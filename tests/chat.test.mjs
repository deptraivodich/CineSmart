import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChatContext, catalogReply } from '../src/utils/chatContext.js';
import { replyToChat } from '../server/chat.js';
import handler from '../api/chat.js';

const movies = Array.from({ length: 25 }, (_, index) => ({ id: String(index), title: `Phim ${index}`, genres: [index === 0 ? 'Hành Động' : 'Hài Hước'], imdb: String(index % 10), privateField: 'not-sent' }));

test('chat context is bounded and does not send account identity or watch history', () => {
  const history = [{ username: 'alice', movieId: '0' }, { username: 'bob', movieId: '1' }];
  const context = buildChatContext('Hành động', movies, history, 'alice');
  assert.equal(context.available_movies.length, 15);
  assert.equal(context.available_movies[0].title, 'Phim 0');
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
  const result = await replyToChat({ message: 'Tìm phim', available_movies: movies, conversation: [{ sender: 'ai', text: 'welcome' }, { sender: 'user', text: 'Chào' }] }, {
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
  const context = buildChatContext('Gợi ý', movies);
  for (const options of [{}, { apiKey: 'x', fetchImpl: async () => ({ ok: false, status: 429 }) }, { apiKey: 'x', fetchImpl: async () => { throw new Error('unavailable'); } }]) {
    const result = await replyToChat(context, options);
    assert.equal(result.mode, 'catalog');
    assert.ok(result.notice);
    assert.ok(result.reply.includes('Gợi ý từ kho phim'));
  }
  assert.ok(catalogReply('hello', []).includes('chưa được tải'));
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
