import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import TrollLogoutModal from '../ui/TrollLogoutModal';
import Secret210Modal from '../ui/Secret210Modal';
import dragonLogo from '../../assets/dragon-logo.png';
import meoDenLogo from '../../assets/meo_den.png';

// 47 Standard Anime & Film Genres list (Sorted A-Z)
export const ANIME_GENRES = [
  'Action',
  'Adventure',
  'Boys Love',
  'Cartoon',
  'Cổ Trang',
  'Comedy',
  'Dementia',
  'Demons',
  'Drama',
  'Ecchi',
  'Fantasy',
  'Game',
  'Harem',
  'Historical',
  'Horror',
  'Josei',
  'Kids',
  'Live Action',
  'Magic',
  'Martial Arts',
  'Mecha',
  'Military',
  'Music',
  'Mystery',
  'Parody',
  'Police',
  'Psychological',
  'Romance',
  'Samurai',
  'School',
  'Sci-Fi',
  'Seinen',
  'Shoujo',
  'Shoujo Ai',
  'Shounen',
  'Shounen Ai',
  'Slice of Life',
  'Space',
  'Sports',
  'Super Power',
  'Supernatural',
  'Suspense',
  'Thriller',
  'Tokusatsu',
  'Vampire',
  'Yaoi',
  'Yuri'
];

