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

export function getRelatedMovies(allMovies, currentMovie, limit = 10) {
  if (!currentMovie || !Array.isArray(allMovies) || allMovies.length === 0) return [];
  const currentId = String(currentMovie.id);
  const currentTitle = currentMovie.title || '';
  const parseGenres = g => Array.isArray(g)
    ? g.map(x => String(x).trim().toLowerCase()).filter(Boolean)
    : String(g || '').split(/[,;/|]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
  const currentGenres = parseGenres(currentMovie.genres);

  const getCleanRootTitle = t => {
    if (!t) return '';
    return String(t)
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd')
      .replace(/[([]?(?:phan|season|ss|part|tap|movie|ova)[\s\d:–-]+[)\]]?/gi, '')
      .replace(/\([^)]*\)|\[[^\]]*\]/g, '')
      .replace(/\s+\d+$/, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .trim();
  };

  const currentRoot = getCleanRootTitle(currentTitle);
  const candidateMovies = allMovies.filter(m => m && String(m.id) !== currentId);
  const priority1 = [];
  const addedIds = new Set();

  if (currentRoot.length >= 3) {
    for (const m of candidateMovies) {
      const otherRoot = getCleanRootTitle(m.title || '');
      if (otherRoot.length >= 3 && (otherRoot === currentRoot || otherRoot.startsWith(currentRoot) || currentRoot.startsWith(otherRoot) || otherRoot.includes(currentRoot) || currentRoot.includes(otherRoot))) {
        priority1.push(m);
        addedIds.add(String(m.id));
      }
    }
  }

  const priority2Candidates = [];
  if (priority1.length < limit) {
    for (const m of candidateMovies) {
      if (addedIds.has(String(m.id))) continue;
      const mGenres = parseGenres(m.genres);
      const matchCount = mGenres.filter(g => currentGenres.includes(g)).length;
      if (matchCount > 0) priority2Candidates.push({ movie: m, matchCount });
    }
    priority2Candidates.sort((a, b) => b.matchCount - a.matchCount);
  }

  const priority2 = priority2Candidates.map(c => {
    addedIds.add(String(c.movie.id));
    return c.movie;
  });

  const combined = [...priority1, ...priority2];
  if (combined.length < limit) {
    for (const m of candidateMovies) {
      if (!addedIds.has(String(m.id))) {
        combined.push(m);
        addedIds.add(String(m.id));
        if (combined.length >= limit) break;
      }
    }
  }
  return combined.slice(0, limit);
}
