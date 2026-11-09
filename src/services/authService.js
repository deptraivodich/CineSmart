/**
 * 210LoliPhim Hybrid Authentication Service
 * Primary: FastAPI Backend (http://localhost:8000/api/auth)
 * Fallback: LocalStorage Client DB (offline resilience)
 * Passwords hashed with SHA-256
 */

const API_BASE = 'http://localhost:8000/api/auth';
const STORAGE_KEY = '210loliphim_accounts_db';
const SESSION_KEY = '210loliphim_current_session';

// --- SHA-256 Hashing via Web Crypto API for Fallback ---
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const byteArray = new Uint8Array(hashBuffer);
  let hexString = '';
  for (let i = 0; i < byteArray.length; i++) {
    const byteHex = byteArray[i].toString(16).padStart(2, '0');
    hexString += byteHex;
  }
  return hexString;
}

// --- Default Seeded Accounts for LocalStorage Fallback ---
const SEED_ACCOUNTS = [
  {
    username: 'khale',
    password: 'khale2k5kk',
    role: 'user',
    age: 18,
    displayName: 'Khale',
    createdAt: '2025-06-15T00:00:00.000Z'
  }
];

// --- Internal Local Storage Helpers ---
function getAccountsFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn('[AuthService] Không thể đọc tài khoản từ LocalStorage:', e);
  }
  return null;
}

function saveAccountsToStorage(accounts) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
  } catch (e) {
    console.warn('[AuthService] Không thể lưu tài khoản vào LocalStorage:', e);
  }
}

// --- Initialize Accounts (Seeds LocalStorage if empty) ---
export async function initAccounts() {
  const existing = getAccountsFromStorage();
  if (existing && existing.length > 0) return existing;

  const seeded = [];
  for (const account of SEED_ACCOUNTS) {
    const hashedPw = await hashPassword(account.password);
    seeded.push({
      username: account.username,
      passwordHash: hashedPw,
      role: account.role,
      age: account.age,
      displayName: account.displayName,
      createdAt: account.createdAt
    });
  }
  saveAccountsToStorage(seeded);
  console.log('[AuthService] Khởi tạo tài khoản dự phòng LocalStorage thành công');
  return seeded;
}

