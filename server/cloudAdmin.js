import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

export function cloudAdmin(env = process.env) {
  const projectId = env.VITE_FIREBASE_PROJECT_ID || 'loliphim-db';
  let app = getApps().find(app => app.name === 'private-cloud-api');
  if (!app) {
    const account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
    if (account.project_id !== projectId || account.type !== 'service_account') throw new Error('Server credentials unavailable');
    app = initializeApp({ projectId, credential: cert(account) }, 'private-cloud-api');
  }
  return { db: getFirestore(app), auth: getAuth(app) };
}
