import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// Token verification uses Google's public signing keys. No private key is needed.
const app = getApps().find(candidate => candidate.name === 'admin-api') || initializeApp({
  projectId: 'loliphim-db',
}, 'admin-api');

export async function verifyAdminRequest(request) {
  const authorization = typeof request.headers.authorization === 'string' ? request.headers.authorization : '';
  if (!authorization.startsWith('Bearer ')) return null;
  try {
    const token = await getAuth(app).verifyIdToken(authorization.slice(7));
    return token.admin === true && token.email_verified === true ? token : null;
  } catch {
    return null;
  }
}
