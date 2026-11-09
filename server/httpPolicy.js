import { createHmac } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function validateOrigin(request, env = process.env) {
  const origin = request.headers.origin;
  const allowed = ['https://cinesmart-delta.vercel.app', ...[env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean).map(host => `https://${host}`)];
  if (env.NODE_ENV !== 'production') allowed.push('http://localhost:3000', 'http://127.0.0.1:3000', 'http://127.0.0.1:5174');
  if (origin && !allowed.includes(origin)) throw new HttpError(403, 'Nguồn yêu cầu không hợp lệ.');
}

export function jsonBody(request, max = 8192) {
  try {
    if (Buffer.byteLength(typeof request.body === 'string' ? request.body : JSON.stringify(request.body || {})) > max) throw new Error();
    const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new HttpError(400, 'Nội dung yêu cầu không hợp lệ hoặc quá dài.'); }
}

export function clientKey(request, secret) {
  if (!secret) throw new Error('Rate limit configuration unavailable');
  const ip = request.headers['x-vercel-forwarded-for'] || request.headers['x-real-ip'] || request.headers['x-forwarded-for'] || request.socket?.remoteAddress || 'unknown';
  return createHmac('sha256', secret).update(String(ip).split(',')[0].trim()).digest('hex');
}

// All limits live in Firestore, so restarting or adding server instances does not reset them.
export async function budget(tx, db, specs, now) {
  const entries = await Promise.all(specs.map(async spec => {
    const ref = db.doc('requestLimits/' + spec.id);
    const old = (await tx.get(ref)).data();
    const active = old && old.resetAt > now;
    const count = active ? old.count : 0;
    if (count >= spec.max || (active && spec.cooldown && now - old.lastAt < spec.cooldown)) {
      throw new HttpError(429, 'Bạn thao tác quá nhanh. Vui lòng chờ rồi thử lại.');
    }
    return { ref, data: { count: count + 1, resetAt: active ? old.resetAt : now + spec.window, lastAt: now } };
  }));
  return () => entries.forEach(({ ref, data }) => tx.set(ref, data));
}

export function errorResponse(response, error) {
  const status = error instanceof HttpError ? error.status : 503;
  if (status === 429) response.setHeader('Retry-After', '60');
  return response.status(status).json({ error: error instanceof HttpError ? error.message : 'Dịch vụ Cloud tạm thời không khả dụng. Vui lòng thử lại sau.' });
}
