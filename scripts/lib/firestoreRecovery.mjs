function errorCode(error) {
  return String(error?.code ?? '').toLowerCase().replace(/^firestore\//, '').replaceAll('_', '-');
}

export function isFirestoreQuotaError(error) {
  return ['8', 'resource-exhausted'].includes(errorCode(error));
}

// Retry reads only. Replaying a committed write can double-count a saved cursor.
export async function readFirestore(operation, { sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const retryable = ['8', 'resource-exhausted', '4', 'deadline-exceeded', '14', 'unavailable'].includes(errorCode(error));
      if (!retryable || attempt === 2) throw error;
      await sleep(1000 * 2 ** attempt);
    }
  }
}

export function nextQuotaReset(now = Date.now()) {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
  const today = format.format(now);
  let reset = Math.ceil((now + 1) / 3600000) * 3600000;
  while (format.format(reset) === today) reset += 3600000;
  return reset + 10 * 60000;
}

export function completedDailySync(job, now = Date.now()) {
  if (job?.status !== 'completed' || job.start !== 1 || job.end !== 10 || job.stats?.pages !== 10) return false;
  const finished = Date.parse(job.finishedAt);
  if (!Number.isFinite(finished)) return false;
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' });
  return day.format(finished) === day.format(now);
}
