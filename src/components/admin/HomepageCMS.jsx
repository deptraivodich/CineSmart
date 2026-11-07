import React, { useState, useEffect } from 'react';
import { getMovies, getHomepageLayout, saveHomepageLayout } from '../../services/movieService';

const SECTIONS = [
  { id: 'top10Movies', name: '🔥 Top 10 Phim Bộ Hôm Nay', max: 10, desc: 'Tối đa 10 phim hiển thị kèm huy hiệu số thứ tự' },
  { id: 'cinemaMovies', name: '🍿 Mãn Nhãn Với Phim Chiếu Rạp', max: 12, desc: 'Danh sách phim chiếu rạp chất lượng 4K' },
  { id: 'trending', name: '📊 BXH 1: Sôi Nổi Nhất', max: 5, desc: 'Top 5 phim xếp hạng sôi nổi' },
  { id: 'favorites', name: '❤️ BXH 2: Yêu Thích Nhất', max: 5, desc: 'Top 5 phim được thả tim nhiều nhất' },
  { id: 'newComments', name: '💬 BXH 3: Bình Luận Mới', max: 5, desc: 'Top 5 phim thảo luận mới' },
  { id: 'comingSoon', name: '📅 Phim Sắp Tới (Coming Soon)', max: 8, desc: 'Danh sách phim sắp khởi chiếu' },
  { id: 'animeVault', name: '⚔️ Kho Tàng Anime Mới Nhất', max: 6, desc: 'Phim đầu tiên là Banner lớn Highlight, các phim sau là tập phim' },
];

