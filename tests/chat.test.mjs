import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChatContext, catalogReply } from '../src/utils/chatContext.js';
import { replyToChat } from '../server/chat.js';
import handler from '../api/chat.js';
import { uniqueMovies } from '../src/utils/movieCatalogue.js';

const movies = Array.from({ length: 25 }, (_, index) => ({ id: String(index), title: `Phim ${index}`, genres: [index === 0 ? 'Hành Động' : 'Hài Hước'], imdb: String(index % 10), privateField: 'not-sent' }));

test('chat context is bounded and does not send account identity or watch history', () => {
  const history = [{ username: 'alice', movieId: '0' }, { username: 'bob', movieId: '1' }];
  const context = buildChatContext('Gợi ý', movies, history, 'alice');
  assert.equal(context.available_movies.length, 15);
  assert.equal(context.catalog_total, 25);
  assert.equal(buildChatContext('Hành động', movies).available_movies.length, 1);
  const json = JSON.stringify(context);
  for (const privateValue of ['alice', 'bob', 'privateField', 'not-sent', 'username', 'user_history']) assert.ok(!json.includes(privateValue));
  assert.deepEqual(buildChatContext('hello', null).available_movies, []);
  assert.deepEqual(buildChatContext('hello', [null], [null], 'alice').available_movies, []);
  assert.deepEqual(buildChatContext('hello', [], {}).available_movies, []);
});

test('another account history does not influence recommendations', () => {
  const baseline = buildChatContext('Gợi ý', movies, [], 'alice');
  const other = buildChatContext('Gợi ý', movies, [{ username: 'bob', movieId: '0' }], 'alice');
  assert.deepEqual(other, baseline);
});

test('a natural-language title search outranks generic wording and unrelated watch preferences', () => {
  const catalogue = [
    ...Array.from({ length: 20 }, (_, index) => ({ id: String(index), title: `Cho tôi một phim trong kho ${index}`, genres: ['Romance'] })),
    { id: 'conan', title: 'Thám tử lừng danh Conan', genres: ['Mystery'] },
  ];
  const history = Array.from({ length: 100 }, () => ({ username: 'alice', movieId: '0' }));
  const context = buildChatContext('Gợi ý cho tôi một anime Conan trong kho và nói ngắn gọn lý do.', catalogue, history, 'alice');
  assert.equal(context.available_movies[0].title, 'Thám tử lừng danh Conan');
});

test('Gemini uses server key, limited context and conversation and parses only visible reply', async () => {
  let request;
  const result = await replyToChat({ message: 'Xin chào CineSmart', available_movies: movies, conversation: [{ sender: 'ai', text: 'welcome' }, { sender: 'user', text: 'Chào' }] }, {
    apiKey: 'test-key',
    fetchImpl: async (url, options) => {
      assert.equal(new URL(url).hostname, 'generativelanguage.googleapis.com');
      assert.ok(!url.includes('test-key'));
      assert.equal(options.headers['x-goog-api-key'], 'test-key');
      request = JSON.parse(options.body);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ thought: true, text: 'hidden' }, { text: 'Bạn có thể xem Phim 0.' }] } }] }) };
    },
  });
  assert.equal(result.mode, 'gemini');
  assert.equal(result.reply, 'Bạn có thể xem Phim 0.');
  assert.equal(request.contents[0].role, 'user');
  assert.equal(request.generationConfig.maxOutputTokens, 768);
});

test('missing key, provider quota and network failure produce clearly labelled catalogue replies', async () => {
  const context = buildChatContext('Xin chào', movies);
  for (const options of [{}, { apiKey: 'x', fetchImpl: async () => ({ ok: false, status: 429 }) }, { apiKey: 'x', fetchImpl: async () => { throw new Error('unavailable'); } }]) {
    const result = await replyToChat(context, options);
    assert.equal(result.mode, 'catalog');
    assert.ok(result.notice);
    assert.ok(result.reply.includes('Gợi ý từ kho phim'));
  }
  assert.ok(catalogReply('hello', []).includes('Không tìm thấy'));
});

test('chat endpoint rejects unsupported methods, foreign origins and invalid or oversized input', async () => {
  function response() { return { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json() { return this; } }; }
  for (const [request, expected] of [
    [{ method: 'GET', headers: {} }, 405],
    [{ method: 'POST', headers: { host: 'cinesmart.example', origin: 'https://other.example' } }, 403],
    [{ method: 'POST', headers: {}, body: { message: '' } }, 400],
    [{ method: 'POST', headers: {}, body: { message: 'x'.repeat(1501) } }, 400],
  ]) {
    const result = response();
    await handler(request, result);
    assert.equal(result.statusCode, expected);
  }
});

