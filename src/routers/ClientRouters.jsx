import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import LoadingScreen from '../components/common/LoadingScreen';
import Navbar from '../components/common/Navbar';
import Footer from '../components/common/Footer';

// Code Splitting Client Pages with React.lazy
const HomePage = lazy(() => import('../pages/client/HomePage'));
const CategoryPage = lazy(() => import('../pages/client/CategoryPage'));
const MovieDetailPage = lazy(() => import('../pages/client/MovieDetailPage'));
const WatchPage = lazy(() => import('../pages/client/WatchPage'));
const LoginPage = lazy(() => import('../pages/client/LoginPage'));
const NotFoundPage = lazy(() => import('../pages/client/NotFoundPage'));

/**
 * Client Area Routing System with Code Splitting & Global Navbar.
 * Guests can browse and watch directly; login is optional for account features.
 */
const ClientRouters = () => {
  const { currentUser, loading } = useAuth();
  const { pathname, search } = useLocation();
  const adminLogin = new URLSearchParams(search).get('admin') === '1';

  return (
    <>
      {/* Global Top Navbar on all client pages except /login */}
      {pathname !== '/login' && <Navbar />}

      <Suspense fallback={<LoadingScreen message="Đang tải giao diện người dùng..." />}>
        <Routes>
          {/* Login is always accessible */}
          <Route path="/login" element={
            loading ? <LoadingScreen message="Đang xác thực..." /> :
            currentUser && !adminLogin ? <Navigate to="/" replace /> : <LoginPage />
          } />

          {/* Public client routes: accessible to both guests and logged-in users */}
          <Route path="/" element={<HomePage />} />
          <Route path="/the-loai" element={<CategoryPage />} />
          <Route path="/category" element={<CategoryPage />} />
          <Route path="/genres" element={<CategoryPage />} />
          {/* SEO Slug Routing */}
          <Route path="/movie/:slug" element={<MovieDetailPage />} />
          <Route path="/movie/:slug/:episode" element={<WatchPage />} />
          {/* Legacy fallback routes for backward compatibility */}
          <Route path="/watch/:id" element={<WatchPage />} />
          <Route path="/watch/:id/:episode" element={<WatchPage />} />
          <Route path="/search" element={<CategoryPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>

      {pathname !== '/login' && <Footer />}
    </>
  );
};

export default ClientRouters;