const HomepageCMS = ({ readOnly = false }) => {
  const [allMovies, setAllMovies] = useState([]);
  const [layout, setLayout] = useState({
    top10Movies: [],
    cinemaMovies: [],
    leaderboard: {
      trending: [],
      favorites: [],
      newComments: []
    },
    comingSoon: [],
    animeVault: []
  });

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSectionId, setActiveSectionId] = useState('top10Movies');
  const [toast, setToast] = useState(null);

  const showToast = (type, message) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    const initData = async () => {
      setIsLoading(true);
      try {
        const [moviesData, layoutData] = await Promise.all([
          getMovies(),
          getHomepageLayout()
        ]);
        setAllMovies(moviesData || []);
        if (layoutData) {
          setLayout({
            top10Movies: layoutData.top10Movies || [],
            cinemaMovies: layoutData.cinemaMovies || [],
            leaderboard: {
              trending: layoutData.leaderboard?.trending || [],
              favorites: layoutData.leaderboard?.favorites || [],
              newComments: layoutData.leaderboard?.newComments || []
            },
            comingSoon: layoutData.comingSoon || [],
            animeVault: layoutData.animeVault || []
          });
        }
      } catch (err) {
        console.error("Error loading Homepage CMS:", err);
        showToast('error', 'Không thể nạp dữ liệu Homepage layout!');
      } finally {
        setIsLoading(false);
      }
    };
    initData();
  }, []);

  // Helper to get list by sectionId
  const getSectionList = (sectionId) => {
    if (['trending', 'favorites', 'newComments'].includes(sectionId)) {
      return layout.leaderboard[sectionId] || [];
    }
    return layout[sectionId] || [];
  };

  // Helper to update list for a sectionId
  const updateSectionList = (sectionId, newList) => {
    if (['trending', 'favorites', 'newComments'].includes(sectionId)) {
      setLayout(prev => ({
        ...prev,
        leaderboard: {
          ...prev.leaderboard,
          [sectionId]: newList
        }
      }));
    } else {
      setLayout(prev => ({
        ...prev,
        [sectionId]: newList
      }));
    }
  };

  // Add movie ID to active section
  const handleAddMovieToSection = (movieId) => {
    if (readOnly) return;
    const currentList = getSectionList(activeSectionId);
    const secConfig = SECTIONS.find(s => s.id === activeSectionId);

    if (currentList.includes(movieId)) {
      showToast('error', 'Phim này đã có trong danh sách!');
      return;
    }

    if (currentList.length >= secConfig.max) {
      showToast('error', `Khu vực này tối đa chỉ chứa ${secConfig.max} phim!`);
      return;
    }

    updateSectionList(activeSectionId, [...currentList, movieId]);
    showToast('success', 'Đã thêm phim vào danh sách!');
  };

  // Remove movie ID from active section
  const handleRemoveMovieFromSection = (movieId) => {
    if (readOnly) return;
    const currentList = getSectionList(activeSectionId);
    updateSectionList(activeSectionId, currentList.filter(id => id !== movieId));
  };

  // Move item up or down in order
  const handleMoveOrder = (index, direction) => {
    if (readOnly) return;
    const currentList = [...getSectionList(activeSectionId)];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;

    if (targetIndex < 0 || targetIndex >= currentList.length) return;

    // Swap elements
    const temp = currentList[index];
    currentList[index] = currentList[targetIndex];
    currentList[targetIndex] = temp;

    updateSectionList(activeSectionId, currentList);
  };

  // Save layout config to Firestore & localStorage
  const handleSaveLayout = async () => {
    if (readOnly) return;
    setIsSaving(true);
    try {
      await saveHomepageLayout(layout);
      showToast('success', '🎉 Đã lưu cấu hình Trang Chủ lên Firestore!');
    } catch (err) {
      showToast('error', 'Lỗi khi lưu cấu hình!');
    } finally {
      setIsSaving(false);
    }
  };

  // Filter available movies by search
  const filteredSearchMovies = allMovies.filter(m => 
    !searchQuery || 
    m.title?.toLowerCase().includes(searchQuery.toLowerCase()) || 
    m.originalTitle?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const activeSecConfig = SECTIONS.find(s => s.id === activeSectionId) || SECTIONS[0];
  const activeSecList = getSectionList(activeSectionId);

  if (isLoading) {
    return (
      <div className="p-8 text-center text-gray-400 space-y-3">
        <div className="w-10 h-10 border-4 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto"></div>
        <p className="text-xs font-bold">Đang nạp cấu hình Homepage CMS...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      
      {/* Toast alert */}
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-5 py-3 rounded-xl border font-bold text-xs shadow-2xl flex items-center gap-2 animate-bounce ${
          toast.type === 'success' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' : 'bg-red-500/20 text-red-400 border-red-500/40'
        }`}>
          <span>{toast.message}</span>
        </div>
      )}

      {/* Header bar & Save button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 glass-panel p-5 rounded-2xl border border-glass-border">
        <div>
          <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
            <span>⚙️ Quản Lý Cấu Trúc Trang Chủ (Homepage Layout CMS)</span>
          </h2>
          <p className="text-xs text-gray-400 mt-1">Gán phim vào từng Section, thay đổi thứ tự hiển thị Top 1 - Top 10 và lưu trực tiếp lên Firestore `settings/homepage_layout`.</p>
        </div>

        <button
          onClick={handleSaveLayout}
          disabled={readOnly || isSaving}
          className="px-6 py-3 rounded-xl bg-neon-cyan/20 hover:bg-neon-cyan/30 text-neon-cyan border border-neon-cyan/40 font-black text-xs transition-all shadow-[0_0_20px_rgba(0,240,255,0.4)] disabled:opacity-50 cursor-pointer flex-shrink-0"
        >
          {isSaving ? 'Đang lưu...' : '💾 Lưu Cấu Hình Trang Chủ'}
        </button>
      </div>

      {/* Section Selector Tabs */}
      <div className="flex space-x-2 overflow-x-auto no-scrollbar pb-2">
        {SECTIONS.map((sec) => (
          <button
            key={sec.id}
            onClick={() => setActiveSectionId(sec.id)}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all border ${
              activeSectionId === sec.id
                ? 'bg-neon-red text-white border-neon-red shadow-neon-red'
                : 'bg-surface-card text-gray-400 hover:text-white border-glass-border'
            }`}
          >
            {sec.name} ({getSectionList(sec.id).length}/{sec.max})
          </button>
        ))}
      </div>

      {/* 2 Column Editor Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column (7 cols): Currently Selected Movies in Section (With Up/Down Order Controls) */}
        <div className="lg:col-span-7 glass-panel p-5 rounded-2xl border border-glass-border space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div>
              <h3 className="text-base font-extrabold text-white">{activeSecConfig.name}</h3>
              <p className="text-[11px] text-gray-400">{activeSecConfig.desc}</p>
            </div>
            <span className="text-xs font-bold px-2.5 py-1 rounded bg-white/10 text-neon-cyan">
              {activeSecList.length} / {activeSecConfig.max} Phim
            </span>
          </div>

          {activeSecList.length === 0 ? (
            <div className="p-8 text-center text-gray-500 border border-dashed border-white/10 rounded-xl space-y-1">
              <p className="text-xs font-semibold">Chưa có phim nào trong mục này.</p>
              <p className="text-[11px]">Chọn phim từ danh sách bên phải để thêm vào khu vực này.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {activeSecList.map((movieId, idx) => {
                const movie = allMovies.find(m => String(m.id) === String(movieId)) || { id: movieId, title: `Phim ID #${movieId}`, poster: '' };
                return (
                  <div key={movieId} className="flex items-center justify-between p-3 rounded-xl bg-surface border border-glass-border hover:border-white/20 transition-all">
                    
                    <div className="flex items-center space-x-3 min-w-0 flex-1">
                      <span className="text-xs font-mono font-bold text-amber-400 w-6 text-center">#{idx + 1}</span>
                      <img src={movie.poster || 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=100'} alt={movie.title} className="w-9 h-12 object-cover rounded-md border border-white/10 flex-shrink-0" />
                      <div className="min-w-0">
                        <h4 className="text-xs font-bold text-white truncate">{movie.title}</h4>
                        <p className="text-[10px] text-gray-400 truncate">{movie.originalTitle || `ID: ${movie.id}`}</p>
                      </div>
                    </div>

                    {/* Controls: Up, Down, Remove */}
                    <div className="flex items-center space-x-1.5 ml-2">
                      <button
                        onClick={() => handleMoveOrder(idx, 'up')}
                        disabled={readOnly || idx === 0}
                        className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-30 text-xs"
                        title="Đẩy lên trên"
                      >
                        ⬆
                      </button>
                      <button
                        onClick={() => handleMoveOrder(idx, 'down')}
                        disabled={readOnly || idx === activeSecList.length - 1}
                        className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-30 text-xs"
                        title="Đẩy xuống dưới"
                      >
                        ⬇
                      </button>
                      <button
                        onClick={() => handleRemoveMovieFromSection(movieId)}
                        disabled={readOnly}
                        className="p-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 text-xs font-bold"
                        title="Xóa khỏi mục này"
                      >
                        ✕
                      </button>
                    </div>

                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column (5 cols): Database Search & Add Movies Selector */}
        <div className="lg:col-span-5 glass-panel p-5 rounded-2xl border border-glass-border space-y-4">
          <h3 className="text-sm font-extrabold text-white flex items-center justify-between border-b border-white/10 pb-3">
            <span>🔍 Chọn Phim Từ Database</span>
            <span className="text-[10px] text-gray-400">Tổng {allMovies.length} phim</span>
          </h3>

          <input
            type="text"
            placeholder="Gõ tên phim để tìm kiếm..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full py-2.5 px-3.5 rounded-xl bg-surface border border-glass-border text-xs text-gray-200 focus:outline-none focus:border-neon-cyan"
          />

          <div className="space-y-2 max-h-[420px] overflow-y-auto custom-scrollbar pr-1">
            {filteredSearchMovies.map((movie) => {
              const isAdded = activeSecList.includes(movie.id);
              return (
                <div key={movie.id} className="flex items-center justify-between p-2.5 rounded-xl bg-surface/80 border border-white/5 hover:border-white/10 transition-all">
                  <div className="flex items-center space-x-2.5 min-w-0 flex-1">
                    <img src={movie.poster || 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=100'} alt={movie.title} className="w-8 h-11 object-cover rounded border border-white/10 flex-shrink-0" />
                    <div className="min-w-0">
                      <h4 className="text-xs font-bold text-gray-200 truncate">{movie.title}</h4>
                      <span className="text-[10px] text-yellow-400">★ {movie.imdb || '8.0'}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => handleAddMovieToSection(movie.id)}
                    disabled={readOnly || isAdded}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all flex-shrink-0 ${
                      isAdded 
                        ? 'bg-white/10 text-gray-400 cursor-not-allowed' 
                        : 'bg-neon-cyan/20 hover:bg-neon-cyan/30 text-neon-cyan border border-neon-cyan/40 cursor-pointer'
                    }`}
                  >
                    {isAdded ? 'Đã thêm' : '+ Thêm'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
};

export default HomepageCMS;
