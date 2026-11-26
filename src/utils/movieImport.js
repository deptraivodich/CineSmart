import { mapGenresToMal, isMalGenreList } from './malGenres.js';

// Shared policy for Magic Import and the browser-independent cloud worker.
const text = v => String(v ?? '').trim().replace(/\s+/g, ' ');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const present = v => Array.isArray(v) ? v.length > 0 : Boolean(text(v)) && !/^(đang cập nhật|n\/a|unknown)$/i.test(text(v));
const names = v => (Array.isArray(v) ? v : [v]).map(x => text(typeof x === 'object' ? x?.name : x)).filter(Boolean).join(', ');
export const normalizeTitle = v => text(v).normalize('NFC').toLowerCase().replace(/[\s:_–-]+/g, ' ');
export const episodeKey = v => {
  const name = text(v).normalize('NFC').toLowerCase().replace(/^(?:(?:tập|tap|episode|ep)\s*[:.-]?\s*)+/i, '');
  return /^\d+(?:\.\d+)?$/.test(name) ? String(Number(name)) : name;
};
export const validStream = v => {
  try { const url = new URL(text(v)); return ['https:', 'http:'].includes(url.protocol) && Boolean(url.hostname) && !/\s/.test(text(v)); }
  catch { return false; }
};

export function mergeEpisodes(existing = [], incoming = []) {
  const episodes = (Array.isArray(existing) ? existing : []).map(ep => ({ ...ep }));
  const index = new Map(episodes.map((ep, i) => [episodeKey(ep.name ?? ep.number), i]));
  let added = 0;
  for (const ep of incoming || []) {
    const key = episodeKey(ep.name ?? ep.number), url = text(ep.url || ep.m3u8Url);
    if (!key || !validStream(url)) continue;
    if (!index.has(key)) {
      if (episodes.some(old => old.url === url)) continue;
      index.set(key, episodes.length);
      episodes.push({ ...ep, name: text(ep.name ?? ep.number), url, sourceUrl: url });
      added++;
    } else {
      const i = index.get(key), old = episodes[i];
      if (episodes.some((other, j) => j !== i && other.url === url)) continue;
      const owned = old.sourceUrl ? old.url === old.sourceUrl : /^https?:\/\/[^/]*(?:kkphim|phimplayer)/i.test(old.url || '');
      if ((!old.url || owned) && old.url !== url) episodes[i] = { ...old, url, sourceUrl: url };
    }
  }
  return { episodes, added };
}

const stripAccents = v => text(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd');
const compactTitle = v => stripAccents(v).toLowerCase().replace(/[^a-z0-9]+/g, '');
const ROMAN_SEASON = { ii: '2', iii: '3', iv: '4', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' };

function seasonTokens(movie) {
  const combined = `${normalizeTitle(movie.title)} ${normalizeTitle(movie.originalTitle)}`;
  const found = new Set();
  for (const m of combined.matchAll(/(?:season|part|phần|mùa|cour|ss)\s*(\d+)/g)) found.add(String(Number(m[1])));
  for (const m of combined.matchAll(/\bs\s*(\d+)\b/g)) found.add(String(Number(m[1])));
  for (const m of combined.matchAll(/\b(\d+)(?:st|nd|rd|th)\s*season\b/g)) found.add(String(Number(m[1])));
  for (const m of combined.matchAll(/\b(ii|iii|iv|vi|vii|viii|ix|x)\b/g)) found.add(ROMAN_SEASON[m[1]]);
  return [...found].sort().join(',');
}

function numberTokens(movie) {
  const combined = `${normalizeTitle(movie.title)} ${normalizeTitle(movie.originalTitle)}`;
  return [...new Set([...combined.matchAll(/\d+/g)].map(m => String(Number(m[0]))))].sort().join(',');
}

function countryTokens(country) {
  return new Set(
    stripAccents(Array.isArray(country) ? country.map(c => c?.name || c).join(',') : country)
      .toLowerCase()
      .split(/[,/|]+/)
      .map(s => s.trim().replace(/\s+/g, ' '))
      .filter(Boolean)
  );
}

function countriesCompatible(a, b) {
  const ca = countryTokens(a), cb = countryTokens(b);
  if (!ca.size || !cb.size) return true;
  for (const token of ca) if (cb.has(token)) return true;
  return false;
}

function editDistance(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? diag : 1 + Math.min(diag, prev[j], prev[j - 1]);
      diag = next;
    }
  }
  return prev[b.length];
}

