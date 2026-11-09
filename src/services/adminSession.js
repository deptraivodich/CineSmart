import { auth } from '../firebase';

let adminSessionUid = null;

export function setAdminSessionUid(uid) {
  adminSessionUid = uid;
}

export async function getAdminIdToken() {
  const user = auth.currentUser;
  if (!user || adminSessionUid !== user.uid) throw new Error('Vui lòng đăng nhập lại Admin.');
  const token = await user.getIdTokenResult();
  if (auth.currentUser !== user || adminSessionUid !== user.uid || !user.emailVerified || token.claims.admin !== true) {
    throw new Error('Tài khoản chưa có quyền Admin trên Firebase.');
  }
  return token.token;
}

export async function adminRequest(body, { signal } = {}) {
  const token = await getAdminIdToken();
  const response = await fetch('/api/admin/crawl', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(250000)]) : AbortSignal.timeout(250000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `API Admin HTTP ${response.status}`);
  return data;
}
