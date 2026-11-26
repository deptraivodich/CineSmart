import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useSearchParams, Link, useNavigate } from 'react-router-dom';
import VideoPlayer from '../../components/player/VideoPlayer';
import MovieComments from '../../components/ui/MovieComments';
import EpisodeSelector from '../../components/ui/EpisodeSelector';
import RelatedMoviesSidebar from '../../components/ui/RelatedMoviesSidebar';
import Navbar from '../../components/common/Navbar';
import { getMovies } from '../../services/movieService';
import { useAuth } from '../../contexts/AuthContext';
import { 
  recordWatchHistory, 
  updateWatchPlaybackPosition, 
  getMovieHistory,
  formatDurationToMinutesSeconds 
} from '../../services/historyService';
import { formatVietnameseSentenceCase, extractCleanEpisodeNumber, formatEpisodeTitle, deduplicateEpisodes } from '../../utils/textUtils';
import { isFeatureMovie, getRelatedMovies } from '../../utils/movieFormat.js';
import { generateSlug } from '../../utils/slugUtils';
import { trackEvent } from '../../services/telemetryService';
import { recordMovieView, getMovieStats, toggleMovieLike } from '../../services/interactionService';

const WatchPage = () => {
  const { slug, episode, id } = useParams();
  const targetSlug = slug || id;
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawEpisode = episode || searchParams.get('ep') || '1';
  const episodeParam = extractCleanEpisodeNumber(rawEpisode, '1');
  
  const playerRef = useRef(null);
  const lastSavedTimeRef = useRef(0);
  const viewedMovieIdRef = useRef(null); // Ref track phim đã tăng view chưa trong phiên
  const [currentMovie, setCurrentMovie] = useState(null);
  const [allMovies, setAllMovies] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeEpisodeState, setActiveEpisodeState] = useState(episodeParam);
  const [activeServerName, setActiveServerName] = useState(searchParams.get('server') || '');
  const [resumePrompt, setResumePrompt] = useState(null); // { savedTime: number, formattedTime: string }
  const [viewsCount, setViewsCount] = useState(0);
  const [isFavorite, setIsFavorite] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setActiveEpisodeState(episodeParam);
  }, [episodeParam]);

  useEffect(() => {
    const fetchWatchMovie = async () => {
      setIsLoading(true);
      setCurrentMovie(null);

      try {
        const moviesList = await getMovies();
        setAllMovies(Array.isArray(moviesList) ? moviesList : []);
        const found = (moviesList || []).find(m => 
          generateSlug(m.title) === targetSlug || 
          String(m.id) === String(targetSlug) ||
          generateSlug(m.originalTitle) === targetSlug
        );

        const activeMovie = found || (moviesList && moviesList.length > 0 ? moviesList[0] : null);
        if (activeMovie) {
          setCurrentMovie(activeMovie);
          const movieId = String(activeMovie.id);
          const username = currentUser?.username || 'anonymous';

          // Đồng bộ thống kê tương tác (Views, Likes)
          getMovieStats(movieId, username).then(stats => {
            if (stats) {
              setViewsCount(stats.views || 0);
              setIsFavorite(stats.is_liked || false);
            }
          });

          // LOGIC TĂNG LƯỢT XEM (NHIỆM VỤ 2):
          // Lượt xem chỉ tăng thêm +1 khi user vừa truy cập vào giao diện Xem Phim từ trang khác.
          // Nếu đang ở màn hình xem phim mà bấm chuyển tập (vd: Tập 1 sang Tập 2), KHÔNG ĐƯỢC tăng view.
          if (viewedMovieIdRef.current !== movieId) {
            viewedMovieIdRef.current = movieId;
            recordMovieView(movieId).then(res => {
              if (res && typeof res.views === 'number') {
                setViewsCount(res.views);
              }
            });
          }
        }
      } catch (err) {
        console.error("Error loading watch movie for targetSlug:", targetSlug, err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchWatchMovie();
    window.scrollTo(0, 0);
  }, [targetSlug, currentUser?.username]);

  // Resolve servers & episodes list safely and deduplicate
  const movieServers = useMemo(() => {
    if (Array.isArray(currentMovie?.servers) && currentMovie.servers.length > 0) {
      return currentMovie.servers.map(s => ({
        ...s,
        episodes: deduplicateEpisodes(s.episodes || []),
      })).filter(s => s.episodes.length > 0);
    }
    return null;
  }, [currentMovie]);

  const resolvedServerName = activeServerName && movieServers?.some(s => s.name === activeServerName)
    ? activeServerName
    : (movieServers?.find(s => s.name === 'Vietsub')?.name || movieServers?.[0]?.name || 'Vietsub');

  const movieEpisodesList = movieServers
    ? (movieServers.find(s => s.name === resolvedServerName)?.episodes || [])
    : (currentMovie?.episodes || []);
  const rawEpisodes = Array.isArray(movieEpisodesList) && movieEpisodesList.length > 0
    ? movieEpisodesList
    : [{ name: '1', url: currentMovie?.m3u8Url || 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8' }];
  const episodes = deduplicateEpisodes(rawEpisodes);

  const cleanEpState = extractCleanEpisodeNumber(activeEpisodeState || '1', '1');
  const activeEpisodeObj = episodes.find(ep => {
    const epCleanNum = extractCleanEpisodeNumber(ep.name || ep.number);
    return epCleanNum === cleanEpState || String(ep.name) === String(activeEpisodeState);
  }) || episodes[0];
  const activeStreamUrl = activeEpisodeObj?.url || activeEpisodeObj?.m3u8Url || currentMovie?.m3u8Url || 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
  const currentEpName = extractCleanEpisodeNumber(activeEpisodeObj?.name || activeEpisodeObj?.number || cleanEpState, '1');
  const formattedTitle = formatVietnameseSentenceCase(currentMovie?.title || 'Phim mới');
  const isMovie = isFeatureMovie(currentMovie);
  const episodeLabel = isMovie ? 'Full' : formatEpisodeTitle(currentEpName);

  const activeEpIndex = episodes.findIndex(ep => {
    const epNameStr = String(ep.name || ep.number || '');
    const cleanEpName = epNameStr.replace(/^tap-?/i, '');
    return epNameStr === String(currentEpName) || cleanEpName === String(currentEpName).replace(/^tap-?/i, '');
  });

  const prevEpisodeObj = activeEpIndex > 0 ? episodes[activeEpIndex - 1] : null;
  const nextEpisodeObj = activeEpIndex >= 0 && activeEpIndex < episodes.length - 1 ? episodes[activeEpIndex + 1] : null;
  const relatedMovies = useMemo(
    () => getRelatedMovies(allMovies, currentMovie, 10),
    [allMovies, currentMovie]
  );

  // Check saved progress and show resume dialog if user previously stopped mid-video
  useEffect(() => {
    if (currentUser?.username && id) {
      const historyItem = getMovieHistory(currentUser.username, id);
      if (
        historyItem && 
        historyItem.currentTime && 
        historyItem.currentTime > 5 && 
        String(historyItem.episode) === String(currentEpName)
      ) {
        setResumePrompt({
          savedTime: historyItem.currentTime,
          formattedTime: formatDurationToMinutesSeconds(historyItem.currentTime)
        });
      } else {
        setResumePrompt(null);
      }
    }
  }, [currentUser?.username, id, currentEpName]);

  // Initial history recording when entering watch page
  useEffect(() => {
    if (currentUser?.username && currentMovie && currentMovie.id) {
      recordWatchHistory(currentUser.username, currentMovie, currentEpName);
    }
  }, [currentUser?.username, currentMovie, currentEpName]);

  // Throttled playback position tracking
  const handleTimeUpdate = useCallback((currentTime, duration) => {
    if (!currentUser?.username || !id) return;
    
    // Save to DB every 2.5 seconds or when currentTime progresses noticeably
    if (Math.abs(currentTime - lastSavedTimeRef.current) >= 2.5) {
      lastSavedTimeRef.current = currentTime;
      updateWatchPlaybackPosition(currentUser.username, id, currentEpName, currentTime, duration);
    }
  }, [currentUser?.username, id, currentEpName]);

  // Telemetry Heartbeat / Events
  const handleVideoPlay = () => {
    if (currentMovie?.id) {
      trackEvent({
        movieId: currentMovie.id,
        actionType: 'play',
        userId: currentUser?.username || 'anonymous'
      });
    }
  };

  const handleVideoPause = () => {
    if (currentMovie?.id) {
      trackEvent({
        movieId: currentMovie.id,
        actionType: 'pause',
        userId: currentUser?.username || 'anonymous'
      });
    }
  };

  // Track pause/exit when component unmounts
  useEffect(() => {
    return () => {
      if (lastSavedTimeRef.current > 0) {
        trackEvent({
          userId: currentUser?.username || 'anonymous',
          movieId: id,
          actionType: 'pause',
          watchTime: lastSavedTimeRef.current,
          videoQuality: currentMovie?.quality || '1080p'
        });
      }
    };
  }, [id, currentUser?.username, currentMovie]);


  // Action: Resume from saved position
  const handleResumeWatching = () => {
    if (resumePrompt && playerRef.current) {
      playerRef.current.seekTo(resumePrompt.savedTime);
      playerRef.current.play();
    }
    setResumePrompt(null);
  };

  // Action: Restart from beginning (0s)
  const handleRestartFromBeginning = () => {
    setResumePrompt(null);
    if (currentUser?.username && id) {
      updateWatchPlaybackPosition(currentUser.username, id, currentEpName, 0);
    }
    if (playerRef.current) {
      playerRef.current.seekTo(0);
      playerRef.current.play();
    }
  };


  const handleToggleFavorite = async () => {
    if (!currentMovie?.id) return;
    const username = currentUser?.username || 'anonymous';
    const res = await toggleMovieLike(currentMovie.id, username);
    setIsFavorite(res.is_liked);
  };

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleSelectEpisode = (epNum) => {
    const cleanNum = String(epNum).replace(/^tap-?/i, '');
    setActiveEpisodeState(cleanNum);
    const movieSlug = generateSlug(currentMovie?.title || '') || targetSlug;
    const serverSuffix = movieServers && movieServers.length > 1 ? `?server=${encodeURIComponent(resolvedServerName)}` : '';
    navigate(`/movie/${movieSlug}/tap-${cleanNum}${serverSuffix}`);
  };

  if (isLoading || !currentMovie) {
    return (
      <div className="min-h-screen bg-background text-white flex flex-col justify-center items-center space-y-4">
        <div className="w-12 h-12 rounded-full border-4 border-neon-red border-t-transparent animate-spin"></div>
        <p className="text-xs text-gray-400 font-bold">Đang nạp luồng phát video...</p>
      </div>
    );
  }

  const {
    id: activeId,
    originalTitle,
    poster,
    banner,
    description,
    imdb,
    duration,
    quality = '4K UltraHD',
    year = '2024'
  } = currentMovie;

  const movieSlug = generateSlug(currentMovie?.title || '') || activeId;

  return (
    <div className="min-h-screen bg-background text-white pb-20">
      <main className="pt-20 px-4 md:px-8 max-w-7xl mx-auto space-y-5">
        {/* Breadcrumb Navigation */}
        <div className="flex items-center space-x-2 text-sm text-gray-400">
          <Link to="/" className="hover:text-neon-red transition-colors">Trang chủ</Link>
          <span>/</span>
          <Link to={`/movie/${movieSlug}`} className="hover:text-neon-cyan transition-colors">{formattedTitle}</Link>
          <span>/</span>
          <span className="text-amber-400 font-bold">{episodeLabel}</span>
        </div>

        {/* 2-Column AnimeVietsub Layout: Left = Player + Info + Episodes, Right = Related Movies */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-8 space-y-5 min-w-0">

        {/* Resume Watching Prompt Dialog Overlay */}
        {resumePrompt && (
          <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-[#1b223d] to-[#161c36] border border-amber-400/40 shadow-[0_0_30px_rgba(245,158,11,0.25)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-scaleUp">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-amber-400/20 border border-amber-400/40 flex items-center justify-center text-xl flex-shrink-0">
                ⏱️
              </div>
              <div>
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>Tiếp tục xem phim?</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-amber-400 text-black font-black">
                    {resumePrompt.formattedTime}
                  </span>
                </h4>
                <p className="text-xs text-gray-300 mt-0.5">
                  Bạn đã xem đến <strong className="text-amber-300">{resumePrompt.formattedTime}</strong> ở {episodeLabel}. Bạn có muốn tiếp tục xem không?
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 w-full sm:w-auto">
              <button
                type="button"
                onClick={handleResumeWatching}
                className="flex-1 sm:flex-none px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400 text-black font-black text-xs shadow-md transition-all cursor-pointer flex items-center justify-center gap-1.5 hover:scale-105"
              >
                <span>Tiếp tục xem</span>
                <span>▶</span>
              </button>
              <button
                type="button"
                onClick={handleRestartFromBeginning}
                className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-gray-300 hover:text-white text-xs font-bold transition-all cursor-pointer"
              >
                Xem từ đầu (0:00)
              </button>
              <button
                type="button"
                onClick={() => setResumePrompt(null)}
                className="p-2 rounded-xl text-gray-400 hover:text-white hover:bg-white/10 text-xs transition-all cursor-pointer"
                title="Đóng thông báo"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Video Player Container */}
        <div className="w-full bg-surface-card rounded-2xl overflow-hidden border border-glass-border shadow-2xl">
          <VideoPlayer 
            key={`${activeId}-${currentEpName}-${activeStreamUrl}`}
            ref={playerRef}
            url={activeStreamUrl}
            title={`${formattedTitle} - ${episodeLabel} (${quality})`}
            poster={banner || poster}
            onTimeUpdate={handleTimeUpdate}
            onPlay={handleVideoPlay}
            onPause={handleVideoPause}
            hasPrevEpisode={!isMovie && Boolean(prevEpisodeObj)}
            hasNextEpisode={!isMovie && Boolean(nextEpisodeObj)}
            onPrevEpisode={() => {
              if (prevEpisodeObj) {
                const epNum = extractCleanEpisodeNumber(prevEpisodeObj.name || prevEpisodeObj.number, activeEpIndex);
                handleSelectEpisode(epNum);
              }
            }}
            onNextEpisode={() => {
              if (nextEpisodeObj) {
                const epNum = extractCleanEpisodeNumber(nextEpisodeObj.name || nextEpisodeObj.number, activeEpIndex + 2);
                handleSelectEpisode(epNum);
              }
            }}
          />
        </div>

        {/* Series episode selection (Max 100 per range). Movies have one full stream. */}
        {!isMovie && <div className="p-6 rounded-2xl glass-panel space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span className="w-1.5 h-4 bg-red-600 rounded-full"></span>
              <span>Danh Sách Chọn Tập Phim</span>
              <span className="text-xs text-amber-400 font-extrabold px-2.5 py-0.5 rounded-full bg-amber-400/15 border border-amber-400/30">
                {episodes.length} Tập
              </span>
            </h3>
            <span className="text-xs text-neon-cyan font-semibold">Click tập bất kỳ để chuyển luồng phát ngay lập tức</span>
          </div>

          <EpisodeSelector
            episodes={episodes}
            servers={movieServers || []}
            activeServerName={resolvedServerName}
            onSelectServer={(name) => {
              setActiveServerName(name);
              const nextParams = new URLSearchParams(searchParams);
              nextParams.set('server', name);
              setSearchParams(nextParams, { replace: true });
            }}
            activeEpisode={currentEpName}
            onSelectEpisode={(epNum) => handleSelectEpisode(epNum)}
          />
        </div>}

        {/* Movie information, description and actions */}
        <div className="relative overflow-hidden p-5 sm:p-6 rounded-2xl glass-panel space-y-5">
          {(banner || poster) && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-15 blur-sm scale-105"
              style={{ backgroundImage: `url(${banner || poster})` }}
            />
          )}
          <div className="relative flex flex-col sm:flex-row items-start gap-5">
            {(poster || banner) && (
              <img
                src={poster || banner}
                alt={formattedTitle}
                className="w-28 sm:w-36 aspect-[2/3] rounded-xl object-cover border border-white/15 shadow-xl shrink-0"
              />
            )}
            <div className="min-w-0 flex-1 w-full space-y-2.5">
              <h1 className="text-xl sm:text-2xl font-black text-amber-400 leading-snug break-words flex flex-wrap items-center gap-2.5">
                <span>{formattedTitle} ({year})</span>
                <span className="inline-flex shrink-0 items-center justify-center whitespace-nowrap px-2.5 py-1 leading-none rounded-lg text-xs font-black bg-neon-red text-white shadow-[0_0_10px_rgba(229,9,20,0.5)]">
                  {episodeLabel}
                </span>
              </h1>
              <p className="text-gray-300 text-xs sm:text-sm font-medium break-words">
                {originalTitle ? `${originalTitle} • ` : ''}Nguồn: KKPhim Luồng M3U8 Trực Tiếp • {quality}
              </p>
              <p className="text-gray-200/90 text-sm leading-relaxed break-words">
                {description ? String(description).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : 'Chưa có mô tả nội dung cho phim này.'}
              </p>
              <div className="pt-1 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-gray-300 font-semibold">
                {imdb && Number(imdb) > 0 && (
                  <span className="inline-flex items-center gap-1 text-amber-300">
                    <span>★</span>
                    <span>IMDb {imdb}/10</span>
                  </span>
                )}
                {duration && <span>⏱ {duration}</span>}
                <span>📅 {year}</span>
                <span>👁 {viewsCount.toLocaleString()} Lượt Xem</span>
              </div>
            </div>
          </div>

          <div className="relative pt-4 border-t border-white/10 flex flex-wrap items-center gap-3">
            {/* UI Nút Lượt xem: hiển thị số Lượt xem đồng bộ toàn cầu (bắt đầu từ 0) */}
            <div 
              title={`Tổng lượt xem toàn cầu: ${viewsCount.toLocaleString()} lượt`}
              className="h-10 px-3 rounded-full bg-surface-card text-neon-cyan border border-glass-border flex items-center gap-1.5 shadow-sm text-xs font-bold select-none cursor-default"
            >
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
              </svg>
              <span>{viewsCount.toLocaleString()}</span>
            </div>

            {/* Nút Yêu thích */}
            <button 
              type="button"
              onClick={handleToggleFavorite}
              title={isFavorite ? 'Đã yêu thích' : 'Thêm vào yêu thích'}
              className={`w-10 h-10 rounded-full flex items-center justify-center border transition-all duration-300 cursor-pointer ${
                isFavorite 
                  ? 'bg-neon-red text-white border-neon-red shadow-[0_0_15px_#e50914] scale-105' 
                  : 'bg-surface-card text-gray-300 hover:text-white border-glass-border hover:border-neon-red/50 hover:bg-neon-red/20'
              }`}
            >
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
              </svg>
            </button>

            {/* Nút Bình luận dẫn về trang chi tiết bình luận của phim */}
            <a
              href="#comments-section"
              className="h-10 px-3.5 rounded-full bg-surface-card text-gray-300 hover:text-white border border-glass-border flex items-center gap-1.5 shadow-sm text-xs font-semibold transition-all hover:bg-white/10"
              title="Xem bình luận & đánh giá"
            >
              <svg className="w-4 h-4 fill-current text-neon-cyan" viewBox="0 0 24 24">
                <path d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18zM18 14H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/>
              </svg>
              <span>Bình luận</span>
            </a>

            {/* Nút Chia sẻ link phim */}
            <button 
              type="button"
              onClick={handleShare}
              title="Sao chép liên kết tập phim"
              className="relative h-10 px-3.5 rounded-full bg-surface-card text-gray-300 hover:text-white border border-glass-border flex items-center gap-1.5 shadow-sm text-xs font-semibold transition-all hover:bg-white/10 cursor-pointer"
            >
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z"/>
              </svg>
              <span>{copied ? 'Đã sao chép!' : 'Chia sẻ'}</span>
              {copied && (
                <span className="absolute -top-9 left-1/2 transform -translate-x-1/2 px-2 py-0.5 bg-neon-cyan text-black font-extrabold text-[10px] rounded whitespace-nowrap shadow-lg">
                  Đã copy!
                </span>
              )}
            </button>
          </div>
        </div>
        <MovieComments movieId={String(activeId)} />
          </div>

          {/* Right Column: Phim Liên Quan */}
          <aside className="lg:col-span-4 space-y-4">
            <RelatedMoviesSidebar movies={relatedMovies} />
          </aside>
        </div>
      </main>
    </div>
  );
};

export default WatchPage;
