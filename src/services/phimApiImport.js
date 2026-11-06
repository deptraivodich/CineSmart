import { normalizePhimApiMovie, movieToTSV } from '../utils/movieImport.js';

export function detailsToTSV(details) {
  const tables = details.map(data => movieToTSV(normalizePhimApiMovie(data)));
  return tables.map((table, i) => i ? table.split('\n').slice(1).join('\n') : table).join('\n');
}

// Browser fallback remains independent of the cloud worker and Firebase credentials.
export async function crawlManualUrl(target, fetchImpl = fetch) {
  const input = new URL(target);
  const path = input.pathname.replace(/\/+$/, '');
  const list = /\/(danh-sach|quoc-gia|the-loai)\//.test(path);
  async function json(url) {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('PhimAPI HTTP ' + response.status);
    return response.json();
  }
  let details;
  if (list) {
    const apiPath = path.replace(/^\/v1\/api/, '');
    const response = await json('https://phimapi.com/v1/api' + apiPath + input.search);
    const items = response.data?.items || response.items;
    if (!Array.isArray(items) || !items.length || items.length > 100) throw new Error('Danh sách phim không hợp lệ');
    details = [];
    for (const item of items) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug)) throw new Error('Slug phim không hợp lệ');
      details.push(await json('https://phimapi.com/phim/' + item.slug));
    }
  } else {
    const slug = path.split('/').pop();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('Slug phim không hợp lệ');
    details = [await json('https://phimapi.com/phim/' + slug)];
  }
  return { tsv: detailsToTSV(details), count: details.length };
}
