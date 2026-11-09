import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/services/authService.js', import.meta.url), 'utf8');
const service = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('a delayed password response cannot overwrite a newer session after logout/account change', async () => {
  const originalFetch = globalThis.fetch, originalStorage = globalThis.localStorage;
  const values = new Map([['210loliphim_current_session', JSON.stringify({ username: 'new-user' })]]);
  globalThis.localStorage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  let resolve, current = true;
  globalThis.fetch = () => new Promise(done => { resolve = done; });
  try {
    const pending = service.login('old-user', 'fixture-password', { isCurrent: () => current });
    current = false;
    resolve({ ok: true, json: async () => ({ session: { username: 'old-user' } }) });
    await assert.rejects(pending, /Phiên đăng nhập đã kết thúc/);
    assert.equal(service.getCurrentSession().username, 'new-user');
  } finally { globalThis.fetch = originalFetch; globalThis.localStorage = originalStorage; }
});

test('the Admin alias cannot be registered as a fallback user', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('unexpected network'); };
  try {
    await assert.rejects(service.register('ADMIN', '20', 'fixture-password'), /dành cho tài khoản Admin/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});
