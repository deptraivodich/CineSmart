import { findMovie, sourceMovieId } from './movieImport.js';

export function prepareCloudSync(movies, cloudCatalog = []) {
  const targets = new Set();
  return movies.filter(movie => movie && !String(movie.id || '').startsWith('mock_')).map(movie => {
    if (typeof movie.id !== 'string' || !movie.id || movie.id.includes('/')) {
      throw new Error('Phim chưa có ID hợp lệ để đồng bộ.');
    }
    // Stable IDs make retries safe even after some chunks have committed.
    let id = movie.id;
    if (id.startsWith('local_')) {
      const existing = findMovie(cloudCatalog, movie);
      id = existing?.id || (movie.sourceSlug ? sourceMovieId(movie.sourceSlug) : `imported-${id}`);
    }
    if (targets.has(id)) throw new Error('Có nhiều bản phim cục bộ cùng định danh. Hãy kiểm tra trước khi đồng bộ.');
    targets.add(id);
    const { id: originalId, ...data } = movie;
    return { id, originalId, data };
  });
}

export function shouldSyncMovie(existing, incoming) {
  if (!existing) return true;
  const cloudTime = Date.parse(existing.updatedAt || existing.createdAt || '');
  const localTime = Date.parse(incoming.updatedAt || incoming.createdAt || '');
  if (Number.isFinite(cloudTime) && (!Number.isFinite(localTime) || cloudTime > localTime)) return false;
  return Object.keys(incoming).some(key => JSON.stringify(incoming[key]) !== JSON.stringify(existing[key]));
}

export function cloudSyncChunks(records) {
  const chunks = [];
  let chunk = [];
  let bytes = 0;
  const encoder = new TextEncoder();
  for (const record of records) {
    const recordBytes = encoder.encode(JSON.stringify(record)).length;
    if (chunk.length && (chunk.length === 100 || bytes + recordBytes > 2 * 1024 * 1024)) {
      chunks.push(chunk);
      chunk = [];
      bytes = 0;
    }
    chunk.push(record);
    bytes += recordBytes;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}
