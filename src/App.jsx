import React, { useEffect, useRef } from 'react';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import AppRouter from './routers/AppRouter';
import CineSmartAIBot from './components/ui/CineSmartAIBot';
import { runAutoUpdate } from './services/autoCrawlService';

function AppContent() {
  const location = useLocation();
  const isAdmin = location.pathname.includes('/admin');
  const timerRef = useRef(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (import.meta.env.VITE_ADMIN_READ_ONLY === 'true') return;

    // Quy tắc chặn (Lock): Nếu pathname đang chứa /admin,
    // TUYỆT ĐỐI NGỪNG không kích hoạt hoặc tạm dừng tiến trình gọi API tự động này để tránh xung đột
    if (isAdmin) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      console.log('[Auto-Crawl Lock] Người dùng đang ở trang Quản trị (/admin). ĐÃ TẠM DỪNG tiến trình Auto-Update.');
      return;
    }

    // Khi người dùng đang ở giao diện Client (không chứa /admin)
    const storedInterval = localStorage.getItem('210loliphim_auto_sync_interval');
    if (storedInterval === '0') {
      console.log('[Auto-Crawl] Người dùng đã cấu hình TẮT tự động quét ngầm.');
      return;
    }

    const intervalMs = storedInterval ? parseInt(storedInterval, 10) : 120000;

    // 1. Chạy lần đầu nhanh chóng sau 15 giây để kiểm tra ngay
    if (!timerRef.current && !intervalRef.current) {
      console.log('[Auto-Crawl] Đã lên lịch tự động kiểm tra phim sau 15 giây...');
      timerRef.current = setTimeout(async () => {
        if (window.location.pathname.includes('/admin')) return;
        console.log('[Auto-Crawl] Kích hoạt kiểm tra tự động đợt đầu...');
        await runAutoUpdate();
        timerRef.current = null;

        // 2. Thiết lập chu kỳ kiểm tra định kỳ theo cấu hình trong lúc người dùng treo máy / xem phim
        if (!intervalRef.current && !window.location.pathname.includes('/admin')) {
          intervalRef.current = setInterval(async () => {
            if (window.location.pathname.includes('/admin')) return;
            const currentSetting = localStorage.getItem('210loliphim_auto_sync_interval');
            if (currentSetting === '0') {
              if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
              }
              return;
            }
            console.log(`[Auto-Crawl] Kích hoạt kiểm tra phim định kỳ (${Math.round(intervalMs / 60000)} phút)...`);
            await runAutoUpdate();
          }, intervalMs);
        }
      }, 15000); // 15 giây
    }

    return () => {
      if (timerRef.current && isAdmin) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (intervalRef.current && isAdmin) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isAdmin, location.pathname]);

  return (
    <>
      <AppRouter />
      {/* Nhiệm vụ 4: Ẩn Chatbot CineSmart AI ở trang Admin, chỉ hiển thị ở màn hình Client */}
      {!isAdmin && <CineSmartAIBot />}
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
