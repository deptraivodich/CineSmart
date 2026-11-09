import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, scryptSync } from 'node:crypto';
import { createComment, listComments } from '../server/comments.js';
import { loginAdmin } from '../server/adminLogin.js';
import { commentsHandler } from '../api/comments.js';
import { validateOrigin } from '../server/httpPolicy.js';
import { crawlAdminMovies } from '../server/adminCrawl.js';
import { MemoryFirestore } from './memoryFirestore.mjs';

class QueryFirestore extends MemoryFirestore {
  collection(path) {
    const db = this, order = [];
    let maximum = Infinity, cursor;
    return {
      orderBy(field, direction) { order.push([field, direction]); return this; },
      startAfter(...value) { cursor = value; return this; },
      limit(value) { maximum = value; return this; },
      async get() {
        let rows = [...db.data].filter(([key]) => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/')).map(([key]) => db.snapshot(key));
        const values = row => order.map(([field]) => field === '__name__' ? row.id : row.data()[field]);
        const compare = (a, b) => {
          for (let index = 0; index < order.length; index++) {
            const value = String(a[index]).localeCompare(String(b[index])) * (order[index][1] === 'desc' ? -1 : 1);
            if (value) return value;
          }
          return 0;
        };
        rows.sort((a, b) => compare(values(a), values(b)));
        if (cursor) rows = rows.filter(row => compare(values(row), cursor) > 0);
        return { docs: rows.slice(0, maximum) };
      },
    };
  }
}
const newBody = overrides => ({ movieId: 'movie-one', username: 'Viewer', content: 'Nội dung bình luận', requestId: randomUUID(), ...overrides });
const newDb = () => new QueryFirestore({ 'movies/movie-one': { title: 'Movie One' }, 'movies/movie-two': { title: 'Movie Two' } });
const response = () => ({ headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

test('comments persist in movie and global feeds; retries/concurrent requests do not duplicate', async () => {
  const db = newDb(), body = newBody();
  const [first, retry] = await Promise.all([createComment(body, { db, key: 'client', now: 100000 }), createComment(body, { db, key: 'client', now: 100001 })]);
  assert.deepEqual(first, retry);
  assert.equal((await listComments({ movieId: 'movie-one' }, { db })).comments.length, 1);
  assert.equal((await listComments({}, { db })).comments.length, 1);
  assert.equal(db.data.get('requestLimits/comments-global').count, 1);
  assert.equal(JSON.stringify(first).includes('fingerprint'), false);
  assert.equal(first.movie_title, 'Movie One');
  await assert.rejects(createComment({ ...body, content: 'different' }, { db, key: 'client' }), error => error.status === 409);
});

test('lost acknowledgement recovers the stored comment without another write or rate charge', async () => {
  const db = newDb(), body = newBody();
  const transaction = db.runTransaction.bind(db);
  db.runTransaction = async operation => { await transaction(operation); throw new Error('lost ack'); };
  await assert.rejects(createComment(body, { db, key: 'client' }));
  const writes = db.writes;
  db.runTransaction = transaction;
  const recovered = await createComment(body, { db, key: 'new-network' });
  assert.ok(recovered.id);
  assert.equal(db.writes, writes);
});

test('shared storage pagination is stable, scoped by movie, and hides private fields', async () => {
  const db = newDb();
  for (let index = 0; index < 3; index++) await createComment(newBody({ content: 'Comment ' + index }), { db, key: String(index), now: 100000 + index });
  await createComment(newBody({ movieId: 'movie-two' }), { db, key: 'other', now: 100005 });
  const ids = new Set();
  let cursor;
  do {
    const page = await listComments({ movieId: 'movie-one', limit: 1, cursor }, { db });
    assert.equal(page.comments.length, 1);
    assert.equal(page.comments[0].movie_id, 'movie-one');
    assert.equal('fingerprint' in page.comments[0], false);
    ids.add(page.comments[0].id); cursor = page.nextCursor;
  } while (cursor);
  assert.equal(ids.size, 3);
  await assert.rejects(listComments({ movieId: '../bad' }, { db }), error => error.status === 400);
  await assert.rejects(listComments({ cursor: 'bad' }, { db }), error => error.status === 400);
});

test('comment validation and database failure never report a locally fabricated success', async () => {
  const db = newDb();
  for (const body of [newBody({ content: '' }), newBody({ content: 'x'.repeat(2001) }), newBody({ movieId: '../bad' }), newBody({ movieId: 'missing' })]) await assert.rejects(createComment(body, { db, key: 'client' }));
  assert.equal(db.writes, 0);
  const result = response();
  const handler = commentsHandler(() => { throw new Error('private SDK details'); });
  await handler({ method: 'GET', headers: {}, query: {} }, result);
  assert.equal(result.code, 503);
  assert.equal(JSON.stringify(result.body).includes('private SDK'), false);
});

test('durable comment cooldown survives new requests and rejects foreign origins', async () => {
  const db = newDb();
  await createComment(newBody(), { db, key: 'client', now: 100000 });
  const before = db.writes;
  await assert.rejects(createComment(newBody(), { db, key: 'client', now: 100001 }), error => error.status === 429);
  assert.equal(db.writes, before);
  assert.throws(() => validateOrigin({ headers: { origin: 'https://foreign.invalid' } }, { NODE_ENV: 'production' }), error => error.status === 403);
});

const salt = 'a'.repeat(32);
const env = { ADMIN_LOGIN_UID: 'existing-google-admin', ADMIN_LOGIN_PASSWORD_HASH: `scrypt$${salt}$${scryptSync('fixture-password', salt, 64).toString('hex')}` };
const user = { uid: env.ADMIN_LOGIN_UID, emailVerified: true, disabled: false, customClaims: { admin: true }, providerData: [{ providerId: 'google.com' }] };

test('password alias reuses the already-authorized Google UID; no new roles are issued', async () => {
  const db = newDb(), issued = [];
  const auth = { async getUser(uid) { assert.equal(uid, user.uid); return user; }, async createCustomToken(...args) { issued.push(args); return 'custom-fixture'; } };
  assert.deepEqual(await loginAdmin({ username: 'admin', password: 'fixture-password' }, { db, auth, env, key: 'client' }), { customToken: 'custom-fixture' });
  assert.deepEqual(issued, [[user.uid]]);
  await assert.rejects(loginAdmin({ username: 'admin', password: 'wrong' }, { db, auth, env, key: 'client' }), error => error.status === 401);
  assert.equal(issued.length, 1);
});

test('disabled, unverified or non-admin identities cannot be upgraded by password login', async () => {
  for (const patch of [{ disabled: true }, { emailVerified: false }, { customClaims: {} }, { providerData: [] }]) {
    let issued = false;
    await assert.rejects(loginAdmin({ username: 'admin', password: 'fixture-password' }, { db: newDb(), env, key: 'client', auth: { getUser: async () => ({ ...user, ...patch }), createCustomToken: async () => { issued = true; } } }), error => error.status === 403);
    assert.equal(issued, false);
  }
});

test('login throttling is shared across invocations and fails closed without configuration', async () => {
  const db = newDb();
  const settings = { db, env, key: 'client', auth: {}, now: 100000 };
  for (let index = 0; index < 10; index++) await assert.rejects(loginAdmin({ username: 'admin', password: 'wrong' }, settings), error => error.status === 401);
  await assert.rejects(loginAdmin({ username: 'admin', password: 'fixture-password' }, { ...settings }), error => error.status === 429);
  await assert.rejects(loginAdmin({ username: 'admin', password: 'fixture-password' }, { ...settings, env: {} }));
});

test('KKPhim search validates requests, encodes keywords, and bounds results', async () => {
  let calls = 0;
  const source = async url => {
    calls++;
    const target = new URL(url);
    assert.equal(target.origin, 'https://phimapi.com');
    assert.equal(target.searchParams.get('keyword'), 'Conan & Movie');
    assert.equal(target.searchParams.get('limit'), '20');
    return { ok: true, json: async () => ({ status: 'success', data: { items: Array.from({ length: 25 }, (_, index) => ({ slug: 'conan-' + index, name: 'Conan' })), params: { pagination: { totalItems: 69, totalItemsPerPage: 20 } } } }) };
  };
  await assert.rejects(crawlAdminMovies({ operation: 'search', keyword: 'a', page: 1 }, source));
  assert.equal(calls, 0);
  const result = await crawlAdminMovies({ operation: 'search', keyword: 'Conan & Movie', page: 1 }, source);
  assert.equal(result.movies.length, 20);
  assert.equal(result.totalPages, 4);
});

test('selected-film import fetches every available episode and rejects substituted source identities', async () => {
  const source = async () => ({ ok: true, json: async () => ({ status: true, movie: { slug: 'long-series', name: 'Long Series' }, episodes: [{ server_data: Array.from({ length: 250 }, (_, index) => ({ name: String(index + 1), link_m3u8: `https://stream.test/${index}.m3u8` })) }] }) });
  const result = await crawlAdminMovies({ operation: 'selected', slugs: ['long-series'] }, source);
  assert.equal(result.movies[0].episodes.length, 250);
  await assert.rejects(crawlAdminMovies({ operation: 'selected', slugs: ['different-series'] }, source));
  await assert.rejects(crawlAdminMovies({ operation: 'selected', slugs: ['long-series', 'long-series'] }, source));
});
