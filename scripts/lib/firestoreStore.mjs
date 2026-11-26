import { randomUUID, createPrivateKey } from 'node:crypto';
import { findMovie, planImport, sourceMovieId } from '../../src/utils/movieImport.js';
import { LEASE_MS, newJob, addResult } from './animeRunner.mjs';
import { SourceError } from './phimApi.mjs';
import { readFirestore } from './firestoreRecovery.mjs';

export function validateCredentials(env = process.env) {
  const expected = env.FIREBASE_PROJECT_ID || 'loliphim-db';
  if (typeof expected !== 'string' || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(expected)) throw new Error('Invalid FIREBASE_PROJECT_ID');
  if (env.FIRESTORE_EMULATOR_HOST) {
    if (!expected.startsWith('demo-')) throw new Error('Emulator requires a demo-* FIREBASE_PROJECT_ID');
    if (!/^(?:localhost|127\.0\.0\.1|\[::1\]):\d{1,5}$/.test(env.FIRESTORE_EMULATOR_HOST)) throw new Error('Emulator requires a loopback host:port');
    const port = Number(env.FIRESTORE_EMULATOR_HOST.split(':').at(-1));
    if (port < 1 || port > 65535) throw new Error('Emulator requires a valid TCP port');
    return { projectId: expected, emulator: true, emulatorHost: env.FIRESTORE_EMULATOR_HOST };
  }
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON GitHub Actions Secret');
  let account;
  try { account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON); } catch { throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT_JSON: expected JSON object'); }
  if (account?.type !== 'service_account' || !['private_key', 'client_email', 'project_id'].every(k => typeof account[k] === 'string' && account[k].trim())) throw new Error('Incomplete Firebase service account JSON');
  if (account.project_id !== expected) throw new Error('Firebase project mismatch; set FIREBASE_PROJECT_ID to the existing CineSmart project');
  if (!/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(account.client_email)) throw new Error('Invalid Firebase service account email');
  try {
    const key = createPrivateKey(account.private_key);
    if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048) throw new Error('RSA key required');
  } catch { throw new Error('Invalid Firebase service account private key (expected RSA PEM)'); }
  return { projectId: expected, account };
}

