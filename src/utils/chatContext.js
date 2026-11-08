import { uniqueMovies } from './movieCatalogue.js';

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
const text = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const stopWords = new Set([
  'goi', 'cho', 'toi', 'mot', 'nhung', 'cac', 'trong', 'kho', 'phim', 'anime',
  'xem', 'hay', 'noi', 'ngan', 'gon', 'ban', 'the', 'loai', 'cua', 'nao',
  'duoc', 'tim', 'muon', 'giup', 'minh', 'theo', 'yeu', 'cau', 'rat', 'hom', 'nay',
]);

const genreAliases = [
  ['action', 'hanh dong'], ['adventure', 'phieu luu'], ['romance', 'tinh cam', 'lang man'],
  ['comedy', 'hai huoc', 'hai'], ['horror', 'kinh di'], ['mystery', 'bi an', 'trinh tham'],
  ['fantasy', 'gia tuong', 'ky ao'], ['sci-fi', 'sci fi', 'khoa hoc', 'vien tuong', 'khoa hoc vien tuong'],
  ['drama', 'chinh kich'], ['slice of life', 'doi thuong'], ['school', 'hoc duong'],
  ['sports', 'the thao'], ['music', 'am nhac'], ['historical', 'lich su', 'co trang'],
  ['psychological', 'tam ly'], ['supernatural', 'sieu nhien'], ['thriller', 'giat gan'],
  ['animation', 'hoat hinh'], ['shounen'], ['shoujo'], ['seinen'], ['josei'],
  ['mecha'], ['martial arts', 'vo thuat'], ['demons', 'ac quy'], ['magic', 'phep thuat'],
  ['military', 'quan doi'], ['police', 'canh sat'], ['space', 'vu tru'],
  ['super power', 'sieu nang luc'], ['vampire', 'ma ca rong'], ['samurai'],
  ['game', 'tro choi'], ['kids', 'thieu nhi'], ['harem'], ['ecchi'], ['parody'],
  ['suspense'], ['dementia'], ['cartoon'], ['live action'], ['boys love'],
  ['shounen ai'], ['shoujo ai'], ['yaoi'], ['yuri'], ['tokusatsu'],
];

function containsPhrase(value, phrase) {
  return ` ${value} `.includes(` ${phrase} `);
}

function requestedGenres(message) {
  const query = normalize(message).replace(/[^a-z0-9-]+/g, ' ');
  return genreAliases.filter(aliases => aliases.some(alias => containsPhrase(query, alias)));
}

export function chatIntent(message) {
  const query = normalize(message);
  if (/bao nhieu|tong (cong |so )?|so luong|how many/.test(query)) return 'count';
  if (/goi y|de xuat|hop gu|gu phim|the loai|nen xem|xem gi|tim phim|recommend/.test(query)) return 'recommend';
  return 'chat';
}

function genres(movie) {
  const values = Array.isArray(movie.genres) ? movie.genres : [movie.genres || movie.category || ''];
  return values.flatMap(value => String(value).split(',')).map(value => value.trim().slice(0, 60)).filter(Boolean).slice(0, 8);
}

export function buildChatContext(message, movies, history = [], username = '', { rank = true } = {}) {
  movies = uniqueMovies(movies);
  const words = normalize(message).split(/\W+/).filter(word => word.length > 2 && !stopWords.has(word));
  const requested = requestedGenres(message);
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
  const candidates = movies.map(movie => {
    const tags = genres(movie);
    const title = normalize(`${movie.title} ${movie.originalTitle || ''}`);
    const categories = normalize(tags.join(' '));
    const matches = words.reduce((score, word) => score + (title.includes(word) ? 4 : 0) + (categories.includes(word) ? 2 : 0), 0);
    const preference = tags.reduce((score, genre) => score + (preferences.get(normalize(genre)) || 0), 0);
    return { movie, tags, matches, preference, watched: watched.has(String(movie.id)) };
  }).filter(({ tags }) => requested.every(aliases => tags.some(tag => aliases.includes(normalize(tag)))));
  if (rank) candidates.sort((a, b) =>
    b.matches - a.matches ||
    b.preference - a.preference ||
    Number(a.watched) - Number(b.watched) ||
    (Number.parseFloat(b.movie.imdb) || 0) - (Number.parseFloat(a.movie.imdb) || 0)
  );
  return {
    message: text(message, 1500),
    catalog_total: movies.length,
    matching_total: candidates.length,
    available_movies: candidates.slice(0, 15).map(({ movie, tags }) => ({
      title: text(movie.title, 160), originalTitle: text(movie.originalTitle, 160),
      genres: tags, year: String(movie.year || '').slice(0, 4),
      imdb: String(movie.imdb || '').slice(0, 8), description: text(movie.description, 200),
    })),
  };
}

export function catalogReply(message, movies, { catalogTotal = null, cloudTotal = null, matchingTotal = null } = {}) {
  if (chatIntent(message) === 'count') {
    if (requestedGenres(message).length) {
      return Number.isSafeInteger(matchingTotal) && matchingTotal >= 0
        ? `Kho phim đã tải có ${matchingTotal} phim phù hợp với thể loại bạn hỏi.`
        : 'Hiện chưa xác minh được tổng số phim thuộc thể loại này trong kho phim.';
    }
    if (Number.isSafeInteger(cloudTotal) && cloudTotal >= 0) return `Hiện tại cơ sở dữ liệu CineSmart có tổng cộng ${cloudTotal} phim.`;
    if (Number.isSafeInteger(catalogTotal) && catalogTotal >= 0) return `Trình duyệt đã tải ${catalogTotal} phim. Hiện chưa xác minh được tổng số phim trên Cloud.`;
    return 'Hiện chưa xác minh được tổng số phim trong cơ sở dữ liệu. Danh sách tham khảo gửi cho AI chỉ là một phần kho phim.';
  }
  if (!movies.length) return 'Không tìm thấy phim phù hợp trong kho phim đã tải. Bạn hãy thử thể loại khác hoặc tải lại danh sách phim.';
  const suggestions = movies.slice(0, 5).map((movie, index) => {
    const detail = [movie.year, ...movie.genres.slice(0, 2)].filter(Boolean).join(' · ');
    return `${index + 1}. ${movie.title}${detail ? ` (${detail})` : ''}`;
  });
  return `Gợi ý từ kho phim cho yêu cầu “${text(message, 100)}”\n\n${suggestions.join('\n')}\n\nBạn có thể tìm các tên phim này bằng ô tìm kiếm trên trang.`;
}
