export class SourceError extends Error {
  constructor(message, { retryable = false, blocked = false, retryAt = 0, status = 0, providerCode = '', requestId = '' } = {}) {
    super(message);
    Object.assign(this, { retryable, blocked, retryAt, status, providerCode, requestId });
  }
}
export function pageRange(start = 1, end = 10) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > 10 || start > end) throw new Error('Pages must be integers within 1-10');
  return { start, end };
}
export function listUrl(page) {
  pageRange(page, page);
  return `https://phimapi.com/v1/api/danh-sach/hoat-hinh?country=nhat-ban&sort_field=modified.time&sort_type=desc&page=${page}`;
}
export function detailUrl(slug) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 180) throw new SourceError('Invalid source slug');
  return `https://phimapi.com/phim/${slug}`;
}
export function createSource({ fetchImpl = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), timeoutMs = 15000, delayMs = 750, now = Date.now, onPage = () => {} } = {}) {
  async function json(url) {
    for (let attempt = 0; attempt < 3; attempt++) {
      await sleep(delayMs);
      let response;
      try {
        response = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': 'CineSmart-Metadata-Sync/1.0' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
      } catch {
        if (attempt === 2) throw new SourceError('Source network/timeout error after 3 attempts', { retryable: true });
        await sleep(1000 * 2 ** attempt); continue;
      }
      if ([401, 403, 451].includes(response.status)) {
        // Retain only diagnostic codes, never arbitrary HTML, cookies or request headers.
        const body = typeof response.text === 'function' ? await response.text().catch(() => '') : '';
        const providerCode = body.slice(0, 2000).match(/\berror code:\s*(\d{3,5})/i)?.[1] || '';
        const ray = response.headers?.get('cf-ray') || '';
        const requestId = /^[a-zA-Z0-9-]{1,80}$/.test(ray) ? ray : '';
        throw new SourceError(`Source denied access (HTTP ${response.status}${providerCode ? `, provider code ${providerCode}` : ''}); stopped without retry`, { blocked: true, status: response.status, providerCode, requestId });
      }
      if (response.status >= 300 && response.status < 400) throw new SourceError('Source redirected the request; confirm the official endpoint before continuing', { blocked: true, status: response.status });
      if (response.status === 429 || response.status >= 500) {
        const header = response.headers?.get('retry-after');
        const seconds = header && /^\d+$/.test(header) ? Number(header) : header ? Math.ceil((Date.parse(header) - now()) / 1000) : 0;
        if (header && /^\d+$/.test(header) && (!Number.isSafeInteger(seconds) || !Number.isFinite(new Date(now() + seconds * 1000).getTime()))) {
          throw new SourceError('Source returned an invalid Retry-After; manual review required', { blocked: true, status: response.status });
        }
        // Never ignore a long Retry-After: defer to a later workflow instead.
        if (seconds > 30) throw new SourceError('Source requested a cooldown; resume after Retry-After', { blocked: true, retryable: true, retryAt: now() + seconds * 1000, status: response.status });
        if (attempt === 2) throw new SourceError(`Source HTTP ${response.status} after 3 attempts`, {
          retryable: true, blocked: response.status === 429 || seconds > 0,
          retryAt: response.status === 429 ? now() + Math.max(30, seconds || 0) * 1000 : seconds > 0 ? now() + seconds * 1000 : 0,
          status: response.status,
        });
        await sleep(Math.max(1000 * 2 ** attempt, (seconds || 0) * 1000)); continue;
      }
      if (!response.ok) throw new SourceError(`Source HTTP ${response.status}`);
      try { return await response.json(); } catch { throw new SourceError('Source returned invalid JSON', { retryable: true }); }
    }
  }
  return {
    async page(page) {
      const data = await json(listUrl(page));
      if (data?.status !== 'success' && data?.status !== true) throw new SourceError('Invalid list status', { retryable: true });
      const items = data?.data?.items;
      if (!Array.isArray(items) || items.length > 100) throw new SourceError('Invalid list items', { retryable: true });
      const current = data.data?.params?.pagination?.currentPage;
      if (current !== undefined && Number(current) !== page) throw new SourceError('Source pagination mismatch');
      const params = data.data.params || {};
      const countries = Array.isArray(params.filterCountry) ? params.filterCountry.filter(Boolean) : null;
      if ((params.slug !== undefined && params.slug !== 'hoat-hinh') ||
          (params.type_slug !== undefined && params.type_slug !== 'danh-sach') ||
          (params.filterCountry !== undefined && (!Array.isArray(countries) || countries.length !== 1 || countries[0] !== 'nhat-ban')) ||
          (params.sortField !== undefined && params.sortField !== 'modified.time') ||
          (params.sortType !== undefined && params.sortType !== 'desc')) throw new SourceError('Source filter/sort echo mismatch');
      const result = items.map(item => { detailUrl(item.slug); return { slug: item.slug }; });
      onPage(data, page);
      return result;
    },
    detail: slug => json(detailUrl(slug)),
  };
}
