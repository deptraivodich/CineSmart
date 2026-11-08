import { replyToChat } from '../server/chat.js';
import { getCatalogueTotal } from '../server/catalogue.js';
import { chatIntent } from '../src/utils/chatContext.js';

const requests = new Map();

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Phương thức không được hỗ trợ.' });
  }
  if (request.headers.origin && ![`https://${request.headers.host}`, `http://${request.headers.host}`].includes(request.headers.origin)) {
    return response.status(403).json({ error: 'Nguồn yêu cầu không hợp lệ.' });
  }
  let body;
  try {
    body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
    if (!body || typeof body.message !== 'string' || !body.message.trim() || body.message.length > 1500 || JSON.stringify(body).length > 32000) throw new Error();
  } catch {
    return response.status(400).json({ error: 'Tin nhắn không hợp lệ hoặc quá dài.' });
  }
  const now = Date.now();
  for (const [ip, entry] of requests) if (entry.until <= now) requests.delete(ip);
  const ip = String(request.headers['x-vercel-forwarded-for'] || request.headers['x-real-ip'] || 'local');
  const entry = requests.get(ip) || { count: 0, until: now + 60000 };
  if (entry.count >= 10 || (!requests.has(ip) && requests.size >= 1000)) {
    response.setHeader('Retry-After', '60');
    return response.status(429).json({ error: 'Bạn gửi tin nhắn hơi nhanh. Hãy thử lại sau một phút.' });
  }
  entry.count++;
  requests.set(ip, entry);
  const cloudTotal = chatIntent(body.message) === 'count' ? await getCatalogueTotal() : null;
  return response.status(200).json(await replyToChat(body, {
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
    cloudTotal,
  }));
}
