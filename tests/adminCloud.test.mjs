import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import handler from '../api/admin/crawl.js';
import { crawlAdminMovies } from '../server/adminCrawl.js';
import { prepareCloudSync, shouldSyncMovie, cloudSyncChunks } from '../src/utils/cloudMovieSync.js';

function response() {
  return {
    headers: {}, statusCode: 200, body: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
}

test('Firebase Admin Auth loads when the runtime cannot require ESM modules', () => {
  execFileSync(process.execPath, ['--no-experimental-require-module', '-e', 'require("firebase-admin/auth")'], { stdio: 'pipe' });
});

test('Admin API rejects anonymous, local-role and forged Firebase tokens', async () => {
  const forged = ['eyJhbGciOiJub25lIn0', Buffer.from(JSON.stringify({ admin: true, email_verified: true, aud: 'loliphim-db' })).toString('base64url'), 'fake'].join('.');
  for (const headers of [{}, { authorization: 'Bearer local-admin' }, { authorization: 'Bearer ' + forged }]) {
    const result = response();
    await handler({ method: 'POST', headers, body: { operation: 'batch', movies: [] } }, result);
    assert.equal(result.statusCode, 401);
    assert.equal(result.headers['Cache-Control'], 'no-store');
  }
});

test('Admin API restricts methods', async () => {
  const result = response();
  await handler({ method: 'GET', headers: {} }, result);
  assert.equal(result.statusCode, 405);
  assert.equal(result.headers.Allow, 'POST');
});

test('Admin crawler bounds batch requests and only contacts the fixed PhimAPI origin', async () => {
  let calls = 0;
  const fetchImpl = async url => {
    calls++;
    assert.equal(url, 'https://phimapi.com/phim/anime-one');
    return { ok: true, async json() {
      return { status: true, movie: { slug: 'anime-one', name: 'Anime One', country: [], category: [] }, episodes: [] };
    } };
  };
  await assert.rejects(crawlAdminMovies({ operation: 'batch', movies: Array(6).fill({ id: 'one' }) }, fetchImpl));
  await assert.rejects(crawlAdminMovies({ operation: 'batch', movies: [{ id: '../bad' }] }, fetchImpl));
  const invalid = await crawlAdminMovies({ operation: 'batch', movies: [{ id: 'one', sourceSlug: 'https://internal.invalid' }] }, fetchImpl);
  assert.equal(calls, 0);
  assert.ok(invalid.movies[0].error);
  const valid = await crawlAdminMovies({ operation: 'batch', movies: [{ id: 'one', sourceSlug: 'anime-one' }] }, fetchImpl);
  assert.equal(calls, 1);
  assert.equal(valid.movies[0].incoming.sourceSlug, 'anime-one');
});

test('Cloud sync preserves deterministic IDs over retries and skips demo records', () => {
  const records = Array.from({ length: 586 }, (_, index) => ({ id: `local_${index}`, title: `Movie ${index}` }));
  const first = prepareCloudSync([...records, { id: 'mock_1' }]);
  const retry = prepareCloudSync(records);
  assert.equal(first.length, 586);
  assert.deepEqual(first, retry);
  assert.equal(new Set(first.map(movie => movie.id)).size, 586);
  const chunks = cloudSyncChunks(first);
  assert.deepEqual(chunks.map(chunk => chunk.length), [100, 100, 100, 100, 100, 86]);
  assert.deepEqual(chunks.flat(), first);
  assert.deepEqual(cloudSyncChunks([{ data: 'a'.repeat(1500000) }, { data: 'b'.repeat(1500000) }]).map(chunk => chunk.length), [1, 1]);
  assert.throws(() => prepareCloudSync([{ title: 'Missing ID' }]));
  const legacy = { id: 'old-cloud-id', title: 'Legacy movie', year: '2025' };
  assert.equal(prepareCloudSync([{ ...legacy, id: 'local_1' }], [legacy])[0].id, legacy.id);
  assert.throws(() => prepareCloudSync([{ ...legacy, id: 'local_1' }, { ...legacy, id: 'local_2' }], [legacy]));
});

test('Cloud sync skips unchanged and stale cache data while retaining current updates', () => {
  const cloud = { title: 'Movie', updatedAt: '2026-11-07T10:00:00Z', episodes: [{ name: '1', url: 'https://stream.test/1' }] };
  assert.equal(shouldSyncMovie(cloud, structuredClone(cloud)), false);
  assert.equal(shouldSyncMovie(cloud, { ...cloud, title: 'Stale', updatedAt: '2026-11-06T10:00:00Z' }), false);
  assert.equal(shouldSyncMovie(cloud, { title: 'No revision' }), false);
  assert.equal(shouldSyncMovie(cloud, { ...cloud, title: 'New', updatedAt: '2026-11-07T11:00:00Z' }), true);
  assert.equal(shouldSyncMovie(null, cloud), true);
});
