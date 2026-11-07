import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import LoadingScreen from '../components/common/LoadingScreen';

// Code Splitting Admin Pages with React.lazy
const AdminDashboard = lazy(() => import('../pages/admin/AdminDashboard'));
const MovieManagementPage = lazy(() => import('../pages/admin/MovieManagementPage'));

/**
 * Protected Admin Route Wrapper
 */
const AdminProtectedRoute = ({ children }) => {
  const { currentUser, isVerifiedAdmin, loading } = useAuth();

  if (loading) {
    return <LoadingScreen message="Đang nạp dữ liệu Admin..." />;
  }

  if (!currentUser || !isVerifiedAdmin) {
    return <Navigate to="/login" replace />;
  }

  
  return children;
};

/**
 * Admin Area Routing System with Lazy Loading & Role Security
 */
const AdminRouters = () => {
  return (
    <Suspense fallback={<LoadingScreen message="Đang tải hệ thống Admin Quản trị..." />}>
      <Routes>
        <Route 
          path="/" 
          element={
            <AdminProtectedRoute>
              <AdminDashboard />
            </AdminProtectedRoute>
          } 
        />
        <Route 
          path="/movies" 
          element={
            <AdminProtectedRoute>
              <MovieManagementPage />
            </AdminProtectedRoute>
          } 
        />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </Suspense>
  );
};

export default AdminRouters;
