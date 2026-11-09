import { cloudAdmin } from '../server/cloudAdmin.js';
import { createComment, listComments } from '../server/comments.js';
import { validateOrigin, jsonBody, clientKey, errorResponse } from '../server/httpPolicy.js';

export function commentsHandler(connect = cloudAdmin) {
  return async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'POST'].includes(request.method)) {
      response.setHeader('Allow', 'GET, POST');
      return response.status(405).json({ error: 'Phương thức không được hỗ trợ.' });
    }
    try {
      validateOrigin(request);
      const result = request.method === 'GET'
        ? await listComments(request.query || {}, connect())
        : await createComment(jsonBody(request), { ...connect(), key: clientKey(request, process.env.SERVER_RATE_LIMIT_SECRET) });
      return response.status(request.method === 'POST' ? 201 : 200).json(request.method === 'POST' ? { comment: result } : result);
    } catch (error) { return errorResponse(response, error); }
  };
}

export default commentsHandler();
