import { normalizePhimApiMovie, findMovie } from '../src/utils/movieImport.js';
import { crawlManualUrl } from '../src/services/phimApiImport.js';
import { generateSlug } from '../src/utils/slugUtils.js';

export async function crawlAdminMovies(body, fetchImpl = fetch) {
  const deadline = AbortSignal.timeout(230000);
  const sourceFetch = (url, options = {}) => {
    const target = new URL(url);
    if (target.origin !== 'https://phimapi.com') throw new Error('Nguồn phim không hợp lệ.');
    return fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.any([deadline, options.signal].filter(Boolean)) });
  };
  const sourceJson = async path => {
    const response = await sourceFetch('https://phimapi.com' + path, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`PhimAPI HTTP ${response.status}`);
    return response.json();
  };
  if (body.operation === 'url') {
    if (typeof body.url !== 'string' || body.url.length > 1000) throw new Error('URL không hợp lệ.');
    return crawlManualUrl(body.url, sourceFetch);
  }
  if (body.operation !== 'batch' || !Array.isArray(body.movies) || !body.movies.length || body.movies.length > 5) {
    throw new Error('Mỗi yêu cầu chỉ kiểm tra từ 1 đến 5 phim.');
  }
  const movies = await Promise.all(body.movies.map(async movie => {
    if (typeof movie?.id !== 'string' || !movie.id || movie.id.length > 200 || movie.id.includes('/')) {
      throw new Error('ID phim không hợp lệ.');
    }
    const slug = movie.sourceSlug || movie.slug || generateSlug(String(movie.title || '').slice(0, 500));
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 180) {
      return { id: movie.id, error: 'Phim chưa có slug nguồn hợp lệ.' };
    }
    try {
      let incoming;
      try {
        incoming = normalizePhimApiMovie(await sourceJson('/phim/' + slug));
        if (!findMovie([movie], incoming)) throw new Error('Source identity mismatch');
      } catch (error) {
        if (movie.sourceSlug) throw error;
        const search = await sourceJson('/v1/api/tim-kiem?limit=10&keyword=' + encodeURIComponent(movie.originalTitle || movie.title));
        const candidates = (search.data?.items || []).map(item => normalizePhimApiMovie({ status: true, movie: item, episodes: [] }));
        const match = findMovie(candidates, movie);
        if (!match) throw new Error('No exact source match');
        incoming = normalizePhimApiMovie(await sourceJson('/phim/' + match.sourceSlug));
        if (!findMovie([movie], incoming)) throw new Error('Source identity mismatch');
      }
      return { id: movie.id, incoming };
    } catch {
      return { id: movie.id, error: 'Không lấy được dữ liệu từ nguồn phim.' };
    }
  }));
  return { movies };
}
