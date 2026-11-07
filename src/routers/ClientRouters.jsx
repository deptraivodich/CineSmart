import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import LoadingScreen from '../components/common/LoadingScreen';
import Navbar from '../components/common/Navbar';

// Code Splitting Client Pages with React.lazy
const HomePage = lazy(() => import('../pages/client/HomePage'));
const CategoryPage = lazy(() => import('../pages/client/CategoryPage'));
const MovieDetailPage = lazy(() => import('../pages/client/MovieDetailPage'));
const WatchPage = lazy(() => import('../pages/client/WatchPage'));
const LoginPage = lazy(() => import('../pages/client/LoginPage'));
const NotFoundPage = lazy(() => import('../pages/client/NotFoundPage'));

/**
 * Auth Guard: Redirects to /login if not logged in
 */
const RequireAuth = ({ children }) => {
  const { currentUser, loading } = useAuth();

  if (loading) {
    return <LoadingScreen message="Đang xác thực..." />;
  }

  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

/**
 * Client Area Routing System with Code Splitting & Global Navbar
 */
const ClientRouters = () => {
  const { currentUser, loading } = useAuth();
  const { search } = useLocation();
  const adminLogin = new URLSearchParams(search).get('admin') === '1';

  return (
    <>
      {/* Global Top Navbar on all client pages (only show when logged in) */}
      {currentUser && <Navbar />}

      <Suspense fallback={<LoadingScreen message="Đang tải giao diện người dùng..." />}>
        <Routes>
          {/* Login is always accessible */}
          <Route path="/login" element={
            loading ? <LoadingScreen message="Đang xác thực..." /> :
            currentUser && !adminLogin ? <Navigate to="/" replace /> : <LoginPage />
          } />

          {/* All other routes require authentication */}
          <Route path="/" element={<RequireAuth><HomePage /></RequireAuth>} />
          <Route path="/the-loai" element={<RequireAuth><CategoryPage /></RequireAuth>} />
          <Route path="/category" element={<RequireAuth><CategoryPage /></RequireAuth>} />
          <Route path="/genres" element={<RequireAuth><CategoryPage /></RequireAuth>} />
          {/* SEO Slug Routing */}
          <Route path="/movie/:slug" element={<RequireAuth><MovieDetailPage /></RequireAuth>} />
          <Route path="/movie/:slug/:episode" element={<RequireAuth><WatchPage /></RequireAuth>} />
          {/* Legacy fallback routes for backward compatibility */}
          <Route path="/watch/:id" element={<RequireAuth><WatchPage /></RequireAuth>} />
          <Route path="/watch/:id/:episode" element={<RequireAuth><WatchPage /></RequireAuth>} />
          <Route path="/search" element={<RequireAuth><CategoryPage /></RequireAuth>} />
          <Route path="*" element={<RequireAuth><NotFoundPage /></RequireAuth>} />
        </Routes>
      </Suspense>
    </>
  );
};

export default ClientRouters;