// --- LocalStorage Fallback Login ---
async function fallbackLocalLogin(username, password, isCurrent = () => true) {
  await initAccounts();
  const accounts = getAccountsFromStorage() || [];
  const trimmedUsername = username.trim().toLowerCase();
  const account = accounts.find(
    a => a.username.toLowerCase() === trimmedUsername
  );

  if (!account) {
    throw new Error('Tên đăng nhập không tồn tại.');
  }

  const hashedInput = await hashPassword(password);
  if (hashedInput !== account.passwordHash) {
    throw new Error('Mật khẩu không chính xác.');
  }

  const session = {
    username: account.username,
    displayName: account.displayName || account.username,
    role: account.role,
    age: account.age
  };
  if (!isCurrent()) throw new Error('Phiên đăng nhập đã kết thúc.');
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

// --- LocalStorage Fallback Register ---
async function fallbackLocalRegister(username, age, password) {
  const accounts = getAccountsFromStorage() || [];
  const trimmedUsername = username.trim();

  if (!trimmedUsername || trimmedUsername.length < 3) {
    throw new Error('Tên đăng nhập phải có ít nhất 3 ký tự.');
  }
  if (!/^[a-zA-Z0-9_]+$/.test(trimmedUsername)) {
    throw new Error('Tên đăng nhập chỉ được chứa chữ cái, số và dấu gạch dưới.');
  }

  const exists = accounts.find(
    a => a.username.toLowerCase() === trimmedUsername.toLowerCase()
  );
  if (exists) {
    throw new Error('Tên đăng nhập này đã được sử dụng.');
  }

  const parsedAge = parseInt(age, 10);
  if (isNaN(parsedAge) || parsedAge < 1 || parsedAge > 120) {
    throw new Error('Tuổi phải là số từ 1 đến 120.');
  }
  if (!password || password.length < 6) {
    throw new Error('Mật khẩu phải có ít nhất 6 ký tự.');
  }

  const hashedPw = await hashPassword(password);
  const newAccount = {
    username: trimmedUsername,
    passwordHash: hashedPw,
    role: 'user',
    age: parsedAge,
    displayName: trimmedUsername,
    createdAt: new Date().toISOString()
  };

  accounts.push(newAccount);
  saveAccountsToStorage(accounts);
  return newAccount;
}

// --- Public Login Function (Hybrid: API first -> Fallback LocalStorage) ---
export async function login(username, password, { isCurrent = () => true } = {}) {
  try {
    const response = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();
    if (!response.ok) {
      // Backend phản hồi lỗi nghiệp vụ (sai mật khẩu / không tồn tại) -> Ném lỗi ra UI
      throw new Error(data.detail || 'Đăng nhập thất bại.');
    }

    const session = data.session;
    if (!isCurrent()) throw new Error('Phiên đăng nhập đã kết thúc.');
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  } catch (error) {
    if (!isCurrent()) throw new Error('Phiên đăng nhập đã kết thúc.');
    // Nếu là lỗi từ Backend (400/401), ném trực tiếp để hiển thị thông báo chính xác
    const knownErrors = [
      'Tên đăng nhập không tồn tại.',
      'Mật khẩu không chính xác.',
      'Vui lòng nhập tên đăng nhập và mật khẩu.'
    ];
    if (knownErrors.includes(error.message)) {
      throw error;
    }

    // Nếu không kết nối được tới Backend (Server tắt / mạng lỗi), tự động fallback về LocalStorage
    console.warn('[AuthService] Backend API không phản hồi, tự động chuyển sang cơ chế LocalStorage:', error.message);
    return fallbackLocalLogin(username, password, isCurrent);
  }
}

// --- Public Register Function (Hybrid: API first -> Fallback LocalStorage) ---
export async function register(username, age, password) {
  if (username.trim().toLowerCase() === 'admin') throw new Error('Tên này dành cho tài khoản Admin.');
  try {
    const response = await fetch(`${API_BASE}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        age: parseInt(age, 10),
        password
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || 'Đăng ký tài khoản thất bại.');
    }

    // Đồng bộ tài khoản sang LocalStorage để chế độ offline luôn sẵn sàng
    try {
      const accounts = getAccountsFromStorage() || [];
      const exists = accounts.some(a => a.username.toLowerCase() === username.trim().toLowerCase());
      if (!exists) {
        const hashedPw = await hashPassword(password);
        accounts.push({
          username: username.trim(),
          passwordHash: hashedPw,
          role: 'user',
          age: parseInt(age, 10),
          displayName: username.trim(),
          createdAt: new Date().toISOString()
        });
        saveAccountsToStorage(accounts);
      }
    } catch (syncErr) {
      console.warn('[AuthService] Đồng bộ tài khoản sang LocalStorage dự phòng thất bại:', syncErr);
    }

    return data.user;
  } catch (error) {
    const knownValidationErrors = [
      'Tên đăng nhập phải có ít nhất 3 ký tự.',
      'Tên đăng nhập chỉ được chứa chữ cái, số và dấu gạch dưới.',
      'Mật khẩu phải có ít nhất 6 ký tự.',
      'Tuổi phải từ 1 đến 120.',
      'Tên đăng nhập này đã được sử dụng.'
    ];
    if (knownValidationErrors.includes(error.message)) {
      throw error;
    }

    console.warn('[AuthService] Backend API không phản hồi, tự động chuyển sang cơ chế LocalStorage:', error.message);
    return fallbackLocalRegister(username, age, password);
  }
}

// --- Public Logout Function ---
export function logout() {
  localStorage.removeItem(SESSION_KEY);
}

// --- Public Get Current Session Function ---
export function getCurrentSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      const session = JSON.parse(raw);
      if (session && session.username) return session;
    }
  } catch (e) {
    console.warn('[AuthService] Không thể phân tích dữ liệu phiên:', e);
  }
  return null;
}

// --- Public Get All Accounts (Admin support) ---
export async function getAllAccounts() {
  try {
    const response = await fetch(`${API_BASE}/users`);
    if (response.ok) {
      return await response.json();
    }
  } catch (e) {
    // Fallback to storage
  }
  return getAccountsFromStorage() || [];
}
