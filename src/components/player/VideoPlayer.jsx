import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import Artplayer from 'artplayer';
import Hls from 'hls.js';

/**
 * Phase 2: VideoPlayer Component (Artplayer + Hls.js)
 * High-performance .m3u8 stream player for KKPhim streaming sources.
 * Features:
 * - Hls.js stream decoding & binding to Artplayer
 * - Auto Quality selector menu (720p, 1080p, Auto) from Hls levels
 * - Custom controls: Seek -10s and Seek +10s (SVG icons)
 * - Neon Red theme (#e50914)
 * - Exposes play(), pause(), seek() via useImperativeHandle
 */
const VideoPlayer = forwardRef(({ 
  url, 
  poster, 
  title = "KKPhim Stream", 
  autoPlay = false,
  onTimeUpdate,
  onPlay,
  onPause,
  hasPrevEpisode = false,
  hasNextEpisode = false,
  onPrevEpisode,
  onNextEpisode,
  className = "" 
}, ref) => {
  const artRef = useRef(null);
  const artInstanceRef = useRef(null);
  const hlsInstanceRef = useRef(null);
  const epActionsRef = useRef({ hasPrevEpisode, hasNextEpisode, onPrevEpisode, onNextEpisode });

  useEffect(() => {
    epActionsRef.current = { hasPrevEpisode, hasNextEpisode, onPrevEpisode, onNextEpisode };
  }, [hasPrevEpisode, hasNextEpisode, onPrevEpisode, onNextEpisode]);

  // Expose imperative handle methods for parent components
  useImperativeHandle(ref, () => ({
    play: () => {
      if (artInstanceRef.current) artInstanceRef.current.play();
    },
    pause: () => {
      if (artInstanceRef.current) artInstanceRef.current.pause();
    },
    seek: (seconds) => {
      if (artInstanceRef.current) {
        const currentTime = artInstanceRef.current.currentTime;
        artInstanceRef.current.currentTime = Math.max(0, currentTime + seconds);
      }
    },
    seekTo: (timeInSeconds) => {
      if (artInstanceRef.current) {
        artInstanceRef.current.currentTime = Math.max(0, timeInSeconds);
      }
    },
    getCurrentTime: () => {
      return artInstanceRef.current ? artInstanceRef.current.currentTime : 0;
    },
    getDuration: () => {
      return artInstanceRef.current ? artInstanceRef.current.duration : 0;
    },
    getInstance: () => artInstanceRef.current,
  }));

  useEffect(() => {
    if (!artRef.current) return;

    // Clean up previous instances if re-rendering
    if (artInstanceRef.current) {
      artInstanceRef.current.destroy(true);
    }
    if (hlsInstanceRef.current) {
      hlsInstanceRef.current.destroy();
    }

    const isM3U8 = url?.endsWith('.m3u8') || url?.includes('.m3u8');

    // Initialize Artplayer with Neon Red Theme and Custom Controls
    const art = new Artplayer({
      container: artRef.current,
      url: url,
      poster: poster || '',
      title: title,
      type: isM3U8 ? 'm3u8' : 'auto',
      volume: 0.8,
      isLive: false,
      muted: false,
      autoplay: autoPlay,
      pip: true,
      autoSize: false,
      autoMini: false,
      screenshot: true,
      setting: true,
      loop: false,
      flip: true,
      playbackRate: true,
      aspectRatio: true,
      fullscreen: true,
      fullscreenWeb: true,
      subtitleOffset: true,
      miniProgressBar: true,
      mutex: true,
      backdrop: true,
      playsInline: true,
      theme: '#e50914', // Neon red theme accent
      
      // Custom Controls for -10s and +10s
      controls: [
        {
          name: 'rewind-10',
          position: 'left',
          index: 10,
          html: `
            <button class="art-icon !w-auto px-1.5 gap-0.5 whitespace-nowrap flex items-center justify-center text-white hover:text-[#e50914] transition-colors" title="Lùi 10 giây">
              <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.334 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z"/>
              </svg>
              <span class="text-[11px] font-bold leading-none">-10s</span>
            </button>
          `,
          click: function () {
            art.currentTime = Math.max(0, art.currentTime - 10);
          },
        },
        {
          name: 'forward-90',
          position: 'left',
          index: 11,
          html: `
            <button class="art-icon !w-auto px-1.5 gap-0.5 whitespace-nowrap flex items-center justify-center text-white hover:text-[#e50914] transition-colors" title="Tua 1 phút 30 giây (Skip Intro)">
              <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.934 12.8a1 1 0 000-1.6l-5.334-4A1 1 0 005 8v8a1 1 0 001.6.8l5.334-4zM19.934 12.8a1 1 0 000-1.6l-5.334-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.334-4z"/>
              </svg>
              <span class="text-[11px] font-bold leading-none">+1'30s</span>
            </button>
          `,
          click: function () {
            art.currentTime = art.currentTime + 90;
          },
        },
        ...(onPrevEpisode ? [{
          name: 'prev-episode',
          position: 'right',
          index: 1,
          html: `
            <button class="art-icon flex items-center justify-center transition-colors ${hasPrevEpisode ? 'text-white hover:text-[#e50914]' : 'text-white/35 cursor-not-allowed'}" title="Lùi lại tập trước">
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
              </svg>
            </button>
          `,
          click: function () {
            if (epActionsRef.current.hasPrevEpisode && epActionsRef.current.onPrevEpisode) {
              epActionsRef.current.onPrevEpisode();
            }
          },
        }] : []),
        ...(onNextEpisode ? [{
          name: 'next-episode',
          position: 'right',
          index: 2,
          html: `
            <button class="art-icon flex items-center justify-center transition-colors ${hasNextEpisode ? 'text-white hover:text-[#e50914]' : 'text-white/35 cursor-not-allowed'}" title="Qua tập tiếp theo">
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
              </svg>
            </button>
          `,
          click: function () {
            if (epActionsRef.current.hasNextEpisode && epActionsRef.current.onNextEpisode) {
              epActionsRef.current.onNextEpisode();
            }
          },
        }] : []),
      ],

      // Custom Hls.js loader integration
      customType: {
        m3u8: function (video, videoUrl) {
          if (Hls.isSupported()) {
            if (hlsInstanceRef.current) {
              hlsInstanceRef.current.destroy();
            }

            const hls = new Hls({
              enableWorker: true,
              lowLatencyMode: true,
              backBufferLength: 90,
            });

            hls.loadSource(videoUrl);
            hls.attachMedia(video);
            hlsInstanceRef.current = hls;

            // Extract Quality Levels dynamically from m3u8 manifest
            hls.on(Hls.Events.MANIFEST_PARSED, function (event, data) {
              const levels = data.levels;
              if (levels && levels.length > 0) {
                const qualityList = levels.map((level, index) => {
                  const height = level.height || 'Unknown';
                  return {
                    default: index === hls.currentLevel,
                    html: `${height}p`,
                    level: index,
                  };
                });

                // Add 'Auto' quality option
                qualityList.unshift({
                  default: true,
                  html: 'Tự động (Auto)',
                  level: -1,
                });

                // Update Artplayer Quality Setting menu
                art.setting.add({
                  name: 'quality',
                  html: 'Chất lượng',
                  tooltip: 'Tự động',
                  selector: qualityList.map((q) => ({
                    default: q.default,
                    html: q.html,
                    level: q.level,
                  })),
                  onSelect: function (item) {
                    hls.currentLevel = item.level;
                    return item.html;
                  },
                });
              }
            });

            // Error Recovery logic
            hls.on(Hls.Events.ERROR, function (event, data) {
              if (data.fatal) {
                switch (data.type) {
                  case Hls.ErrorTypes.NETWORK_ERROR:
                    console.warn('Hls Network error, attempting recovery...');
                    hls.startLoad();
                    break;
                  case Hls.ErrorTypes.MEDIA_ERROR:
                    console.warn('Hls Media error, attempting recovery...');
                    hls.recoverMediaError();
                    break;
                  default:
                    hls.destroy();
                    break;
                }
              }
            });
          } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            // Safari native HLS playback
            video.src = videoUrl;
          } else {
            art.notice.show = 'Trình duyệt không hỗ trợ phát HLS .m3u8';
          }
        },
      },
    });

    // Hook timeupdate, pause, and ended events to notify parent
    art.on('video:play', () => {
      if (onPlay) {
        onPlay();
      }
    });

    art.on('video:timeupdate', () => {
      if (onTimeUpdate && typeof art.currentTime === 'number') {
        onTimeUpdate(art.currentTime, art.duration || 0);
      }
    });

    art.on('video:pause', () => {
      if (onPause && typeof art.currentTime === 'number') {
        onPause(art.currentTime);
      }
      if (onTimeUpdate && typeof art.currentTime === 'number') {
        onTimeUpdate(art.currentTime, art.duration || 0);
      }
    });

    art.on('video:ended', () => {
      if (onTimeUpdate && typeof art.currentTime === 'number') {
        onTimeUpdate(art.currentTime, art.duration || 0);
      }
    });

    artInstanceRef.current = art;

    // Keyboard '>' or ArrowRight always seeks forward +10s
    const handleKeyDown = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
      if (e.key === '>' || e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        art.currentTime = art.currentTime + 10;
      }
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      if (artInstanceRef.current && artInstanceRef.current.destroy) {
        artInstanceRef.current.destroy(true);
      }
      if (hlsInstanceRef.current) {
        hlsInstanceRef.current.destroy();
      }
    };
  }, [url, poster, autoPlay]);

  return (
    <div className={`relative w-full aspect-video rounded-2xl overflow-hidden shadow-2xl bg-black border border-glass-border ${className}`}>
      {/* Player Container */}
      <div ref={artRef} className="w-full h-full"></div>
    </div>
  );
});

VideoPlayer.displayName = 'VideoPlayer';

export default VideoPlayer;
