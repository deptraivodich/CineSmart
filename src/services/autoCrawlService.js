/**
 * Auto-Crawl & Auto-Update Background Service
 * Nhiệm vụ 2 & Nhiệm vụ 3
 * - Tự động lọc các phim CHƯA Hoàn Tất và KHÔNG PHẢI phim lẻ chiếu rạp.
 * - Gọi Backend API /api/movies/auto-update để cào và so sánh 5 trường:
 *   (Tập phim, Quốc gia, Đạo diễn, Thông Tin, Tập hiện tại).
 * - Cập nhật dữ liệu mới vào Firestore / Local Storage.
 */

import { getMovies, updateMovie, getStoredMovies, saveStoredMovies } from './movieService';
import { generateSlug } from '../utils/slugUtils';
import { runAdminAutoUpdateBatch } from './adminCrawler';

const BACKEND_URL = import.meta.env.VITE_BACKEND_API_URL || 'http://localhost:8000';

/**
 * Kiểm tra điều kiện phim có hợp lệ để auto-update hay không
 * @param {Object} movie
 * @param {boolean} ongoingOnly - Nếu true, chỉ lấy phim đang phát sóng (chưa hoàn tất)
 */
export const isEligibleForAutoUpdate = (movie, ongoingOnly = false) => {
  if (!movie || !movie.id) return false;

  // Nếu không giới hạn ongoingOnly, tất cả phim có trong DB đều đủ điều kiện quét & gộp
  if (!ongoingOnly) {
    return true;
  }

  // 1. Bỏ qua phim đã Hoàn Tất chính thức qua trường status
  const status = String(movie.status || '').toLowerCase().trim();
  if (status === 'completed' || status === 'hoàn tất' || status === 'hoan tat') {
    return false;
  }

  return true;
};

/**
 * Xử lý Auto-Update cho một lô (batch) phim xác định
 * Dùng cho AutoSyncModal để cập nhật live log và đếm thống kê theo thời gian thực
 */
export const runAutoUpdateBatch = async (batch) => {
  if (!Array.isArray(batch) || batch.length === 0) {
    return { status: 'skipped', reason: 'Empty batch', checkedCount: 0, updatedCount: 0, updatedMovies: [], checkedDetails: [] };
  }

  if (import.meta.env.PROD) return runAdminAutoUpdateBatch(batch);

  try {
    const payloadMovies = batch.map(m => ({
      id: m.id,
      title: m.title,
      originalTitle: m.originalTitle || m.original_title || '',
      status: m.status || 'ongoing',
      episodeCurrent: m.episodeCurrent || m.episodesStatus || '',
      country: m.country || '',
      director: m.director || '',
      episodes: m.episodes || [],
      slug: m.slug || generateSlug(m.title) || '',
      updatedAt: m.updatedAt || m.updated_at || ''
    }));

    const response = await fetch(`${BACKEND_URL}/api/movies/auto-update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ movies: payloadMovies })
    });

    if (!response.ok) {
      throw new Error(`Auto-update API error: HTTP ${response.status}`);
    }

    const data = await response.json();
    const updatedList = data.updated_movies || [];
    const checkedDetails = data.checked_details || [];
    const nowIso = new Date().toISOString();

    if (updatedList.length > 0) {
      console.log(`[Auto-Crawl] Đã gộp và cập nhật ${updatedList.length} bộ phim từ PhimAPI:`, updatedList);

      // Cập nhật từng phim vào Firestore & localStorage
      for (const updated of updatedList) {
        try {
          await updateMovie(updated.id, {
            country: updated.country,
            director: updated.director,
            status: updated.status,
            episodeCurrent: updated.episodeCurrent,
            episodesStatus: updated.episodesStatus,
            episodes: updated.episodes,
            episodesCount: updated.episodesCount,
            m3u8Url: updated.m3u8Url || updated.episodes?.[0]?.url,
            lastAutoCrawledAt: nowIso,
            updatedAt: nowIso
          });
        } catch (updateErr) {
          console.warn(`[Auto-Crawl] Lỗi cập nhật phim ${updated.id}:`, updateErr);
        }
      }

      // Phát sự kiện để cập nhật UI các trang
      window.dispatchEvent(new CustomEvent('210loliphim_movies_updated', { detail: { updatedCount: updatedList.length } }));
      window.dispatchEvent(new CustomEvent('210loliphim_interactions_updated'));
    }

    // Đánh dấu lastAutoCrawledAt cho các phim trong batch kể cả khi chưa có tập mới
    try {
      const checkedIds = new Set(batch.map(b => String(b.id)));
      const updatedIds = new Set(updatedList.map(u => String(u.id)));
      const currentStored = getStoredMovies();
      let hasLocalTouch = false;

      const updatedStored = currentStored.map(m => {
        if (checkedIds.has(String(m.id)) && !updatedIds.has(String(m.id))) {
          hasLocalTouch = true;
          return { ...m, lastAutoCrawledAt: nowIso };
        }
        return m;
      });

      if (hasLocalTouch) {
        saveStoredMovies(updatedStored);
      }
    } catch (touchErr) {
      console.debug('[Auto-Crawl] Lỗi ghi nhận thời gian kiểm tra batch:', touchErr);
    }

    return {
      status: 'success',
      checkedCount: data.checked_count || batch.length,
      updatedCount: updatedList.length,
      updatedMovies: updatedList,
      checkedDetails: checkedDetails
    };
  } catch (err) {
    console.warn('[Auto-Crawl] Lỗi trong tiến trình runAutoUpdateBatch:', err);
    return {
      status: 'error',
      error: err.message,
      checkedCount: 0,
      updatedCount: 0,
      updatedMovies: [],
      checkedDetails: []
    };
  }
};

/**
 * Chạy quy trình Auto-Update Phim toàn diện
 * Quét xoay vòng toàn bộ kho phim trong DB (Round-robin)
 */
export const runAutoUpdate = async () => {
  try {
    const allMovies = await getMovies();
    if (!Array.isArray(allMovies) || allMovies.length === 0) {
      return { status: 'skipped', reason: 'No movies in DB' };
    }

    const validMovies = allMovies.filter(m => m && m.id);
    if (validMovies.length === 0) {
      return { status: 'skipped', reason: 'No valid movies' };
    }

    // Sắp xếp các phim theo thứ tự ưu tiên:
    // 1. Phim đang phát sóng (ongoing/Active) được ưu tiên hơn
    // 2. Phim chưa được cập nhật lâu nhất lên đầu (Round-robin xoay vòng 100% kho phim)
    validMovies.sort((a, b) => {
      const isOngoingA = a.status === 'ongoing' || a.status === 'Active';
      const isOngoingB = b.status === 'ongoing' || b.status === 'Active';
      if (isOngoingA !== isOngoingB) return isOngoingA ? -1 : 1;

      const timeA = new Date(a.lastAutoCrawledAt || a.updatedAt || a.updated_at || 0).getTime();
      const timeB = new Date(b.lastAutoCrawledAt || b.updatedAt || b.updated_at || 0).getTime();
      return timeA - timeB;
    });

    // Gửi 20 phim mỗi đợt để tối ưu tốc độ và bao phủ toàn bộ kho phim
    const batch = validMovies.slice(0, 20);
    return await runAutoUpdateBatch(batch);
  } catch (err) {
    console.warn('[Auto-Crawl] Lỗi trong tiến trình Auto-Update:', err);
    return { status: 'error', error: err.message };
  }
};
