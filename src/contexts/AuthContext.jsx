import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { onIdTokenChanged } from 'firebase/auth';
import { auth, googleProvider, signInWithPopup, signOut } from '../firebase';
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

  useEffect(() => {
    let active = true;
    const unsubscribe = onIdTokenChanged(auth, async user => {
      const generation = authGeneration.current;
      try {
        const token = user ? await user.getIdTokenResult() : null;
        if (!active || generation !== authGeneration.current || auth.currentUser !== user) return;
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

  // Login with username + password
  const login = async (username, password) => {
    const generation = ++authGeneration.current;
    setAdminSessionUid(null);
    setFirebaseSession(null);
    await signOut(auth);
    const session = await authLogin(username, password);
    if (generation !== authGeneration.current) throw new Error('Phiên đăng nhập đã kết thúc.');
    setCurrentUser({
      username: session.username,
      displayName: session.displayName,
      age: session.age
    });
    setUserRole(session.role);
    return session;
  };

  const loginAdminWithGoogle = async () => {
    const generation = ++authGeneration.current;
    const { user } = await signInWithPopup(auth, googleProvider);
    const token = await user.getIdTokenResult(true);
    if (generation !== authGeneration.current || auth.currentUser !== user) {
      throw new Error('Phiên đăng nhập đã kết thúc.');
    }
    if (!user.emailVerified || token.claims.admin !== true) {
      await signOut(auth);
      throw new Error('Email Google này chưa được cấp quyền Admin.');
    }
    authLogout();
    setCurrentUser(null);
    setUserRole('guest');
    setAdminSessionUid(user.uid);
    setFirebaseSession({
      user: { username: user.email, displayName: user.displayName || user.email, uid: user.uid },
      admin: true,
    });
  };

  // Register new account
  const register = async (username, age, password) => {
    const account = await authRegister(username, age, password);
    return account;
  };

  // Logout
  const logout = () => {
    authGeneration.current++;
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
    loginAdminWithGoogle,
    register,
    logout
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
