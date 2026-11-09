/**
 * Interaction Service (Views, Likes/Favorites, Comments, and Leaderboard Analytics)
 * Connects to FastAPI Backend at http://localhost:8000 with synchronized local caching.
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

const STORAGE_VIEWS_KEY = '210loliphim_global_movie_views';
const STORAGE_LIKES_KEY = '210loliphim_user_movie_likes';

// Helper: Get cached views from localStorage
const getLocalViews = () => {
  try {
    const raw = localStorage.getItem(STORAGE_VIEWS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
};

const saveLocalViews = (viewsMap) => {
  try {
    localStorage.setItem(STORAGE_VIEWS_KEY, JSON.stringify(viewsMap));
  } catch (e) {
    // Ignore
  }
};

// Helper: Get cached user likes from localStorage
const getLocalLikes = () => {
  try {
    const raw = localStorage.getItem(STORAGE_LIKES_KEY);
    return raw ? JSON.parse(raw) : {}; // { [userId]: [movieId1, movieId2] }
  } catch (e) {
    return {};
  }
};

const saveLocalLikes = (likesMap) => {
  try {
    localStorage.setItem(STORAGE_LIKES_KEY, JSON.stringify(likesMap));
  } catch (e) {
    // Ignore
  }
};

/**
 * 1. TĂNG LƯỢT XEM (POST /api/movies/:id/view)
 * Tăng +1 view cho phim toàn cầu.
 */
export const recordMovieView = async (movieId) => {
  if (!movieId) return { views: 0 };
  const cleanId = String(movieId).trim();

  // Update local cache immediately
  const localMap = getLocalViews();
  const currentLocalViews = (localMap[cleanId] || 0) + 1;
  localMap[cleanId] = currentLocalViews;
  saveLocalViews(localMap);

  try {
    const res = await fetch(`${API_BASE_URL}/api/movies/${encodeURIComponent(cleanId)}/view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      if (typeof data.views === 'number') {
        localMap[cleanId] = data.views;
        saveLocalViews(localMap);
        return { views: data.views };
      }
    }
  } catch (err) {
    console.warn('Backend view increment fallback to local:', err.message);
  }

  return { views: currentLocalViews };
};

/**
 * 2. LẤY STATS PHIM (GET /api/movies/:id/stats?user_id=...)
 * Lấy tổng view, tổng like, trạng thái đã like của user.
 */
export const getMovieStats = async (movieId, userId = 'anonymous') => {
  if (!movieId) return { views: 0, likes_count: 0, is_liked: false, comments_count: 0 };
  const cleanId = String(movieId).trim();
  const cleanUser = String(userId || 'anonymous').trim();

  const localViews = getLocalViews()[cleanId] || 0;
  const localLikes = getLocalLikes();
  const userLikesList = localLikes[cleanUser] || [];
  const isLikedLocal = userLikesList.includes(cleanId);
  
  // Count total likes locally
  let totalLikesLocal = 0;
  Object.values(localLikes).forEach(arr => {
    if (Array.isArray(arr) && arr.includes(cleanId)) totalLikesLocal++;
  });


  try {
    const res = await fetch(`${API_BASE_URL}/api/movies/${encodeURIComponent(cleanId)}/stats?user_id=${encodeURIComponent(cleanUser)}`);
    if (res.ok) {
      const data = await res.json();
      // Sync local cache with authoritative backend stats
      const localMap = getLocalViews();
      localMap[cleanId] = data.views;
      saveLocalViews(localMap);
      return data;
    }
  } catch (err) {
    // Silently fallback to local cache
  }

  return {
    views: localViews,
    likes_count: totalLikesLocal,
    is_liked: isLikedLocal,
    comments_count: null
  };
};

/**
 * 3. TOGGLE LIKE (POST /api/movies/:id/like)
 * Bấm tim: lưu/xóa phim khỏi danh sách yêu thích của user.
 */
export const toggleMovieLike = async (movieId, userId = 'anonymous') => {
  if (!movieId) return { is_liked: false, total_likes: 0 };
  const cleanId = String(movieId).trim();
  const cleanUser = String(userId || 'anonymous').trim();

  // Optimistic local update
  const localLikes = getLocalLikes();
  const userList = localLikes[cleanUser] || [];
  let isLikedNow = false;

  if (userList.includes(cleanId)) {
    localLikes[cleanUser] = userList.filter(id => id !== cleanId);
    isLikedNow = false;
  } else {
    localLikes[cleanUser] = [cleanId, ...userList];
    isLikedNow = true;
  }
  saveLocalLikes(localLikes);

  let totalLikesLocal = 0;
  Object.values(localLikes).forEach(arr => {
    if (Array.isArray(arr) && arr.includes(cleanId)) totalLikesLocal++;
  });

  try {
    const res = await fetch(`${API_BASE_URL}/api/movies/${encodeURIComponent(cleanId)}/like`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: cleanUser })
    });
    if (res.ok) {
      const data = await res.json();
      return {
        is_liked: data.is_liked,
        total_likes: data.total_likes
      };
    }
  } catch (err) {
    console.warn('Backend like fallback to local:', err.message);
  }

  return {
    is_liked: isLikedNow,
    total_likes: totalLikesLocal
  };
};

/**
 * 4. LẤY DANH SÁCH PHIM YÊU THÍCH CỦA USER (GET /api/user/:userId/favorites)
 */
export const getUserFavorites = async (userId = 'anonymous') => {
  const cleanUser = String(userId || 'anonymous').trim();
  const localLikes = getLocalLikes();
  const cachedFavs = localLikes[cleanUser] || [];

  try {
    const res = await fetch(`${API_BASE_URL}/api/user/${encodeURIComponent(cleanUser)}/favorites`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.favorites)) {
        // Sync local cache
        localLikes[cleanUser] = data.favorites;
        saveLocalLikes(localLikes);
        return data.favorites;
      }
    }
  } catch (err) {
    // Fallback
  }

  return cachedFavs;
};

/**
 * 5. BXH SÔI NỔI NHẤT (THEO LƯỢT XEM GIẢM DẦN, views >= 1)
 */
export const getLeaderboardTrending = async (limit = 10) => {
  try {
    const res = await fetch(`${API_BASE_URL}/api/leaderboard/trending?limit=${limit}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.trending)) {
        return data.trending.filter(item => item && Number(item.views) >= 1);
      }
    }
  } catch (err) {
    // Fallback to local views
  }

  const localViews = getLocalViews();
  const list = Object.entries(localViews)
    .map(([movie_id, views]) => ({ movie_id, views: Number(views) }))
    .filter(item => item.views >= 1)
    .sort((a, b) => b.views - a.views)
    .slice(0, limit);

  return list;
};

