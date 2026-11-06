import { appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createSource, pageRange } from './lib/phimApi.mjs';
import { runAnimeSync } from './lib/animeRunner.mjs';
import { connectFirestore, firestoreStore } from './lib/firestoreStore.mjs';

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
export async function main() {
  const settings = options();
  const connection = await connectFirestore();
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  try {
    const store = await firestoreStore(connection.db, settings);
    const job = await runAnimeSync({ ...settings, store, source: createSource(), shouldStop: () => stopping });
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
    console.log(report);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, '\n```text\n' + report + '\n```\n');
    // Pending work/errors are visible failures; never claim a completed sync.
    if (job.status !== 'completed') process.exitCode = 1;
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
