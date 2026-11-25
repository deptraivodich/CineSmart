import React from 'react';
import { Link } from 'react-router-dom';
import { generateSlug } from '../../utils/slugUtils';
import { formatVietnameseSentenceCase } from '../../utils/textUtils';

const RelatedMoviesSidebar = ({ movies = [], className = '' }) => (
  <div className={`p-5 rounded-2xl bg-surface-card/90 border border-glass-border backdrop-blur-md space-y-4 ${className}`}>
    <h3 className="text-base font-extrabold text-white flex items-center justify-between">
      <span className="flex items-center gap-2">
        <span className="text-neon-red">🎬</span> Phim liên quan
      </span>
      <span className="text-[10px] text-gray-400 font-bold">210LoliPhim</span>
    </h3>

    <div className="space-y-3 max-h-[540px] overflow-y-auto custom-scrollbar pr-1">
      {movies.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-4">Chưa có phim liên quan</p>
      ) : (
        movies.map((rel, idx) => {
          const relSlug = generateSlug(rel.title || '') || rel.id;
          const relTitle = formatVietnameseSentenceCase(rel.title || 'Phim');
          const relImdb = rel.imdb || '8.0';
          const relYear = rel.year || '2024';
          const relGenres = Array.isArray(rel.genres)
            ? rel.genres.slice(0, 2).join(', ')
            : String(rel.genres || rel.category || 'Anime').split(',')[0];

          return (
            <Link
              key={rel.id}
              to={`/movie/${relSlug}`}
              className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 border border-transparent hover:border-white/10 transition-all group"
            >
              <span className={`w-6 text-center text-base font-black italic flex-shrink-0 ${
                idx === 0 ? 'text-amber-400' : idx === 1 ? 'text-gray-300' : idx === 2 ? 'text-amber-600' : 'text-gray-500'
              }`}>
                {idx + 1}
              </span>
              <div className="w-12 h-16 rounded-lg overflow-hidden bg-surface flex-shrink-0 border border-white/10">
                <img
                  src={rel.poster || rel.banner}
                  alt={relTitle}
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                  loading="lazy"
                />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-xs font-bold text-gray-100 group-hover:text-amber-300 truncate transition-colors">
                  {relTitle}
                </h4>
                <div className="flex items-center gap-1.5 text-[10px] text-gray-400 mt-1">
                  <span className="text-amber-400 font-bold">★ {relImdb}</span>
                  <span>•</span>
                  <span>{relYear}</span>
                </div>
                <p className="text-[10px] text-gray-500 truncate mt-0.5">{relGenres}</p>
              </div>
            </Link>
          );
        })
      )}
    </div>
  </div>
);

export default RelatedMoviesSidebar;