function nearTitleMatch(a, b) {
  const ca = compactTitle(a), cb = compactTitle(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  const maxLen = Math.max(ca.length, cb.length);
  if (maxLen < 8) return false;
  const dist = editDistance(ca, cb);
  return dist <= 2 && (maxLen - dist) / maxLen >= 0.85;
}

export function findMovie(movies, incoming) {
  const slug = incoming.sourceSlug || incoming.slug;
  const exact = slug ? movies.filter(m => [m.sourceSlug, m.slug, m.id].includes(slug)) : [];
  if (exact.length > 1) throw new Error('Ambiguous source identity; reconcile manually');
  if (exact.length) return exact[0];
  const incomingSeasons = seasonTokens(incoming);
  const baseEligible = movies.filter(m => {
    if (m.sourceSlug && slug && m.sourceSlug !== slug) return false;
    if (m.year && incoming.year && text(m.year) !== text(incoming.year)) return false;
    return seasonTokens(m) === incomingSeasons;
  });
  const matches = baseEligible.filter(m =>
    ['title', 'originalTitle'].some(k => incoming[k] && m[k] && normalizeTitle(m[k]) === normalizeTitle(incoming[k]))
  );
  if (matches.length > 1) throw new Error('Ambiguous legacy identity; reconcile manually');
  if (matches.length) return matches[0];
  // Near-match fallback requires matching year, country, seasons, and all numeric tokens (so ss1 vs ss2 never collide).
  if (!incoming.year) return null;
  const incomingNumbers = numberTokens(incoming);
  const near = baseEligible.filter(m => {
    if (!m.year || text(m.year) !== text(incoming.year)) return false;
    if (numberTokens(m) !== incomingNumbers) return false;
    if (!countriesCompatible(m.country, incoming.country)) return false;
    return ['title', 'originalTitle'].some(k => incoming[k] && m[k] && nearTitleMatch(m[k], incoming[k]));
  });
  if (near.length > 1) throw new Error('Ambiguous legacy identity; reconcile manually');
  return near[0] || null;
}

export function sourceMovieId(slug) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 180) throw new Error('Invalid source slug');
  return 'kkphim-' + slug;
}
export function normalizeServerName(rawName, index = 0) {
  const s = text(rawName);
  if (/lồng\s*tiếng|long\s*tieng/i.test(s)) return 'Lồng Tiếng';
  if (/thuyết\s*minh|thuyet\s*minh/i.test(s)) return 'Thuyết Minh';
  if (/vietsub|phụ\s*đề/i.test(s)) return 'Vietsub';
  return s || `Server ${index + 1}`;
}

export function mergeServers(existingServers = [], incomingServers = []) {
  const existing = Array.isArray(existingServers) ? existingServers : [];
  const incoming = Array.isArray(incomingServers) ? incomingServers : [];
  if (!incoming.length) return existing;
  const byName = new Map(existing.map((srv, idx) => [normalizeServerName(srv.name, idx), { ...srv, name: normalizeServerName(srv.name, idx) }]));
  for (let i = 0; i < incoming.length; i++) {
    const inc = incoming[i];
    const name = normalizeServerName(inc.name, i);
    const prev = byName.get(name);
    const { episodes } = mergeEpisodes(prev?.episodes || [], inc.episodes || []);
    if (episodes.length) byName.set(name, { name, episodes });
  }
  return [...byName.values()];
}

