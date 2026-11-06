import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSource, listUrl, pageRange, SourceError } from '../scripts/lib/phimApi.mjs';
import { runAnimeSync } from '../scripts/lib/animeRunner.mjs';
import { firestoreStore, validateCredentials, connectFirestore } from '../scripts/lib/firestoreStore.mjs';
import { generateKeyPairSync } from 'node:crypto';
import { checkAnimeSource } from '../scripts/checkAnimeSource.mjs';
import { options } from '../scripts/crawlDailyAnime.mjs';
import { normalizePhimApiMovie, isJapaneseAnimation, findMovie, planImport, episodeKey, movieToTSV } from '../src/utils/movieImport.js';
import { parseTSV } from '../src/utils/MagicParser.js';
import { detailsToTSV, crawlManualUrl } from '../src/services/phimApiImport.js';
import { MemoryFirestore } from './memoryFirestore.mjs';

const clone = structuredClone;
const noop = () => {};
function detail(slug = 'anime-one', count = 2) {
  return { status: true, movie: { slug, name: 'Anime ' + slug, origin_name: 'Original ' + slug, type: 'hoathinh', year: 2026, country: [{ slug: 'nhat-ban', name: 'Nhật Bản' }], director: ['Director'], status: 'ongoing', episode_current: 'Tập ' + count, category: [{ name: 'Anime' }], poster_url: 'poster.jpg', thumb_url: 'banner.jpg', content: '<p>Story</p>', quality: 'HD', imdb: { vote_average: 8.2 }, modified: { time: '2026-01-01T00:00:00Z' } }, episodes: [{ server_data: Array.from({ length: count }, (_, i) => ({ name: String(i + 1), link_m3u8: 'https://v7.kkphimplayer7.com/test/' + slug + '/' + (i + 1) + '.m3u8' })) }] };
}
function fixtureSource({ details = {}, pages = { 1: ['anime-one', 'anime-two'], 2: ['anime-one'] } } = {}) {
  const calls = { pages: [], details: [] };
  return {
    calls,
    async page(page) { calls.pages.push(page); return (pages[page] || []).map(slug => ({ slug })); },
    async detail(slug) { calls.details.push(slug); const value = details[slug]; if (value instanceof Error) throw value; return clone(value || detail(slug)); },
  };
}
async function run(db, source = fixtureSource(), opts = {}) {
  const store = await firestoreStore(db, { dryRun: opts.dryRun, now: opts.now });
  return runAnimeSync({ store, source, log: noop, ...opts });
}
function response(status, body, retryAfter) {
  return { status, ok: status >= 200 && status < 300, headers: { get: () => retryAfter || null }, async json() { if (body instanceof Error) throw body; return body; } };
}

