import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { getMovies, addMovie, updateMovie, deleteMovie, syncAllLocalMoviesToCloud } from '../../services/movieService';
import { runAutoUpdate } from '../../services/autoCrawlService';
import MagicImport from '../../components/admin/MagicImport';
import HomepageCMS from '../../components/admin/HomepageCMS';
import AutoSyncModal from '../../components/admin/AutoSyncModal';
import dragonLogo from '../../assets/dragon-logo.png';
import { ANIME_GENRES } from '../../components/common/Navbar';
import { formatVietnameseSentenceCase, extractCleanEpisodeNumber, formatEpisodeTitle, deduplicateEpisodes } from '../../utils/textUtils';

/**
 * Defensive Helper: Safely extracts genres as clean string array
 */
const getGenresArray = (movie) => {
  if (!movie) return ['Anime'];
  if (Array.isArray(movie.genres)) {
    const clean = movie.genres.filter(Boolean);
    if (clean.length > 0) return clean;
  }
  if (typeof movie.category === 'string' && movie.category.trim()) {
    const clean = movie.category.split(',').map(s => s.trim()).filter(Boolean);
    if (clean.length > 0) return clean;
  }
  if (Array.isArray(movie.category)) {
    const clean = movie.category.filter(Boolean);
    if (clean.length > 0) return clean;
  }
  return ['Anime'];
};

/**
 * Defensive Helper: Safely formats episode display text to avoid rendering raw objects in JSX
 */
const getEpisodeDisplay = (episodes, fallbackCount) => {
  if (Array.isArray(episodes)) {
    return `${episodes.length} Tập`;
  }
  if (typeof episodes === 'string' && episodes.trim()) {
    return episodes;
  }
  if (fallbackCount && typeof fallbackCount === 'string') {
    return fallbackCount;
  }
  return '1 Tập';
};

/**
 * Interactive Multi-Select Genre Tags Component
 * Allows selecting multiple categories/genres with badges, search, and bulk toggling
 */
