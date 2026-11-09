import { deduplicateEpisodes } from './textUtils.js';
import { legacyMovieMetadata } from '../data/legacyMovieMetadata.js';

export function durationMinutes(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  const text = String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const clock = text.match(/^(\d+):([0-5]?\d):([0-5]?\d)$/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]) + Number(clock[3]) / 60 || null;
  const units = text.match(/^(?:(\d+(?:[.,]\d+)?)\s*(?:gio|hours?|h)\s*)?(?:(\d+(?:[.,]\d+)?)\s*(?:phut|minutes?|min|m)?\s*)?(?:\/(?:tap|episode|ep))?$/);
  if (!units || (!units[1] && !units[2])) return null;
  const minutes = Number((units[1] || '0').replace(',', '.')) * 60 + Number((units[2] || '0').replace(',', '.'));
  return minutes > 0 ? minutes : null;
}

export function isFeatureMovie(movie) {
  if (!movie || Number(movie.totalEpisodes) > 1) return false;
  const count = Array.isArray(movie.episodes) && movie.episodes.length
    ? deduplicateEpisodes(movie.episodes).length
    : movie.m3u8Url ? 1 : 0;
  return count === 1 && durationMinutes(movie.duration || movie.time) > 60;
}

// Derive the display category for old and new records without writing to Firestore.
export function withMovieFormat(movie) {
  if (!movie) return movie;
  const legacy = legacyMovieMetadata[movie.sourceSlug];
  const currentDuration = movie.duration || movie.time;
  const duration = durationMinutes(currentDuration) ? currentDuration : legacy?.duration;
  const enriched = {
    ...movie,
    ...(duration ? { duration } : {}),
    ...(!movie.totalEpisodes && legacy?.totalEpisodes ? { totalEpisodes: legacy.totalEpisodes } : {}),
  };
  if (!isFeatureMovie(enriched)) return enriched;
  const genres = Array.isArray(movie.genres) ? movie.genres : String(movie.genres || movie.category || '').split(',').map(s => s.trim()).filter(Boolean);
  const tags = genres.some(g => g.toLowerCase() === 'movie') ? genres : [...genres, 'Movie'];
  return { ...enriched, format: 'Movie', genres: tags, category: tags.join(', ') };
}