test('automatic options always pages 1-10; reject page 0, 11, fractions and reversed ranges', () => {
  assert.deepEqual(options({ GITHUB_EVENT_NAME: 'schedule', CRAWLER_START_PAGE: '0', CRAWLER_END_PAGE: '11' }, []), { start: 1, end: 10, dryRun: true, mode: 'automatic' });
  for (const args of [[0, 10], [1, 11], [2, 1], [1.5, 10]]) assert.throws(() => pageRange(...args));
  for (let p = 1; p <= 10; p++) {
    const u = new URL(listUrl(p));
    assert.equal(u.pathname, '/v1/api/danh-sach/hoat-hinh');
    assert.deepEqual(Object.fromEntries(u.searchParams), { country: 'nhat-ban', sort_field: 'modified.time', sort_type: 'desc', page: String(p) });
  }
});
test('source validates real API-shaped list pagination and slug identities', async () => {
  const s = createSource({ sleep: async () => {}, fetchImpl: async () => response(200, { status: 'success', data: { items: [{ slug: 'anime-one' }], params: { pagination: { currentPage: 1 } } } }) });
  assert.deepEqual(await s.page(1), [{ slug: 'anime-one' }]);
  await assert.rejects(s.page(2), /pagination mismatch/);
});
test('only Japanese animation details are imported; foreign, live-action and missing country excluded', async () => {
  const foreign = detail('foreign'); foreign.movie.country = [{ slug: 'trung-quoc' }];
  const live = detail('live'); live.movie.type = 'series';
  const missing = detail('missing'); delete missing.movie.country;
  assert.equal(isJapaneseAnimation(foreign.movie), false);
  const db = new MemoryFirestore();
  const result = await run(db, fixtureSource({ pages: { 1: ['foreign', 'live', 'missing', 'anime-one'] }, details: { foreign, live, missing } }));
  assert.equal(result.stats.filtered, 3);
  assert.equal(result.stats.new, 1);
  assert.equal([...db.data.keys()].filter(k => k.startsWith('movies/')).length, 1);
});
test('new document uses existing schema, lowercase collection and source status; all ten pages traversed once', async () => {
  const db = new MemoryFirestore(), source = fixtureSource();
  const result = await run(db, source);
  assert.deepEqual(source.calls.pages, [1,2,3,4,5,6,7,8,9,10]);
  assert.deepEqual(source.calls.details, ['anime-one', 'anime-two']);
  assert.equal(result.stats.discovered, 2);
  const movie = db.data.get('movies/kkphim-anime-one');
  for (const field of ['title','originalTitle','poster','banner','imdb','year','country','director','genres','category','description','quality','episodes','episodesCount','episodesStatus','episodeCurrent','m3u8Url','status','createdAt','updatedAt']) assert.ok(field in movie, field);
  assert.equal(movie.status, 'ongoing');
  assert.equal(movie.episodesStatus, 'Tập 2');
  assert.equal(movie.poster, 'https://phimimg.com/poster.jpg');
  assert.notEqual(movie.poster, movie.banner);
  assert.ok(!('isValid' in movie));
});
test('two unchanged runs do not create movies, duplicate episodes, or touch movie documents/timestamps', async () => {
  const db = new MemoryFirestore();
  await run(db);
  const before = clone([...db.data.entries()].filter(([p]) => p.startsWith('movies/')));
  const writes = db.movieWrites;
  const job = await run(db);
  assert.equal(job.stats.new, 0);
  assert.equal(job.stats.update, 0);
  assert.equal(job.stats.skip, 2);
  assert.deepEqual([...db.data.entries()].filter(([p]) => p.startsWith('movies/')), before);
  assert.equal(db.movieWrites, writes);
});
test('legacy migration keeps ID, createdAt, interactions, admin artwork and nonempty metadata', async () => {
  const incoming = normalizePhimApiMovie(detail());
  const legacy = { ...incoming, sourceSlug: undefined, sourceSync: undefined, createdAt: 'old', poster: 'manual-poster', director: 'Manual Director', country: 'Manual country', views: 42, likes: 9, custom: { foo: true }, episodes: incoming.episodes.slice(0, 1) };
  delete legacy.sourceSlug; delete legacy.sourceSync;
  const db = new MemoryFirestore({ 'movies/legacy-document': legacy });
  const job = await run(db, fixtureSource({ pages: { 1: ['anime-one'] } }));
  const saved = db.data.get('movies/legacy-document');
  assert.equal(job.stats.new, 0); assert.equal(job.stats.update, 1);
  assert.equal(saved.createdAt, 'old'); assert.equal(saved.views, 42); assert.equal(saved.likes, 9);
  assert.equal(saved.director, 'Manual Director'); assert.equal(saved.country, 'Manual country');
  assert.equal(saved.poster, 'manual-poster'); assert.deepEqual(saved.custom, { foo: true });
  assert.equal(saved.sourceSlug, 'anime-one'); assert.equal(saved.episodes.length, 2);
});
test('controlled changes update source-managed country/director/status/current and missing description', () => {
  const first = planImport(null, normalizePhimApiMovie(detail())).data;
  first.description = '';
  const next = { ...normalizePhimApiMovie(detail()), director: 'New Director', country: 'Nhật Bản, Mỹ', status: 'completed', episodeCurrent: 'Hoàn tất (2/2)', episodesStatus: 'Hoàn tất (2/2)' };
  const update = planImport(first, next);
  for (const k of ['director','country','status','episodeCurrent','episodesStatus','description']) assert.equal(update.data[k], next[k]);
  const manual = { ...first, director: 'Admin custom director' };
  assert.ok(!('director' in planImport(manual, next).data));
});
test('new episodes and changed valid source links merge; source omissions never delete old data', () => {
  const old = planImport(null, normalizePhimApiMovie(detail('anime-one', 2))).data;
  const next = normalizePhimApiMovie(detail('anime-one', 3));
  next.episodes[0].url = 'https://cdn.example/changed.m3u8';
  const update = planImport(old, next);
  assert.equal(update.added, 1); assert.equal(update.data.episodes.length, 3);
  assert.equal(update.data.episodes[0].url, 'https://cdn.example/changed.m3u8');
  const saved = { ...old, ...update.data };
  assert.equal(planImport(saved, next).action, 'skip');
  const partial = { ...next, episodes: [], country: '', director: '', description: '' };
  assert.equal(planImport(saved, partial).action, 'skip');
  saved.episodes[0].url = 'https://admin.example/custom.m3u8';
  next.episodes[0].url = 'https://cdn.example/again.m3u8';
  const protectedPlan = planImport(saved, next);
  assert.ok(!protectedPlan.data.episodes || protectedPlan.data.episodes[0].url === saved.episodes[0].url);
});
test('specials, decimals, named episodes and seasons keep distinct full identities', () => {
  assert.equal(episodeKey('Tập 01'), episodeKey('1'));
  const names = ['1', 'OVA 1', 'Special 1', 'Season 1 Episode 1', 'Season 1 Episode 2', 'Season 2 Episode 1', '1.5', '1 - Finale'];
  const movie = { ...normalizePhimApiMovie(detail()), episodes: names.map(name => ({ name, url: 'https://cdn.example/' + encodeURIComponent(name) })) };
  const created = planImport(null, movie).data;
  assert.equal(created.episodes.length, names.length);
  assert.equal(planImport(created, movie).action, 'skip');
});
test('identity fallback is exact, year/season-aware and rejects ambiguous legacy matches', () => {
  const incoming = { title: 'Anime (Season 2)', originalTitle: 'Show Season 2', year: '2026', sourceSlug: 'anime-season-2' };
  assert.equal(findMovie([{ id: 'a', title: 'Anime (Season 1)', originalTitle: 'Show Season 1', year: '2026' }], incoming), null);
  assert.equal(findMovie([{ id: 'a', ...incoming, year: '2025', sourceSlug: 'different' }], incoming), null);
  assert.throws(() => findMovie([{ id: 'a', title: incoming.title }, { id: 'b', title: incoming.title }], incoming), /Ambiguous/);
});
test('HTTP 429 and 5xx retry with bounded backoff and Retry-After; 403 stops immediately', async () => {
  let calls = 0; const sleeps = [];
  const s = createSource({ sleep: async ms => sleeps.push(ms), fetchImpl: async () => ++calls < 3 ? response(calls === 1 ? 429 : 503, null, '2') : response(200, detail()) });
  await s.detail('anime-one');
  assert.equal(calls, 3); assert.ok(sleeps.includes(2000));
  calls = 0;
  const denied = createSource({ sleep: async () => {}, fetchImpl: async () => { calls++; return response(403); } });
  await assert.rejects(denied.detail('anime-one'), e => e.blocked && /403/.test(e.message));
  assert.equal(calls, 1);
});
test('timeout uses AbortSignal and three bounded attempts; invalid JSON is visible', async () => {
  let attempts = 0;
  const s = createSource({ timeoutMs: 3, sleep: async () => {}, fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
    attempts++;
    const keepAlive = setTimeout(() => reject(new Error('timeout fallback')), 50);
    signal.addEventListener('abort', () => { clearTimeout(keepAlive); reject(new Error('timeout')); }, { once: true });
  }) });
  await assert.rejects(s.detail('anime-one'), e => e.retryable);
  assert.equal(attempts, 3);
  const bad = createSource({ sleep: async () => {}, fetchImpl: async () => response(200, new SyntaxError('bad json')) });
  await assert.rejects(bad.detail('anime-one'), /invalid JSON/);
});
test('budget interruption resumes snapshot/cursor without refetching completed pages or losing movies', async () => {
  let clock = Date.now();
  const db = new MemoryFirestore(), source = fixtureSource();
  const original = source.detail;
  source.detail = async slug => { const d = await original(slug); clock += 2000; return d; };
  const pending = await run(db, source, { now: () => clock, budgetMs: 1000 });
  assert.equal(pending.status, 'pending'); assert.equal(pending.index, 1);
  const resumed = fixtureSource();
  const done = await run(db, resumed, { now: () => clock });
  assert.equal(done.status, 'completed');
  assert.equal(done.stats.new, 2); assert.equal(done.stats.episodes, 4);
  assert.equal(resumed.calls.pages.includes(1), false);
  assert.deepEqual(resumed.calls.details, ['anime-two']);
});
test('lost acknowledgement after atomic movie+cursor commit resumes with exact counters', async () => {
  const db = new MemoryFirestore(); db.failAfterMovieCommit = true;
  await assert.rejects(run(db), /lost acknowledgement/);
  const job = db.data.get('crawlerJobs/dailyJapaneseAnime');
  assert.equal(job.index, 1); assert.equal(job.stats.new, 1);
  const done = await run(db);
  assert.equal(done.stats.new, 2); assert.equal(done.stats.episodes, 4);
  assert.equal([...db.data.keys()].filter(k => k.startsWith('movies/')).length, 2);
});
test('failed Firestore transaction does not advance persisted cursor or report success', async () => {
  const db = new MemoryFirestore(); db.failBeforeMovieCommit = true;
  await assert.rejects(run(db), /before commit/);
  assert.equal(db.data.get('crawlerJobs/dailyJapaneseAnime').index, 0);
  assert.equal(db.data.has('movies/kkphim-anime-one'), false);
  assert.equal((await run(db)).stats.new, 2);
});
test('retry queue persists; poison movie stops retrying after bounded attempts without blocking future scans', async () => {
  const db = new MemoryFirestore(), source = fixtureSource({ details: { 'anime-one': new SourceError('Temporary source failure', { retryable: true }) } });
  const first = await run(db, source);
  assert.equal(first.status, 'pending');
  const second = await run(db, source);
  assert.equal(second.status, 'completed_with_errors');
  assert.equal(second.failures[0].attempts, 3);
  const third = await run(db);
  assert.equal(third.status, 'completed');
  assert.equal(third.stats.new, 1);
  assert.equal(third.previousReport.status, 'completed_with_errors');
});
test('dry-run reads real-shaped existing catalog but never writes movies, lease, cursor or statistics', async () => {
  const db = new MemoryFirestore();
  const job = await run(db, fixtureSource(), { dryRun: true });
  assert.equal(job.stats.new, 2); assert.equal(db.writes, 0); assert.equal(db.data.size, 0);
});
test('missing, malformed, incomplete or wrong-project Firebase secrets fail clearly without echoing values', () => {
  assert.throws(() => validateCredentials({}), /Missing FIREBASE_SERVICE_ACCOUNT_JSON/);
  assert.throws(() => validateCredentials({ FIREBASE_SERVICE_ACCOUNT_JSON: 'private garbage' }), /Invalid/);
  assert.throws(() => validateCredentials({ FIREBASE_SERVICE_ACCOUNT_JSON: '{}' }), /Incomplete/);
  const account = JSON.stringify({ type: 'service_account', project_id: 'other', private_key: 'private-secret', client_email: 'test@example.com' });
  assert.throws(() => validateCredentials({ FIREBASE_SERVICE_ACCOUNT_JSON: account }), /project mismatch/);
  assert.throws(() => validateCredentials({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }), /demo-/);
});
test('two nearly simultaneous workers are serialized by transactional lease; stale owner cannot write', async () => {
  let time = Date.now(); const db = new MemoryFirestore();
  const a = await firestoreStore(db, { now: () => time }), b = await firestoreStore(db, { now: () => time });
  const results = await Promise.allSettled([a.acquire({ start: 1, end: 10 }), b.acquire({ start: 1, end: 10 })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const winner = results[0].status === 'fulfilled' ? a : b;
  const loser = winner === a ? b : a;
  const state = results.find(r => r.status === 'fulfilled').value;
  time += 6 * 60000;
  await loser.acquire({ start: 1, end: 10 });
  await assert.rejects(winner.commit(state, normalizePhimApiMovie(detail())), /lease lost/);
  await winner.release();
  assert.notEqual(db.data.get('crawlerJobs/dailyJapaneseAnime').leaseUntil, 0);
  await loser.release();
});
test('manual TSV and worker normalization produce equivalent Firestore create payloads', () => {
  const raw = detail(); raw.episodes[0].server_data.push({ name: 'OVA 1', link_m3u8: 'https://cdn.example/ova.m3u8' });
  const direct = normalizePhimApiMovie(raw);
  const manual = parseTSV(detailsToTSV([raw]))[0];
  assert.equal(manual.isValid, true);
  assert.deepEqual(planImport(null, manual, 'fixed').data, planImport(null, direct, 'fixed').data);
  assert.equal(manual.episodeCurrent, 'Tập 2');
  assert.equal(parseTSV(detailsToTSV([raw, detail('anime-two')])).length, 2);
  const traditional = parseTSV('Tên Phim\tTập\tLink Video\tThông Tin\nLegacy show\t1\thttps://cdn.example/1.m3u8\tongoing\n\tOVA 1\thttps://cdn.example/ova.m3u8\t')[0];
  assert.equal(traditional.episodes.length, 2);
  assert.equal(traditional.status, 'ongoing');
  assert.equal(parseTSV(movieToTSV(direct))[0].sourceSlug, direct.sourceSlug);
});
test('manual browser fallback retains original list filters and preserves full episode names', async () => {
  const urls = [];
  const result = await crawlManualUrl('https://www.kkphim1.com/danh-sach/hoat-hinh?country=nhat-ban&sort_field=modified.time&sort_type=desc&page=3', async url => {
    urls.push(url);
    return response(200, url.includes('/danh-sach/') ? { data: { items: [{ slug: 'anime-one' }] } } : detail());
  });
  assert.equal(new URL(urls[0]).searchParams.get('page'), '3');
  assert.equal(new URL(urls[0]).searchParams.get('country'), 'nhat-ban');
  assert.equal(result.count, 1); assert.equal(parseTSV(result.tsv)[0].sourceSlug, 'anime-one');
});
test('workflow is daily Vietnam time, read-only repository permission and one cross-branch concurrency group', async () => {
  const yaml = await readFile(new URL('../.github/workflows/daily-anime-crawler.yml', import.meta.url), 'utf8');
  assert.match(yaml, /30 18 \* \* \*/);
  assert.match(yaml, /group: cinesmart-firestore-anime-writer/);
  assert.match(yaml, /cancel-in-progress: false/);
  assert.match(yaml, /contents: read/);
  assert.match(yaml, /vars\.CRAWLER_WRITES_ENABLED != 'true'/);
  assert.match(yaml, /github\.ref != format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\)/);
  assert.doesNotMatch(yaml, /localhost|git push|contents: write/);
});


test('source refusal stops the invocation and retains the current movie; repeated refusal cannot lock future jobs forever', async () => {
  const db = new MemoryFirestore();
  const source = fixtureSource({ details: { 'anime-one': new SourceError('Source denied access (HTTP 403)', { blocked: true }) } });
  for (let attempt = 1; attempt <= 3; attempt++) {
    const before = source.calls.details.length;
    await assert.rejects(run(db, source), /403/);
    assert.equal(source.calls.details.length - before, 1);
    const state = db.data.get('crawlerJobs/dailyJapaneseAnime');
    assert.equal(state.index, 0);
    assert.equal(state.failures[0].attempts, attempt);
    assert.equal(state.status, attempt === 3 ? 'failed' : 'pending');
  }
  assert.equal((await run(db)).status, 'completed');
});
test('page errors preserve page cursor and become terminal after three invocations', async () => {
  const db = new MemoryFirestore();
  const broken = fixtureSource();
  broken.page = async () => { throw new SourceError('Source returned invalid JSON', { retryable: true }); };
  for (let i = 1; i <= 3; i++) {
    await assert.rejects(run(db, broken), /invalid JSON/);
    const state = db.data.get('crawlerJobs/dailyJapaneseAnime');
    assert.equal(state.page, 1);
    assert.equal(state.pageAttempts, i);
  }
  assert.equal(db.data.get('crawlerJobs/dailyJapaneseAnime').status, 'failed');
  assert.equal((await run(db)).status, 'completed');
});
test('manual page range cannot silently replace an unfinished daily job', async () => {
  const db = new MemoryFirestore();
  const pending = await run(db, fixtureSource(), { shouldStop: () => true });
  assert.equal(pending.status, 'pending');
  await assert.rejects(run(db, fixtureSource(), { start: 1, end: 1 }), /Resume the pending/);
});
test('live transaction re-reads admin edits made after catalogue scan', async () => {
  const original = planImport(null, normalizePhimApiMovie(detail())).data;
  const db = new MemoryFirestore({ 'movies/kkphim-anime-one': original });
  const store = await firestoreStore(db);
  const state = await store.acquire({ start: 1, end: 10 });
  db.data.get('movies/kkphim-anime-one').director = 'Admin edit after scan';
  const incoming = { ...normalizePhimApiMovie(detail('anime-one', 3)), director: 'New Source Director' };
  const result = await store.commit(state, incoming);
  assert.equal(result.lastResult.action, 'update');
  assert.equal(db.data.get('movies/kkphim-anime-one').director, 'Admin edit after scan');
  await store.release();
});
test('HTML/invalid list status and malformed details fail visibly instead of silently completing', async () => {
  const bad = createSource({ sleep: async () => {}, fetchImpl: async () => response(200, { data: { items: [] } }) });
  await assert.rejects(bad.page(1), /Invalid list status/);
  const db = new MemoryFirestore();
  const malformed = detail('anime-one'); malformed.episodes[0].server_data = {};
  const first = await run(db, fixtureSource({ details: { 'anime-one': malformed } }));
  assert.equal(first.status, 'pending');
  assert.equal(first.failures[0].attempts, 2);
  const second = await run(db, fixtureSource({ details: { 'anime-one': malformed } }));
  assert.equal(second.status, 'completed_with_errors');
});

test('a full daily scan supersedes an interrupted manual subset and still visits pages 1-10', async () => {
  const db = new MemoryFirestore();
  const partial = await run(db, fixtureSource(), { start: 3, end: 5, shouldStop: () => true });
  assert.equal(partial.status, 'pending');
  const source = fixtureSource();
  const full = await run(db, source);
  assert.equal(full.start, 1); assert.equal(full.end, 10);
  assert.deepEqual(source.calls.pages, [1,2,3,4,5,6,7,8,9,10]);
  assert.equal(full.status, 'completed');
});
test('TSV parity holds with missing source metadata/current episode and a named special', () => {
  const raw = detail(); raw.movie.episode_current = ''; raw.movie.director = []; raw.movie.category = [];
  raw.movie.imdb = {}; raw.movie.poster_url = ''; raw.movie.thumb_url = '';
  raw.episodes[0].server_data = [{ name: 'OVA 1', link_m3u8: 'https://cdn.example/ova.m3u8' }];
  const incoming = normalizePhimApiMovie(raw);
  assert.deepEqual(planImport(null, parseTSV(detailsToTSV([raw]))[0], 'fixed').data, planImport(null, incoming, 'fixed').data);
});
test('invalid source slug from pasted TSV cannot form an unintended document path', () => {
  assert.throws(() => planImport(null, { sourceSlug: '../../bad', episodes: [] }), /Invalid source slug/);
});

test('missing source status never reopens an existing completed movie and retains TSV parity', () => {
  const raw = detail(); raw.movie.status = '';
  const incoming = normalizePhimApiMovie(raw);
  const existing = planImport(null, { ...incoming, status: 'completed' }, 'old').data;
  assert.equal(planImport(existing, incoming).action, 'skip');
  assert.deepEqual(planImport(null, parseTSV(detailsToTSV([raw]))[0], 'fixed').data, planImport(null, incoming, 'fixed').data);
});

test('legacy Full/1 aliases and repeated source links do not create duplicate episodes', () => {
  const base = { title: 'Legacy full', year: '2026', status: 'completed', episodes: [{ name: '1', url: 'https://cdn.example/full.m3u8' }], m3u8Url: 'https://cdn.example/full.m3u8' };
  const incoming = { ...base, episodes: [{ name: 'Full', url: 'https://cdn.example/full.m3u8' }, { name: 'Special 1', url: 'https://cdn.example/special.m3u8' }, { name: 'Duplicate Special', url: 'https://cdn.example/special.m3u8' }] };
  const plan = planImport(base, incoming);
  assert.equal(plan.added, 1);
  assert.equal(plan.data.episodes.length, 2);
  assert.equal(planImport({ ...base, ...plan.data }, incoming).action, 'skip');
});

test('403 diagnostics retain Cloudflare 1010 and request ID without retry or raw HTML', async () => {
  let calls = 0;
  const source = createSource({ sleep: async () => {}, fetchImpl: async (_url, options) => {
    calls++;
    assert.equal(options.headers['User-Agent'], 'CineSmart-Metadata-Sync/1.0');
    return { status: 403, headers: { get: key => key === 'cf-ray' ? 'request-id-HKG' : null }, text: async () => 'error code: 1010\n private-response-content' };
  } });
  await assert.rejects(source.page(1), error => error.blocked && error.status === 403 && error.providerCode === '1010' && error.requestId === 'request-id-HKG' && !error.message.includes('private-response-content'));
  assert.equal(calls, 1);
});

test('source refuses redirect without following it or trying other hosts', async () => {
  let calls = 0;
  const source = createSource({ sleep: async () => {}, fetchImpl: async (_url, options) => {
    calls++; assert.equal(options.redirect, 'manual'); return response(302);
  } });
  await assert.rejects(source.page(1), error => error.blocked && /redirected/.test(error.message));
  assert.equal(calls, 1);
});

test('source rejects a valid-looking response that echoes wrong filters or sorting', async () => {
  for (const wrong of [{ slug: 'phim-moi-cap-nhat' }, { filterCountry: ['trung-quoc'] }, { sortField: 'year' }, { sortType: 'asc' }, { filterCountry: ['nhat-ban', 'au-my'] }]) {
    const source = createSource({ sleep: async () => {}, fetchImpl: async () => response(200, {
      status: true, data: { items: [{ slug: 'anime-one' }], params: { slug: 'hoat-hinh', type_slug: 'danh-sach', filterCountry: ['nhat-ban'], sortField: 'modified.time', sortType: 'desc', ...wrong } },
    }) });
    await assert.rejects(source.page(1), /filter\/sort echo mismatch/);
  }
});

test('long Retry-After persists across invocations and makes zero requests until expiry', async () => {
  const db = new MemoryFirestore(); let clock = Date.now(), calls = 0;
  const source = createSource({ now: () => clock, sleep: async () => {}, fetchImpl: async () => { calls++; return response(429, null, '3600'); } });
  await assert.rejects(run(db, source, { now: () => clock }), /Retry-After/);
  assert.equal(calls, 1);
  assert.equal(db.data.get('crawlerJobs/dailyJapaneseAnime').resumeAt, clock + 3600000);
  const writes = db.writes;
  const waiting = await run(db, source, { now: () => clock });
  assert.equal(waiting.status, 'pending'); assert.equal(calls, 1); assert.equal(db.writes, writes);
  clock += 3600001;
  assert.equal((await run(db, fixtureSource(), { now: () => clock })).status, 'completed');
});

test('Retry-After on the final HTTP attempt is retained instead of ignored', async () => {
  let calls = 0;
  const source = createSource({ now: () => 100000, sleep: async () => {}, fetchImpl: async () => response(429, null, ++calls === 3 ? '3600' : '1') });
  await assert.rejects(source.detail('anime-one'), e => e.blocked && e.retryAt === 3700000);
  assert.equal(calls, 3);
});

test('source-only diagnostic checks all 10 pages and never duplicates a detail sample', async () => {
  const source = fixtureSource();
  const report = await checkAnimeSource({ source, log: noop });
  assert.equal(report.pages.length, 10); assert.equal(report.uniqueMovies, 2);
  assert.equal(report.firestoreWrites, 0); assert.equal(report.details.length, 2);
  assert.deepEqual(source.calls.details, ['anime-one', 'anime-two']);
  await assert.rejects(checkAnimeSource({ source, log: noop, detailSamples: 0 }), /within 1-10/);
});

test('Firebase validates real RSA PEM, account types, project and email locally without networking', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const account = { type: 'service_account', project_id: 'test-cinesmart', client_email: 'bot@test-cinesmart.iam.gserviceaccount.com', private_key: privateKey };
  const env = { FIREBASE_PROJECT_ID: 'test-cinesmart', FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(account) };
  assert.equal(validateCredentials(env).projectId, 'test-cinesmart');
  for (const [field, value, message] of [['private_key', 'not-a-private-key', /private key/], ['client_email', 'not-an-email', /email/], ['private_key', {}, /Incomplete/]]) {
    assert.throws(() => validateCredentials({ ...env, FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ ...account, [field]: value }) }), message);
  }
  assert.throws(() => validateCredentials({ ...env, FIREBASE_PROJECT_ID: 'other-project' }), /project mismatch/);
  assert.throws(() => validateCredentials({ ...env, FIREBASE_PROJECT_ID: '../invalid' }), /Invalid FIREBASE_PROJECT_ID/);
  const connection = await connectFirestore(env);
  try { assert.equal(connection.db.projectId, 'test-cinesmart'); }
  finally { await connection.close(); }
  // No .get(), query or write is executed on the SDK; IAM/auth remain unverified.
});

