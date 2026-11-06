import { fileURLToPath } from 'node:url';
import { createSource } from './lib/phimApi.mjs';
import { isJapaneseAnimation, normalizePhimApiMovie } from '../src/utils/movieImport.js';

// No Firebase import, credentials, database reads or database writes.
export async function checkAnimeSource({ source, log = console.log, detailSamples = 3, fetchImpl } = {}) {
  if (!Number.isInteger(detailSamples) || detailSamples < 1 || detailSamples > 10) throw new Error('Source check samples must be within 1-10');
  const observations = [];
  source ||= createSource({ fetchImpl, onPage(data, page) {
    const p = data.data.params || {};
    const matching = data.data.items.filter(isJapaneseAnimation).length;
    if (matching !== data.data.items.length) throw new Error('Source check list contains movies outside Japanese animation filter');
    observations.push({ page, country: p.filterCountry, type: p.slug, sortField: p.sortField, sortType: p.sortType,
      matchingListItems: matching, totalListItems: data.data.items.length });
  } });
  const slugs = new Set(), pages = [];
  const startedAt = new Date().toISOString();
  for (let page = 1; page <= 10; page++) {
    const items = await source.page(page);
    for (const item of items) slugs.add(item.slug);
    pages.push({ page, items: items.length });
    log(`[Source check] Page ${page}/10: ${items.length} movies`);
  }
  const details = [];
  // Sample across the range rather than just the first page.
  const all = [...slugs];
  const count = Math.min(detailSamples, all.length);
  for (let i = 0; i < count; i++) {
    const slug = all[Math.floor(i * (all.length - 1) / Math.max(1, count - 1))];
    const data = await source.detail(slug);
    if (data?.movie?.slug !== slug || !isJapaneseAnimation(data.movie)) throw new Error('Source check detail identity/filter mismatch');
    const movie = normalizePhimApiMovie(data);
    details.push({ slug, status: movie.status, episodes: movie.episodes.length, country: movie.country });
    log(`[Source check] Detail ${slug}: ${movie.episodes.length} episodes, ${movie.status}`);
  }
  if (pages.length !== 10 || !slugs.size || !details.length) throw new Error('Source check incomplete: no usable data');
  return { mode: 'source-only (no Firestore connection)', startedAt, finishedAt: new Date().toISOString(), pages,
    uniqueMovies: slugs.size, details, filterEcho: observations, firestoreWrites: 0 };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  checkAnimeSource().then(report => console.log(JSON.stringify(report, null, 2))).catch(error => {
    console.error(`[Source check] FAILED: ${error.message}`);
    process.exitCode = 1;
  });
}
