let cachedTotal = null;
let expiresAt = 0;
let pending = null;

export async function getCatalogueTotal({ projectId = process.env.VITE_FIREBASE_PROJECT_ID, fetchImpl = fetch } = {}) {
  if (!projectId || !/^[a-z0-9-]+$/.test(projectId)) return null;
  if (Date.now() < expiresAt) return cachedTotal;
  if (pending) return pending;
  pending = (async () => {
    try {
      const response = await fetchImpl(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runAggregationQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
        body: JSON.stringify({
          structuredAggregationQuery: {
            structuredQuery: { from: [{ collectionId: 'movies' }] },
            aggregations: [{ alias: 'total', count: {} }],
          },
        }),
      });
      if (!response.ok) throw new Error('Catalogue count unavailable');
      const rows = await response.json();
      const value = rows.find(row => row.result)?.result.aggregateFields?.total;
      const total = Number(value?.integerValue ?? value?.doubleValue);
      if (!Number.isSafeInteger(total) || total < 0) throw new Error('Invalid catalogue count');
      cachedTotal = total;
      expiresAt = Date.now() + 600000;
      return total;
    } catch {
      // A failed refresh must not present a stale count as a current Cloud total.
      cachedTotal = null;
      expiresAt = Date.now() + 30000;
      return null;
    }
  })();
  try {
    return await pending;
  } finally {
    pending = null;
  }
}