test('full mapped catalogue count survives the 15-film AI shortlist and ignores duplicate IDs', async () => {
  const catalogue = Array.from({ length: 586 }, (_, index) => ({ id: `film-${index}`, title: `Anime ${index}`, genres: ['Action'] }));
  const context = buildChatContext('Hiện tại trên web có tổng cộng bao nhiêu phim?', [...catalogue, catalogue[0], null]);
  assert.equal(uniqueMovies([...catalogue, catalogue[0]]).length, 586);
  assert.equal(context.catalog_total, 586);
  assert.equal(context.available_movies.length, 15);
  const result = await replyToChat(context, { cloudTotal: 586, fetchImpl: () => assert.fail('Counts must not be guessed by Gemini') });
  assert.ok(result.reply.includes('586 phim'));
  const unavailable = await replyToChat(context);
  assert.ok(unavailable.reply.includes('đã tải 586 phim'));
  assert.ok(unavailable.reply.includes('chưa xác minh'));
  const legacy = await replyToChat({ message: context.message, available_movies: context.available_movies });
  assert.ok(!legacy.reply.includes('15 phim'));
});

test('genre recommendations return five unique matches, all two scarce matches, or no unrelated films', async () => {
  const catalogue = [
    ...Array.from({ length: 12 }, (_, index) => ({ id: `action-${index}`, title: `Action Film ${index}`, genres: [index % 2 ? 'Action' : 'Hành Động'] })),
    { id: 'horror-1', title: 'Horror One', genres: ['Horror'] },
    { id: 'horror-2', title: 'Horror Two', genres: ['Kinh Dị'] },
    { id: 'science-1', title: 'Science Fiction', genres: ['Sci-Fi'] },
  ];
  for (const [message, expected, matching] of [
    ['Gợi ý phim thể loại hành động', 5, 12],
    ['Gợi ý phim kinh dị', 2, 2],
    ['Gợi ý phim âm nhạc', 0, 0],
    ['Gợi ý phim khoa học viễn tưởng', 1, 1],
  ]) {
    const context = buildChatContext(message, [...catalogue, catalogue[0]]);
    assert.equal(context.matching_total, matching);
    const result = await replyToChat(context, { fetchImpl: () => assert.fail('Recommendations must keep the mapped selection') });
    assert.equal((result.reply.match(/^\d+\. /gm) || []).length, expected);
    if (expected === 0) assert.ok(result.reply.includes('Không tìm thấy'));
  }
});

test('personal recommendations preserve current account preference order through the server', async () => {
  const catalogue = [
    ...Array.from({ length: 7 }, (_, index) => ({ id: `romance-${index}`, title: `Romance ${index}`, genres: ['Romance'], imdb: '6' })),
    { id: 'action', title: 'Action', genres: ['Action'], imdb: '10' },
  ];
  const context = buildChatContext('Phim hợp gu tôi', catalogue, [{ username: 'alice', movieId: 'romance-0' }], 'alice');
  const result = await replyToChat(context);
  assert.equal((result.reply.match(/^\d+\. Romance/gm) || []).length, 5);
  assert.ok(!result.reply.includes('Action'));
});

test('Cloud count aggregates movies read-only and coalesces repeated concurrent requests', async () => {
  const { getCatalogueTotal } = await import('../server/catalogue.js?test=success');
  let calls = 0;
  const options = { projectId: 'test-project', fetchImpl: async (url, request) => {
    calls++;
    assert.ok(url.endsWith('/documents:runAggregationQuery'));
    const body = JSON.parse(request.body);
    assert.deepEqual(body.structuredAggregationQuery.structuredQuery.from, [{ collectionId: 'movies' }]);
    assert.equal(request.method, 'POST');
    return { ok: true, json: async () => [{ result: { aggregateFields: { total: { integerValue: '586' } } } }] };
  } };
  assert.deepEqual(await Promise.all([getCatalogueTotal(options), getCatalogueTotal(options)]), [586, 586]);
  assert.equal(await getCatalogueTotal(options), 586);
  assert.equal(calls, 1);
});

test('unavailable or malformed Cloud counts remain unknown and do not become the shortlist length', async () => {
  for (const [name, response] of [
    ['quota', { ok: false, status: 429 }],
    ['invalid', { ok: true, json: async () => [{ result: { aggregateFields: { total: { integerValue: 'invalid' } } } }] }],
  ]) {
    const { getCatalogueTotal } = await import(`../server/catalogue.js?test=${name}`);
    let calls = 0;
    const options = { projectId: 'test-project', fetchImpl: async () => { calls++; return response; } };
    assert.equal(await getCatalogueTotal(options), null);
    assert.equal(await getCatalogueTotal(options), null);
    assert.equal(calls, 1);
  }
});
