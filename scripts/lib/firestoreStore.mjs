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

// One bounded catalogue identity scan per invocation, then one document per movie.
export async function firestoreStore(db, { dryRun = false, now = Date.now } = {}) {
  const owner = randomUUID(), ref = db.doc('crawlerJobs/dailyJapaneseAnime');
  const snapshot = await readFirestore(() => db.collection('movies').select('title', 'originalTitle', 'year', 'slug', 'sourceSlug').limit(10001).get());
  if (snapshot.size > 10000) throw new Error('Catalogue exceeds 10000 movies; migrate to an indexed identity catalogue before running');
  const catalog = snapshot.docs.map(d => ({ ...d.data(), id: d.id }));
  const virtual = new Map();
  let leased = false;
  function fence(current) {
    if (!current || current.owner !== owner || current.leaseUntil <= now()) throw new Error('Crawler lease lost; refusing stale writes');
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
        const promoteToFullScan = pending && start === 1 && end === 10 && (old.start !== 1 || old.end !== 10);
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
      let candidate;
      try { candidate = incoming ? findMovie(catalog, incoming) : null; }
      catch (error) { throw new SourceError(error.message); }
      const id = incoming ? candidate?.id || sourceMovieId(incoming.sourceSlug) : null;
      const movieRef = id ? db.collection('movies').doc(id) : null;
      let committedMovie;
      const perform = async tx => {
        committedMovie = undefined;
        if (!dryRun) {
          const current = (await tx.get(ref)).data(); fence(current);
          if (current.id !== state.id) throw new Error('Crawler job was replaced');
        }
        let existing;
        if (movieRef) {
          existing = virtual.get(id);
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
        const i = catalog.findIndex(m => m.id === id);
        if (i < 0) catalog.push(committedMovie); else catalog[i] = committedMovie;
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