export async function connectFirestore(env = process.env) {
  const config = validateCredentials(env);
  const { initializeApp, cert, deleteApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const app = initializeApp({ projectId: config.projectId, ...(config.emulator ? {} : { credential: cert(config.account) }) }, 'anime-' + randomUUID());
  const db = getFirestore(app);
  try { db.settings({ ignoreUndefinedProperties: false, ...(config.emulator ? { host: config.emulatorHost, ssl: false } : {}) }); }
  catch (error) { await deleteApp(app); throw error; }
  return { db, close: () => deleteApp(app) };
}

const IDENTITY_FIELDS = ['title', 'originalTitle', 'year', 'slug', 'sourceSlug', 'country'];

// Targeted per-movie lookup avoids scanning the entire catalogue on every invocation.
export async function firestoreStore(db, { dryRun = false, now = Date.now } = {}) {
  const owner = randomUUID(), ref = db.doc('crawlerJobs/dailyJapaneseAnime');
  const moviesCol = db.collection('movies');
  const yearCache = new Map();
  const runCatalog = new Map();
  const virtual = new Map();
  let leased = false;
  function fence(current) {
    if (!current || current.owner !== owner || current.leaseUntil <= now()) throw new Error('Crawler lease lost; refusing stale writes');
  }
  async function loadYearCandidates(rawYear) {
    const yearStr = String(rawYear ?? '').trim();
    if (!yearStr) return [];
    if (!yearCache.has(yearStr)) {
      const yearNum = /^\d{4}$/.test(yearStr) ? Number(yearStr) : null;
      const q = yearNum !== null
        ? moviesCol.where('year', 'in', [yearStr, yearNum])
        : moviesCol.where('year', '==', yearStr);
      const snap = await readFirestore(() => q.select(...IDENTITY_FIELDS).limit(1000).get());
      yearCache.set(yearStr, snap.docs.map(d => ({ ...d.data(), id: d.id })));
    }
    const merged = new Map(yearCache.get(yearStr).map(m => [m.id, m]));
    for (const [id, m] of runCatalog) {
      if (String(m.year ?? '').trim() === yearStr) merged.set(id, m);
    }
    return [...merged.values()];
  }
  async function resolveIncoming(incoming) {
    if (!incoming) return { id: null, prefetched: null };
    const slug = incoming.sourceSlug || incoming.slug;
    if (runCatalog.size) {
      const inRun = findMovie([...runCatalog.values()], incoming);
      if (inRun) return { id: inRun.id, prefetched: virtual.get(inRun.id) || null };
    }
    if (slug) {
      const directId = sourceMovieId(slug);
      const directSnap = await readFirestore(() => moviesCol.doc(directId).get());
      if (directSnap.exists) return { id: directSnap.id, prefetched: directSnap.data() };
      const [bySourceSnap, bySlugSnap] = await Promise.all([
        readFirestore(() => moviesCol.where('sourceSlug', '==', slug).select(...IDENTITY_FIELDS).limit(2).get()),
        readFirestore(() => moviesCol.where('slug', '==', slug).select(...IDENTITY_FIELDS).limit(2).get()),
      ]);
      const exact = new Map();
      for (const d of [...bySourceSnap.docs, ...bySlugSnap.docs]) exact.set(d.id, { ...d.data(), id: d.id });
      if (exact.size > 1) throw new SourceError('Ambiguous source identity; reconcile manually');
      if (exact.size === 1) return { id: [...exact.keys()][0], prefetched: null };
    }
    const candidates = await loadYearCandidates(incoming.year);
    const candidate = candidates.length ? findMovie(candidates, incoming) : null;
    return { id: candidate?.id || sourceMovieId(incoming.sourceSlug), prefetched: null };
  }
  return {
    async acquire({ start, end }) {
      if (dryRun) return newJob(start, end, now());
      const job = await db.runTransaction(async tx => {
        const old = (await tx.get(ref)).data();
        if (old?.leaseUntil > now()) throw new Error('Another crawler owns the active lease');
        if (old?.resumeAt > now()) return { ...old, status: 'pending' };
        const pending = old && ['running', 'pending'].includes(old.status);
        // A full scan covers all unfinished work in an interrupted manual subset.
        const promoteToFullScan = pending && start === 1 && end === 2 && (old.start !== 1 || old.end !== 2);
        const active = pending && !promoteToFullScan;
        if (active && (old.start !== start || old.end !== end)) throw new Error('Resume the pending page range before choosing a different range');
        const next = active ? { ...old } : newJob(start, end, now());
        if (!active && old) next.previousReport = { id: old.id, status: old.status, startedAt: old.startedAt, finishedAt: old.finishedAt, stats: old.stats, failures: (old.failures || []).slice(0, 100), failedMovies: old.failures?.length || 0 };
        Object.assign(next, { owner, status: 'running', resumeAt: 0, leaseUntil: now() + LEASE_MS });
        tx.set(ref, next);
        return next;
      });
      leased = job.owner === owner; return job;
    },
    async commit(state, incoming) {
      let id = null, prefetched = null;
      try { ({ id, prefetched } = await resolveIncoming(incoming)); }
      catch (error) {
        if (error instanceof SourceError) throw error;
        if (/Ambiguous/.test(error.message)) throw new SourceError(error.message);
        throw error;
      }
      const movieRef = id ? moviesCol.doc(id) : null;
      let committedMovie;
      const perform = async tx => {
        committedMovie = undefined;
        if (!dryRun) {
          const current = (await tx.get(ref)).data(); fence(current);
          if (current.id !== state.id) throw new Error('Crawler job was replaced');
        }
        let existing;
        if (movieRef) {
          existing = virtual.get(id) || (dryRun ? prefetched : undefined);
          if (!existing) {
            const doc = await (tx ? tx.get(movieRef) : readFirestore(() => movieRef.get()));
            if (doc.exists) existing = doc.data();
          }
        }
        const next = structuredClone(state);
        if (incoming) {
          if (existing?.sourceSlug && existing.sourceSlug !== incoming.sourceSlug) throw new SourceError('Conflicting source identity');
          const plan = planImport(existing, incoming, new Date(now()).toISOString());
          next.lastResult = { action: plan.action, added: plan.added };
          addResult(next, plan);
          if (plan.action !== 'skip') {
            if (Buffer.byteLength(JSON.stringify({ ...existing, ...plan.data })) > 850000) throw new SourceError('Movie approaches Firestore document size limit; manual split required');
            if (!dryRun) {
              if (existing) tx.update(movieRef, plan.data);
              else tx.create(movieRef, plan.data);
            }
            committedMovie = { ...existing, ...plan.data, id };
          }
        }
        next.leaseUntil = now() + LEASE_MS;
        next.heartbeatAt = new Date(now()).toISOString();
        if (!dryRun) tx.set(ref, next);
        return next;
      };
      let next;
      try { next = dryRun ? await perform(null) : await db.runTransaction(perform); }
      catch (error) {
        if (/Ambiguous/.test(error.message)) throw new SourceError(error.message);
        throw error;
      }
      if (committedMovie) {
        if (dryRun) virtual.set(id, committedMovie);
        runCatalog.set(id, committedMovie);
      }
      return next;
    },
    async release() {
      if (!leased || dryRun) return;
      await db.runTransaction(async tx => {
        const current = (await tx.get(ref)).data();
        if (current?.owner === owner) tx.update(ref, { leaseUntil: 0 });
      });
      leased = false;
    },
  };
}
