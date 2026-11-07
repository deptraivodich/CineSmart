const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
const text = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const stopWords = new Set([
  'goi', 'cho', 'toi', 'mot', 'nhung', 'cac', 'trong', 'kho', 'phim', 'anime',
  'xem', 'hay', 'noi', 'ngan', 'gon', 'ban', 'the', 'loai', 'cua', 'nao',
  'duoc', 'tim', 'muon', 'giup', 'minh', 'theo', 'yeu', 'cau', 'rat', 'hom', 'nay',
]);

function genres(movie) {
  const values = Array.isArray(movie.genres) ? movie.genres : [movie.genres || movie.category || ''];
  return values.flatMap(value => String(value).split(',')).map(value => value.trim().slice(0, 60)).filter(Boolean).slice(0, 8);
}

export function buildChatContext(message, movies, history = [], username = '') {
  movies = Array.isArray(movies) ? movies : [];
  const words = normalize(message).split(/\W+/).filter(word => word.length > 2 && !stopWords.has(word));
  const watched = new Set();
  const preferences = new Map();
  for (const item of Array.isArray(history) ? history : []) {
    if (!username || !item || item.username !== username) continue;
    watched.add(String(item.movieId));
    const movie = movies.find(candidate => candidate && String(candidate.id) === String(item.movieId));
    for (const genre of genres(movie || item)) {
      const key = normalize(genre);
      preferences.set(key, (preferences.get(key) || 0) + 1);
    }
  }
  const candidates = movies.filter(movie => movie && typeof movie.title === 'string').map(movie => {
    const tags = genres(movie);
    const title = normalize(`${movie.title} ${movie.originalTitle || ''}`);
    const categories = normalize(tags.join(' '));
    const matches = words.reduce((score, word) => score + (title.includes(word) ? 4 : 0) + (categories.includes(word) ? 2 : 0), 0);
    const preference = tags.reduce((score, genre) => score + (preferences.get(normalize(genre)) || 0), 0);
    return { movie, tags, matches, preference, watched: watched.has(String(movie.id)) };
  });
  candidates.sort((a, b) =>
    b.matches - a.matches ||
    b.preference - a.preference ||
    Number(a.watched) - Number(b.watched) ||
    (Number.parseFloat(b.movie.imdb) || 0) - (Number.parseFloat(a.movie.imdb) || 0)
  );
  return {
    message: text(message, 1500),
    available_movies: candidates.slice(0, 15).map(({ movie, tags }) => ({
      title: text(movie.title, 160), originalTitle: text(movie.originalTitle, 160),
      genres: tags, year: String(movie.year || '').slice(0, 4),
      imdb: String(movie.imdb || '').slice(0, 8), description: text(movie.description, 200),
    })),
  };
}

export function catalogReply(message, movies) {
  if (!movies.length) return 'Kho phim chưa được tải. Bạn hãy mở danh sách phim rồi thử tìm theo tên hoặc thể loại nhé.';
  const suggestions = movies.slice(0, 3).map(movie => {
    const detail = [movie.year, ...movie.genres.slice(0, 2)].filter(Boolean).join(' · ');
    return `• ${movie.title}${detail ? ` (${detail})` : ''}`;
  });
  return `Gợi ý từ kho phim cho yêu cầu “${text(message, 100)}”\n\n${suggestions.join('\n')}\n\nBạn có thể tìm các tên phim này bằng ô tìm kiếm trên trang.`;
}
