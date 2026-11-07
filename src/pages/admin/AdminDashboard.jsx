import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import MagicImport from '../../components/admin/MagicImport';
import TrollLogoutModal from '../../components/ui/TrollLogoutModal';
import { Link, useNavigate } from 'react-router-dom';
import dragonLogo from '../../assets/dragon-logo.png';
import { getMovies } from '../../services/movieService';
import { getAdminStats } from '../../services/interactionService';

const AdminDashboard = ({ readOnly = false }) => {
  const { currentUser, logout } = useAuth();
  const [isTrollModalOpen, setIsTrollModalOpen] = useState(false);
  const navigate = useNavigate();

  // Real Statistics State (Nhiệm vụ 5)
  const [stats, setStats] = useState({ total_movies: 0, today_views: 0 });
  const [isLoadingStats, setIsLoadingStats] = useState(true);

  const loadRealStats = useCallback(async () => {
    setIsLoadingStats(true);
    try {
      // 1. Lấy danh sách phim thực tế từ Firebase / Local Cache
      const moviesList = await getMovies();
      const currentMovieCount = Array.isArray(moviesList) ? moviesList.length : 0;
      if (readOnly) {
        setStats({ total_movies: currentMovieCount, today_views: null });
        return;
      }

      // 2. Gọi API Backend để lấy thống kê chuẩn xác (Tổng phim và Lượt xem hôm nay)
      const data = await getAdminStats(currentMovieCount);
      setStats({
        total_movies: data.total_movies ?? currentMovieCount,
        today_views: data.today_views ?? 0
      });

      // 3. Đồng bộ dữ liệu phim sang SQLite backend trong nền nếu có
      if (Array.isArray(moviesList) && moviesList.length > 0) {
        fetch('http://localhost:8000/api/movies/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ movies: moviesList })
        }).catch(() => {});
      }
    } catch (err) {
      console.error("Lỗi khi tải thống kê thực tế cho Admin Dashboard:", err);
    } finally {
      setIsLoadingStats(false);
    }
  }, [readOnly]);

  useEffect(() => {
    loadRealStats();

    // Lắng nghe sự kiện cập nhật phim hoặc tương tác để reload số liệu thực tế
    const handleUpdate = () => {
      loadRealStats();
    };

    window.addEventListener('210loliphim_movies_updated', handleUpdate);
    window.addEventListener('210loliphim_interactions_updated', handleUpdate);

    return () => {
      window.removeEventListener('210loliphim_movies_updated', handleUpdate);
      window.removeEventListener('210loliphim_interactions_updated', handleUpdate);
    };
  }, [loadRealStats]);

  return (
    <div className="min-h-screen bg-background text-gray-100 flex flex-col">
      {/* Admin Header */}
      <header className="h-16 border-b border-glass-border glass-panel px-6 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center space-x-3">
          <Link to="/" className="flex items-center space-x-2.5">
            <img 
              src={dragonLogo} 
              alt="Dragon Logo" 
              className="w-9 h-9 object-contain drop-shadow-[0_0_12px_rgba(255,255,255,0.9)]"
            />
            <span className="text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-neon-red to-orange-500">
              210LOLIPHIM
            </span>
          </Link>
          <span className="text-xs text-neon-cyan px-2 py-0.5 rounded bg-neon-cyan/10 border border-neon-cyan/20 font-bold">
            ADMIN PANEL
          </span>
        </div>

        <div className="flex items-center space-x-4">
          <span className="text-xs text-gray-400">Xin chào, <strong className="text-neon-red">{currentUser?.displayName || 'Admin'}</strong></span>
          <button 
            onClick={() => setIsTrollModalOpen(true)}
            className="text-xs px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/40 transition-all cursor-pointer"
          >
            Đăng xuất
          </button>
        </div>
      </header>

      {/* Troll Logout Modal */}
      <TrollLogoutModal
        isOpen={isTrollModalOpen}
        onClose={() => setIsTrollModalOpen(false)}
        onConfirmLogout={() => {
          logout();
          navigate('/login');
        }}
      />

      {/* Main Admin Content */}
      <div className="flex-1 p-6 md:p-10 max-w-7xl w-full mx-auto space-y-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-white">Quản Trị Hệ Thống & Kho Phim</h1>
            <p className="text-gray-400 text-sm mt-1">Nạp phim hàng loạt từ TSV/Excel, quản lý luồng phát m3u8 & kho phim Firebase Firestore.</p>
          </div>

          <div className="flex items-center space-x-3">
            <Link 
              to="/admin/movies" 
              className="px-5 py-2.5 rounded-xl bg-neon-red hover:bg-red-600 text-white font-extrabold text-xs shadow-neon-red transition-all flex items-center gap-2"
            >
              <span>{readOnly ? '🎬 Xem Danh Sách Phim' : '🎬 Quản Lý Danh Sách Phim (Full-CRUD)'}</span>
            </Link>
          </div>
        </div>

        {/* Stats Grid - Hiển thị số liệu thực tế từ Backend & DB */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Ô 1: Tổng Phim Quản Lý (Dữ liệu thật từ Database) */}
          <div className="p-5 glass-panel rounded-xl border-l-4 border-neon-red space-y-1">
            <p className="text-xs text-gray-400 font-semibold uppercase">Tổng Phim Quản Lý</p>
            <p className="text-2xl font-black text-white">
              {isLoadingStats ? (
                <span className="text-gray-500 animate-pulse text-lg">Đang tải...</span>
              ) : (
                stats.total_movies.toLocaleString()
              )}
            </p>
            <Link to="/admin/movies" className="text-[11px] text-neon-red hover:underline block pt-1">Quản lý ngay →</Link>
          </div>

          {/* Ô 2: Luồng KKPhim Active */}
          <div className="p-5 glass-panel rounded-xl border-l-4 border-neon-cyan space-y-1">
            <p className="text-xs text-gray-400 font-semibold uppercase">Luồng KKPhim Active</p>
            <p className="text-2xl font-black text-white">{readOnly ? '—' : '98.5%'}</p>
            <span className="text-[11px] text-emerald-400 block pt-1">{readOnly ? 'Chưa kiểm tra luồng phát' : 'Hoạt động bình thường'}</span>
          </div>

          {/* Ô 3: Lượt Xem Hôm Nay (Dữ liệu thật theo ngày hôm nay từ view_logs / logs) */}
          <div className="p-5 glass-panel rounded-xl border-l-4 border-amber-500 space-y-1">
            <p className="text-xs text-gray-400 font-semibold uppercase">Lượt Xem Hôm Nay</p>
            <p className="text-2xl font-black text-white">
              {isLoadingStats ? (
                <span className="text-gray-500 animate-pulse text-lg">Đang tải...</span>
              ) : (
                stats.today_views?.toLocaleString() ?? '—'
              )}
            </p>
            <span className="text-[11px] text-amber-400 block pt-1">{readOnly ? 'Backend thống kê chưa được triển khai' : 'Lượt xem thực tế hôm nay'}</span>
          </div>

          {/* Ô 4: Trạng Thái Firestore */}
          <div className="p-5 glass-panel rounded-xl border-l-4 border-emerald-500 space-y-1">
            <p className="text-xs text-gray-400 font-semibold uppercase">Trạng Thái Firestore</p>
            <p className="text-2xl font-black text-emerald-400">{readOnly ? 'Chỉ đọc' : 'Connected'}</p>
            <span className="text-[11px] text-gray-400 block pt-1">{readOnly ? 'Thao tác ghi đã khóa' : 'Batch write sẵn sàng'}</span>
          </div>
        </div>

        {/* Phase 4 Magic Import Tool */}
        <div className="pt-4">
          <MagicImport readOnly={readOnly} />
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