const GenreMultiSelect = ({ selectedGenres = [], onChange, label = "Danh Mục Chính (Chọn được nhiều thể loại)" }) => {
  const [searchFilter, setSearchFilter] = useState('');

  const currentList = useMemo(() => {
    if (Array.isArray(selectedGenres)) return selectedGenres.filter(Boolean);
    if (typeof selectedGenres === 'string' && selectedGenres.trim()) {
      return selectedGenres.split(',').map(s => s.trim()).filter(Boolean);
    }
    return [];
  }, [selectedGenres]);

  const toggleGenre = (genre) => {
    if (!genre) return;
    if (currentList.includes(genre)) {
      onChange(currentList.filter(g => g !== genre));
    } else {
      onChange([...currentList, genre]);
    }
  };

  const selectAll = () => onChange([...ANIME_GENRES]);
  const clearAll = () => onChange([]);

  const filteredGenres = useMemo(() => {
    return (ANIME_GENRES || []).filter(g => 
      !searchFilter || String(g).toLowerCase().includes(searchFilter.toLowerCase())
    );
  }, [searchFilter]);

  return (
    <div className="space-y-2.5 p-4 rounded-xl bg-surface border border-glass-border">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/10 pb-2">
        <label className="text-xs font-bold text-gray-200 flex items-center gap-1.5">
          <span>🎭</span> {label}
          <span className="px-2 py-0.5 rounded-full bg-neon-cyan/20 text-neon-cyan text-[10px] font-extrabold">
            Đã chọn {currentList.length} mục
          </span>
        </label>
        
        <div className="flex items-center space-x-2 text-[10px]">
          <button 
            type="button" 
            onClick={selectAll}
            className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-gray-300 font-semibold transition-all cursor-pointer"
          >
            ✓ Chọn tất cả ({ANIME_GENRES.length})
          </button>
          <button 
            type="button" 
            onClick={clearAll}
            className="px-2.5 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-400 font-semibold transition-all cursor-pointer"
          >
            ✕ Bỏ chọn hết
          </button>
        </div>
      </div>

      {/* Selected Tags Chips Display */}
      {currentList.length > 0 && (
        <div className="flex flex-wrap gap-1.5 py-1 max-h-24 overflow-y-auto custom-scrollbar">
          {currentList.map((genre) => (
            <span 
              key={genre}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-neon-cyan/20 border border-neon-cyan/40 text-neon-cyan text-xs font-bold shadow-sm animate-fadeIn"
            >
              <span>{genre}</span>
              <button 
                type="button"
                onClick={() => toggleGenre(genre)}
                className="hover:text-white text-[11px] font-black cursor-pointer bg-neon-cyan/30 rounded-full w-4 h-4 inline-flex items-center justify-center"
                title={`Xóa ${genre}`}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Quick Search Filter */}
      <div className="relative">
        <input 
          type="text"
          placeholder={`🔍 Gõ để tìm nhanh thể loại trong danh sách ${ANIME_GENRES.length} mục...`}
          value={searchFilter}
          onChange={e => setSearchFilter(e.target.value)}
          className="w-full py-2 px-3 rounded-lg bg-surface-card border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan"
        />
        {searchFilter && (
          <button
            type="button"
            onClick={() => setSearchFilter('')}
            className="absolute right-2.5 top-2 text-xs text-gray-400 hover:text-white"
          >
            ✕
          </button>
        )}
      </div>

      {/* Interactive 46 Genre Badges Grid */}
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1.5 max-h-48 overflow-y-auto custom-scrollbar pr-1 pt-1">
        {filteredGenres.map((genre) => {
          const isSelected = currentList.includes(genre);
          return (
            <button
              type="button"
              key={genre}
              onClick={() => toggleGenre(genre)}
              className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold text-center truncate transition-all cursor-pointer border ${
                isSelected
                  ? 'bg-neon-cyan text-black border-neon-cyan shadow-[0_0_10px_rgba(0,240,255,0.4)] font-bold scale-[1.02]'
                  : 'bg-surface-card text-gray-300 border-white/10 hover:border-white/30 hover:text-white'
              }`}
              title={genre}
            >
              {isSelected ? `✓ ${genre}` : genre}
            </button>
          );
        })}
      </div>
    </div>
  );
};

/**
 * Phase 4: Full-CRUD Movie Management System (Admin Panel) + Homepage Layout CMS Tab
 * Updated with Defensive Programming to guarantee zero component crashes
 */
const MovieManagementPage = ({ readOnly = false }) => {
  // Navigation Tabs: 'list' | 'create' | 'magic' | 'homepage'
  const [activeTab, setActiveTab] = useState('list');

  // Main Movies State - Always initialized as an Array
  const [movies, setMovies] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState(null); // { type: 'success' | 'error' | 'info', message: string }

  // Filter, Search & Pagination States
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [qualityFilter, setQualityFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 6;

  // Single Add / Edit Form State with multi-select Anime Genres
  const initialFormState = {
    title: '',
    originalTitle: '',
    country: 'Nhật Bản',
    m3u8Url: '',
    episodes: '1/1',
    quality: '4K UltraHD',
    imdb: '8.0',
    year: '2024',
    ageRating: '16+',
    category: ['Action', 'Fantasy'],
    genres: ['Action', 'Fantasy'],
    poster: '',
    banner: '',
    description: '',
    status: 'Active'
  };
  const [formData, setFormData] = useState(initialFormState);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Modals States
  const [editingMovie, setEditingMovie] = useState(null); // Movie object if Edit Modal is open
  const [deletingMovie, setDeletingMovie] = useState(null); // Movie object if Delete Modal is open
  const [viewingMovie, setViewingMovie] = useState(null); // Movie object if Quick View Modal is open

  // Helper function to show Toast Alerts
  const showToast = (type, message) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  // Cloud Sync State
  const [isSyncing, setIsSyncing] = useState(false);
  // Auto-Sync Modal State
  const [isAutoSyncModalOpen, setIsAutoSyncModalOpen] = useState(false);
  const [isAutoCrawling, setIsAutoCrawling] = useState(false);

  // Manual Trigger: Open AutoSyncModal
  const handleManualAutoCrawl = () => {
    if (readOnly) return;
    setIsAutoSyncModalOpen(true);
  };

  // Sync all local movies to Cloud Firestore
  const handleSyncToCloud = async () => {
    if (readOnly) return;
    setIsSyncing(true);
    try {
      const res = await syncAllLocalMoviesToCloud();
      if (res.success) {
        showToast('success', `Đã ghi ${res.count} phim lên Cloud. Bỏ qua ${res.skipped || 0} phim đã khớp hoặc có bản Cloud mới hơn.`);
        await fetchMoviesList();
      } else {
        showToast('info', res.message || 'Không có phim nào để đồng bộ.');
      }
    } catch (e) {
      console.error("Lỗi đồng bộ Cloud Firestore:", e);
      showToast('error', `Lỗi đồng bộ Firestore: ${e.message || 'Vui lòng kiểm tra kết nối mạng hoặc Firebase Rules'}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // Fetch Movies on Mount with Safe Try/Catch/Finally
  const fetchMoviesList = async ({ forceRefresh = false } = {}) => {
    setIsLoading(true);
    try {
      const data = await getMovies({ forceRefresh });
      setMovies(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Lỗi khi tải danh sách phim:", err);
      showToast('error', 'Lỗi khi tải danh sách phim từ hệ thống!');
      setMovies([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMoviesList();

    // Lắng nghe sự kiện cào tự động hoàn tất từ App.jsx / autoCrawlService
    const handleMoviesUpdated = () => {
      console.log('[Admin] Nhận được tín hiệu có phim mới được cập nhật, tải lại bảng dữ liệu...');
      fetchMoviesList();
    };

    window.addEventListener('210loliphim_movies_updated', handleMoviesUpdated);
    return () => {
      window.removeEventListener('210loliphim_movies_updated', handleMoviesUpdated);
    };
  }, []);

  // Filtered & Searched Movies with safe Defensive Programming
  const filteredMovies = useMemo(() => {
    if (!Array.isArray(movies)) return [];
    
    return movies.filter(movie => {
      if (!movie || typeof movie !== 'object') return false;

      const titleStr = String(movie.title || '');
      const origStr = String(movie.originalTitle || '');
      const q = String(searchQuery || '').trim().toLowerCase();

      const matchSearch = 
        !q || 
        titleStr.toLowerCase().includes(q) || 
        origStr.toLowerCase().includes(q);
      
      const genresList = getGenresArray(movie);
      const matchCategory = 
        categoryFilter === 'all' || 
        genresList.some(g => String(g).toLowerCase() === String(categoryFilter).toLowerCase());

      const matchQuality = 
        qualityFilter === 'all' || 
        (typeof movie.quality === 'string' && movie.quality.includes(qualityFilter));

      return matchSearch && matchCategory && matchQuality;
    });
  }, [movies, searchQuery, categoryFilter, qualityFilter]);

  // Paginated Movies
  const totalPages = Math.max(1, Math.ceil((filteredMovies?.length || 0) / ITEMS_PER_PAGE));
  const paginatedMovies = useMemo(() => {
    if (!Array.isArray(filteredMovies)) return [];
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredMovies.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredMovies, currentPage]);

  // Reset page when search or filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, categoryFilter, qualityFilter]);

  // Helper to open Edit Modal with normalized episodes array
  const handleOpenEditModal = (movie) => {
    if (!movie) return;

    let rawEps = [];
    if (Array.isArray(movie.episodes) && movie.episodes.length > 0) {
      rawEps = movie.episodes;
    } else if (movie.m3u8Url) {
      rawEps = [{ name: '1', url: String(movie.m3u8Url) }];
    } else {
      rawEps = [{ name: '1', url: '' }];
    }

    const dedupedEps = deduplicateEpisodes(rawEps);
    const eps = dedupedEps.map((ep, idx) => ({
      name: String(ep?.name || ep?.number || (idx + 1)),
      url: String(ep?.url || ep?.m3u8Url || '')
    }));

    const genreList = getGenresArray(movie);
    const defaultEpCurrent = movie.episodeCurrent || movie.episodesStatus || (eps.length > 0 ? `Tập ${eps.length}` : 'Tập 1');

    setEditingMovie({
      ...movie,
      director: movie.director || '',
      status: movie.status || 'ongoing',
      episodeCurrent: defaultEpCurrent,
      episodesStatus: defaultEpCurrent,
      episodes: eps,
      genres: genreList,
      category: genreList.join(', ')
    });
  };

  // CREATE: Single Movie Submit (Supporting Multi-select Categories)
  const handleCreateMovie = async (e) => {
    e.preventDefault();
    if (readOnly) return;
    if (!formData.title || !formData.m3u8Url) {
      showToast('error', 'Vui lòng điền đủ Tên Phim và Link M3U8 Stream!');
      return;
    }

    const genreList = Array.isArray(formData.genres) && formData.genres.length > 0 
      ? formData.genres 
      : (Array.isArray(formData.category) ? formData.category : [ANIME_GENRES[0]]);

    const formattedTitle = formatVietnameseSentenceCase(formData.title);

    const moviePayload = {
      ...formData,
      title: formattedTitle,
      episodes: [{ name: '1', url: formData.m3u8Url }],
      episodesCount: '1 Tập',
      episodesStatus: 'Tập 1',
      genres: genreList,
      category: genreList.join(', ')
    };

    setIsSubmitting(true);
    try {
      const created = await addMovie(moviePayload);
      setMovies(prev => [created, ...prev]);
      setFormData(initialFormState);
      setActiveTab('list');
      showToast('success', `🎉 Thêm mới phim "${created.title}" với ${genreList.length} thể loại thành công!`);
    } catch (err) {
      console.error("Create movie error:", err);
      showToast('error', err.message || 'Không thể tạo mới phim. Vui lòng thử lại!');
    } finally {
      setIsSubmitting(false);
    }
  };

  // UPDATE: Submit Edit Modal Form (Dynamic Episodes Support)
  const handleUpdateMovieSubmit = async (e) => {
    e.preventDefault();
    if (readOnly) return;
    if (!editingMovie) return;

    const genreList = getGenresArray(editingMovie);
    const cleanedEpisodes = (editingMovie.episodes || []).filter(ep => ep && ep.url && ep.url.trim());
    const dedupedEpisodes = deduplicateEpisodes(cleanedEpisodes);
    const finalEpisodes = dedupedEpisodes.length > 0 ? dedupedEpisodes : [{ name: '1', url: editingMovie.m3u8Url || '' }];
    const formattedTitle = formatVietnameseSentenceCase(editingMovie.title);
    const finalEpisodeCurrent = editingMovie.episodeCurrent || editingMovie.episodesStatus || (finalEpisodes.length > 0 ? `Tập ${finalEpisodes.length}` : 'Tập 1');

    const updatePayload = {
      ...editingMovie,
      title: formattedTitle,
      director: editingMovie.director || '',
      status: editingMovie.status || 'ongoing',
      episodeCurrent: finalEpisodeCurrent,
      episodesStatus: finalEpisodeCurrent,
      episodes: finalEpisodes,
      episodesCount: `${finalEpisodes.length} Tập`,
      m3u8Url: finalEpisodes[0]?.url || editingMovie.m3u8Url || '',
      genres: genreList,
      category: genreList.join(', ')
    };

    setIsSubmitting(true);
    try {
      const updated = await updateMovie(editingMovie.id, updatePayload);
      setMovies(prev => prev.map(m => m.id === editingMovie.id ? { ...m, ...updated } : m));
      setEditingMovie(null);
      showToast('success', `Cập nhật phim "${updated.title}" thành công!`);
    } catch (err) {
      console.error("Update movie error:", err);
      showToast('error', err.message || 'Không thể cập nhật phim!');
    } finally {
      setIsSubmitting(false);
    }
  };

  // DELETE: Instant Optimistic Confirm Delete Action
  const handleConfirmDelete = async () => {
    if (readOnly) return;
    if (!deletingMovie) return;

    const targetMovie = deletingMovie;
    const targetId = targetMovie.id;

    setIsSubmitting(true);
    try {
      await deleteMovie(targetId);
      setDeletingMovie(null);
      setMovies(prev => prev.filter(movie => movie.id !== targetId));
      showToast('success', `Đã xóa phim "${targetMovie.title}" trên Cloud.`);
    } catch (err) {
      showToast('error', err.message || 'Không thể xóa phim trên Cloud.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-gray-100 flex flex-col pb-20">
      
      {/* Toast Notification Alert */}
      {toast && (
        <div className={`fixed top-5 right-5 z-[99999] px-5 py-3.5 rounded-2xl shadow-2xl flex items-center space-x-3 text-xs font-bold border transition-all animate-bounce ${
          toast.type === 'success' 
            ? 'bg-emerald-600/90 text-white border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.5)]' 
            : 'bg-red-600/90 text-white border-red-400 shadow-[0_0_20px_rgba(239,68,68,0.5)]'
        }`}>
          <span>{toast.type === 'success' ? '✅' : '❌'}</span>
          <span>{toast.message}</span>
        </div>
      )}

      {/* Admin Navbar Header */}
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
          <Link to="/admin" className="text-xs text-neon-cyan hover:underline font-semibold">
            ← Về Admin Dashboard
          </Link>
        </div>
      </header>

      {/* Main Admin Content Container */}
      <main className="flex-1 p-6 md:p-10 max-w-7xl w-full mx-auto space-y-8">
        
        {/* Page Title & Tab Navigators */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-white">Quản Lý Hệ Thống Admin</h1>
            <p className="text-gray-400 text-sm mt-1">Quản lý kho phim Firestore, phân trang, thêm mới đa thể loại, xóa phim và cấu hình Layout Trang Chủ.</p>
          </div>

          {/* Tab Navigation Buttons */}
          <div className="flex flex-wrap items-center gap-2 bg-surface-card p-1.5 rounded-xl border border-glass-border">
            <button 
              type="button"
              onClick={() => setActiveTab('list')}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'list' ? 'bg-neon-red text-white shadow-neon-red' : 'text-gray-400 hover:text-white'
              }`}
            >
              📋 Danh Sách Phim ({movies?.length || 0})
            </button>
            <button 
              type="button"
              onClick={() => setActiveTab('homepage')}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'homepage' ? 'bg-purple-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'
              }`}
            >
              ⚙️ Quản Lý Trang Chủ
            </button>
            <button 
              type="button"
              onClick={() => setActiveTab('create')}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'create' ? 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/40' : 'text-gray-400 hover:text-white'
              }`}
            >
              ➕ Thêm Phim Mới
            </button>
            <button 
              type="button"
              onClick={() => setActiveTab('magic')}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'magic' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' : 'text-gray-400 hover:text-white'
              }`}
            >
              ✨ Magic Import
            </button>
            <button 
              type="button"
              onClick={handleManualAutoCrawl}
              disabled={readOnly}
              className="px-3.5 py-2 rounded-lg text-xs font-black bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white shadow-lg flex items-center gap-1.5 transition-all cursor-pointer active:scale-95"
              title="Kích hoạt bảng điều khiển Cào Phim Tự Động & Live Sync Log"
            >
              <span>⚡ Cào Phim Tự Động</span>
            </button>
            <button 
              type="button"
              onClick={handleSyncToCloud}
              disabled={readOnly || isSyncing}
              className="px-3.5 py-2 rounded-lg text-xs font-black bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white shadow-lg flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
              title="Đẩy toàn bộ danh sách phim hiện có lên cơ sở dữ liệu đám mây Cloud Firestore"
            >
              <span>{isSyncing ? '⏳ Đang đồng bộ...' : '☁️ Đồng bộ lên Cloud'}</span>
            </button>
          </div>
        </div>

        {/* TAB 1: READ - DATA TABLE SYSTEM */}
        {activeTab === 'list' && (
          <div className="space-y-6">
            
            {/* Search & Filter Controls Toolbar */}
            <div className="glass-panel p-4 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4">
              
              {/* Search Bar */}
              <div className="relative w-full md:w-80">
                <input 
                  type="text" 
                  placeholder="Tìm kiếm phim theo tên hoặc tên gốc..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full py-2.5 pl-9 pr-4 text-xs rounded-xl bg-surface/90 border border-glass-border text-gray-200 focus:outline-none focus:border-neon-cyan"
                />
                <svg className="w-4 h-4 text-gray-400 absolute left-3 top-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
              </div>

              {/* Filters & Refresh */}
              <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                {/* Category Filter matching all Anime genres */}
                <select 
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="py-2 px-3 rounded-xl bg-surface border border-glass-border text-xs text-gray-300 focus:outline-none focus:border-neon-cyan max-w-[200px] cursor-pointer"
                >
                  <option value="all">Tất cả thể loại ({ANIME_GENRES.length})</option>
                  {(ANIME_GENRES || []).map((genre, idx) => (
                    <option key={idx} value={genre}>{genre}</option>
                  ))}
                </select>

                <select 
                  value={qualityFilter}
                  onChange={(e) => setQualityFilter(e.target.value)}
                  className="py-2 px-3 rounded-xl bg-surface border border-glass-border text-xs text-gray-300 focus:outline-none cursor-pointer"
                >
                  <option value="all">Tất cả chất lượng</option>
                  <option value="4K UltraHD">4K UltraHD</option>
                  <option value="4K">4K</option>
                  <option value="Full HD">Full HD</option>
                </select>

                <button 
                  type="button"
                  onClick={() => fetchMoviesList({ forceRefresh: true })}
                  className="p-2 rounded-xl bg-surface-card hover:bg-white/10 text-gray-300 border border-glass-border text-xs cursor-pointer"
                  title="Làm mới dữ liệu"
                >
                  🔄
                </button>
              </div>

            </div>

            {/* DATA TABLE */}
            <div className="glass-panel rounded-2xl overflow-hidden border border-glass-border shadow-2xl">
              {isLoading ? (
                <div className="p-8 space-y-4">
                  {Array.from({ length: 4 }).map((_, idx) => (
                    <div key={idx} className="h-16 w-full bg-white/5 rounded-xl animate-skeleton"></div>
                  ))}
                </div>
              ) : (filteredMovies?.length || 0) === 0 ? (
                <div className="p-12 text-center text-gray-400 space-y-3">
                  <span className="text-4xl">🎬</span>
                  <p className="text-sm font-semibold">Không tìm thấy phim nào khớp với từ khóa/bộ lọc!</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-surface-card/90 border-b border-glass-border text-gray-400 font-semibold uppercase tracking-wider">
                        <th className="p-4">#</th>
                        <th className="p-4">Poster</th>
                        <th className="p-4">Tên Phim / Tên Gốc</th>
                        <th className="p-4">Thông Số</th>
                        <th className="p-4">Danh Mục (Genres)</th>
                        <th className="p-4">Trạng Thái</th>
                        <th className="p-4 text-right">Cột Thao Tác (Actions)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-glass-border text-gray-200">
                      {(paginatedMovies || []).map((movie, index) => {
                        const movieGenres = getGenresArray(movie);
                        const displayEpisodes = getEpisodeDisplay(movie?.episodes, movie?.episodesCount);
                        const rowKey = movie?.id || `movie-row-${index}`;
                        const movieStatus = String(movie?.status || '').toLowerCase().trim();

                        return (
                          <tr key={rowKey} className="hover:bg-white/5 transition-colors">
                            <td className="p-4 font-mono text-gray-500">{(currentPage - 1) * ITEMS_PER_PAGE + index + 1}</td>
                            
                            <td className="p-4">
                              <div className="w-12 h-16 rounded-lg overflow-hidden border border-glass-border flex-shrink-0 bg-surface">
                                <img 
                                  src={movie?.poster || 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=200'} 
                                  alt={movie?.title || 'Poster'} 
                                  onError={(e) => { e.target.src = 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=200'; }}
                                  className="w-full h-full object-cover" 
                                />
                              </div>
                            </td>

                            <td className="p-4 max-w-[220px]">
                              <h4 className="font-extrabold text-white text-sm truncate">{movie?.title || 'Phim chưa có tên'}</h4>
                              <p className="text-[11px] text-gray-400 truncate mt-0.5">{movie?.originalTitle || 'N/A'}</p>
                            </td>

                            <td className="p-4 space-y-1">
                              <div className="flex items-center gap-1.5">
                                <span className="px-2 py-0.5 rounded text-[10px] bg-yellow-500/20 text-yellow-400 font-bold">★ {movie?.imdb || '8.0'}</span>
                                <span className="px-2 py-0.5 rounded text-[10px] bg-neon-red/20 text-neon-red font-bold">{movie?.quality || '4K'}</span>
                              </div>
                              <div className="text-[11px] text-gray-300">
                                <span>{movie?.year || '2024'}</span> • <span className="font-semibold text-neon-cyan">{movie?.episodeCurrent || movie?.episodesStatus || displayEpisodes}</span>
                              </div>
                              {movie?.director && movie.director.toLowerCase() !== 'đang cập nhật' && (
                                <div className="text-[10px] text-gray-400 truncate max-w-[180px]" title={`Đạo diễn: ${movie.director}`}>
                                  🎬 {movie.director}
                                </div>
                              )}
                            </td>

                            {/* Multi-category badge display */}
                            <td className="p-4 max-w-[200px]">
                              <div className="flex flex-wrap gap-1">
                                {movieGenres.slice(0, 3).map((g, i) => {
                                  const genreKey = `${movie?.id || index}-genre-${i}`;
                                  return (
                                    <span key={genreKey} className="px-2 py-0.5 rounded bg-white/10 text-gray-200 text-[10px] border border-white/10 whitespace-nowrap">
                                      {g}
                                    </span>
                                  );
                                })}
                                {movieGenres.length > 3 && (
                                  <span className="px-1.5 py-0.5 rounded bg-neon-cyan/15 text-neon-cyan text-[9px] font-bold">
                                    +{movieGenres.length - 3}
                                  </span>
                                )}
                              </div>
                            </td>

                            <td className="p-4">
                              {movieStatus === 'completed' || movieStatus === 'hoàn tất' ? (
                                <span className="px-2.5 py-1 rounded-md bg-emerald-500/20 text-emerald-400 text-[11px] border border-emerald-500/30 font-bold">
                                  ✓ Hoàn Tất
                                </span>
                              ) : movieStatus === 'ongoing' ? (
                                <span className="px-2.5 py-1 rounded-md bg-cyan-500/20 text-cyan-300 text-[11px] border border-cyan-500/30 font-bold">
                                  ⏳ Đang Chiếu
                                </span>
                              ) : (
                                <span className="px-2.5 py-1 rounded-md bg-emerald-500/20 text-emerald-400 text-[11px] border border-emerald-500/30 font-bold">
                                  {movie?.status || 'Active'}
                                </span>
                              )}
                            </td>

                            <td className="p-4 text-right">
                              <div className="flex items-center justify-end space-x-2">
                                <button 
                                  type="button"
                                  onClick={() => setViewingMovie(movie)}
                                  className="p-2 rounded-lg bg-surface hover:bg-white/10 text-gray-300 hover:text-white border border-glass-border transition-all cursor-pointer"
                                  title="Xem Chi Tiết Phim"
                                >
                                  👁️
                                </button>

                                <button 
                                  type="button"
                                  onClick={() => handleOpenEditModal(movie)}
                                  className="p-2 rounded-lg bg-neon-cyan/15 hover:bg-neon-cyan/30 text-neon-cyan border border-neon-cyan/40 transition-all font-bold cursor-pointer"
                                  title="Chỉnh Sửa Phim"
                                >
                                  ✏️
                                </button>

                                <button 
                                  type="button"
                                  onClick={() => setDeletingMovie(movie)}
                                  disabled={readOnly}
                                  className="p-2 rounded-lg bg-red-500/20 hover:bg-red-500/40 text-red-400 border border-red-500/50 transition-all font-bold cursor-pointer"
                                  title="Xóa Phim"
                                >
                                  🗑️
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Data Table Pagination Bar */}
              {totalPages > 1 && (
                <div className="p-4 bg-surface-card border-t border-glass-border flex items-center justify-between text-xs">
                  <span className="text-gray-400">
                    Trang <strong>{currentPage}</strong> / <strong>{totalPages}</strong> (Tổng {filteredMovies?.length || 0} phim)
                  </span>
                  <div className="flex items-center space-x-2">
                    <button 
                      type="button"
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="px-3 py-1.5 rounded-lg bg-surface hover:bg-white/10 disabled:opacity-40 border border-glass-border cursor-pointer"
                    >
                      ← Trang trước
                    </button>
                    <button 
                      type="button"
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="px-3 py-1.5 rounded-lg bg-surface hover:bg-white/10 disabled:opacity-40 border border-glass-border cursor-pointer"
                    >
                      Trang sau →
                    </button>
                  </div>
                </div>
              )}
            </div>

          </div>
        )}

        {/* TAB HOMEPAGE CMS */}
        {activeTab === 'homepage' && (
          <HomepageCMS readOnly={readOnly} />
        )}

        {/* TAB 2: CREATE - SINGLE MOVIE FORM (Interactive Multi-Select Genre System) */}
        {activeTab === 'create' && (
          <div className="glass-panel p-8 rounded-2xl space-y-6 max-w-4xl mx-auto border border-glass-border">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <span>➕ Thêm Phim Mới Vào Firestore (Chọn Nhiều Thể Loại)</span>
            </h2>

            <form onSubmit={handleCreateMovie} className="space-y-5">
              <fieldset disabled={readOnly} className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-300">Tên Phim (Tiếng Việt) *</label>
                  <input 
                    type="text"
                    required
                    value={formData.title}
                    onChange={e => setFormData({ ...formData, title: e.target.value })}
                    placeholder="VD: Thất Nghiệp Chuyển Sinh S2"
                    className="w-full p-3 rounded-xl bg-surface border border-glass-border text-xs text-white"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-300">Tên Tiếng Anh / Tên Gốc</label>
                  <input 
                    type="text"
                    value={formData.originalTitle}
                    onChange={e => setFormData({ ...formData, originalTitle: e.target.value })}
                    placeholder="VD: Mushoku Tensei Season 2"
                    className="w-full p-3 rounded-xl bg-surface border border-glass-border text-xs text-white"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-300">Link Video M3U8 Stream (KKPhim / HLS) *</label>
                <input 
                  type="text"
                  required
                  value={formData.m3u8Url}
                  onChange={e => setFormData({ ...formData, m3u8Url: e.target.value })}
                  placeholder="https://domain.com/video/stream.m3u8"
                  className="w-full p-3 rounded-xl bg-surface border border-glass-border text-xs font-mono text-neon-cyan"
                />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-300">Số Tập</label>
                  <input 
                    type="text"
                    value={formData.episodes}
                    onChange={e => setFormData({ ...formData, episodes: e.target.value })}
                    className="w-full p-3 rounded-xl bg-surface border border-glass-border text-xs text-white"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-300">Chất Lượng</label>
                  <select 
                    value={formData.quality}
                    onChange={e => setFormData({ ...formData, quality: e.target.value })}
                    className="w-full p-3 rounded-xl bg-surface border border-glass-border text-xs text-white cursor-pointer"
                  >
                    <option value="4K UltraHD">4K UltraHD</option>
                    <option value="4K">4K</option>
                    <option value="Full HD">Full HD</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-300">Điểm IMDb</label>
                  <input 
                    type="text"
                    value={formData.imdb}
                    onChange={e => setFormData({ ...formData, imdb: e.target.value })}
                    className="w-full p-3 rounded-xl bg-surface border border-glass-border text-xs text-white"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-300">Năm Phát Hành</label>
                  <input 
                    type="text"
                    value={formData.year}
                    onChange={e => setFormData({ ...formData, year: e.target.value })}
                    className="w-full p-3 rounded-xl bg-surface border border-glass-border text-xs text-white"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-300">Quốc Gia</label>
                  <input 
                    type="text"
                    value={formData.country || ''}
                    onChange={e => setFormData({ ...formData, country: e.target.value })}
                    placeholder="VD: Nhật Bản, Mỹ"
                    className="w-full p-3 rounded-xl bg-surface border border-glass-border text-xs text-white font-semibold text-emerald-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-300">Link Poster (Ảnh đứng)</label>
                  <input 
                    type="text"
                    value={formData.poster}
                    onChange={e => setFormData({ ...formData, poster: e.target.value })}
                    placeholder="https://..."
                    className="w-full p-3 rounded-xl bg-surface border border-glass-border text-xs text-white"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-300">Link Banner (Ảnh ngang)</label>
                  <input 
                    type="text"
                    value={formData.banner}
                    onChange={e => setFormData({ ...formData, banner: e.target.value })}
                    placeholder="https://..."
                    className="w-full p-3 rounded-xl bg-surface border border-glass-border text-xs text-white"
                  />
                </div>
              </div>

              {/* MULTI-SELECT CATEGORY / GENRE SYSTEM */}
              <GenreMultiSelect 
                selectedGenres={formData.genres || formData.category}
                onChange={newGenres => setFormData({ ...formData, genres: newGenres, category: newGenres })}
                label="Danh Mục Chính & Thể Loại Anime (Click chọn được nhiều mục)"
              />

              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-300">Mô Tả Nội Dung Phim</label>
                <textarea 
                  rows="3"
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Tóm tắt nội dung phim..."
                  className="w-full p-3 rounded-xl bg-surface border border-glass-border text-xs text-white"
                />
              </div>

              <button 
                type="submit"
                disabled={readOnly || isSubmitting}
                className="w-full py-3.5 rounded-xl bg-neon-cyan/20 hover:bg-neon-cyan/30 text-neon-cyan border border-neon-cyan/40 font-bold text-xs transition-all shadow-[0_0_20px_rgba(0,240,255,0.3)] disabled:opacity-50 cursor-pointer"
              >
                {isSubmitting ? 'Đang lưu phim...' : '🔥 Lưu Phim Mới Vào Hệ Thống'}
              </button>
              </fieldset>
            </form>
          </div>
        )}

        {/* TAB 3: MAGIC IMPORT BULK TSV */}
        {activeTab === 'magic' && (
          <MagicImport readOnly={readOnly} />
        )}

      </main>

      {/* UPDATE MODAL (Edit Movie Dialog with Multi-Select Genre System) */}
      {editingMovie && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-surface-card border border-glass-border p-6 rounded-2xl max-w-2xl w-full space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto custom-scrollbar">
            <div className="flex items-center justify-between border-b border-glass-border pb-3">
              <h3 className="text-lg font-bold text-white">{readOnly ? 'Xem Biểu Mẫu Phim' : '✏️ Chỉnh Sửa Phim'} — {editingMovie?.title || 'Phim'}</h3>
              <button type="button" onClick={() => setEditingMovie(null)} className="text-gray-400 hover:text-white cursor-pointer">✕</button>
            </div>

            <form onSubmit={handleUpdateMovieSubmit} className="space-y-4 text-xs">
              <fieldset disabled={readOnly} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-gray-300">Tên phim</label>
                  <input 
                    type="text" 
                    value={editingMovie.title || ''} 
                    onChange={e => setEditingMovie({ ...editingMovie, title: e.target.value })}
                    className="w-full p-2.5 rounded-lg bg-surface border border-glass-border text-white mt-1"
                  />
                </div>
                <div>
                  <label className="text-gray-300">Tên gốc</label>
                  <input 
                    type="text" 
                    value={editingMovie.originalTitle || ''} 
                    onChange={e => setEditingMovie({ ...editingMovie, originalTitle: e.target.value })}
                    className="w-full p-2.5 rounded-lg bg-surface border border-glass-border text-white mt-1"
                  />
                </div>
              </div>

              {/* DYNAMIC EPISODES MANAGER */}
              <div className="space-y-3 p-4 rounded-xl bg-surface/90 border border-glass-border">
                <div className="flex items-center justify-between">
                  <label className="text-gray-200 font-bold flex items-center gap-2">
                    <span>🎬 Quản Lý Danh Sách Tập Phim</span>
                    <span className="px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-400 font-extrabold text-[11px] border border-amber-400/30">
                      {editingMovie.episodes?.length || 0} Tập
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const currentEps = Array.isArray(editingMovie.episodes) ? editingMovie.episodes : [];
                      const nextNum = currentEps.length + 1;
                      setEditingMovie({
                        ...editingMovie,
                        episodes: [...currentEps, { name: String(nextNum), url: '' }]
                      });
                    }}
                    className="px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/40 text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                  >
                    <span>➕ Thêm Tập Mới</span>
                  </button>
                </div>

                {/* Episode Row Inputs */}
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                  {(Array.isArray(editingMovie.episodes) ? editingMovie.episodes : []).map((ep, epIdx) => {
                    const epKey = `edit-ep-${epIdx}-${ep?.name || ''}`;
                    return (
                      <div key={epKey} className="flex items-center gap-2 p-2 rounded-lg bg-black/40 border border-white/5">
                        <div className="w-24 flex-shrink-0">
                          <span className="text-[10px] text-gray-400 block mb-0.5">Tên tập</span>
                          <input 
                            type="text"
                            placeholder="VD: 1 hoặc 01"
                            value={ep?.name || ''}
                            onChange={(e) => {
                              const nextEps = [...editingMovie.episodes];
                              nextEps[epIdx] = { ...nextEps[epIdx], name: e.target.value };
                              setEditingMovie({ ...editingMovie, episodes: nextEps });
                            }}
                            className="w-full p-1.5 rounded bg-surface border border-glass-border text-white text-xs font-bold text-center"
                          />
                        </div>

                        <div className="flex-1">
                          <span className="text-[10px] text-gray-400 block mb-0.5">Link Video M3U8 Stream</span>
                          <input 
                            type="text"
                            placeholder="https://.../video.m3u8"
                            value={ep?.url || ''}
                            onChange={(e) => {
                              const nextEps = [...editingMovie.episodes];
                              nextEps[epIdx] = { ...nextEps[epIdx], url: e.target.value };
                              setEditingMovie({ 
                                ...editingMovie, 
                                episodes: nextEps,
                                m3u8Url: nextEps[0]?.url || editingMovie.m3u8Url || '' 
                              });
                            }}
                            className="w-full p-1.5 rounded bg-surface border border-glass-border text-neon-cyan text-xs font-mono"
                          />
                        </div>

                        <div className="pt-4 flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              const nextEps = (editingMovie.episodes || []).filter((_, idx) => idx !== epIdx);
                              setEditingMovie({ 
                                ...editingMovie, 
                                episodes: nextEps,
                                m3u8Url: nextEps[0]?.url || ''
                              });
                            }}
                            className="p-1.5 rounded bg-red-500/15 hover:bg-red-500/30 text-red-400 border border-red-500/30 text-xs transition-colors cursor-pointer"
                            title="Xóa tập này"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {(!editingMovie.episodes || editingMovie.episodes.length === 0) && (
                    <p className="text-center text-xs text-gray-500 py-3">Chưa có tập phim nào. Nhấn "+ Thêm Tập Mới" để thêm tập.</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="text-gray-300">Điểm IMDb</label>
                  <input 
                    type="text" 
                    value={editingMovie.imdb || ''} 
                    onChange={e => setEditingMovie({ ...editingMovie, imdb: e.target.value })}
                    className="w-full p-2.5 rounded-lg bg-surface border border-glass-border text-white mt-1"
                  />
                </div>
                <div>
                  <label className="text-gray-300">Năm</label>
                  <input 
                    type="text" 
                    value={editingMovie.year || ''} 
                    onChange={e => setEditingMovie({ ...editingMovie, year: e.target.value })}
                    className="w-full p-2.5 rounded-lg bg-surface border border-glass-border text-white mt-1"
                  />
                </div>
                <div>
                  <label className="text-gray-300">Chất lượng</label>
                  <input 
                    type="text" 
                    value={editingMovie.quality || ''} 
                    onChange={e => setEditingMovie({ ...editingMovie, quality: e.target.value })}
                    className="w-full p-2.5 rounded-lg bg-surface border border-glass-border text-white mt-1"
                  />
                </div>
                <div>
                  <label className="text-gray-300 font-semibold text-emerald-400">Quốc gia</label>
                  <input 
                    type="text" 
                    placeholder="VD: Nhật Bản, Mỹ"
                    value={editingMovie.country || ''} 
                    onChange={e => setEditingMovie({ ...editingMovie, country: e.target.value })}
                    className="w-full p-2.5 rounded-lg bg-surface border border-emerald-500/40 text-white font-semibold mt-1"
                  />
                </div>
              </div>

              {/* Thông tin Tập hiện tại & Đạo diễn & Trạng thái */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-xl bg-surface/90 border border-neon-cyan/20">
                <div>
                  <label className="text-gray-300 font-bold text-neon-cyan flex items-center gap-1.5">
                    <span>📺</span>
                    <span>Tập Hiện Tại / Thông Tin</span>
                  </label>
                  <input 
                    type="text" 
                    placeholder="VD: Tập hoàn tất (11/11) hoặc Tập 12"
                    value={editingMovie.episodeCurrent || editingMovie.episodesStatus || ''} 
                    onChange={e => setEditingMovie({ 
                      ...editingMovie, 
                      episodeCurrent: e.target.value, 
                      episodesStatus: e.target.value 
                    })}
                    className="w-full p-2.5 rounded-lg bg-surface border border-neon-cyan/40 text-neon-cyan font-bold mt-1 text-xs focus:outline-none focus:border-neon-cyan"
                  />
                  <span className="text-[10px] text-gray-400 mt-0.5 block">Hiển thị ở trang chi tiết và danh sách</span>
                </div>

                <div>
                  <label className="text-gray-300 font-bold text-amber-400 flex items-center gap-1.5">
                    <span>🎬</span>
                    <span>Đạo Diễn</span>
                  </label>
                  <input 
                    type="text" 
                    placeholder="VD: Ryosuke Shibuya, Makoto Hoshino..."
                    value={editingMovie.director || ''} 
                    onChange={e => setEditingMovie({ ...editingMovie, director: e.target.value })}
                    className="w-full p-2.5 rounded-lg bg-surface border border-amber-400/40 text-white font-semibold mt-1 text-xs focus:outline-none focus:border-amber-400"
                  />
                  <span className="text-[10px] text-gray-400 mt-0.5 block">Tên đạo diễn phim</span>
                </div>

                <div>
                  <label className="text-gray-300 font-bold text-emerald-400 flex items-center gap-1.5">
                    <span>📊</span>
                    <span>Trạng Thái Phim</span>
                  </label>
                  <select 
                    value={editingMovie.status || 'ongoing'} 
                    onChange={e => setEditingMovie({ ...editingMovie, status: e.target.value })}
                    className="w-full p-2.5 rounded-lg bg-surface border border-emerald-500/40 text-emerald-400 font-bold mt-1 text-xs focus:outline-none cursor-pointer"
                  >
                    <option value="ongoing">⏳ Đang chiếu (ongoing)</option>
                    <option value="completed">✓ Hoàn tất (completed)</option>
                    <option value="Active">⭐ Hoạt động (Active)</option>
                    <option value="trailer">🎞️ Sắp chiếu (trailer)</option>
                  </select>
                  <span className="text-[10px] text-gray-400 mt-0.5 block">Trạng thái phát hành</span>
                </div>
              </div>

              {/* Poster & Banner Fields with Live Image Previews */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-gray-300 flex items-center justify-between">
                    <span>🖼️ Link Ảnh Poster (Ảnh Đứng)</span>
                    {editingMovie.poster && <span className="text-[10px] text-emerald-400">Đã có link</span>}
                  </label>
                  <input 
                    type="text" 
                    placeholder="https://domain.com/poster.jpg"
                    value={editingMovie.poster || ''} 
                    onChange={e => setEditingMovie({ ...editingMovie, poster: e.target.value })}
                    className="w-full p-2.5 rounded-lg bg-surface border border-glass-border text-white mt-1"
                  />
                  {editingMovie.poster && (
                    <div className="mt-2 flex items-center gap-2 p-1.5 rounded-lg bg-black/40 border border-white/10">
                      <img 
                        src={editingMovie.poster} 
                        alt="Poster Preview" 
                        onError={e => { e.target.src = 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=200'; }}
                        className="w-10 h-14 object-cover rounded border border-white/20"
                      />
                      <span className="text-[10px] text-gray-400">Xem trước Poster</span>
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-gray-300 flex items-center justify-between">
                    <span>🌄 Link Ảnh Bìa / Banner (Ảnh Ngang)</span>
                    {editingMovie.banner && <span className="text-[10px] text-emerald-400">Đã có link</span>}
                  </label>
                  <input 
                    type="text" 
                    placeholder="https://domain.com/banner.jpg"
                    value={editingMovie.banner || ''} 
                    onChange={e => setEditingMovie({ ...editingMovie, banner: e.target.value })}
                    className="w-full p-2.5 rounded-lg bg-surface border border-glass-border text-white mt-1"
                  />
                  {editingMovie.banner && (
                    <div className="mt-2 flex items-center gap-2 p-1.5 rounded-lg bg-black/40 border border-white/10">
                      <img 
                        src={editingMovie.banner} 
                        alt="Banner Preview" 
                        onError={e => { e.target.src = 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=300'; }}
                        className="w-20 h-10 object-cover rounded border border-white/20"
                      />
                      <span className="text-[10px] text-gray-400">Xem trước Ảnh bìa</span>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="text-gray-300">Mô Tả Nội Dung Phim</label>
                <textarea 
                  rows="2"
                  value={editingMovie.description || ''} 
                  onChange={e => setEditingMovie({ ...editingMovie, description: e.target.value })}
                  placeholder="Tóm tắt nội dung phim..."
                  className="w-full p-2.5 rounded-lg bg-surface border border-glass-border text-white mt-1"
                />
              </div>

              {/* Edit Multi-Select Category System */}
              <GenreMultiSelect 
                selectedGenres={editingMovie.genres || editingMovie.category}
                onChange={newGenres => setEditingMovie({ ...editingMovie, genres: newGenres, category: newGenres.join(', ') })}
                label="Danh Mục Chính & Thể Loại (Chọn nhiều mục)"
              />

              </fieldset>
              <div className="flex items-center justify-end space-x-3 pt-3">
                <button 
                  type="button" 
                  onClick={() => setEditingMovie(null)}
                  className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-gray-300 cursor-pointer"
                >
                  Hủy
                </button>
                <button 
                  type="submit"
                  disabled={readOnly || isSubmitting}
                  className="px-6 py-2 rounded-xl bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/40 font-bold cursor-pointer"
                >
                  Lưu Thay Đổi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {deletingMovie && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-surface-card border border-red-500/50 p-6 rounded-2xl max-w-md w-full space-y-4 shadow-2xl text-center">
            <div className="w-12 h-12 rounded-full bg-red-500/20 text-red-500 border border-red-500/40 flex items-center justify-center text-2xl font-bold mx-auto">
              ⚠️
            </div>
            <h3 className="text-lg font-extrabold text-white">Xác Nhận Xóa Phim?</h3>
            <p className="text-xs text-gray-300">
              Bạn có chắc chắn muốn xóa phim <strong className="text-neon-red">"{deletingMovie?.title || 'này'}"</strong> khỏi kho dữ liệu không? Thao tác này không thể hoàn tác.
            </p>
            <div className="flex items-center justify-center space-x-4 pt-2">
              <button 
                type="button" 
                onClick={() => setDeletingMovie(null)}
                className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-gray-300 text-xs font-bold cursor-pointer"
              >
                Hủy Bỏ
              </button>
              <button 
                type="button" 
                onClick={handleConfirmDelete}
                disabled={readOnly || isSubmitting}
                className="px-6 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-black shadow-[0_0_20px_rgba(239,68,68,0.6)] cursor-pointer active:scale-95 transition-transform"
              >
                🗑️ Xác Nhận Xóa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QUICK VIEW MODAL */}
      {viewingMovie && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-surface-card border border-glass-border p-6 rounded-2xl max-w-lg w-full space-y-4 shadow-2xl text-xs">
            <div className="flex items-center justify-between border-b border-glass-border pb-2">
              <h3 className="text-base font-bold text-white">👁️ Xem Nhanh: {viewingMovie?.title || 'Chi Tiết'}</h3>
              <button type="button" onClick={() => setViewingMovie(null)} className="text-gray-400 hover:text-white cursor-pointer">✕</button>
            </div>
            <div className="flex gap-4">
              <img 
                src={viewingMovie?.poster || 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=200'} 
                alt="Poster" 
                onError={(e) => { e.target.src = 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=200'; }}
                className="w-24 h-36 object-cover rounded-xl border border-glass-border" 
              />
              <div className="space-y-1.5 flex-1">
                <p><strong className="text-gray-400">Tên gốc:</strong> {viewingMovie?.originalTitle || 'N/A'}</p>
                <p><strong className="text-gray-400">IMDb:</strong> ★ {viewingMovie?.imdb || '8.0'}</p>
                <p><strong className="text-gray-400">Năm:</strong> {viewingMovie?.year || '2024'}</p>
                <p><strong className="text-gray-400">Chất lượng:</strong> {viewingMovie?.quality || '4K'}</p>
                <p><strong className="text-gray-400">Trạng thái:</strong> <span className="font-semibold text-emerald-400">{viewingMovie?.status || 'Active'}</span></p>
                <p><strong className="text-gray-400">Tập hiện tại:</strong> <span className="font-semibold text-neon-cyan">{viewingMovie?.episodeCurrent || viewingMovie?.episodesStatus || 'N/A'}</span> ({getEpisodeDisplay(viewingMovie?.episodes, viewingMovie?.episodesCount)})</p>
                <p><strong className="text-gray-400">Đạo diễn:</strong> {viewingMovie?.director || 'Đang cập nhật'}</p>
                <p><strong className="text-gray-400">Quốc gia:</strong> {viewingMovie?.country || 'Nhật Bản'}</p>
                <div>
                  <strong className="text-gray-400 block mb-1">Thể loại đã chọn:</strong>
                  <div className="flex flex-wrap gap-1">
                    {getGenresArray(viewingMovie).map((g, i) => {
                      const genreTagKey = `view-genre-${i}`;
                      return (
                        <span key={genreTagKey} className="px-2 py-0.5 rounded bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30 text-[10px] font-bold">
                          {g}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <p className="text-neon-cyan truncate font-mono pt-1"><strong className="text-gray-400">M3U8:</strong> {viewingMovie?.m3u8Url || 'N/A'}</p>
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button type="button" onClick={() => setViewingMovie(null)} className="px-4 py-2 rounded-xl bg-white/10 text-gray-300 cursor-pointer">
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AUTO-SYNC MODAL WITH LIVE LOG */}
      <AutoSyncModal
        isOpen={!readOnly && isAutoSyncModalOpen}
        onClose={() => {
          setIsAutoSyncModalOpen(false);
          fetchMoviesList();
        }}
        onFinished={() => {
          fetchMoviesList();
        }}
      />

    </div>
  );
};

export default MovieManagementPage;
