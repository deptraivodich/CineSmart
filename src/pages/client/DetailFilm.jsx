import React, { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import Navbar from '../../components/common/Navbar';
import { getMovies } from '../../services/movieService';
import { getCurrentSession } from '../../services/authService';
import { getMovieStats, toggleMovieLike } from '../../services/interactionService';
import MovieComments from '../../components/ui/MovieComments';
import { formatVietnameseSentenceCase, extractCleanEpisodeNumber, formatEpisodeTitle, deduplicateEpisodes } from '../../utils/textUtils';
import { isFeatureMovie } from '../../utils/movieFormat.js';
import { generateSlug } from '../../utils/slugUtils';

// Fallback template when fetching detail
const DEFAULT_FALLBACK_MOVIE = {
  id: '1',
  title: 'Phim Đang Tải...',
  originalTitle: 'Loading...',
  banner: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1600&auto=format&fit=crop&q=80',
  poster: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600&auto=format&fit=crop&q=80',
  imdb: '8.0',
  year: '2024',
  ageRating: '16+',
  quality: '4K UltraHD',
  duration: '120 phút',
  episodesCount: 'Full Tập',
  audio: 'Vietsub + Thuyết Minh',
  director: 'Đang cập nhật',
  genres: ['Hành động', 'Viễn tưởng'],
  description: 'Mô tả chi tiết nội dung phim đang được cập nhật từ hệ thống.',
  episodes: Array.from({ length: 12 }, (_, i) => ({
    number: i + 1,
    title: `Tập ${i + 1}`,
    m3u8Url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'
  }))
};

const DetailFilm = () => {
  const { slug, id } = useParams(); // SEO Slug or ID param
  const targetSlug = slug || id;
  const [movieDetail, setMovieDetail] = useState(null);
  const [allMovies, setAllMovies] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedEpisode, setSelectedEpisode] = useState(1);
  const [isFavorite, setIsFavorite] = useState(false);
  const [viewsCount, setViewsCount] = useState(0);
  const [copied, setCopied] = useState(false);

  // Fetch & re-bind movie data whenever slug/id in URL changes
  useEffect(() => {
    const fetchMovieData = async () => {
      setIsLoading(true);
      setMovieDetail(null); // Clear previous state immediately!

      try {
        const moviesList = await getMovies();
        setAllMovies(moviesList || []);

        // Đối chiếu slug trên URL với generateSlug(movie.title) hoặc id
        const found = (moviesList || []).find(m => 
          generateSlug(m.title) === targetSlug || 
          String(m.id) === String(targetSlug) ||
          generateSlug(m.originalTitle) === targetSlug
        );

        const formatEpisodes = (rawEps, defaultM3u8) => {
          if (Array.isArray(rawEps) && rawEps.length > 0) {
            const deduped = deduplicateEpisodes(rawEps);
            return deduped.map((ep, i) => {
              const epNum = extractCleanEpisodeNumber(ep.name || ep.number, i + 1);
              return {
                number: epNum,
                title: formatEpisodeTitle(ep.name || ep.number, i + 1),
                m3u8Url: ep.url || ep.m3u8Url || defaultM3u8 || ''
              };
            });
          }
          return [
            {
              number: '1',
              title: 'Tập 1',
              m3u8Url: defaultM3u8 || 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'
            }
          ];
        };

        if (found) {
          const parsedEps = formatEpisodes(found.episodes, found.m3u8Url);
          setMovieDetail({
            ...found,
            episodes: parsedEps,
            episodesCount: `${parsedEps.length} Tập`
          });

          // Đồng bộ Lượt xem, Trạng thái Yêu thích, và Bình luận thật từ API
          const session = getCurrentSession();
          const username = session?.username || 'anonymous';
          getMovieStats(found.id, username).then(stats => {
            if (stats) {
              setViewsCount(stats.views || 0);
              setIsFavorite(stats.is_liked || false);
            }
          });
        } else if (moviesList && moviesList.length > 0) {
          const fallback = moviesList[0];
          const parsedEps = formatEpisodes(fallback.episodes, fallback.m3u8Url);
          setMovieDetail({
            ...fallback,
            episodes: parsedEps,
            episodesCount: `${parsedEps.length} Tập`
          });

          const session = getCurrentSession();
          const username = session?.username || 'anonymous';
          getMovieStats(fallback.id, username).then(stats => {
            if (stats) {
              setViewsCount(stats.views || 0);
              setIsFavorite(stats.is_liked || false);
            }
          });
        } else {
          setMovieDetail(DEFAULT_FALLBACK_MOVIE);
        }
      } catch (err) {
        console.error("Error fetching detail for slug/id:", targetSlug, err);
        setMovieDetail(DEFAULT_FALLBACK_MOVIE);
      } finally {
        setIsLoading(false);
      }
    };

    fetchMovieData();
    window.scrollTo(0, 0); // Scroll to top when changing movie
  }, [targetSlug]);

  // Thuật toán 'Phim Liên Quan' (Tối đa 10 phim)
  const relatedMovies = useMemo(() => {
    if (!movieDetail || !allMovies || allMovies.length === 0) return [];

    const currentId = String(movieDetail.id);
    const currentTitle = movieDetail.title || '';
    const currentGenres = Array.isArray(movieDetail.genres) 
      ? movieDetail.genres.map(g => String(g).trim().toLowerCase()) 
      : String(movieDetail.genres || '').split(/[,;/|]+/).map(g => g.trim().toLowerCase()).filter(Boolean);

    // Chuẩn hóa tên phim để tìm chuỗi tên gốc (bỏ "phần X", "season X", "part X", số tập...)
    const getCleanRootTitle = (t) => {
      if (!t) return '';
      return String(t)
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd')
        .replace(/[\(\[\{]?(phan|season|ss|part|tap|movie|ova)[\s\d:–\-]+[\)\]\}]?/gi, '')
        .replace(/[\(\[\{][^\)\]\}]*[\)\]\}]/g, '')
        .replace(/\s+\d+$/, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .trim();
    };

    const currentRoot = getCleanRootTitle(currentTitle);

    // Lọc bỏ phim hiện tại
    const candidateMovies = allMovies.filter(m => m && String(m.id) !== currentId);

    // Logic ưu tiên 1: Cùng chuỗi tên (trùng tiền tố / hậu tố / cùng franchise)
    const priority1Movies = [];
    const addedIds = new Set();

    if (currentRoot.length >= 3) {
      candidateMovies.forEach(m => {
        const otherRoot = getCleanRootTitle(m.title || '');
        if (otherRoot.length >= 3) {
          const isSameRoot = otherRoot === currentRoot;
          const isPrefixOrSuffix = otherRoot.startsWith(currentRoot) || currentRoot.startsWith(otherRoot) || 
                                   otherRoot.includes(currentRoot) || currentRoot.includes(otherRoot);

          if (isSameRoot || isPrefixOrSuffix) {
            priority1Movies.push(m);
            addedIds.add(String(m.id));
          }
        }
      });
    }

    // Logic ưu tiên 2: Cùng Thể loại với phim đang xem cho đến khi đủ 10 phim
    const priority2Candidates = [];
    if (priority1Movies.length < 10) {
      candidateMovies.forEach(m => {
        if (!addedIds.has(String(m.id))) {
          const mGenres = Array.isArray(m.genres) 
            ? m.genres.map(g => String(g).trim().toLowerCase()) 
            : String(m.genres || '').split(/[,;/|]+/).map(g => g.trim().toLowerCase()).filter(Boolean);
          
          const matchCount = mGenres.filter(g => currentGenres.includes(g)).length;
          if (matchCount > 0) {
            priority2Candidates.push({ movie: m, matchCount });
          }
        }
      });

      // Sắp xếp ưu tiên phim có nhiều thể loại trùng nhất lên trước
      priority2Candidates.sort((a, b) => b.matchCount - a.matchCount);
    }

    const priority2Movies = priority2Candidates.map(c => {
      addedIds.add(String(c.movie.id));
      return c.movie;
    });

    let combined = [...priority1Movies, ...priority2Movies];

    // Nếu vẫn chưa đủ 10, điền thêm các phim khác trong DB cho đủ 10
    if (combined.length < 10) {
      for (const m of candidateMovies) {
        if (!addedIds.has(String(m.id))) {
          combined.push(m);
          addedIds.add(String(m.id));
          if (combined.length >= 10) break;
        }
      }
    }

    return combined.slice(0, 10);
  }, [movieDetail, allMovies]);

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleToggleFavorite = async () => {
    if (!movieDetail?.id) return;
    const session = getCurrentSession();
    const username = session?.username || 'anonymous';
    const res = await toggleMovieLike(movieDetail.id, username);
    setIsFavorite(res.is_liked);
  };

  if (isLoading || !movieDetail) {
    return (
      <div className="min-h-screen bg-background text-white flex flex-col justify-center items-center space-y-4">
        <div className="w-12 h-12 rounded-full border-4 border-neon-red border-t-transparent animate-spin"></div>
        <p className="text-xs text-gray-400 font-bold">Đang tải thông tin phim...</p>
      </div>
    );
  }

  const {
    id: activeId,
    title,
    originalTitle,
    banner,
    poster,
    imdb = '8.5',
    year = '2024',
    ageRating = '16+',
    quality = '4K UltraHD',
    duration = 'Đang cập nhật',
    episodesCount = 'Full Tập',
    badge = 'Vietsub + Thuyết Minh',
    director = 'Đang cập nhật',
    country = 'Nhật Bản',
    genres = ['Hành động', 'Viễn tưởng'],
    description = 'Tóm tắt nội dung phim đang được cập nhật.',
    episodes = []
  } = movieDetail;

  const movieSlug = generateSlug(title) || activeId;
  const isMovie = isFeatureMovie(movieDetail);
  const watchEpisode = isMovie ? episodes[0]?.number || 1 : selectedEpisode;

  return (
    <div className="min-h-screen bg-background text-white pb-24">
      {/* Hero Section - Full Width Backdrop Banner */}
      <section className="relative w-full h-[55vh] md:h-[70vh] flex items-end overflow-hidden">
        {/* Backdrop Image */}
        <div className="absolute inset-0 z-0">
          <img 
            src={banner || poster} 
            alt={title} 
            className="w-full h-full object-cover object-center scale-105 filter brightness-90 opacity-80"
          />
          {/* Gradient Overlays */}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-transparent"></div>
          <div className="absolute inset-0 bg-gradient-to-r from-background/90 via-background/40 to-transparent"></div>
        </div>

        {/* Ambient Top Shadow */}
        <div className="absolute top-0 inset-x-0 h-32 bg-gradient-to-b from-background to-transparent z-1"></div>
      </section>

      {/* Main Content Layout Container */}
      <main className="relative z-10 -mt-36 md:-mt-48 max-w-7xl mx-auto px-4 md:px-12">
        <div className="flex flex-col xl:flex-row gap-8 items-start">

          {/* Left & Center Main Content Area */}
          <div className="flex-1 space-y-8 w-full">

            {/* 2-Column Movie Info Header */}
            <div className="flex flex-col md:flex-row gap-6 md:gap-8 items-start">
              
              {/* Left Column: Poster Image */}
              <div className="w-44 sm:w-56 md:w-64 flex-shrink-0 mx-auto md:mx-0">
                <div className="relative aspect-[2/3] w-full rounded-2xl overflow-hidden shadow-[0_0_35px_rgba(229,9,20,0.5)] border border-glass-border group">
                  <img 
                    src={poster} 
                    alt={title} 
                    className="w-full h-full object-cover rounded-2xl transition-transform duration-500 group-hover:scale-105"
                  />
                  <div className="absolute top-3 left-3 bg-neon-red text-white text-[10px] font-extrabold px-2.5 py-1 rounded shadow-neon-red uppercase">
                    {quality}
                  </div>
                </div>

                {/* Sub-info Badges under Poster */}
                <div className="mt-3 flex items-center justify-center gap-2 text-xs text-gray-400">
                  <span className="px-2 py-1 rounded bg-white/5 border border-white/10">{badge}</span>
                </div>
              </div>

              {/* Right Column: Title, Metadata, Action Buttons & Storyline */}
              <div className="flex-1 space-y-4 text-center md:text-left">
                
                {/* Title & Original Title */}
                <div>
                  <h1 className="text-3xl sm:text-4xl md:text-5xl font-black text-white tracking-tight leading-tight">
                    {formatVietnameseSentenceCase(title)}
                  </h1>
                  <h2 className="text-base md:text-lg text-gray-400 font-medium mt-1">
                    {originalTitle} ({year})
                  </h2>
                </div>

                {/* Metadata Badges Row */}
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-2.5 text-xs sm:text-sm font-semibold">
                  <span className="px-2.5 py-1 rounded-lg bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 flex items-center gap-1 font-bold">
                    ★ {imdb} IMDb
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-neon-red/20 text-neon-red border border-neon-red/30">
                    {ageRating}
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-white/10 text-gray-200 border border-white/10">
                    {year}
                  </span>
                  {country && (
                    <span className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold">
                      🌐 {country}
                    </span>
                  )}
                  <span className="px-2.5 py-1 rounded-lg bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30">
                    {duration}
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    {isMovie ? 'Movie' : episodesCount}
                  </span>
                </div>

                {/* Genres Tags */}
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 pt-1">
                  {Array.isArray(genres) ? genres.map((g, idx) => (
                    <span key={idx} className="px-3 py-1 rounded-full bg-surface-card text-xs text-gray-300 border border-glass-border">
                      {g}
                    </span>
                  )) : (
                    <span className="px-3 py-1 rounded-full bg-surface-card text-xs text-gray-300 border border-glass-border">
                      {genres}
                    </span>
                  )}
                </div>

                {/* Storyline Description */}
                <p className="text-gray-300 text-xs sm:text-sm leading-relaxed max-w-3xl line-clamp-4">
                  {description}
                </p>

                {/* Country & Director (ĐÃ XÓA BỎ DÒNG 'Diễn viên: Đang cập nhật' THEO NHIỆM VỤ 2) */}
                <div className="text-xs text-gray-400 space-y-1 pt-1">
                  <p><strong className="text-gray-200">Quốc gia:</strong> <span className="text-emerald-400 font-semibold">{country}</span></p>
                  <p><strong className="text-gray-200">Đạo diễn:</strong> {director}</p>
                </div>
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 pt-4">
                  {/* Big Prominent Highlighted 'Xem Ngay' Button with Dynamic Movie SEO Slug Route */}
                  <Link 
                    to={`/movie/${movieSlug}/tap-${watchEpisode}`}
                    className="px-8 py-3.5 rounded-xl bg-gradient-to-r from-yellow-400 via-amber-500 to-amber-600 hover:from-yellow-300 hover:to-amber-500 text-black font-extrabold text-sm sm:text-base flex items-center gap-2 shadow-[0_0_30px_rgba(251,191,36,0.6)] hover:scale-105 transition-all duration-300 cursor-pointer"
                  >
                    <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    <span>{isMovie ? 'XEM NGAY' : `XEM NGAY (${formatEpisodeTitle(selectedEpisode).toUpperCase()})`}</span>
                  </Link>

                  {/* Circular Icon Buttons: Lượt xem, Yêu thích, Bình luận, Chia sẻ */}
                  <div className="flex items-center space-x-3">
                    {/* UI Nút Lượt xem: hiển thị số Lượt xem đồng bộ toàn cầu (bắt đầu từ 0) */}
                    <div 
                      title={`Tổng lượt xem toàn cầu: ${viewsCount.toLocaleString()} lượt`}
                      className="h-11 px-3.5 rounded-full bg-surface-card text-neon-cyan border border-glass-border flex items-center gap-1.5 shadow-sm text-xs font-bold select-none cursor-default"
                    >
                      <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                        <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                      </svg>
                      <span>{viewsCount.toLocaleString()}</span>
                    </div>

                    {/* Nút Yêu thích (giao diện giữ nguyên, gọi API lưu/xóa, không hiện tổng tim) */}
                    <button 
                      onClick={handleToggleFavorite}
                      title={isFavorite ? 'Đã yêu thích' : 'Thêm vào yêu thích'}
                      className={`w-11 h-11 rounded-full flex items-center justify-center border transition-all duration-300 ${
                        isFavorite 
                          ? 'bg-neon-red text-white border-neon-red shadow-[0_0_20px_#e50914] scale-110' 
                          : 'bg-surface-card text-gray-300 hover:text-white border-glass-border hover:border-neon-red/50 hover:bg-neon-red/20'
                      }`}
                    >
                      <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                      </svg>
                    </button>

                    <a 
                      href="#comments-section"
                      title="Bình luận"
                      className="w-11 h-11 rounded-full bg-surface-card text-gray-300 hover:text-white border border-glass-border hover:border-neon-cyan/50 hover:bg-neon-cyan/20 flex items-center justify-center transition-all duration-300"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"/>
                      </svg>
                    </a>

                    <button 
                      onClick={handleShare}
                      title="Chia sẻ phim"
                      className="relative w-11 h-11 rounded-full bg-surface-card text-gray-300 hover:text-white border border-glass-border hover:border-amber-500/50 hover:bg-amber-500/20 flex items-center justify-center transition-all duration-300"
                    >
                      <svg className="w-5 h-5 fill-none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/>
                      </svg>
                      {copied && (
                        <span className="absolute -top-10 left-1/2 transform -translate-x-1/2 px-2.5 py-1 bg-neon-cyan text-black font-extrabold text-[10px] rounded whitespace-nowrap shadow-lg animate-bounce">
                          Đã copy link!
                        </span>
                      )}
                    </button>
                  </div>
                </div>

              </div>
            </div>

            {/* Series episode selection; a Movie opens directly from Xem ngay. */}
            {!isMovie && <div className="p-6 rounded-2xl bg-surface-card/90 border border-glass-border backdrop-blur-md space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <span className="w-1.5 h-4 bg-neon-red rounded-full"></span>
                  <span>Danh Sách Tập Phim</span>
                  <span className="text-xs text-gray-400 font-normal">({episodesCount})</span>
                </h3>
                <span className="text-xs text-neon-cyan font-semibold">Nguồn m3u8 Vietsub • KKPhim</span>
              </div>

              {/* Episode Rectangular Grid Buttons with SEO Slug URL */}
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2.5">
                {episodes.map((ep) => (
                  <Link
                    key={ep.number}
                    to={`/movie/${movieSlug}/tap-${ep.number}`}
                    onClick={() => setSelectedEpisode(ep.number)}
                    className={`py-2.5 px-3 rounded-xl text-center text-xs font-bold transition-all duration-200 border ${
                      String(selectedEpisode) === String(ep.number)
                        ? 'bg-neon-red text-white border-neon-red shadow-[0_0_15px_#e50914] scale-105'
                        : 'bg-background/80 text-gray-300 hover:text-white border-glass-border hover:border-neon-red/50 hover:bg-neon-red/20'
                    }`}
                  >
                    {ep.title}
                  </Link>
                ))}
              </div>
            </div>}

            <MovieComments movieId={String(activeId)} />

          </div>

          {/* Right Sidebar: Phim Liên Quan (NHIỆM VỤ 2 & 3) */}
          <aside className="hidden xl:block w-80 flex-shrink-0 space-y-4">
            <div className="p-5 rounded-2xl bg-surface-card/90 border border-glass-border backdrop-blur-md space-y-4">
              <h3 className="text-base font-extrabold text-white flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <span className="text-neon-red">🎬</span> Phim liên quan
                </span>
                <span className="text-[10px] text-gray-400 font-bold">210LoliPhim</span>
              </h3>

              <div className="space-y-3">
                {relatedMovies.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-4">Chưa có phim liên quan</p>
                ) : (
                  relatedMovies.map((item, index) => {
                    // BẮT BUỘC DÙNG BIẾN TRUNG GIAN CHO THUỘC TÍNH KEY KHI LẶP .MAP()
                    const itemKey = `related-movie-${item.id || index}-${index}`;
                    const itemSlug = generateSlug(item.title) || item.id;
                    const itemRank = index + 1;
                    const itemFormattedTitle = formatVietnameseSentenceCase(item.title);

                    return (
                      <Link 
                        key={itemKey} 
                        to={`/movie/${itemSlug}`}
                        className="flex items-center space-x-3 p-2 rounded-xl hover:bg-white/5 transition-all group"
                      >
                        <span className={`text-2xl font-black italic w-6 text-center ${
                          itemRank === 1 ? 'text-yellow-400 drop-shadow-[0_0_10px_rgba(250,204,21,0.5)]' :
                          itemRank === 2 ? 'text-gray-300' :
                          itemRank === 3 ? 'text-amber-600' : 'text-gray-600'
                        }`}>
                          {itemRank}
                        </span>

                        <div className="w-12 h-16 rounded-lg overflow-hidden flex-shrink-0 border border-glass-border group-hover:scale-105 transition-transform">
                          <img 
                            src={item.poster || item.banner} 
                            alt={itemFormattedTitle} 
                            className="w-full h-full object-cover" 
                            onError={(e) => { e.target.src = 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=300'; }}
                          />
                        </div>

                        <div className="flex-1 min-w-0">
                          <h4 className="text-xs font-bold text-gray-200 truncate group-hover:text-neon-red transition-colors">
                            {itemFormattedTitle}
                          </h4>
                          <div className="flex items-center space-x-2 text-[10px] text-gray-400 mt-0.5">
                            <span className="text-yellow-400 font-semibold">★ {item.imdb || '8.0'}</span>
                            {item.year && (
                              <>
                                <span>•</span>
                                <span>{item.year}</span>
                              </>
                            )}
                          </div>
                          {Array.isArray(item.genres) && item.genres.length > 0 && (
                            <p className="text-[10px] text-gray-500 truncate mt-0.5">
                              {item.genres.slice(0, 2).join(', ')}
                            </p>
                          )}
                        </div>
                      </Link>
                    );
                  })
                )}
              </div>
            </div>
          </aside>

        </div>
      </main>
    </div>
  );
};

export default DetailFilm;
