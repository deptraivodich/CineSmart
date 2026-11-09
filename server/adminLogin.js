import { scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError, budget } from './httpPolicy.js';

const scrypt = promisify(scryptCallback);

export async function checkAdminPassword(password, encoded) {
  const [algorithm, salt, hex] = String(encoded || '').split('$');
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(hex)) throw new Error('Login not configured');
  const actual = await scrypt(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(hex, 'hex'));
}

export async function loginAdmin(body, { db, auth, key, env = process.env, now = Date.now() }) {
  if (typeof body.username !== 'string' || body.username.length > 60 || typeof body.password !== 'string' || !body.password || body.password.length > 200) {
    throw new HttpError(400, 'Tên đăng nhập hoặc mật khẩu không hợp lệ.');
  }
  if (!env.ADMIN_LOGIN_UID || !env.ADMIN_LOGIN_PASSWORD_HASH) throw new Error('Login not configured');
  await db.runTransaction(async tx => {
    const commit = await budget(tx, db, [
      { id: 'admin-ip-' + key, max: 10, window: 600000 },
      { id: 'admin-global', max: 50, window: 600000 },
      { id: 'admin-daily', max: 100, window: 86400000 },
    ], now);
    commit();
  });
  const valid = await checkAdminPassword(body.password, env.ADMIN_LOGIN_PASSWORD_HASH);
  if (body.username.trim().toLowerCase() !== 'admin' || !valid) throw new HttpError(401, 'Tên đăng nhập hoặc mật khẩu không đúng.');
  const user = await auth.getUser(env.ADMIN_LOGIN_UID);
  // Reuse only the already-authorized Google account. Never assign new roles here.
  if (user.disabled || !user.emailVerified || user.customClaims?.admin !== true || !user.providerData.some(provider => provider.providerId === 'google.com')) {
    throw new HttpError(403, 'Tài khoản Admin chưa được cấp quyền hoặc đã bị khóa.');
  }
  return { customToken: await auth.createCustomToken(user.uid) };
}
