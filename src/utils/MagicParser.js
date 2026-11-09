/**
 * Phase 4 & Upgrade: MagicParser Utility
 * Implements 'The Carry-over Algorithm' to parse raw TSV text copied from Excel/Google Sheets
 * for multi-episode series (Phim Bộ) without repeating metadata for each episode row.
 * Fully supports 'Ảnh bìa' (Poster / Banner) column mapping in any column order.
 */

import { formatVietnameseSentenceCase } from './textUtils.js';
export { formatVietnameseSentenceCase };

// Flexible Column Alias Mapping Dictionary
const COLUMN_ALIASES = {
  duration: ['duration', 'time', 'thời lượng', 'thoi luong', 'runtime'],
  totalEpisodes: ['totalepisodes', 'episode_total', 'tổng số tập', 'tong so tap'],
  sourceSlug: ['sourceslug'],
  sourceUpdatedAt: ['sourceupdatedat'],
  episodesStatus: ['episodesstatus'],
  title: ['title', 'tên phim', 'tên', 'name', 'movie_name', 'phim', 'ten phim'],
  originalTitle: ['originaltitle', 'tên gốc', 'ten goc', 'tên tiếng anh', 'original_name', 'english_title'],
  episode: ['tập', 'tap', 'episode', 'ep', 'episodes', 'số tập', 'so tap', 'tập số'],
  videoUrl: ['link video', 'linkvideo', 'link', 'm3u8', 'stream_url', 'url', 'link m3u8', 'm3u8url', 'video_url'],
  poster: ['poster', 'ảnh poster', 'anh poster', 'link poster', 'link ảnh poster', 'poster_url', 'image', 'ảnh đứng'],
  banner: ['banner', 'ảnh bìa', 'anh bia', 'link ảnh bìa', 'link anh bia', 'backdrop', 'cover', 'banner_url', 'ảnh ngang', 'hình nền', 'ảnh'],
  imdb: ['imdb', 'điểm imdb', 'diem imdb', 'điểm', 'score', 'đánh giá'],
  year: ['năm', 'nam', 'year', 'năm phát hành', 'release_year'],
  country: ['quốc gia', 'quoc gia', 'country', 'quốc gia phát hành'],
  director: ['đạo diễn', 'dao dien', 'director', 'đạo diễn phim', 'daodien'],
  status: ['thông tin', 'thong tin', 'status', 'tình trạng', 'tinh trang'],
  episodeCurrent: ['tập hiện tại', 'tap hien tai', 'episode_current', 'tập mới nhất', 'current_episode', 'hien tai', 'taphientai'],
  genres: ['thể loại', 'the loai', 'genres', 'genre', 'danh mục', 'category', 'chuyên mục'],
  ageRating: ['độ tuổi', 'do tuoi', 'agerating', 'tuổi', 'phân loại', 'age', 'rating_age'],
  quality: ['chất lượng', 'chat luong', 'quality', 'định dạng', 'resolution'],
  description: ['mô tả', 'mo ta', 'description', 'nội dung', 'tóm tắt']
};

/**
 * Normalizes a header string by trimming and converting to lowercase for alias matching
 */
const normalizeHeader = (headerStr) => {
  return String(headerStr || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-_/.:]+/g, '');
};

/**
 * Finds matching standard key for a given raw header column name
 */
