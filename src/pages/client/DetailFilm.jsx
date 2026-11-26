import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import Navbar from '../../components/common/Navbar';
import { getMovies } from '../../services/movieService';
import { getCurrentSession } from '../../services/authService';
import { getMovieStats, toggleMovieLike } from '../../services/interactionService';
import MovieComments from '../../components/ui/MovieComments';
import EpisodeSelector from '../../components/ui/EpisodeSelector';
import RelatedMoviesSidebar from '../../components/ui/RelatedMoviesSidebar';
import { formatVietnameseSentenceCase, extractCleanEpisodeNumber, formatEpisodeTitle, deduplicateEpisodes } from '../../utils/textUtils';
import { isFeatureMovie, getRelatedMovies } from '../../utils/movieFormat.js';
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
  const [activeServerName, setActiveServerName] = useState('');
  const [isFavorite, setIsFavorite] = useState(false);
  const [viewsCount, setViewsCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [isDescTruncated, setIsDescTruncated] = useState(false);
  const descRef = useRef(null);

  // Fetch & re-bind movie data whenever slug/id in URL changes
  useEffect(() => {
    const fetchMovieData = async () => {
      setIsLoading(true);
      setMovieDetail(null); // Clear previous state immediately!
      setDescExpanded(false);
      setIsDescTruncated(false);

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

  useEffect(() => {
    if (descExpanded || !descRef.current) return;
    const el = descRef.current;
    setIsDescTruncated(el.scrollHeight > el.clientHeight + 1);
  }, [movieDetail?.description, isLoading, descExpanded]);

  // Thuật toán 'Phim Liên Quan' (Tối đa 10 phim)
  const relatedMovies = useMemo(
    () => getRelatedMovies(allMovies, movieDetail, 10),
    [allMovies, movieDetail]
  );

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
  const movieServers = Array.isArray(movieDetail?.servers) && movieDetail.servers.length > 0
    ? movieDetail.servers
    : null;
  const resolvedServerName = activeServerName && movieServers?.some(s => s.name === activeServerName)
    ? activeServerName
    : (movieServers?.find(s => s.name === 'Vietsub')?.name || movieServers?.[0]?.name || 'Vietsub');
  const activeServerEpisodes = movieServers
    ? (movieServers.find(s => s.name === resolvedServerName)?.episodes || episodes)
    : episodes;

  const isMovie = isFeatureMovie(movieDetail);
  const watchEpisode = isMovie ? activeServerEpisodes[0]?.number || 1 : selectedEpisode;

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
                  {ageRating && (
                    <span className="px-2.5 py-1 rounded-lg bg-neon-red/20 text-neon-red border border-neon-red/30">
                      {ageRating}
                    </span>
                  )}
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
                <div className="max-w-3xl">
                  <p
                    ref={descRef}
                    className={`text-gray-300 text-xs sm:text-sm leading-relaxed ${descExpanded ? '' : 'line-clamp-4'}`}
                  >
                    {description}
                  </p>
                  {(isDescTruncated || descExpanded) && (
                    <button
                      type="button"
                      onClick={() => setDescExpanded(prev => !prev)}
                      className="mt-1 text-xs font-bold text-amber-400 hover:text-amber-300 transition-colors cursor-pointer"
                    >
                      {descExpanded ? 'Thu gọn ▲' : 'Xem thêm ▼'}
                    </button>
                  )}
                </div>

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

              <EpisodeSelector
                episodes={activeServerEpisodes}
                servers={movieServers || []}
                activeServerName={resolvedServerName}
                onSelectServer={(name) => setActiveServerName(name)}
                activeEpisode={selectedEpisode}
                getEpisodeLink={(_, epNum) => `/movie/${movieSlug}/tap-${epNum}${movieServers && movieServers.length > 1 ? `?server=${encodeURIComponent(resolvedServerName)}` : ''}`}
                onSelectEpisode={(epNum) => setSelectedEpisode(epNum)}
              />
            </div>}

            <MovieComments movieId={String(activeId)} />

          </div>

          {/* Right Sidebar: Phim Liên Quan */}
          <aside className="hidden xl:block w-80 flex-shrink-0 space-y-4">
            <RelatedMoviesSidebar movies={relatedMovies} />
          </aside>

        </div>
      </main>
    </div>
  );
};

export default DetailFilm;