export const MOVIE_FIELDS = ['title', 'originalTitle', 'poster', 'banner', 'imdb', 'year', 'country', 'director', 'genres', 'category', 'animeSeason', 'animeSeasonYear', 'description', 'quality', 'ageRating', 'duration', 'totalEpisodes', 'status', 'episodeCurrent', 'episodesStatus', 'servers', 'sourceSlug', 'sourceUpdatedAt'];
const mutable = ['country', 'director', 'genres', 'category', 'animeSeason', 'animeSeasonYear', 'status', 'episodeCurrent', 'episodesStatus'];
export function planImport(existing, incoming, now = new Date().toISOString()) {
  if (incoming.sourceSlug) sourceMovieId(incoming.sourceSlug);
  if (existing?.sourceSlug && incoming.sourceSlug && existing.sourceSlug !== incoming.sourceSlug) throw new Error('Conflicting source identity');
  const oldEps = Array.isArray(existing?.episodes) && existing.episodes.length ? existing.episodes : existing?.m3u8Url ? [{ name: '1', url: existing.m3u8Url }] : [];
  const { episodes, added } = mergeEpisodes(oldEps, incoming.episodes);
  const mergedServers = mergeServers(existing?.servers, incoming.servers);
  if (!existing) {
    const data = Object.fromEntries(MOVIE_FIELDS.filter(k => incoming[k] !== undefined).map(k => [k, incoming[k]]));
    Object.assign(data, { episodes, ...(mergedServers.length ? { servers: mergedServers } : {}), episodesCount: `${episodes.length} Tập`, m3u8Url: episodes[0]?.url || '', status: incoming.status || 'ongoing', createdAt: now, updatedAt: now });
    data.episodeCurrent ||= episodes.length ? `Tập ${episodes.at(-1).name}` : 'Chưa có tập';
    data.episodesStatus ||= data.episodeCurrent;
    data.sourceSync = Object.fromEntries(mutable.filter(k => present(data[k])).map(k => [k, data[k]]));
    return { action: 'new', data, added };
  }
  const patch = {}, baseline = { ...(existing.sourceSync || {}) };
  const existingHasValidMalGenres = isMalGenreList(existing.genres);
  for (const key of MOVIE_FIELDS) {
    if (['sourceSlug', 'sourceUpdatedAt', 'servers'].includes(key) || !present(incoming[key]) || same(existing[key], incoming[key])) continue;
    const migrateLegacyGenres = ['genres', 'category'].includes(key) && baseline[key] === undefined && !existingHasValidMalGenres;
    const canUpdate = !present(existing[key]) || migrateLegacyGenres || (mutable.includes(key) && (same(existing[key], baseline[key]) || (!existing.sourceSync && ['status', 'episodeCurrent', 'episodesStatus'].includes(key))));
    if (canUpdate) patch[key] = incoming[key];
  }
  if (mergedServers.length && !same(existing.servers || [], mergedServers)) {
    patch.servers = mergedServers;
  }
  if (!same(oldEps, episodes)) {
    patch.episodes = episodes;
    patch.episodesCount = `${episodes.length} Tập`;
    if (!existing.m3u8Url || existing.m3u8Url === oldEps[0]?.url) patch.m3u8Url = episodes[0]?.url || existing.m3u8Url || '';
  }
  if (incoming.sourceSlug && !existing.sourceSlug) patch.sourceSlug = incoming.sourceSlug;
  if (!Object.keys(patch).length) return { action: 'skip', data: {}, added: 0 };
  for (const key of mutable) {
    if (patch[key] !== undefined) baseline[key] = patch[key];
    else if (same(existing[key], incoming[key]) && present(incoming[key])) baseline[key] = incoming[key];
  }
  if (incoming.sourceUpdatedAt) patch.sourceUpdatedAt = incoming.sourceUpdatedAt;
  Object.assign(patch, { sourceSync: baseline, updatedAt: now });
  return { action: 'update', data: patch, added };
}

