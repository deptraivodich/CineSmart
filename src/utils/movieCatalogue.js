export function uniqueMovies(movies) {
  const entries = (Array.isArray(movies) ? movies : [])
    .filter(movie => movie && typeof movie.title === 'string' && movie.title.trim())
    .map(movie => [String(movie.id || `${movie.title.trim().toLowerCase()}|${movie.year || ''}`), movie]);
  return [...new Map(entries).values()];
}