const getMappedStandardKey = (rawHeader) => {
  const normalized = normalizeHeader(rawHeader);
  
  for (const [standardKey, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (aliases.some(alias => normalizeHeader(alias) === normalized)) {
      return standardKey;
    }
  }
  return null;
};

/**
 * Cleans IMDb rating strings e.g. "8.2 /10" or "8.2/10" -> "8.2"
 */
export const cleanImdbScore = (rawImdb) => {
  if (!rawImdb) return '8.0';
  const str = String(rawImdb).trim();
  const match = str.match(/(\d+(\.\d+)?)/);
  return match ? match[1] : '8.0';
};

/**
 * Splits comma/slash separated genres into a clean array
 */
export const parseGenresArray = (rawGenres) => {
  if (!rawGenres) return ['Action', 'Fantasy'];
  if (Array.isArray(rawGenres)) return rawGenres.filter(Boolean);
  
  return String(rawGenres)
    .split(/[,;/|]+/)
    .map(g => g.trim())
    .filter(Boolean);
};

const DEFAULT_POSTER = 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600&auto=format&fit=crop&q=80';
const DEFAULT_BANNER = 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1200&auto=format&fit=crop&q=80';

/**
 * Main parseTSV function with The Carry-over Algorithm
 * @param {string} rawText - TSV formatted string pasted from Excel
 * @returns {Array<Object>} Array of standardized movie objects with episodes array
 */
export const parseTSV = (rawText) => {
  if (!rawText || typeof rawText !== 'string') {
    return [];
  }

  // Split lines and trim whitespace, preserving tab structure
  const rawLines = rawText.split(/\r?\n/).filter(line => line.trim().length > 0);

  if (rawLines.length < 2) {
    throw new Error('Dữ liệu TSV cần tối thiểu 1 dòng Tiêu đề (Header) và 1 dòng Dữ liệu.');
  }

  // Parse Header row (Row 1)
  const rawHeaders = rawLines[0].split('\t').map(h => h.trim());
  const headerMap = rawHeaders.map(rh => ({
    raw: rh,
    key: getMappedStandardKey(rh)
  }));

  const parsedMovies = [];
  let currentMovie = null;
  let explicitEpisodeCurrent = false;

  // Process data rows from Row 2 onwards
  for (let i = 1; i < rawLines.length; i++) {
    const rowValues = rawLines[i].split('\t').map(val => val.trim());
    const rawObject = {};
    
    // Map each cell value to standard key or keep raw header key
    headerMap.forEach((col, idx) => {
      const val = rowValues[idx] || '';
      if (col.key) {
        rawObject[col.key] = val;
      } else {
        rawObject[col.raw] = val;
      }
    });

    const titleValue = (rawObject.title || '').trim();
    const episodeValue = (rawObject.episode || '').trim();
    const videoUrlValue = (rawObject.videoUrl || rawObject.m3u8Url || '').trim();

    // TRƯỜNG HỢP 1: Có Tên Phim -> Khởi tạo một Movie mới
    if (titleValue) {
      const genresArray = parseGenresArray(rawObject.genres || rawObject.category);
      const epName = episodeValue || '1';
      const epUrl = videoUrlValue;

      // Extract custom poster & banner from 'Ảnh bìa' or 'Poster'
      const customImage = (rawObject.banner || rawObject.poster || '').trim();
      const posterUrl = rawObject.poster || customImage || DEFAULT_POSTER;
      const bannerUrl = (rawObject.banner || customImage) || DEFAULT_BANNER;

      const movieData = {
        title: formatVietnameseSentenceCase(titleValue),
        originalTitle: (rawObject.originalTitle || '').trim(),
        imdb: cleanImdbScore(rawObject.imdb),
        year: (rawObject.year || new Date().getFullYear().toString()).trim(),
        country: (rawObject.country || '').trim(),
        director: (rawObject.director || 'Đang cập nhật').trim(),
        genres: genresArray.length > 0 ? genresArray : ['Action', 'Fantasy'],
        category: genresArray.length > 0 ? genresArray.join(', ') : 'Action, Fantasy',
        duration: (rawObject.duration || '').trim(),
        totalEpisodes: (rawObject.totalEpisodes || '').trim(),
        quality: (rawObject.quality || '4K UltraHD').trim(),
        ageRating: (rawObject.ageRating || '16+').trim(),
        poster: posterUrl,
        banner: bannerUrl,
        description: (rawObject.description || '').trim(),
        m3u8Url: epUrl, // First episode URL as default stream
        episodes: epUrl ? [{ name: String(epName), url: epUrl }] : [],
        episodesStatus: (rawObject.episodeCurrent || `Tập ${epName}`).trim(),
        episodeCurrent: (rawObject.episodeCurrent || `Tập ${epName}`).trim(),
        episodesCount: `1 Tập`,
        status: (rawObject.status || 'ongoing').trim(),
        createdAt: new Date().toISOString(),
        // Validation flags for UI
        isValid: Boolean(titleValue && epUrl),
        missingFields: []
      };

      if (!epUrl) movieData.missingFields.push('Link Video Tập 1');

      if (rawObject.sourceSlug) {
        for (const key of ['originalTitle', 'poster', 'banner', 'imdb', 'year', 'country', 'director', 'quality', 'description', 'ageRating', 'duration', 'totalEpisodes', 'sourceSlug', 'sourceUpdatedAt']) {
          movieData[key] = rawObject[key] || '';
        }
        movieData.genres = rawObject.genres ? parseGenresArray(rawObject.genres) : [];
        movieData.category = movieData.genres.join(', ');
        movieData.status = rawObject.status || '';
        movieData.episodeCurrent = rawObject.episodeCurrent || '';
        movieData.episodesStatus = rawObject.episodesStatus || rawObject.episodeCurrent || '';
      }
      explicitEpisodeCurrent = Boolean(rawObject.sourceSlug || rawObject.episodeCurrent || rawObject.episodesStatus);
      currentMovie = movieData;
      parsedMovies.push(movieData);
    } 
    // TRƯỜNG HỢP 2: Trống Tên Phim, nhưng có Tập và Link Video -> Kế thừa (Carry-over) vào currentMovie
    else if ((videoUrlValue || episodeValue) && currentMovie !== null) {
      const epName = episodeValue || String(currentMovie.episodes.length + 1);
      const epUrl = videoUrlValue;

      if (epUrl) {
        // Append episode to currentMovie
        currentMovie.episodes.push({
          name: String(epName),
          url: epUrl
        });

        // Update counts and status dynamically
        currentMovie.episodesCount = `${currentMovie.episodes.length} Tập`;
        if (!explicitEpisodeCurrent) {
          currentMovie.episodesStatus = `Tập ${currentMovie.episodes.length}`;
          currentMovie.episodeCurrent = `Tập ${currentMovie.episodes.length}`;
        }
        
        // Ensure default stream URL is set if it was previously empty
        if (!currentMovie.m3u8Url) {
          currentMovie.m3u8Url = epUrl;
        }

        // Re-evaluate validity
        currentMovie.isValid = Boolean(currentMovie.title && currentMovie.m3u8Url);
        currentMovie.missingFields = currentMovie.missingFields.filter(f => f !== 'Link Video Tập 1');
      }
    }
  }

  return parsedMovies;
};

/**
 * Example template string generator matching User's Excel Series structure with 12 columns standard:
 * Tên Phim | Tên Gốc | Tập | Link Video | Ảnh bìa | Điểm IMDb | Năm | Quốc Gia | Đạo Diễn | Thông Tin | Tập hiện tại | Thể Loại
 */
export const getTSVTemplateExample = () => {
  return `Tên Phim\tTên Gốc\tTập\tLink Video\tẢnh bìa\tĐiểm IMDb\tNăm\tQuốc Gia\tĐạo Diễn\tThông Tin\tTập hiện tại\tThể Loại
Thất Nghiệp Chuyển Sinh (Phần 3)\tMushoku Tensei: Jobless Reincarnation (Season 3)\t1\thttps://v7.kkphimplayer7.com/20260704/17WYGn3j/index.m3u8\thttps://images.unsplash.com/photo-1534447677768-be436bb09401?w=600&auto=format&fit=crop&q=80\t8.2 /10\t2026\tNhật Bản\tHiroki Hirano\tongoing\tTập 5\tFantasy, Ecchi, Drama, Adventure, Magic, Isekai
\t\t2\thttps://v7.kkphimplayer7.com/20260704/hr8ykSk2/index.m3u8\t\t\t\t\t\t\t\t
\t\t3\thttps://v7.kkphimplayer7.com/20260712/IfhlTVwT/index.m3u8\t\t\t\t\t\t\t\t
\t\t4\thttps://v7.kkphimplayer7.com/20260719/QS07vokj/index.m3u8\t\t\t\t\t\t\t\t
\t\t5\thttps://v7.kkphimplayer7.com/20260726/lhxZcA50/index.m3u8\t\t\t\t\t\t\t\t
Dune: Hành Tinh Cát 2\tDune: Part Two\t1\thttps://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8\thttps://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=1200&auto=format&fit=crop&q=80\t8.6\t2024\tMỹ\tDenis Villeneuve\tcompleted\tHoàn Tất (1/1)\tAction, Sci-Fi, Adventure`;
};
