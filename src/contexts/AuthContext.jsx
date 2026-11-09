import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { onIdTokenChanged, signInWithCustomToken } from 'firebase/auth';
import { auth, signOut } from '../firebase';
import { setAdminSessionUid } from '../services/adminSession';
import {
  initAccounts,
  login as authLogin,
  register as authRegister,
  logout as authLogout,
  getCurrentSession
} from '../services/authService';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [userRole, setUserRole] = useState('guest');
  const [loading, setLoading] = useState(true);
  const [firebaseSession, setFirebaseSession] = useState(null);
  const [firebaseLoading, setFirebaseLoading] = useState(true);
  const authGeneration = useRef(0);
  const authIntent = useRef('restore');

  useEffect(() => {
    let active = true;
    const unsubscribe = onIdTokenChanged(auth, async user => {
      const generation = authGeneration.current;
      try {
        if (user && !['restore', user.uid].includes(authIntent.current)) return;
        const token = user ? await user.getIdTokenResult() : null;
        if (!active || generation !== authGeneration.current || auth.currentUser !== user || (user && !['restore', user.uid].includes(authIntent.current))) return;
        setAdminSessionUid(user?.emailVerified && token?.claims.admin === true ? user.uid : null);
        setFirebaseSession(user ? {
          user: { username: user.email, displayName: user.displayName || user.email, uid: user.uid },
          admin: user.emailVerified && token.claims.admin === true,
        } : null);
      } catch {
        if (active && generation === authGeneration.current) {
          setAdminSessionUid(null);
          setFirebaseSession(null);
        }
      } finally {
        if (active) setFirebaseLoading(false);
      }
    });
    return () => { active = false; unsubscribe(); };
  }, []);

  // On mount: init accounts DB + restore session
  useEffect(() => {
    const bootstrap = async () => {
      try {
        // Seed default accounts if first run
        await initAccounts();

        // Restore persisted session
        const session = getCurrentSession();
        if (session) {
          setCurrentUser({
            username: session.username,
            displayName: session.displayName,
            age: session.age
          });
          setUserRole(session.role);
        }
      } catch (e) {
        console.warn('[AuthContext] Bootstrap error:', e);
      } finally {
        setLoading(false);
      }
    };
    bootstrap();
  }, []);

  // The Admin alias is verified by the server, then signs into the existing Firebase UID.
  const login = async (username, password) => {
    const generation = ++authGeneration.current;
    authIntent.current = 'pending';
    setAdminSessionUid(null);
    setFirebaseSession(null);
    authLogout();
    setCurrentUser(null);
    setUserRole('guest');
    await signOut(auth);
    if (generation !== authGeneration.current) throw new Error('Phiên đăng nhập đã kết thúc.');
    if (username.trim().toLowerCase() === 'admin') {
      let user;
      try {
        const response = await fetch('/api/admin/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }), signal: AbortSignal.timeout(20000),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Không đăng nhập được Admin.');
        if (generation !== authGeneration.current) throw new Error('Phiên đăng nhập đã kết thúc.');
        ({ user } = await signInWithCustomToken(auth, result.customToken));
        const token = await user.getIdTokenResult(true);
        if (generation !== authGeneration.current || auth.currentUser !== user || !user.emailVerified || token.claims.admin !== true) throw new Error('Phiên Admin không còn hợp lệ.');
        authIntent.current = user.uid;
        setAdminSessionUid(user.uid);
        const session = { username: user.email, displayName: user.displayName || 'Admin', uid: user.uid, role: 'admin' };
        setFirebaseSession({ user: session, admin: true });
        return session;
      } catch (error) {
        if (generation === authGeneration.current) authIntent.current = 'signed-out';
        if (user && auth.currentUser === user) await signOut(auth);
        throw error;
      }
    }
    authIntent.current = 'signed-out';
    const session = await authLogin(username, password, { isCurrent: () => generation === authGeneration.current });
    if (generation !== authGeneration.current) throw new Error('Phiên đăng nhập đã kết thúc.');
    setCurrentUser({ username: session.username, displayName: session.displayName, age: session.age });
    setUserRole(session.role);
    return session;
  };

  // Register new account
  const register = async (username, age, password) => {
    const account = await authRegister(username, age, password);
    return account;
  };

  // Logout
  const logout = () => {
    authGeneration.current++;
    authIntent.current = 'signed-out';
    setAdminSessionUid(null);
    authLogout();
    setFirebaseSession(null);
    setCurrentUser(null);
    setUserRole('guest');
    return signOut(auth);
  };

  const effectiveRole = firebaseSession ? (firebaseSession.admin ? 'admin' : 'user') : userRole;
  const value = {
    currentUser: firebaseSession?.user || currentUser,
    userRole: effectiveRole,
    loading: loading || firebaseLoading,
    isVerifiedAdmin: firebaseSession?.admin === true,
    isAdmin: firebaseSession?.admin === true,
    isUser: effectiveRole === 'user' || effectiveRole === 'admin',
    login,
    register,
    logout
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
