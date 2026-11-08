import { appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createSource, pageRange } from './lib/phimApi.mjs';
import { runAnimeSync } from './lib/animeRunner.mjs';
import { connectFirestore, firestoreStore } from './lib/firestoreStore.mjs';
import { completedDailySync, isFirestoreQuotaError, nextQuotaReset, readFirestore } from './lib/firestoreRecovery.mjs';

export function options(env = process.env, argv = process.argv.slice(2)) {
  const automatic = env.GITHUB_EVENT_NAME === 'schedule';
  const start = automatic ? 1 : Number(env.CRAWLER_START_PAGE || 1);
  const end = automatic ? 10 : Number(env.CRAWLER_END_PAGE || 10);
  pageRange(start, end);
  // Only the literal false requests writes. Missing/mistyped configuration stays read-only.
  const dryRun = argv.includes('--dry-run') || env.CRAWLER_DRY_RUN !== 'false';
  if (!dryRun) {
    if (env.CRAWLER_WRITES_ENABLED !== 'true') throw new Error('Production writes disabled; owner must explicitly enable CRAWLER_WRITES_ENABLED');
    if (env.GITHUB_ACTIONS === 'true' && (!env.CRAWLER_DEFAULT_BRANCH ||
        env.GITHUB_REF !== `refs/heads/${env.CRAWLER_DEFAULT_BRANCH}` ||
        !['schedule', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME))) {
      throw new Error('Production writes require the default branch and a schedule/workflow_dispatch event');
    }
  }
  return { start, end, dryRun, mode: automatic ? 'automatic' : 'manual' };
}
async function writeReport(report, env, log) {
  log(report);
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, '\n```text\n' + report + '\n```\n');
}

export async function main({
  env = process.env,
  argv = process.argv.slice(2),
  connect = connectFirestore,
  source = createSource(),
  now = Date.now,
  sleep,
  log = console.log,
} = {}) {
  const settings = options(env, argv);
  const connection = await connect(env);
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  try {
    // Check one document before scanning the catalogue or contacting the source.
    const checkpoint = await readFirestore(() => connection.db.doc('crawlerJobs/dailyJapaneseAnime').get(), { sleep });
    const previous = checkpoint.data();
    if (!settings.dryRun && settings.mode === 'automatic' && completedDailySync(previous, now())) {
      await writeReport(`CineSmart Japanese anime sync\nStatus: already_completed_today\nFull pages 1-10 sync finished at ${previous.finishedAt}\nMovies changed in this recovery invocation: 0`, env, log);
      return { status: 'already_completed_today' };
    }
    const store = await firestoreStore(connection.db, { ...settings, now });
    const job = await runAnimeSync({ ...settings, store, source, now, log, shouldStop: () => stopping });
    const report = [
      'CineSmart Japanese anime sync',
      'Mode: ' + (settings.dryRun ? 'dry-run (no Firestore writes)' : settings.mode),
      'Status: ' + job.status, 'Started: ' + job.startedAt, 'Finished: ' + (job.finishedAt || 'pending/resumable'),
      'Pages checked: ' + job.stats.pages + '/' + (job.end - job.start + 1) + ' (daily total: 10)',
      'Discovered: ' + job.stats.discovered, 'New movies: ' + job.stats.new, 'Updated movies: ' + job.stats.update,
      'Unchanged: ' + job.stats.skip, 'Filtered: ' + job.stats.filtered, 'New episodes: ' + job.stats.episodes,
      'Failed movies: ' + job.failures.length, 'Error attempts: ' + job.stats.errors,
      'Retry queue: ' + JSON.stringify(job.failures.filter(f => f.retryable && f.attempts < 3)),
    ].join('\n');
    await writeReport(report, env, log);
    // Pending work/errors are visible failures; never claim a completed sync.
    if (job.status !== 'completed') process.exitCode = 1;
    return job;
  } catch (error) {
    if (!isFirestoreQuotaError(error)) throw error;
    const resumeAt = nextQuotaReset(now());
    await writeReport([
      'CineSmart Japanese anime sync',
      'Status: deferred_firestore_quota',
      'Firestore returned RESOURCE_EXHAUSTED after bounded read retries or during persistence.',
      'Synchronization is incomplete. The next invocation will retry using the last persisted checkpoint.',
      'Expected daily quota reset (with buffer): ' + new Date(resumeAt).toISOString(),
      'Automatic recovery is scheduled for 16:30 Vietnam time. Repeated exhaustion remains deferred.',
    ].join('\n'), env, log);
    return { status: 'deferred_firestore_quota', resumeAt };
  } finally {
    process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
    await connection.close();
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    // SDK errors can contain credentials or request details. Only our configuration/source messages are safe.
    const safe = /^(Missing |Invalid |Incomplete |Firebase project |Emulator requires |Pages must |Source |Another crawler |Resume the pending |Catalogue exceeds |Crawler lease |Crawler job |Production writes )/.test(error.message);
    console.error('[CineSmart Bot] FAILED: ' + (safe ? error.message : 'Worker failed; check Firebase IAM, database availability and job checkpoint. Code=' + String(error.code || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '')));
    process.exitCode = 1;
  });
}