/**
 * 6. BXH YÊU THÍCH NHẤT (THEO SỐ TIM GIẢM DẦN, likes >= 1)
 */
export const getLeaderboardFavorites = async (limit = 10) => {
  try {
    const res = await fetch(`${API_BASE_URL}/api/leaderboard/favorites?limit=${limit}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.favorites)) {
        return data.favorites.filter(item => item && Number(item.like_count) >= 1);
      }
    }
  } catch (err) {
    // Fallback
  }

  const localLikes = getLocalLikes();
  const countMap = {};
  Object.values(localLikes).forEach(arr => {
    if (Array.isArray(arr)) {
      arr.forEach(movieId => {
        countMap[movieId] = (countMap[movieId] || 0) + 1;
      });
    }
  });

  const list = Object.entries(countMap)
    .map(([movie_id, like_count]) => ({ movie_id, like_count }))
    .filter(item => item.like_count >= 1)
    .sort((a, b) => b.like_count - a.like_count)
    .slice(0, limit);

  return list;
};

/**
 * 7. BÌNH LUẬN MỚI NHẤT TOÀN CẦU (Bình luận thật, không mock data)
 */
async function commentsRequest(url, options = {}) {
  const response = await fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(15000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Không kết nối được dịch vụ bình luận.');
  return data;
}

export const getRecentComments = async (limit = 10) => {
  const data = await commentsRequest(`/api/comments?limit=${limit}`);
  return data.comments;
};

export const getMovieCommentsPage = async (movieId, { cursor = '', signal } = {}) => {
  const query = new URLSearchParams({ movieId: String(movieId), limit: '30' });
  if (cursor) query.set('cursor', cursor);
  return commentsRequest('/api/comments?' + query, { signal });
};

export const getMovieComments = async movieId => (await getMovieCommentsPage(movieId)).comments;

export const addMovieComment = async (movieId, { username, content, requestId = crypto.randomUUID() }) => {
  const data = await commentsRequest('/api/comments', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ movieId: String(movieId), username, content, requestId }),
  });
  if (!data.comment?.id) throw new Error('Cloud chưa xác nhận lưu bình luận.');
  return data.comment;
};

/**
 * 9. LẤY THỐNG KÊ THẬT CHO ADMIN DASHBOARD (GET /api/admin/stats)
 * Nhiệm vụ 5:
 * - Tổng Phim Quản Lý
 * - Lượt Xem Hôm Nay
 */
export const getAdminStats = async (clientTotalMovies = 0) => {
  try {
    const url = clientTotalMovies > 0 
      ? `${API_BASE_URL}/api/admin/stats?total_movies=${clientTotalMovies}`
      : `${API_BASE_URL}/api/admin/stats`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      return {
        total_movies: data.total_movies ?? clientTotalMovies,
        today_views: data.today_views ?? 0
      };
    }
  } catch (err) {
    console.warn('Backend admin stats fallback to local:', err.message);
  }

  // Fallback to calculating from local views
  const localViews = getLocalViews();
  const totalViewsSum = Object.values(localViews).reduce((acc, v) => acc + (Number(v) || 0), 0);
  return {
    total_movies: clientTotalMovies || 0,
    today_views: totalViewsSum > 0 ? totalViewsSum : 0
  };
};
