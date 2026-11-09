import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { RiErrorWarningLine } from 'react-icons/ri';
import MovieCard from '../../components/ui/MovieCard';
import ContinuousMarquee from '../../components/ui/ContinuousMarquee';
import WatchHistoryModal from '../../components/ui/WatchHistoryModal';
import FavoritesModal from '../../components/ui/FavoritesModal';
import { getMovies, getHomepageLayout } from '../../services/movieService';
import { getUserWatchHistory } from '../../services/historyService';
import {
  getUserFavorites,
  getLeaderboardTrending,
  getLeaderboardFavorites,
  getRecentComments
} from '../../services/interactionService';
import { useAuth } from '../../contexts/AuthContext';
import { formatVietnameseSentenceCase, generateSlug } from '../../utils/textUtils';
import { isFeatureMovie } from '../../utils/movieFormat.js';
import { uniqueMovies } from '../../utils/movieCatalogue.js';

const HomePage = () => {
  const [allMovies, setAllMovies] = useState([]);
  const [layout, setLayout] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Hero Carousel Slide Index
  const [currentSlide, setCurrentSlide] = useState(0);

  // Watch History State for current logged-in user
  const { currentUser } = useAuth();
  const [userHistory, setUserHistory] = useState([]);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);

  // Favorites State
  const [favoriteMovieIds, setFavoriteMovieIds] = useState([]);
  const [isFavoritesModalOpen, setIsFavoritesModalOpen] = useState(false);

  // Real Interaction Leaderboards
  const [trendingLeaderboard, setTrendingLeaderboard] = useState([]);
  const [favoritesLeaderboard, setFavoritesLeaderboard] = useState([]);
  const [recentCommentsList, setRecentCommentsList] = useState([]);

  // Refresh user watch history
  const refreshHistory = useCallback(() => {
    if (currentUser?.username) {
      const hist = getUserWatchHistory(currentUser.username);
      setUserHistory(Array.isArray(hist) ? hist : []);
    } else {
      setUserHistory([]);
    }
  }, [currentUser?.username]);

  // Refresh user favorites
  const refreshFavorites = useCallback(async () => {
    const username = currentUser?.username || 'anonymous';
    try {
      const favIds = await getUserFavorites(username);
      setFavoriteMovieIds(Array.isArray(favIds) ? favIds : []);
    } catch (err) {
      console.error("Error fetching user favorites:", err);
      setFavoriteMovieIds([]);
    }
  }, [currentUser?.username]);

  // Refresh leaderboards
  const refreshLeaderboards = useCallback(async () => {
    try {
      const [trendingData, favData, commentsData] = await Promise.all([
        getLeaderboardTrending(),
        getLeaderboardFavorites(),
        getRecentComments(8)
      ]);

      // Filter: Lượt xem phải >= 1 (tuyệt đối không chèn phim 0 view)
      const validTrending = (Array.isArray(trendingData) ? trendingData : [])
        .filter(item => (Number(item?.views) || 0) >= 1);
      setTrendingLeaderboard(validTrending);

      // Filter: Số tim phải >= 1
      const validFavs = (Array.isArray(favData) ? favData : [])
        .filter(item => (Number(item?.like_count) || 0) >= 1);
      setFavoritesLeaderboard(validFavs);

      // Newest comments from database
      setRecentCommentsList(Array.isArray(commentsData) ? commentsData : []);
    } catch (err) {
      console.error("Error refreshing leaderboards:", err);
    }
  }, []);

  useEffect(() => {
    refreshHistory();
    refreshFavorites();
    refreshLeaderboards();

    const handleHistoryUpdate = () => {
      refreshHistory();
    };

    const handleFavoritesUpdate = () => {
      refreshFavorites();
      refreshLeaderboards();
    };

    window.addEventListener('210loliphim_history_updated', handleHistoryUpdate);
    window.addEventListener('210loliphim_favorites_updated', handleFavoritesUpdate);
    window.addEventListener('210loliphim_interactions_updated', handleFavoritesUpdate);

    return () => {
      window.removeEventListener('210loliphim_history_updated', handleHistoryUpdate);
      window.removeEventListener('210loliphim_favorites_updated', handleFavoritesUpdate);
      window.removeEventListener('210loliphim_interactions_updated', handleFavoritesUpdate);
    };
  }, [refreshHistory, refreshFavorites, refreshLeaderboards]);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const [moviesData, layoutData] = await Promise.all([
          getMovies(),
          getHomepageLayout()
        ]);
        setAllMovies(Array.isArray(moviesData) ? moviesData.filter(m => m && m.id) : []);
        setLayout(layoutData || null);
      } catch (err) {
        console.error("Error fetching homepage data:", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

  // Defensive Helper: Filter valid movies for CMS layout sections & eliminate ghost/deleted IDs
  const getSectionMovies = useMemo(() => {
    return (idList = []) => {
      if (!Array.isArray(idList) || idList.length === 0 || !Array.isArray(allMovies) || allMovies.length === 0) {
        return [];
      }
      return idList
        .map(id => allMovies.find(m => m && String(m.id) === String(id)))
        .filter(movie => movie !== undefined && movie !== null && typeof movie === 'object' && movie.id);
    };
  }, [allMovies]);

  // Clean Section Lists with fallback to existing DB movies
  const validAllMovies = useMemo(() => {
    return (Array.isArray(allMovies) ? allMovies : []).filter(m => m !== undefined && m !== null && m.id);
  }, [allMovies]);

  // Phim Yêu Thích Của Bạn (User favorited movies matched with full movie metadata)
  const userFavoriteMovies = useMemo(() => {
    if (!favoriteMovieIds || favoriteMovieIds.length === 0 || !Array.isArray(validAllMovies) || validAllMovies.length === 0) {
      return [];
    }
    return favoriteMovieIds
      .map(id => validAllMovies.find(m => m && String(m.id) === String(id)))
      .filter(movie => movie !== undefined && movie !== null && movie.id);
  }, [favoriteMovieIds, validAllMovies]);

  // Cột 1: Sôi Nổi Nhất (Xếp hạng theo lượt xem giảm dần, views >= 1)
  const trendingRankedMovies = useMemo(() => {
    if (!trendingLeaderboard || trendingLeaderboard.length === 0 || !Array.isArray(validAllMovies)) return [];
    return trendingLeaderboard
      .map(item => {
        const movie = validAllMovies.find(m => m && String(m.id) === String(item.movie_id));
        if (!movie) return null;
        return {
          ...movie,
          views: Number(item.views) || 0
        };
      })
      .filter(m => m !== null && m !== undefined && (m.views || 0) >= 1)
      .slice(0, 10);
  }, [trendingLeaderboard, validAllMovies]);

  // Cột 2: Yêu Thích Nhất (Xếp hạng theo lượt thả tim giảm dần, likes >= 1)
  const favoritesRankedMovies = useMemo(() => {
    if (!favoritesLeaderboard || favoritesLeaderboard.length === 0 || !Array.isArray(validAllMovies)) return [];
    return favoritesLeaderboard
      .map(item => {
        const movie = validAllMovies.find(m => m && String(m.id) === String(item.movie_id));
        if (!movie) return null;
        return {
          ...movie,
          like_count: Number(item.like_count) || 0
        };
      })
      .filter(m => m !== null && m !== undefined && (m.like_count || 0) >= 1)
      .slice(0, 10);
  }, [favoritesLeaderboard, validAllMovies]);

  const trendingSeriesMovies = useMemo(() => trendingRankedMovies.filter(movie => !isFeatureMovie(movie)), [trendingRankedMovies]);

  // Top 10 Phim Bộ Hôm Nay
  const top10Movies = useMemo(() => {
    if (trendingSeriesMovies.length > 0) {
      return uniqueMovies(trendingSeriesMovies).slice(0, 10);
    }
    const fromLayout = layout?.top10Movies ? getSectionMovies(layout.top10Movies) : [];
    const series = fromLayout.filter(movie => !isFeatureMovie(movie));
    return uniqueMovies(series.length > 0 ? series : validAllMovies.filter(movie => !isFeatureMovie(movie))).slice(0, 10);
  }, [layout, getSectionMovies, validAllMovies, trendingSeriesMovies]);

  const cinemaMovies = useMemo(() => {
    const fromLayout = layout?.cinemaMovies ? getSectionMovies(layout.cinemaMovies) : [];
    return uniqueMovies([...fromLayout, ...validAllMovies].filter(isFeatureMovie)).slice(0, 12);
  }, [layout, getSectionMovies, validAllMovies]);

  const animeVaultMovies = useMemo(() => {
    const fromLayout = layout?.animeVault ? getSectionMovies(layout.animeVault) : [];
    return fromLayout.length > 0 ? fromLayout : validAllMovies.slice(0, 5);
  }, [layout, getSectionMovies, validAllMovies]);

  const animeHighlight = (animeVaultMovies.length > 0 ? animeVaultMovies[0] : validAllMovies[0]) || null;

  // Hero Slider Movies (First 3 valid movies)
  const heroMovies = useMemo(() => {
    return validAllMovies.slice(0, 3);
  }, [validAllMovies]);

  // Auto-play hero slider
  useEffect(() => {
    if (heroMovies.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentSlide(prev => (prev + 1) % heroMovies.length);
    }, 6000);
    return () => clearInterval(interval);
  }, [heroMovies.length]);

  const activeHeroMovie = heroMovies[currentSlide] || heroMovies[0] || validAllMovies[0] || null;

  // Watch history for carousel: maximum 10 items, oldest on the left (idx 0), newest on the right
  const carouselHistory = useMemo(() => {
    if (!userHistory || userHistory.length === 0) return [];
    const latest10 = userHistory.slice(0, 10);
    return [...latest10].reverse();
  }, [userHistory]);

  return (
    <div className="min-h-screen bg-background text-gray-100 flex flex-col pb-24 overflow-x-hidden">

      {/* 1. HERO BANNER SECTION - Defensively guarded against null / empty / loading state */}
      {isLoading ? (
        <div className="relative w-full h-[70vh] sm:h-[78vh] md:h-[84vh] min-h-[540px] max-h-[780px] bg-[#121524] animate-pulse flex items-end p-8 md:p-16">
          <div className="space-y-4 max-w-2xl w-full">
            <div className="h-6 w-32 bg-white/10 rounded-lg animate-skeleton"></div>
            <div className="h-10 w-3/4 bg-white/10 rounded-xl animate-skeleton"></div>
            <div className="h-4 w-1/2 bg-white/10 rounded animate-skeleton"></div>
            <div className="h-12 w-48 bg-white/10 rounded-xl animate-skeleton"></div>
          </div>
        </div>
      ) : activeHeroMovie ? (
        <div className="relative w-full h-[70vh] sm:h-[78vh] md:h-[84vh] min-h-[540px] max-h-[780px] overflow-hidden">

          {/* Background Image with Smooth Fade */}
          <div className="absolute inset-0">
            <img
              src={activeHeroMovie?.banner || activeHeroMovie?.poster || 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1200'}
              alt={activeHeroMovie?.title || 'Banner'}
              className="w-full h-full object-cover object-center scale-105 transition-all duration-1000 ease-out"
            />
            {/* Multi-layered Gradients for readability */}
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent"></div>
            <div className="absolute inset-0 bg-gradient-to-r from-background/95 via-background/50 to-transparent"></div>
          </div>

          {/* Hero Content Overlay with pt-24 to safely clear the fixed top navbar */}
          <div className="absolute inset-0 max-w-7xl mx-auto px-4 md:px-12 flex flex-col justify-end pt-24 pb-14 md:pb-20 z-10">
            <div className="max-w-2xl lg:max-w-3xl space-y-3.5">

              {/* Badges */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-1 rounded-md bg-neon-red text-white text-xs font-black uppercase tracking-wider shadow-neon-red">
                  Hot Tuần Này
                </span>
                <span className="px-2.5 py-1 rounded-md bg-amber-400/20 text-amber-300 border border-amber-400/30 text-xs font-bold flex items-center gap-1">
                  ★ {activeHeroMovie?.imdb || '8.5'} IMDb
                </span>
                <span className="px-2.5 py-1 rounded-md bg-white/10 text-gray-300 text-xs font-semibold backdrop-blur-md">
                  {activeHeroMovie?.quality || '4K UltraHD'}
                </span>
                <span className="px-2.5 py-1 rounded-md bg-white/10 text-gray-300 text-xs font-semibold backdrop-blur-md">
                  {activeHeroMovie?.year || '2024'}
                </span>
              </div>

              {/* Movie Title in Proper Sentence Case (No uppercase forced class) */}
              <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-black text-white leading-snug drop-shadow-2xl font-display tracking-tight line-clamp-3">
                {formatVietnameseSentenceCase(activeHeroMovie?.title || 'Phim mới')}
              </h1>

              {activeHeroMovie?.originalTitle && (
                <p className="text-xs sm:text-sm md:text-base text-amber-300 font-semibold drop-shadow-md">
                  {activeHeroMovie.originalTitle}
                </p>
              )}

              {/* Description */}
              <p className="text-xs sm:text-sm text-gray-300 line-clamp-2 sm:line-clamp-3 leading-relaxed drop-shadow-sm max-w-xl">
                {activeHeroMovie?.description || 'Khám phá thế giới điện ảnh và anime đỉnh cao chất lượng 4K mượt mà.'}
              </p>

              {/* CTA Buttons */}
              <div className="flex flex-wrap items-center gap-3 pt-2">
                {activeHeroMovie?.id && (
                  <Link
                    to={`/movie/${generateSlug(activeHeroMovie.title) || activeHeroMovie.id}/tap-1`}
                    className="px-6 sm:px-8 py-3 rounded-xl bg-gradient-to-r from-neon-red to-orange-600 hover:from-red-600 hover:to-orange-500 text-white font-black text-xs sm:text-sm shadow-neon-red transition-all flex items-center gap-2 hover:scale-105 active:scale-95 cursor-pointer"
                  >
                    <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                    <span>Xem Ngay</span>
                  </Link>
                )}

                {activeHeroMovie?.id && (
                  <Link
                    to={`/movie/${generateSlug(activeHeroMovie.title) || activeHeroMovie.id}`}
                    className="px-5 sm:px-7 py-3 rounded-xl bg-white/15 hover:bg-white/25 text-white font-bold text-xs sm:text-sm backdrop-blur-md border border-white/20 transition-all flex items-center gap-2 hover:scale-105 cursor-pointer"
                  >
                    <RiErrorWarningLine className="text-base sm:text-lg flex-shrink-0" />
                    <span>Chi Tiết Phim</span>
                  </Link>
                )}
              </div>

            </div>
          </div>

          {/* Hero Slider Dots */}
          {heroMovies.length > 1 && (
            <div className="absolute bottom-6 right-6 md:right-12 z-20 flex items-center space-x-2">
              {heroMovies.map((_, idx) => {
                const dotKey = `hero-dot-${idx}`;
                return (
                  <button
                    key={dotKey}
                    onClick={() => setCurrentSlide(idx)}
                    className={`h-1.5 rounded-full transition-all duration-300 cursor-pointer ${currentSlide === idx ? 'w-8 bg-amber-400 shadow-[0_0_10px_#f59e0b]' : 'w-2 bg-white/30 hover:bg-white/60'
                      }`}
                    aria-label={`Slide ${idx + 1}`}
                  />
                );
              })}
            </div>
          )}

        </div>
      ) : (
        /* Empty Fallback Hero */
        <div className="relative w-full h-[50vh] min-h-[380px] bg-[#121524] flex items-center justify-center text-center p-8 pt-24">
          <div className="space-y-3">
            <span className="text-4xl">🎬</span>
            <h2 className="text-2xl font-black text-white">Chào Mừng Đến Với 210LoliPhim</h2>
            <p className="text-xs text-gray-400">Vào bảng quản trị Admin để thêm phim mới hoặc nạp phim từ Magic Import!</p>
            <div className="pt-2">
              <Link to="/admin" className="px-5 py-2.5 rounded-xl bg-neon-red text-white text-xs font-bold inline-block">
                👑 Mở Admin Dashboard
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Container */}
      <div className="w-full min-w-0 px-4 md:px-12 -mt-4 relative z-20 space-y-12 max-w-7xl mx-auto">

        {/* Section: Phim mới cập nhật */}
        <section className="space-y-4 overflow-visible">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <div className="w-1.5 h-5 shrink-0 rounded-full bg-neon-cyan shadow-[0_0_10px_#00f0ff]"></div>
              <h2 className="text-lg md:text-xl font-extrabold text-white">Phim Mới Cập Nhật</h2>
            </div>
            <Link to="/the-loai" className="text-xs text-gray-400 hover:text-neon-cyan cursor-pointer">
              Xem tất cả ({validAllMovies.length}) →
            </Link>
          </div>

          {isLoading ? (
            <div className="flex flex-nowrap overflow-x-auto overflow-y-visible gap-3 sm:gap-4 w-full pb-12 pt-4 -my-4 scroll-smooth no-scrollbar">
              {Array.from({ length: 8 }).map((_, idx) => {
                const skeletonKey = `skeleton-new-${idx}`;
                return (
                  <MovieCard key={skeletonKey} isLoading={true} layoutMode="carousel" />
                );
              })}
            </div>
          ) : validAllMovies.length === 0 ? (
            <div className="p-8 text-center bg-surface-card rounded-2xl border border-glass-border space-y-2">
              <p className="text-sm font-bold text-gray-300">Kho phim hiện tại chưa có phim nào.</p>
              <p className="text-xs text-gray-500">Vào Admin Manager để thêm phim mới hoặc Magic Import!</p>
            </div>
          ) : (
            <ContinuousMarquee
              items={validAllMovies.filter(movie => movie !== undefined && movie !== null && movie.id).slice(0, 10)}
              direction="right"
              speed={30}
              renderItem={(movie, idx, isClone) => (
                <MovieCard
                  movie={movie}
                  layoutMode="carousel"
                  showHoverPopup={false}
                  tabIndex={isClone ? -1 : 0}
                />
              )}
            />
          )}
        </section>

        {/* SECTION: Phim Yêu Thích Của Bạn (Đặt ngay dưới list Phim Mới Cập Nhật) */}
        {userFavoriteMovies.length > 0 && (
          <section className="space-y-4 overflow-visible animate-fadeIn">
            <div className="flex items-center justify-between">
              <div
                onClick={() => setIsFavoritesModalOpen(true)}
                className="flex items-center space-x-2.5 cursor-pointer group select-none"
                title="Bấm vào đây để mở toàn bộ danh sách phim yêu thích"
              >
                <div className="w-1.5 h-5 shrink-0 rounded-full bg-neon-red shadow-[0_0_12px_#e50914]"></div>
                <h2 className="text-lg md:text-xl font-extrabold text-white flex flex-wrap items-center gap-2 min-w-0 group-hover:text-neon-red transition-colors">
                  <span>Phim Yêu Thích Của Bạn</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-neon-red/20 text-neon-red border border-neon-red/30 font-bold">
                    ❤️ {userFavoriteMovies.length} Phim
                  </span>
                </h2>
              </div>

              {userFavoriteMovies.length > 10 && (
                <button
                  type="button"
                  onClick={() => setIsFavoritesModalOpen(true)}
                  className="text-xs text-neon-red hover:text-red-400 font-bold cursor-pointer transition-colors flex items-center gap-1 group"
                >
                  <span>Xem tất cả ({userFavoriteMovies.length})</span>
                  <span className="group-hover:translate-x-0.5 transition-transform">→</span>
                </button>
              )}
            </div>

            {/* Trượt ngang tối đa 10 phim yêu thích */}
            {userFavoriteMovies.length >= 4 ? (
              <ContinuousMarquee
                items={userFavoriteMovies.slice(0, 10)}
                direction="right"
                speed={25}
                renderItem={(movie, idx, isClone) => (
                  <MovieCard
                    movie={movie}
                    layoutMode="carousel"
                    showHoverPopup={false}
                    tabIndex={isClone ? -1 : 0}
                  />
                )}
              />
            ) : (
              <div className="flex flex-nowrap overflow-x-auto overflow-y-visible gap-3 sm:gap-4 w-full pb-12 pt-4 -my-4 scroll-smooth no-scrollbar">
                {userFavoriteMovies
                  .slice(0, 10)
                  .map((movie, idx, arr) => {
                    const favCardKey = movie.id || `user-fav-${idx}`;
                    return (
                      <MovieCard
                        key={favCardKey}
                        movie={movie}
                        layoutMode="carousel"
                        isFirst={idx === 0}
                        isLast={idx === arr.length - 1}
                      />
                    );
                  })}
              </div>
            )}
          </section>
        )}

        {/* SECTION 1: Top 10 phim bộ hôm nay */}
        {top10Movies.filter(m => m !== undefined && m !== null && m.id).length > 0 && (
          <section className="space-y-4 overflow-visible">
            <div className="flex items-center space-x-2.5">
              <div className="w-1.5 h-5 shrink-0 rounded-full bg-amber-400 shadow-[0_0_12px_#f59e0b]"></div>
              <h2 className="text-lg md:text-xl font-extrabold text-white flex flex-wrap items-center gap-2 min-w-0">
                <span>Top 10 Phim Bộ Hôm Nay</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-amber-400/20 text-amber-300 border border-amber-400/30">{trendingSeriesMovies.length ? `${top10Movies.length} phim có lượt xem` : 'Khám phá kho phim'}</span>
              </h2>
            </div>

            <ContinuousMarquee
              items={top10Movies.filter(movie => movie !== undefined && movie !== null && movie.id).slice(0, 10)}
              loop={false}
              className="px-3"
              direction="left"
              speed={30}
              renderItem={(movie, idx, isClone) => (
                <div className="relative group flex-none">
                  <div className="absolute -top-4 -left-3 z-20 text-4xl sm:text-5xl font-black italic text-amber-400 drop-shadow-[0_4px_10px_rgba(0,0,0,0.9)] stroke-black pointer-events-none select-none">
                    #{idx + 1}
                  </div>
                  <MovieCard
                    movie={movie}
                    layoutMode="carousel"
                    showHoverPopup={false}
                    tabIndex={isClone ? -1 : 0}
                  />
                </div>
              )}
            />
          </section>
        )}

        {/* SECTION: LỊCH SỬ XEM PHIM (Chỉ hiển thị khi người dùng đã có lịch sử xem) */}
        {currentUser && carouselHistory.length > 0 && (
          <section className="space-y-4 overflow-visible animate-fadeIn">
            <div className="flex items-center justify-between">
              <div
                onClick={() => setIsHistoryModalOpen(true)}
                className="flex items-center space-x-2.5 cursor-pointer group select-none"
                title="Bấm vào đây để mở toàn bộ danh sách lịch sử xem phim"
              >
                <div className="w-1.5 h-5 shrink-0 rounded-full bg-neon-cyan shadow-[0_0_12px_#00f0ff]"></div>
                <h2 className="text-lg md:text-xl font-extrabold text-white flex flex-wrap items-center gap-2 min-w-0 group-hover:text-neon-cyan transition-colors">
                  <span>Lịch Sử Xem Phim</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30 font-bold">
                    🕒 {userHistory.length} Phim
                  </span>
                </h2>
              </div>

              <button
                type="button"
                onClick={() => setIsHistoryModalOpen(true)}
                className="text-xs text-neon-cyan hover:text-cyan-300 font-bold cursor-pointer transition-colors flex items-center gap-1 group"
              >
                <span>Xem tất cả ({userHistory.length})</span>
                <span className="group-hover:translate-x-0.5 transition-transform">→</span>
              </button>
            </div>

            {/* Trượt ngang tối đa 10 phim: cũ nhất bên trái (idx 0), mới nhất bên phải (idx length-1) */}
            <div className="flex space-x-4 overflow-x-auto overflow-y-visible no-scrollbar snap-x snap-mandatory py-12 px-1 scroll-smooth -my-8">
              {carouselHistory.map((item, idx) => {
                const historyCardKey = item.id || item.movieId || `hist-${idx}`;
                const isFirstCard = idx === 0;
                const isLastCard = idx === carouselHistory.length - 1;
                const popupPositionClass = isFirstCard
                  ? 'left-0 translate-x-0 origin-left'
                  : isLastCard
                    ? 'right-0 left-auto translate-x-0 origin-right'
                    : 'left-1/2 -translate-x-1/2 origin-center';
                const formattedTitle = formatVietnameseSentenceCase(item.title || 'Phim');
                const itemSlug = generateSlug(item.title) || item.movieId;

                return (
                  <div
                    key={historyCardKey}
                    className="snap-start flex-none w-36 sm:w-44 relative group cursor-pointer select-none transition-transform duration-300 hover:scale-105 hover:z-50"
                  >
                    {/* Episode badge at top-left */}
                    <div className="absolute top-2 left-2 z-20 pointer-events-none">
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-neon-cyan text-black shadow-[0_2px_8px_rgba(0,240,255,0.6)]">
                        Tập {item.episode || '1'}
                      </span>
                    </div>

                    <Link to={`/movie/${itemSlug}/tap-${item.episode || '1'}`} className="block relative w-full aspect-[2/3] rounded-xl overflow-hidden border border-white/10 shadow-xl group-hover:border-neon-cyan/50 transition-colors">
                      <img
                        src={item.poster || 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=200'}
                        alt={formattedTitle}
                        onError={(e) => { e.target.src = 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=200'; }}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent opacity-80"></div>
                      <div className="absolute bottom-2 left-2 right-2 space-y-0.5">
                        <h4 className="text-xs font-bold text-white truncate">{formattedTitle}</h4>
                        {item.currentTime > 0 && (
                          <p className="text-[10px] text-neon-cyan font-bold truncate">⏱️ Đã xem: {item.progressText || `${Math.floor(item.currentTime / 60)}p`}</p>
                        )}
                        <p className="text-[10px] text-amber-300 font-mono truncate">🕒 {item.timestamp}</p>
                      </div>
                    </Link>

                    {/* HOVER EXPANDED POPUP CARD */}
                    <div className={`absolute top-1/2 -translate-y-1/2 ${popupPositionClass} w-[220px] sm:w-[260px] md:w-[300px] lg:w-[340px] scale-90 opacity-0 invisible group-hover:scale-100 group-hover:opacity-100 group-hover:visible pointer-events-none group-hover:pointer-events-auto transition-all duration-300 ease-out rounded-xl bg-[#14151a] border border-[#2a2d3a] shadow-[0_20px_50px_rgba(0,0,0,0.95)] overflow-hidden z-50 text-white`}>
                      <div className="relative w-full aspect-video bg-[#1a1e30] overflow-hidden rounded-t-xl">
                        <img
                          src={item.banner || item.poster || 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600'}
                          alt={formattedTitle}
                          onError={(e) => { e.target.src = 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600'; }}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-[#14151a] via-[#14151a]/50 to-transparent"></div>

                        <div className="absolute top-2 left-2 z-10 flex flex-wrap items-center gap-1.5">
                          <span className="px-2 py-0.5 rounded text-[10px] font-black bg-neon-cyan text-black shadow-md">
                            Đang xem: Tập {item.episode || '1'}
                          </span>
                          {item.currentTime > 0 && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-black/70 text-neon-cyan border border-neon-cyan/40">
                              ⏱️ {item.progressText || `${Math.floor(item.currentTime / 60)}p`}
                            </span>
                          )}
                        </div>

                        <div className="absolute bottom-1 right-2 z-10">
                          <span className="text-[10px] text-amber-300 font-mono font-bold drop-shadow-md">
                            {item.timestamp}
                          </span>
                        </div>
                      </div>

                      <div className="relative px-3.5 pb-3.5 -mt-6 sm:-mt-8">
                        <h3 className="text-white font-black text-sm sm:text-base truncate drop-shadow-lg">
                          {formattedTitle}
                        </h3>
                        {item.originalTitle && (
                          <p className="text-amber-400 text-[11px] sm:text-xs mb-2.5 sm:mb-3 truncate drop-shadow-md font-medium">
                            {item.originalTitle}
                          </p>
                        )}

                        <div className="flex items-center gap-1.5 sm:gap-2 mb-2.5 sm:mb-3.5 w-full">
                          <Link
                            to={`/movie/${itemSlug}/tap-${item.episode || '1'}`}
                            className="flex-1 bg-gradient-to-r from-neon-cyan to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-black font-extrabold py-1.5 px-2.5 rounded-lg transition-colors flex justify-center items-center gap-1 shadow-md text-xs"
                          >
                            <svg className="w-3.5 h-3.5 fill-current flex-shrink-0" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                            <span>Xem tiếp</span>
                          </Link>

                          <Link
                            to={`/movie/${itemSlug}`}
                            className="border border-gray-600 bg-[#2a2d3a]/60 text-white py-1.5 px-2.5 rounded-lg hover:bg-gray-700 transition-colors flex items-center gap-1 whitespace-nowrap font-medium text-xs cursor-pointer"
                            title="Xem chi tiết phim"
                          >
                            <span className="text-gray-300 text-xs leading-none">ℹ</span> Chi tiết
                          </Link>
                        </div>

                        <div className="flex flex-wrap items-center gap-1 sm:gap-1.5 mb-2 text-[9px] sm:text-[10px] font-semibold">
                          <span className="px-1.5 py-0.5 rounded border border-amber-400/80 text-amber-400 bg-amber-400/10">
                            ★ {item.imdb || '8.0'} IMDb
                          </span>
                          <span className="px-1.5 py-0.5 rounded border border-gray-500 bg-gray-800 text-gray-200">
                            {item.ageRating || 'T16'}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-300">
                            {item.year || '2024'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* SECTION 2: Mãn nhãn với phim chiếu rạp */}
        {cinemaMovies.filter(m => m !== undefined && m !== null && m.id).length > 0 && (
          <section className="space-y-4 overflow-visible">
            <div className="flex items-center space-x-2.5">
              <div className="w-1.5 h-5 shrink-0 rounded-full bg-neon-red shadow-[0_0_12px_#e50914]"></div>
              <h2 className="text-lg md:text-xl font-extrabold text-white flex flex-wrap items-center gap-2 min-w-0">
                <span>Mãn Nhãn Với Phim Chiếu Rạp</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-neon-red/20 text-neon-red border border-neon-red/30">🍿 Cinema 4K</span>
              </h2>
            </div>

            <div className="flex flex-nowrap overflow-x-auto overflow-y-visible gap-3 sm:gap-4 w-full pb-12 pt-4 -my-4 scroll-smooth no-scrollbar">
              {cinemaMovies
                .filter(movie => movie !== undefined && movie !== null && movie.id)
                .slice(0, 10)
                .map((movie, idx, arr) => {
                  const cinemaKey = movie.id || `cinema-${idx}`;
                  return (
                    <div key={cinemaKey} className="relative group flex-none">
                      <MovieCard
                        movie={movie}
                        layoutMode="carousel"
                        isFirst={idx === 0}
                        isLast={idx === arr.length - 1}
                        showHoverPopup={false}
                      />
                      <div className="absolute top-2 right-2 z-10 pointer-events-none">
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-amber-500 text-black uppercase shadow-md">
                          RẠP 4K
                        </span>
                      </div>
                    </div>
                  );
                })}
            </div>
          </section>
        )}

        {/* SECTION 3: Bảng Xếp Hạng 210LoliPhim (3 cột tương tác thực tế) */}
        <section className="space-y-4">
          <div className="flex items-center space-x-2.5">
            <div className="w-1.5 h-5 shrink-0 rounded-full bg-purple-500 shadow-[0_0_12px_#a855f7]"></div>
            <h2 className="text-lg md:text-xl font-extrabold text-white">Bảng Xếp Hạng 210LoliPhim</h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Cột 1: Sôi nổi nhất (Xếp hạng theo lượt xem giảm dần, views >= 1) */}
            <div className="glass-panel p-5 rounded-2xl border border-glass-border space-y-4">
              <h3 className="text-sm font-extrabold text-amber-300 flex items-center justify-between border-b border-white/10 pb-3">
                <span className="flex items-center gap-2">🔥 Sôi Nổi Nhất</span>
                <span className="text-[10px] text-gray-400">Lượt xem</span>
              </h3>

              <div className="space-y-3">
                {trendingRankedMovies.length === 0 ? (
                  <div className="py-12 text-center text-gray-400 text-xs italic">
                    Hiện đang trống
                  </div>
                ) : (
                  trendingRankedMovies.map((item, idx) => {
                    const trendKey = item.id || `trend-${idx}`;
                    const movieSlug = generateSlug(item?.title) || item?.id;
                    const viewsFormatted = (Number(item?.views) || 0).toLocaleString();

                    return (
                      <Link
                        key={trendKey}
                        to={`/movie/${movieSlug}`}
                        className="flex items-center space-x-3 p-2 rounded-xl hover:bg-white/5 transition-all group"
                      >
                        <span className={`text-xl font-black italic w-6 text-center ${idx === 0 ? 'text-yellow-400' : idx === 1 ? 'text-gray-300' : idx === 2 ? 'text-amber-600' : 'text-gray-500'}`}>
                          #{idx + 1}
                        </span>
                        <img
                          src={item?.poster || 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=200'}
                          alt={item?.title || 'Poster'}
                          onError={(e) => { e.target.src = 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=200'; }}
                          className="w-10 h-14 object-cover rounded-lg border border-white/10 flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <h4 className="text-xs font-bold text-white truncate group-hover:text-amber-400">
                            {formatVietnameseSentenceCase(item?.title || 'Phim')}
                          </h4>
                          <div className="flex items-center justify-between mt-1 text-[10px] text-gray-400">
                            <span>★ {item?.imdb || '8.5'} IMDb</span>
                            <span className="text-amber-400 font-mono font-semibold flex items-center gap-0.5">
                              👁️ {viewsFormatted}
                            </span>
                          </div>
                        </div>
                      </Link>
                    );
                  })
                )}
              </div>
            </div>

            {/* Cột 2: Yêu thích nhất (Xếp hạng theo lượt thả tim giảm dần, likes >= 1. Ẩn số tim ra ngoài UI) */}
            <div className="glass-panel p-5 rounded-2xl border border-glass-border space-y-4">
              <h3 className="text-sm font-extrabold text-neon-red flex items-center justify-between border-b border-white/10 pb-3">
                <span className="flex items-center gap-2">❤️ Yêu Thích Nhất</span>
                <span className="text-[10px] text-gray-400">Được yêu thích</span>
              </h3>

              <div className="space-y-3">
                {favoritesRankedMovies.length === 0 ? (
                  <div className="py-12 text-center text-gray-400 text-xs italic">
                    Hiện chưa có phim yêu thích
                  </div>
                ) : (
                  favoritesRankedMovies.map((item, idx) => {
                    const favRankKey = item.id || `fav-rank-${idx}`;
                    const movieSlug = generateSlug(item?.title) || item?.id;

                    return (
                      <Link
                        key={favRankKey}
                        to={`/movie/${movieSlug}`}
                        className="flex items-center space-x-3 p-2 rounded-xl hover:bg-white/5 transition-all group"
                      >
                        <span className={`text-xl font-black italic w-6 text-center ${idx === 0 ? 'text-red-400' : idx === 1 ? 'text-gray-300' : idx === 2 ? 'text-gray-400' : 'text-gray-600'}`}>
                          #{idx + 1}
                        </span>
                        <img
                          src={item?.poster || 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=200'}
                          alt={item?.title || 'Poster'}
                          onError={(e) => { e.target.src = 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=200'; }}
                          className="w-10 h-14 object-cover rounded-lg border border-white/10 flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <h4 className="text-xs font-bold text-white truncate group-hover:text-neon-red">
                            {formatVietnameseSentenceCase(item?.title || 'Phim')}
                          </h4>
                          <div className="flex items-center justify-between mt-1 text-[10px] text-gray-400">
                            <span>★ {item?.imdb || '8.5'} IMDb</span>
                            <span className="text-gray-400">{item?.year || '2024'}</span>
                          </div>
                        </div>
                      </Link>
                    );
                  })
                )}
              </div>
            </div>

            {/* Cột 3: Bình luận mới (Hiển thị bình luận thật mới nhất từ database) */}
            <div className="glass-panel p-5 rounded-2xl border border-glass-border space-y-4">
              <h3 className="text-sm font-extrabold text-neon-cyan flex items-center justify-between border-b border-white/10 pb-3">
                <span className="flex items-center gap-2">💬 Bình Luận Mới</span>
                <span className="text-[10px] text-gray-400">Thảo luận thật</span>
              </h3>

              <div className="space-y-3">
                {recentCommentsList.length === 0 ? (
                  <div className="py-12 text-center text-gray-400 text-xs italic">
                    Hiện chưa có bình luận
                  </div>
                ) : (
                  recentCommentsList.map((cmt, idx) => {
                    const commentKey = cmt.id || `cmt-${idx}`;
                    const targetMovie = validAllMovies.find(m => m && String(m.id) === String(cmt.movie_id));
                    const movieTitle = targetMovie?.title || cmt.movie_title || 'Phim';
                    const movieSlug = generateSlug(movieTitle) || cmt.movie_id;

                    return (
                      <Link
                        key={commentKey}
                        to={`/movie/${movieSlug}#comments-section`}
                        className="flex items-start space-x-3 p-2 rounded-xl hover:bg-white/5 transition-all group"
                      >
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-neon-cyan/30 to-blue-500/30 border border-neon-cyan/40 text-neon-cyan flex items-center justify-center font-bold text-xs flex-shrink-0 mt-0.5">
                          {(cmt.username || 'U').slice(0, 1).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-[11px] font-bold text-neon-cyan truncate">
                              @{cmt.username || 'Người dùng'}
                            </span>
                            <span className="text-[9px] text-gray-400 whitespace-nowrap">
                              {cmt.created_at ? new Date(cmt.created_at).toLocaleDateString('vi-VN') : ''}
                            </span>
                          </div>
                          <p className="text-xs text-gray-200 line-clamp-1 italic mt-0.5 group-hover:text-white">
                            "{cmt.content}"
                          </p>
                          <p className="text-[10px] text-amber-400/80 truncate mt-0.5 font-medium">
                            🎬 {formatVietnameseSentenceCase(movieTitle)}
                          </p>
                        </div>
                      </Link>
                    );
                  })
                )}
              </div>
            </div>

          </div>
        </section>

        {/* SECTION 4: Kho tàng anime mới nhất */}
        {(animeHighlight || animeVaultMovies.length > 0) && (
          <section className="space-y-6 pt-4 border-t border-white/10">
            <div className="flex items-center space-x-2.5">
              <div className="w-1.5 h-5 shrink-0 rounded-full bg-pink-500 shadow-[0_0_12px_#ec4899]"></div>
              <h2 className="text-lg md:text-xl font-extrabold text-white flex flex-wrap items-center gap-2 min-w-0">
                <span>Kho Tàng Anime Mới Nhất</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-pink-500/20 text-pink-400 border border-pink-500/30">⚔️ World of Anime</span>
              </h2>
            </div>

            {/* Large Highlight Anime Banner */}
            {animeHighlight && (
              <div className="relative w-full h-56 sm:h-72 rounded-2xl overflow-hidden border border-pink-500/30 shadow-2xl flex items-end p-6">
                <img
                  src={animeHighlight?.banner || animeHighlight?.poster || 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1200'}
                  alt={animeHighlight?.title || 'Anime'}
                  onError={(e) => { e.target.src = 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1200'; }}
                  className="absolute inset-0 w-full h-full object-cover opacity-80 scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#151928] via-[#151928]/60 to-transparent"></div>
                <div className="relative z-10 space-y-2 max-w-xl">
                  <span className="px-2.5 py-1 rounded-md bg-pink-600 text-white text-[10px] font-black uppercase tracking-wider">
                    Siêu Phẩm Anime Highlights
                  </span>
                  <h3 className="text-2xl sm:text-3xl font-black text-white drop-shadow-md uppercase">
                    {animeHighlight?.title || 'Anime Highlight'}
                  </h3>
                  <p className="text-xs text-gray-300 line-clamp-2">
                    {animeHighlight?.description || 'Hành trình sinh tồn và trưởng thành đầy xúc cảm tại thế giới anime đỉnh cao.'}
                  </p>
                  {animeHighlight?.id && (
                    <div className="pt-1">
                      <Link
                        to={`/movie/${generateSlug(animeHighlight.title) || animeHighlight.id}/tap-1`}
                        className="inline-flex items-center space-x-2 px-5 py-2 rounded-xl bg-pink-600 hover:bg-pink-500 text-white font-bold text-xs shadow-lg transition-all"
                      >
                        <span>Xem Ngay Tập Mới</span>
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* List of Recent Anime Episode Cards Underneath */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {animeVaultMovies
                .filter(anime => anime !== undefined && anime !== null && anime.id)
                .map((anime, idx) => {
                  const animeKey = anime?.id || `anime-${idx}`;
                  return (
                    <Link
                      key={animeKey}
                      to={`/movie/${generateSlug(anime?.title) || anime?.id}/tap-1`}
                      className="flex items-center space-x-3 p-3 rounded-xl bg-surface-card border border-glass-border hover:border-pink-500/50 transition-all group"
                    >
                      <div className="w-20 h-14 rounded-lg overflow-hidden flex-shrink-0 relative border border-white/10">
                        <img
                          src={anime?.poster || 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=200'}
                          alt={anime?.title || 'Anime'}
                          onError={(e) => { e.target.src = 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=200'; }}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        />
                        <span className="absolute bottom-1 right-1 text-[9px] px-1 rounded bg-black/80 text-pink-400 font-bold">
                          {isFeatureMovie(anime) ? 'Movie' : typeof anime?.episodes === 'string' ? anime.episodes : (Array.isArray(anime?.episodes) ? `${anime.episodes.length} Tập` : 'Tập 1')}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-xs font-bold text-white truncate group-hover:text-pink-400">{anime?.title || 'Anime'}</h4>
                        <p className="text-[10px] text-gray-400 mt-1">Cập nhật 4K Vietsub</p>
                      </div>
                    </Link>
                  );
                })}
            </div>
          </section>
        )}

      </div>

      {/* Full Watch History Modal */}
      {currentUser && (
        <WatchHistoryModal
          isOpen={isHistoryModalOpen}
          onClose={() => setIsHistoryModalOpen(false)}
          username={currentUser.username}
          history={userHistory}
          onHistoryChange={refreshHistory}
        />
      )}

      {/* Full Favorites Modal */}
      <FavoritesModal
        isOpen={isFavoritesModalOpen}
        onClose={() => setIsFavoritesModalOpen(false)}
        username={currentUser?.username || 'anonymous'}
        movies={userFavoriteMovies}
        onFavoritesChange={refreshFavorites}
      />
    </div>
  );
};

export default HomePage;
