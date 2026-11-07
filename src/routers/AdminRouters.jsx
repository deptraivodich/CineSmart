import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import LoadingScreen from '../components/common/LoadingScreen';

// Code Splitting Admin Pages with React.lazy
const AdminDashboard = lazy(() => import('../pages/admin/AdminDashboard'));
const MovieManagementPage = lazy(() => import('../pages/admin/MovieManagementPage'));

/**
 * Protected Admin Route Wrapper
 */
const AdminProtectedRoute = ({ children }) => {
  const { userRole, loading } = useAuth();

  if (loading) {
    return <LoadingScreen message="Đang nạp dữ liệu Admin..." />;
  }

  if (import.meta.env.VITE_ADMIN_READ_ONLY === 'true') {
    return (
      <main className="min-h-screen flex items-center justify-center px-6 bg-slate-950 text-white">
        <div className="max-w-lg space-y-4 text-center">
          <h1 className="text-2xl font-bold">Quản trị đang được bảo trì</h1>
          <p>Chức năng quản lý dữ liệu tạm thời bị khóa. Bạn vẫn có thể xem danh sách và thông tin phim.</p>
          <Link className="inline-block text-cyan-300 underline" to="/">Về trang chủ</Link>
        </div>
      </main>
    );
  }

  // Not admin → redirect to login im  mediately
  if (userRole !== 'admin') {
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
