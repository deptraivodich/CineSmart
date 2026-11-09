import { cloudAdmin } from '../../server/cloudAdmin.js';
import { loginAdmin } from '../../server/adminLogin.js';
import { validateOrigin, jsonBody, clientKey, errorResponse } from '../../server/httpPolicy.js';

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Phương thức không được hỗ trợ.' });
  }
  try {
    validateOrigin(request);
    const body = jsonBody(request, 2048);
    return response.status(200).json(await loginAdmin(body, { ...cloudAdmin(), key: clientKey(request, process.env.SERVER_RATE_LIMIT_SECRET) }));
  } catch (error) { return errorResponse(response, error); }
}
