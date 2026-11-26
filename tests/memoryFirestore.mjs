// In-memory Firestore protocol fake. No network, credentials or real database writes.
// This exercises the production adapter's transactions; it is not emulator/live evidence.
export class MemoryFirestore {
  constructor(seed = {}) {
    this.data = new Map(Object.entries(structuredClone(seed)));
    this.writes = 0;
    this.movieWrites = 0;
    this.movieReads = 0;
    this.serial = Promise.resolve();
    this.failAfterMovieCommit = false;
    this.failBeforeMovieCommit = false;
  }
  doc(path) {
    const db = this;
    return {
      path,
      id: path.split('/').at(-1),
      async get() {
        if (path.startsWith('movies/')) db.movieReads++;
        return db.snapshot(path);
      },
    };
  }
  snapshot(path) {
    const value = this.data.get(path);
    return { exists: value !== undefined, id: path.split('/').at(-1), data: () => structuredClone(value) };
  }
  collection(name) {
    const db = this;
    const makeQuery = (filters = [], maximum = Infinity) => ({
      doc: id => db.doc(name + '/' + id),
      select: () => makeQuery(filters, maximum),
      limit: n => makeQuery(filters, n),
      where: (field, op, value) => makeQuery([...filters, { field, op, value }], maximum),
      async get() {
        const docs = [...db.data.keys()]
          .filter(p => p.startsWith(name + '/'))
          .filter(p => {
            const doc = db.data.get(p);
            return filters.every(({ field, op, value }) => {
              const actual = doc?.[field];
              if (op === '==') return actual === value;
              if (op === 'in') return Array.isArray(value) && value.includes(actual);
              throw new Error('Unsupported MemoryFirestore operator: ' + op);
            });
          })
          .slice(0, maximum)
          .map(p => {
            if (name === 'movies') db.movieReads++;
            return db.snapshot(p);
          });
        return { size: docs.length, docs };
      },
    });
    return makeQuery();
  }
  async runTransaction(callback) {
    const previous = this.serial;
    let unlock;
    this.serial = new Promise(resolve => { unlock = resolve; });
    await previous;
    const pending = [];
    const tx = {
      get: async ref => {
        if (ref.path.startsWith('movies/')) this.movieReads++;
        return this.snapshot(ref.path);
      },
      set: (ref, data) => pending.push({ ref, data, kind: 'set' }),
      create: (ref, data) => pending.push({ ref, data, kind: 'create' }),
      update: (ref, data) => pending.push({ ref, data, kind: 'update' }),
    };
    try {
      const value = await callback(tx);
      const hasMovie = pending.some(w => w.ref.path.startsWith('movies/'));
      if (hasMovie && this.failBeforeMovieCommit) { this.failBeforeMovieCommit = false; throw new Error('Injected database failure before commit'); }
      for (const { ref, data, kind } of pending) {
        if (kind === 'create' && this.data.has(ref.path)) throw new Error('Already exists');
        if (kind === 'update' && !this.data.has(ref.path)) throw new Error('Missing document');
        this.data.set(ref.path, structuredClone(kind === 'update' ? { ...this.data.get(ref.path), ...data } : data));
        this.writes++;
        if (ref.path.startsWith('movies/')) this.movieWrites++;
      }
      if (hasMovie && this.failAfterMovieCommit) { this.failAfterMovieCommit = false; throw new Error('Injected lost acknowledgement after atomic commit'); }
      return value;
    } finally { unlock(); }
  }
}
