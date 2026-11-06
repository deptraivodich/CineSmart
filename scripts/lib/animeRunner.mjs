import { randomUUID } from 'node:crypto';
import { isJapaneseAnimation, normalizePhimApiMovie } from '../../src/utils/movieImport.js';
import { pageRange, SourceError } from './phimApi.mjs';

export const LEASE_MS = 5 * 60000;
export function newJob(start, end, now = Date.now()) {
  pageRange(start, end);
  return { id: randomUUID(), start, end, page: start, index: 0, items: null, seen: [], failures: [], pageAttempts: 0,
    status: 'running', startedAt: new Date(now).toISOString(), finishedAt: null,
    stats: { pages: 0, discovered: 0, new: 0, update: 0, skip: 0, filtered: 0, episodes: 0, errors: 0 } };
}
export function addResult(job, result) {
  job.stats[result.action]++;
  job.stats.episodes += result.added;
}

// store.commit checkpoints a movie write and cursor/counters atomically.
export async function runAnimeSync({ store, source, start = 1, end = 10, dryRun = false, mode = 'manual', now = Date.now, budgetMs = 18 * 60000, log = console.log, shouldStop = () => false }) {
  pageRange(start, end);
  let job = await store.acquire({ start, end, dryRun, now: now() });
  const started = now();
  log(`[CineSmart Bot] ${dryRun ? 'DRY-RUN' : mode} started ${new Date(started).toISOString()} | Japanese animation | pages ${job.start}-${job.end}`);
  const save = async movie => { job = await store.commit(job, movie); };
  const pause = async () => { job.status = 'pending'; await save(); return job; };
  const outOfTime = () => shouldStop() || now() - started >= budgetMs;
  async function process(slug, retry = false) {
    const priorFailure = job.failures.find(f => f.slug === slug);
    try {
      const detail = await source.detail(slug);
      if (detail?.status !== true || !detail.movie || !Array.isArray(detail.episodes)) throw new SourceError('Invalid movie detail JSON', { retryable: true });
      if (detail.movie.slug !== slug) throw new SourceError('Detail slug does not match requested identity');
      if (!isJapaneseAnimation(detail.movie)) {
        job.stats.filtered++;
        job.failures = job.failures.filter(f => f.slug !== slug);
        await save(); log(`[FILTER] ${slug}`); return;
      }
      let movie;
      try { movie = normalizePhimApiMovie(detail); }
      catch { throw new SourceError('Malformed movie metadata', { retryable: true }); }
      job.failures = job.failures.filter(f => f.slug !== slug);
      await save(movie);
      log(`[${job.lastResult.action.toUpperCase()}] ${movie.title} (+${job.lastResult.added} episodes)`);
    } catch (error) {
      // Persistence/permission/lease errors are fatal. Never advance a cursor after a failed write.
      if (!(error instanceof SourceError)) throw error;
      const old = priorFailure;
      job.failures = job.failures.filter(f => f.slug !== slug);
      const attempts = (old?.attempts || 0) + 1;
      job.failures.push({ slug, page: old?.page || job.page, attempts, retryable: error.retryable || error.blocked, message: error.message, retryAt: error.retryAt, status: error.status, providerCode: error.providerCode, requestId: error.requestId });
      job.stats.errors++;
      if (error.blocked) {
        if (!retry) { job.index--; job.seen = job.seen.filter(s => s !== slug); job.stats.discovered--; }
        job.status = attempts >= 3 ? 'failed' : 'pending';
        if (error.retryAt) job.resumeAt = error.retryAt;
        await save(); throw error;
      }
      await save(); log(`[ERROR] ${slug}: ${error.message}`);
    }
  }
  try {
    if (job.resumeAt > now()) {
      log(`[COOLDOWN] Source Retry-After is active until ${new Date(job.resumeAt).toISOString()}; no source requests made`);
      return job;
    }
    while (job.page <= job.end) {
      if (outOfTime()) return await pause();
      if (job.items === null) {
        log(`[Page ${job.page}/10] Fetching movies...`);
        try { job.items = await source.page(job.page); }
        catch (error) {
          job.pageAttempts++;
          job.status = job.pageAttempts >= 3 ? 'failed' : 'pending';
          job.lastError = error instanceof SourceError ? error.message : 'Unexpected page error';
          if (error.retryAt) job.resumeAt = error.retryAt;
          await save(); throw error;
        }
        job.pageAttempts = 0;
        job.stats.pages++;
        await save();
      }
      while (job.index < job.items.length) {
        if (outOfTime()) return await pause();
        const { slug } = job.items[job.index];
        job.index++;
        if (job.seen.includes(slug)) { await save(); continue; }
        job.seen.push(slug); job.stats.discovered++;
        await process(slug);
      }
      job.page++; job.index = 0; job.items = null;
      await save();
    }
    // Each failing slug gets at most one retry per workflow and three durable attempts.
    const retryable = job.failures.filter(f => f.retryable && f.attempts < 3);
    for (const failure of retryable) {
      if (outOfTime()) return await pause();
      await process(failure.slug, true);
    }
    job.status = job.failures.some(f => f.retryable && f.attempts < 3) ? 'pending' : job.failures.length ? 'completed_with_errors' : 'completed';
    if (job.status !== 'pending') job.finishedAt = new Date(now()).toISOString();
    await save();
    return job;
  } finally {
    await store.release();
    log(`[CineSmart Bot] Worker ended ${new Date(now()).toISOString()} | status=${job.status} | ${JSON.stringify(job.stats)} | failures=${JSON.stringify(job.failures)}`);
  }
}
