import { verifyAdminRequest } from '../../server/adminAuth.js';
import { crawlAdminMovies } from '../../server/adminCrawl.js';

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Phương thức không được hỗ trợ.' });
  }
  if (!await verifyAdminRequest(request)) {
    return response.status(401).json({ error: 'Yêu cầu tài khoản Firebase có quyền Admin.' });
  }
  let body;
  try {
    body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
  } catch {
    return response.status(400).json({ error: 'Nội dung JSON không hợp lệ.' });
  }
  try {
    return response.status(200).json(await crawlAdminMovies(body));
  } catch {
    return response.status(400).json({ error: 'Không thể cào phim. Kiểm tra dữ liệu đầu vào hoặc thử lại sau.' });
  }
}
