import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatVietnameseSentenceCase } from '../../utils/textUtils';
import { isFeatureMovie } from '../../utils/movieFormat.js';
import { generateSlug } from '../../utils/slugUtils';
import { trackEvent } from '../../services/telemetryService';

/**
 * MovieCard Component - Responsive Grid Sizing & Smooth Scale-In Hover Popup
 * 1. Default layoutMode: 'grid' (w-full h-full), supports 'carousel' (w-44 sm:w-52 md:w-60 flex-shrink-0)
 * 2. Aspect Ratio: aspect-[2/3] for standard movie poster scale
 * 3. Responsive Popup Width: w-[220px] sm:w-[260px] md:w-[300px] lg:w-[340px] (no hardcoded overflow widths)
 * 4. Smooth Scale: scale-90 opacity-0 invisible -> group-hover:scale-100 group-hover:opacity-100 group-hover:visible
 * 5. Smart Positioning: isFirst (origin-left), isLast (origin-right), center (origin-center)
 */
const MovieCard = ({
  movie,
  isLoading = false,
  layoutMode = 'grid',
  isFirst = false,
  isLast = false,
  showHoverPopup = true,
  tabIndex
}) => {
  const [imgError, setImgError] = useState(false);

  if (isLoading) {
    return (
      <div className={`${layoutMode === 'carousel' ? 'w-44 sm:w-52 md:w-60 flex-shrink-0' : 'w-full h-full'} space-y-2`}>
        <div className="aspect-[2/3] w-full rounded-lg bg-white/5 animate-skeleton border border-white/5"></div>
        <div className="h-4 w-3/4 bg-white/5 rounded animate-skeleton"></div>
      </div>
    );
  }

  const {
    id = '1',
    title = 'Phim mới',
    originalTitle = '',
    poster = 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600&auto=format&fit=crop&q=80',
    banner = '',
    imdb = '8.0',
    year = '2024',
    ageRating = 'T16',
    season = 'Phần 1',
    episodesStatus = 'Tập hoàn tất',
    genres = ['Anime', 'Hành động'],
    pdBadge = '',
    tmBadge = ''
  } = movie || {};

  const coverImage = banner || poster;
  const formattedTitle = formatVietnameseSentenceCase(title);
  const movieSlug = generateSlug(title) || id;

  // Dynamic positioning class based on isFirst / isLast props to prevent edge clipping
  const popupPositionClass = isFirst
    ? 'left-0 translate-x-0 origin-left'
    : isLast
      ? 'right-0 left-auto translate-x-0 origin-right'
      : 'left-1/2 -translate-x-1/2 origin-center';

  const handleTrackClick = () => {
    trackEvent({
      movieId: id,
      actionType: 'click'
    });
  };

  return (
    <div className={`relative cursor-pointer group select-none block transition-transform duration-300 hover:scale-105 ${showHoverPopup ? 'hover:z-50' : ''} ${layoutMode === 'carousel' ? 'w-44 sm:w-52 md:w-60 flex-shrink-0' : 'w-full h-full'}`}>

      {/* 1. NORMAL CARD VIEW */}
      <div className="w-full h-full space-y-2">
        <Link to={`/movie/${movieSlug}`} tabIndex={tabIndex} onClick={handleTrackClick} draggable="false" className="block relative w-full aspect-[2/3] rounded-lg overflow-hidden bg-[#1a1e30] border border-white/10 shadow-md">
          <img
            src={poster}
            alt={formattedTitle}
            loading="lazy"
            draggable="false"
            onError={(e) => { e.target.src = 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600'; }}
            className="aspect-[2/3] w-full h-full object-cover rounded-lg shadow-md pointer-events-none"
          />
          {/* Bottom Badges on Image */}
          <div className="absolute bottom-2 left-2 flex items-center space-x-1.5 z-10">
            {pdBadge && (
              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#343a57]/90 text-gray-200 backdrop-blur-md border border-white/10">
                {pdBadge}
              </span>
            )}
            {tmBadge && (
              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-600/90 text-white shadow-sm">
                {tmBadge}
              </span>
            )}
          </div>
        </Link>

        {/* Normal Card Text */}
        <div className="px-0.5">
          <h3 className="text-xs sm:text-sm font-bold text-white truncate leading-snug">
            {formattedTitle}
          </h3>
          {originalTitle && (
            <p className="text-[11px] text-gray-400 truncate mt-0.5">
              {originalTitle}
            </p>
          )}
        </div>
      </div>

      {/* 2. HOVER EXPANDED POPUP CARD - Responsive Width & Smooth Scale-In */}
      {showHoverPopup && (
        <div className={`absolute top-1/2 -translate-y-1/2 ${popupPositionClass} w-[220px] sm:w-[260px] md:w-[300px] lg:w-[340px] scale-90 opacity-0 invisible group-hover:scale-100 group-hover:opacity-100 group-hover:visible pointer-events-none group-hover:pointer-events-auto transition-all duration-300 ease-out rounded-xl bg-[#14151a] border border-[#2a2d3a] shadow-[0_20px_50px_rgba(0,0,0,0.95)] overflow-hidden z-50 text-white`}>

          {/* Top Banner Image (16:9) & Gradient */}
          <div className="relative w-full aspect-video bg-[#1a1e30] overflow-hidden rounded-t-xl">
            {!imgError ? (
              <img
                src={coverImage}
                alt={formattedTitle}
                onError={() => setImgError(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-[#1a1e30] text-gray-500 text-xs font-medium">
                Không có ảnh bìa
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-[#14151a] via-[#14151a]/50 to-transparent"></div>
          </div>

          {/* Details & Action Controls Section */}
          <div className="relative px-3.5 pb-3.5 -mt-6 sm:-mt-8">

            <h3 className="text-white font-black text-sm sm:text-base truncate drop-shadow-lg">
              {formattedTitle}
            </h3>
            {originalTitle && (
              <p className="text-amber-400 text-[11px] sm:text-xs mb-2.5 sm:mb-3 truncate drop-shadow-md font-medium">
                {originalTitle}
              </p>
            )}

            <div className="flex items-center gap-1.5 sm:gap-2 mb-2.5 sm:mb-3.5 w-full">
              <Link
                to={`/movie/${movieSlug}/tap-1`}
                onClick={handleTrackClick}
                className="flex-1 bg-[#ffce45] text-black font-extrabold py-1.5 px-2.5 rounded-lg hover:bg-amber-300 transition-colors flex justify-center items-center gap-1 shadow-md text-xs"
              >
                <svg className="w-3.5 h-3.5 fill-current flex-shrink-0" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                <span>Xem ngay</span>
              </Link>

              <button
                type="button"
                className="border border-gray-600 bg-[#2a2d3a]/60 text-white py-1.5 px-2.5 rounded-lg hover:bg-gray-700 transition-colors flex items-center gap-1 whitespace-nowrap font-medium text-xs cursor-pointer"
                title="Thêm vào yêu thích"
              >
                <span className="text-red-400 text-sm leading-none">♥</span> Thích
              </button>

              <Link
                to={`/movie/${movieSlug}`}
                onClick={handleTrackClick}
                className="border border-gray-600 bg-[#2a2d3a]/60 text-white py-1.5 px-2.5 rounded-lg hover:bg-gray-700 transition-colors flex items-center gap-1 whitespace-nowrap font-medium text-xs cursor-pointer"
                title="Xem chi tiết phim"
              >
                <span className="text-gray-300 text-xs leading-none">ℹ</span> Chi tiết
              </Link>
            </div>

            {/* Metadata Badges Row */}
            <div className="flex flex-wrap items-center gap-1 sm:gap-1.5 mb-2 text-[9px] sm:text-[10px] font-semibold">
              <span className="px-1.5 py-0.5 rounded border border-amber-400/80 text-amber-400 bg-amber-400/10">
                ★ {imdb} IMDb
              </span>
              <span className="px-1.5 py-0.5 rounded border border-gray-500 bg-gray-800 text-gray-200">
                {ageRating}
              </span>
              <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-300">
                {year}
              </span>
              <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-300">
                {isFeatureMovie(movie) ? 'Movie' : season}
              </span>
              <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-300">
                {isFeatureMovie(movie) ? 'Full' : episodesStatus}
              </span>
            </div>

            {/* Genres Footer Text Row */}
            <div className="text-[9px] sm:text-[10px] text-gray-400 font-medium truncate">
              {Array.isArray(genres) ? genres.join(' • ') : genres}
            </div>

          </div>
        </div>
      )}
    </div>
  );
};

export default MovieCard;