import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import LoadingScreen from '../components/common/LoadingScreen';

// Code Splitting Admin Pages with React.lazy
const AdminDashboard = lazy(() => import('../pages/admin/AdminDashboard'));
const MovieManagementPage = lazy(() => import('../pages/admin/MovieManagementPage'));
const ADMIN_READ_ONLY = import.meta.env.VITE_ADMIN_READ_ONLY === 'true';

/**
 * Protected Admin Route Wrapper
 */
const AdminProtectedRoute = ({ children }) => {
  const { currentUser, userRole, loading } = useAuth();

  if (loading) {
    return <LoadingScreen message="Đang nạp dữ liệu Admin..." />;
  }

  if (!currentUser || (!ADMIN_READ_ONLY && userRole !== 'admin')) {
    return <Navigate to="/login" replace />;
  }

  if (ADMIN_READ_ONLY) {
    return (
      <>
        <div role="status" className="bg-amber-950 text-amber-100 px-6 py-3 text-sm">
          <strong>Admin đang ở chế độ xem.</strong> Bạn có thể kiểm tra giao diện và dữ liệu. Các thao tác lưu, xóa và đồng bộ đã khóa.
          <Link className="ml-3 text-cyan-300 underline" to="/">Về trang chủ</Link>
        </div>
        {children}
      </>
    );
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
              <AdminDashboard readOnly={ADMIN_READ_ONLY} />
            </AdminProtectedRoute>
          } 
        />
        <Route 
          path="/movies" 
          element={
            <AdminProtectedRoute>
              <MovieManagementPage readOnly={ADMIN_READ_ONLY} />
            </AdminProtectedRoute>
          } 
        />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </Suspense>
  );
};

export default AdminRouters;