const Navbar = () => {
  const { currentUser, userRole, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isTrollModalOpen, setIsTrollModalOpen] = useState(false);
  const [isSecret210Open, setIsSecret210Open] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGenres, setSelectedGenres] = useState([]);
  const navigate = useNavigate();
  const location = useLocation();

  // Sync selected genres from URL params when visiting /the-loai
  useEffect(() => {
    if (location.pathname.startsWith('/the-loai') || location.pathname.startsWith('/category')) {
      const params = new URLSearchParams(location.search);
      const genreParam = params.get('genre') || params.get('genres');
      if (genreParam) {
        const parsed = genreParam.split(',').map(g => g.trim()).filter(Boolean);
        setSelectedGenres(parsed);
      }
    }
  }, [location]);

  // Toggle single genre selection
  const toggleGenre = (genre) => {
    if (selectedGenres.includes(genre)) {
      setSelectedGenres(selectedGenres.filter(g => g !== genre));
    } else {
      setSelectedGenres([...selectedGenres, genre]);
    }
  };

  // Select all & clear all helpers
  const selectAllGenres = () => setSelectedGenres([...ANIME_GENRES]);
  const clearAllGenres = () => setSelectedGenres([]);

  // Submit filter action: navigate to /the-loai?genres=Action,Fantasy
  const handleFilterSubmit = () => {
    if (selectedGenres.length === 0) {
      navigate('/the-loai');
    } else {
      const query = encodeURIComponent(selectedGenres.join(','));
      navigate(`/the-loai?genres=${query}`);
    }
    setMenuOpen(false);
  };

  // Handle Search Submission (Navigates to /the-loai with search parameter)
  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/the-loai?q=${encodeURIComponent(searchQuery.trim())}`);
      setSearchQuery('');
      setMenuOpen(false);
    }
  };

  return (
    <>
      {/* Main Top Bar Header - Always Solid Navy & Highly Visible */}
      <header className="fixed top-0 left-0 right-0 z-[9999] bg-[#161a2e]/95 backdrop-blur-md border-b border-white/10 shadow-2xl py-2.5 transition-all">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 md:px-8 flex items-center justify-between gap-2 md:gap-3">

          {/* Left Section: Menu Hamburger & Brand Logo with Slogan */}
          <div className="flex min-w-0 items-center space-x-2 sm:space-x-4 flex-shrink-0">

            {/* Hamburger Button */}
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-all cursor-pointer flex flex-col justify-center items-center gap-1 w-11 h-11 shrink-0 border border-white/10"
              aria-label="Mở danh mục thể loại"
              title="Danh mục thể loại"
            >
              <span className={`block w-5 h-0.5 bg-white transition-all ${menuOpen ? 'rotate-45 translate-y-1.5 bg-amber-400' : ''}`}></span>
              <span className={`block w-5 h-0.5 bg-white transition-all ${menuOpen ? 'opacity-0' : ''}`}></span>
              <span className={`block w-5 h-0.5 bg-white transition-all ${menuOpen ? '-rotate-45 -translate-y-1.5 bg-amber-400' : ''}`}></span>
            </button>

            {/* Brand Logo with Dragon Icon & Slogan */}
            <Link to="/" className="flex min-w-0 items-center space-x-1.5 sm:space-x-2.5 group">
              <div className="relative hidden min-[360px]:block">
                <img
                  src={dragonLogo}
                  alt="Dragon Logo"
                  className="w-8 h-8 sm:w-10 sm:h-10 object-contain drop-shadow-[0_0_12px_rgba(255,255,255,0.95)] group-hover:scale-110 transition-transform duration-300"
                />
              </div>
              <div className="flex flex-col">
                <div className="flex items-center text-lg sm:text-2xl font-black tracking-tight leading-none">
                  <span className="text-amber-400">210</span>
                  <span className="text-[#38bdf8]">LoliPhim</span>
                </div>
                <span className="hidden sm:block text-[9px] font-bold text-amber-300 tracking-tight mt-0.5 whitespace-nowrap">
                  -\ Tích cực quay tay – Vận may sẽ đến /-
                </span>
              </div>
            </Link>
          </div>

          {/* Middle Section: Search Bar Container (Always Visible & Responsive) */}
          <div className="hidden md:block flex-1 max-w-xl mx-2 min-w-0">
            <form onSubmit={handleSearchSubmit} className="relative w-full">
              <div className="relative flex items-center">
                <svg className="w-4 h-4 text-gray-400 absolute left-3 pointer-events-none flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Tìm phim, thể loại..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full py-1.5 sm:py-2 pl-9 sm:pl-10 pr-3 sm:pr-4 text-xs rounded-full bg-[#242b4d] border border-white/10 text-white placeholder-gray-400 focus:outline-none focus:border-amber-400 focus:bg-[#202644] transition-all shadow-inner"
                />
              </div>
            </form>
          </div>

          {/* Right Section: Buttons (Thể Loại & Thành Viên / Admin) */}
          <div className="flex items-center space-x-2 sm:space-x-3 flex-shrink-0">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Tìm phim"
              className="md:hidden w-11 h-11 rounded-full bg-[#283056] border border-white/15 flex items-center justify-center"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>

            {/* 1. Button Thể Loại */}
            <button
              type="button"
              onClick={() => setMenuOpen(!menuOpen)}
              className="hidden md:flex px-3 sm:px-3.5 py-1.5 rounded-full bg-[#283056] hover:bg-[#323c6d] text-white text-xs font-bold border border-white/15 transition-all items-center space-x-1.5 cursor-pointer shadow-sm"
            >
              <span>🎭</span>
              <span className="hidden xs:inline">Thể Loại</span>
              {selectedGenres.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-amber-400 text-black text-[10px] font-black ml-0.5">
                  {selectedGenres.length}
                </span>
              )}
            </button>

            {/* 2. Admin Dashboard Quick Link Button (If Admin) */}
            {userRole === 'admin' && (
              <Link
                to="/admin"
                className="hidden md:flex px-3 py-1.5 rounded-full bg-neon-red/90 hover:bg-neon-red text-white text-xs font-black shadow-neon-red transition-all items-center gap-1"
                title="Vào Trang Quản Trị Admin"
              >
                <span>👑</span>
                <span className="hidden md:inline">Admin</span>
              </Link>
            )}

            {/* 3. Button Thành Viên (Yellow Gold Pill Button) */}
            {currentUser ? (
              <div className="flex items-center space-x-1.5 sm:space-x-2">
                <Link
                  to="/admin"
                  aria-label={`Tài khoản ${currentUser.displayName || currentUser.username || 'User'}`}
                  className="w-11 h-11 sm:w-auto sm:h-auto sm:px-4 sm:py-1.5 rounded-full bg-[#ffce45] hover:bg-amber-300 text-gray-900 font-extrabold text-xs transition-all shadow-md flex items-center justify-center space-x-1"
                >
                  <span>👤</span>
                  <span className="hidden sm:inline max-w-[90px] truncate">{currentUser.displayName || currentUser.username || 'User'}</span>
                </Link>
                <button
                  onClick={() => setIsTrollModalOpen(true)}
                  className="text-[11px] text-gray-400 hover:text-red-400 font-semibold cursor-pointer hidden md:inline"
                >
                  Đăng xuất
                </button>
              </div>
            ) : (
              <Link
                to="/login"
                className="px-4 sm:px-5 py-1.5 rounded-full bg-[#ffce45] hover:bg-amber-300 text-gray-900 font-black text-xs transition-all shadow-md flex items-center space-x-1"
              >
                <span>Đăng nhập</span>
              </Link>
            )}
          </div>

        </div>
      </header>

      {/* DROPDOWN MULTI-SELECT MENU DRAWER (WITH CLICK OUTSIDE & RED CLOSE X BUTTON) */}
      {menuOpen && (
        <div
          onClick={() => setMenuOpen(false)}
          className="fixed inset-0 z-[10000] bg-black/75 backdrop-blur-sm pt-20 pb-8 px-4 flex justify-start items-start animate-fadeIn cursor-pointer"
        >
          {/* Slate Indigo Card Container */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm bg-[#323c6d] border border-white/15 rounded-2xl p-5 text-white space-y-4 shadow-2xl max-h-[calc(100dvh-7rem)] overflow-y-auto custom-scrollbar flex flex-col justify-between cursor-default animate-scaleUp"
          >
            {/* Dedicated Top Row: Header & Red Close X Button (Separated from User Pill Button) */}
            <div className="flex items-center justify-between pb-1">
              <div className="flex items-center space-x-2">
                <span className="text-sm">⚡</span>
                <span className="text-xs font-black uppercase tracking-wider text-amber-400">210LoliPhim Menu</span>
              </div>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="w-7 h-7 rounded-full bg-red-500/20 hover:bg-red-500/40 text-red-400 border border-red-500/40 flex items-center justify-center text-xs font-black transition-all cursor-pointer shadow-[0_0_10px_rgba(239,68,68,0.3)] hover:scale-110"
                title="Đóng bảng chọn thể loại"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <form onSubmit={handleSearchSubmit} className="md:hidden">
                <input
                  type="search"
                  aria-label="Tìm phim trong danh mục"
                  placeholder="Tìm phim, thể loại..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full min-h-11 px-4 text-base rounded-xl bg-[#202644] border border-white/10 text-white placeholder-gray-400 focus:outline-none focus:border-amber-400"
                />
                <button type="submit" className="mt-2 w-full min-h-11 rounded-xl bg-amber-400 text-black font-bold">Tìm kiếm</button>
              </form>
              {/* 1. Pill Button: Thành viên */}
              <Link
                to={currentUser ? "#" : "/login"}
                onClick={() => setMenuOpen(false)}
                className="w-full py-2.5 rounded-full bg-[#eef1f8] hover:bg-white text-[#212642] font-black text-sm flex items-center justify-center space-x-2 shadow-md transition-all"
              >
                <span className="text-base">👤</span>
                <span>{currentUser ? (currentUser.displayName || currentUser.username || 'User') : 'Đăng nhập'}</span>
              </Link>

              {/* 2. MỤC THỂ LOẠI (MULTI-SELECT 3 CỘT) */}
              <div className="space-y-3 pt-2 border-t border-white/10">
                <div className="flex items-center justify-between font-extrabold text-sm text-amber-300">
                  <span className="flex items-center gap-1.5">
                    <span>🎭</span> Chọn Đa Thể Loại
                  </span>
                  <div className="flex items-center space-x-2 text-[10px]">
                    <button
                      type="button"
                      onClick={selectAllGenres}
                      className="hover:underline text-gray-300 font-bold cursor-pointer"
                    >
                      Tất cả
                    </button>
                    <span>•</span>
                    <button
                      type="button"
                      onClick={clearAllGenres}
                      className="hover:underline text-red-400 font-bold cursor-pointer"
                    >
                      Xóa
                    </button>
                  </div>
                </div>

                <p className="text-[10px] text-gray-300">
                  Click chọn nhiều thể loại (đã chọn: <strong className="text-amber-300">{selectedGenres.length}</strong>)
                </p>

                {/* 46 Genre Buttons Grid with toggle active state */}
                <div className="grid grid-cols-3 gap-1.5 max-h-60 overflow-y-auto custom-scrollbar pr-1">
                  {ANIME_GENRES.map((genre, idx) => {
                    const isSelected = selectedGenres.includes(genre);
                    return (
                      <button
                        type="button"
                        key={idx}
                        onClick={() => toggleGenre(genre)}
                        className={`px-2 py-2 rounded-lg border text-center truncate transition-all text-[11px] cursor-pointer ${isSelected
                            ? 'bg-amber-400 text-black border-amber-400 font-black shadow-[0_0_10px_rgba(245,158,11,0.5)] scale-[1.02]'
                            : 'bg-[#23294a] text-gray-200 border-white/10 hover:bg-white/10 hover:text-white font-medium'
                          }`}
                        title={genre}
                      >
                        {isSelected ? `✓ ${genre}` : genre}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Sticky Actions Bar at the bottom of the drawer */}
            <div className="space-y-3 pt-3 border-t border-white/10">
              {/* Filter Submit Button */}
              <button
                type="button"
                onClick={handleFilterSubmit}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400 text-black font-black text-xs uppercase tracking-wider shadow-[0_0_15px_rgba(245,158,11,0.5)] transition-all cursor-pointer flex items-center justify-center space-x-2"
              >
                <span>🚀 Lọc Phim</span>
                {selectedGenres.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-black/20 text-black font-extrabold text-[10px]">
                    {selectedGenres.length} thể loại
                  </span>
                )}
              </button>

              {currentUser && (
                <div className="text-center pt-1 space-y-3">
                  <button
                    onClick={() => { setMenuOpen(false); setIsTrollModalOpen(true); }}
                    className="text-xs text-red-400 font-bold hover:underline cursor-pointer"
                  >
                    Đăng xuất tài khoản
                  </button>

                  {/* Secret 210 Button Section */}
                  <div className="pt-2 border-t border-white/10 flex flex-col items-center space-y-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        setIsSecret210Open(true);
                      }}
                      className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-yellow-500 via-amber-500 to-gray-900 hover:from-yellow-400 hover:to-black text-white font-black transition-all shadow-[0_0_15px_rgba(234,179,8,0.35)] hover:shadow-[0_0_22px_rgba(234,179,8,0.6)] flex items-center justify-center space-x-3 border border-yellow-400/40 cursor-pointer group active:scale-95"
                    >
                      <img
                        src={meoDenLogo}
                        alt="Meo Den 210"
                        className="w-8 h-8 object-contain drop-shadow group-hover:rotate-12 transition-transform"
                      />
                      <span className="text-2xl font-black tracking-widest text-black drop-shadow-[0_1px_2px_rgba(255,255,255,0.8)]">
                        210,Hentaiz,JAV...
                      </span>
                    </button>
                    <p className="text-[11px] text-red-400 italic text-center font-medium leading-tight px-1">
                      "Kho tàng kiến thức, cùng nững tài liệu học tập đắt giá!Còn chần chừ gì nữa mà không vào ngay:)"
                    </p>
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>
      )}

      {/* Troll Logout Modal */}
      <TrollLogoutModal
        isOpen={isTrollModalOpen}
        onClose={() => setIsTrollModalOpen(false)}
        onConfirmLogout={() => {
          logout();
          navigate('/login');
        }}
      />

      {/* Secret 210 Troll Modal */}
      <Secret210Modal
        isOpen={isSecret210Open}
        onClose={() => setIsSecret210Open(false)}
        onSuccess={() => {
          navigate('/the-loai?genre=Adult');
        }}
      />
    </>
  );
};

export default Navbar;