export function isJapaneseAnimation(movie) {
  return movie?.type === 'hoathinh' && Array.isArray(movie.country) && movie.country.some(c => c?.slug === 'nhat-ban');
}
export function isSupportedAnimation(movie) {
  return movie?.type === 'hoathinh' && Array.isArray(movie.country) && movie.country.some(c => ['nhat-ban', 'trung-quoc'].includes(c?.slug));
}
export function normalizePhimApiMovie(data) {
  if (data?.status !== true || !data.movie?.name || !data.movie?.slug || !Array.isArray(data.episodes)) throw new Error('Invalid movie detail JSON');
  const m = data.movie;
  const image = v => !v ? '' : /^https?:\/\//i.test(v) ? v : `https://phimimg.com/${v.replace(/^\//, '')}`;
  const servers = [];
  const serverIndex = new Map();
  for (let sIdx = 0; sIdx < data.episodes.length; sIdx++) {
    const srv = data.episodes[sIdx];
    const srvEps = (srv?.server_data || [])
      .map((ep, i) => ({ name: text(ep.name || i + 1), url: text(ep.link_m3u8 || ep.link_embed) }))
      .filter(ep => validStream(ep.url));
    if (!srvEps.length) continue;
    const name = normalizeServerName(srv?.server_name, sIdx);
    if (serverIndex.has(name)) {
      const idx = serverIndex.get(name);
      servers[idx].episodes = mergeEpisodes(servers[idx].episodes, srvEps).episodes;
    } else {
      serverIndex.set(name, servers.length);
      servers.push({ name, episodes: srvEps });
    }
  }
  const primaryServer = servers.find(s => s.name === 'Vietsub') || servers[0];
  const episodes = primaryServer ? primaryServer.episodes : [];
  const genres = mapGenresToMal(m.category || []), title = text(m.name);
  const hasMultipleOrNamedAudio = servers.length > 1 || (servers.length === 1 && ['Lồng Tiếng', 'Thuyết Minh'].includes(servers[0].name));
  return { title: title.charAt(0).toUpperCase() + title.slice(1).toLowerCase(), originalTitle: text(m.origin_name), poster: image(m.poster_url || m.thumb_url), banner: image(m.thumb_url || m.poster_url), imdb: text(m.imdb?.vote_average || m.tmdb?.vote_average), year: text(m.year), country: names(m.country), director: names(m.director), genres, category: genres.join(', '), description: text(m.content).replace(/<[^>]*>/g, '').replace(/\s+/g, ' '), duration: text(m.time), totalEpisodes: text(m.episode_total), quality: text(m.quality), ageRating: text(m.age_rating), episodes, ...(hasMultipleOrNamedAudio ? { servers } : {}), episodesCount: `${episodes.length} Tập`, status: ['completed', 'ongoing', 'trailer'].includes(m.status) ? m.status : '', episodeCurrent: text(m.episode_current), episodesStatus: text(m.episode_current), m3u8Url: episodes[0]?.url || '', sourceSlug: m.slug, sourceUpdatedAt: text(m.modified?.time) };
}
export function movieToTSV(movie) {
  const fields = [...MOVIE_FIELDS.filter(k => k !== 'servers'), 'episode', 'videoUrl'];
  const cell = v => (Array.isArray(v) ? v.join(', ') : text(v)).replace(/[\t\r\n]+/g, ' ');
  const rows = (movie.episodes.length ? movie.episodes : [{ name: '1', url: '' }]).map((ep, i) => fields.map(k => cell(k === 'episode' ? ep.name : k === 'videoUrl' ? ep.url : i === 0 ? movie[k] : '')).join('\t'));
  return [fields.join('\t'), ...rows].join('\n');
}