test('emulator is explicitly confined to a demo project and local valid port', async () => {
  assert.throws(() => validateCredentials({ FIREBASE_PROJECT_ID: 'demo-cinesmart', FIRESTORE_EMULATOR_HOST: 'remote.example:8080' }), /loopback/);
  for (const port of ['0', '99999']) assert.throws(() => validateCredentials({ FIREBASE_PROJECT_ID: 'demo-cinesmart', FIRESTORE_EMULATOR_HOST: '127.0.0.1:' + port }), /valid TCP port/);
  const connection = await connectFirestore({ FIREBASE_PROJECT_ID: 'demo-cinesmart', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' });
  try { assert.equal(connection.db.projectId, 'demo-cinesmart'); }
  finally { await connection.close(); }
});

test('source-only diagnostic fails if list contents contradict the acknowledged filter', async () => {
  let calls = 0;
  await assert.rejects(checkAnimeSource({ log: noop, fetchImpl: async () => {
    calls++;
    return response(200, { status: true, data: { params: { slug: 'hoat-hinh', filterCountry: ['nhat-ban'] }, items: [{ slug: 'foreign', type: 'hoathinh', country: [{ slug: 'trung-quoc' }] }] } });
  } }), /outside Japanese animation filter/);
  assert.equal(calls, 1);
});

test('unsafe Retry-After cannot persist an infinite cooldown that blocks all future runs', async () => {
  const source = createSource({ sleep: async () => {}, fetchImpl: async () => response(429, null, '9'.repeat(400)) });
  await assert.rejects(source.page(1), e => e.blocked && e.retryAt === 0 && /invalid Retry-After/.test(e.message));
});

test('CLI defaults and dry-run override cannot enable Firestore writes accidentally', () => {
  assert.equal(options({}, []).dryRun, true);
  assert.equal(options({ CRAWLER_DRY_RUN: 'FALSE' }, []).dryRun, true);
  assert.equal(options({ CRAWLER_DRY_RUN: 'false' }, ['--dry-run']).dryRun, true);
  assert.equal(options({ GITHUB_EVENT_NAME: 'schedule' }, []).dryRun, true);
});

test('explicit write requests require a separate owner permission flag', () => {
  for (const permission of [undefined, '', 'false', 'TRUE']) {
    assert.throws(() => options({ CRAWLER_DRY_RUN: 'false', CRAWLER_WRITES_ENABLED: permission }, []), /Production writes disabled/);
  }
  // Policy evaluation only: no SDK initialization or database calls.
  assert.equal(options({ CRAWLER_DRY_RUN: 'false', CRAWLER_WRITES_ENABLED: 'true' }, []).dryRun, false);
});

test('GitHub writes require an approved default-branch schedule or manual run', () => {
  const env = { GITHUB_ACTIONS: 'true', CRAWLER_DEFAULT_BRANCH: 'main', GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'schedule', CRAWLER_DRY_RUN: 'false', CRAWLER_WRITES_ENABLED: 'true' };
  assert.equal(options(env, []).dryRun, false);
  assert.equal(options({ ...env, GITHUB_EVENT_NAME: 'workflow_dispatch' }, []).dryRun, false);
  for (const change of [{ GITHUB_REF: 'refs/heads/feat/daily-anime-crawler' }, { CRAWLER_DEFAULT_BRANCH: '' }, { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_EVENT_NAME: 'push' }]) {
    assert.throws(() => options({ ...env, ...change }, []), /Production writes require the default branch/);
  }
});
