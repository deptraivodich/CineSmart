import { fileURLToPath } from 'node:url';
import { connectFirestore } from './lib/firestoreStore.mjs';
import { createMalGenreLookup } from './lib/malApi.mjs';
import { mapGenresToMal, isMalGenreList } from '../src/utils/malGenres.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export async function syncAllMovieGenres({
  db,
  malLookup = createMalGenreLookup(),
  dryRun = true,
  log = console.log,
  now = () => new Date().toISOString(),
} = {}) {
  const snapshot = await db.collection('movies').get();
  const stats = { total: snapshot.size, updated: 0, malMatched: 0, fallbackMapped: 0, skipped: 0, failed: 0 };

  for (const doc of snapshot.docs) {
    const movie = doc.data();
    const existingGenres = Array.isArray(movie.genres) ? movie.genres : [];
    const existingCategory = String(movie.category || '');

    try {
      const malResult = await malLookup.lookupGenres(movie);
      let nextGenres = null;
      let source = 'mal';

      if (malResult?.genres?.length) {
        nextGenres = malResult.genres;
        stats.malMatched++;
      } else {
        const mapped = mapGenresToMal(existingGenres.length ? existingGenres : existingCategory);
        if (mapped.length) {
          nextGenres = mapped;
          source = 'fallback';
          stats.fallbackMapped++;
        } else if (!isMalGenreList(existingGenres) && existingGenres.length > 0) {
          // Existing genres only had non-MAL noise like ["Hoạt Hình"]
          nextGenres = [];
          source = 'cleaned';
          stats.fallbackMapped++;
        }
      }

      if (nextGenres === null) {
        stats.skipped++;
        continue;
      }

      const nextAnimeSeason = malResult?.animeSeason || movie.animeSeason || '';
      const nextAnimeSeasonYear = malResult?.animeSeasonYear || movie.animeSeasonYear || '';
      const nextCategory = nextGenres.join(', ');
      const baseline = { ...(movie.sourceSync || {}) };
      const changed = !same(existingGenres, nextGenres)
        || existingCategory !== nextCategory
        || !same(baseline.genres, nextGenres)
        || (nextAnimeSeason && movie.animeSeason !== nextAnimeSeason)
        || (nextAnimeSeasonYear && movie.animeSeasonYear !== nextAnimeSeasonYear);

      if (!changed) {
        stats.skipped++;
        continue;
      }

      if (!dryRun) {
        baseline.genres = nextGenres;
        baseline.category = nextCategory;
        if (nextAnimeSeason) baseline.animeSeason = nextAnimeSeason;
        if (nextAnimeSeasonYear) baseline.animeSeasonYear = nextAnimeSeasonYear;
        const patch = {
          genres: nextGenres,
          category: nextCategory,
          ...(nextAnimeSeason ? { animeSeason: nextAnimeSeason } : {}),
          ...(nextAnimeSeasonYear ? { animeSeasonYear: nextAnimeSeasonYear } : {}),
          sourceSync: baseline,
          updatedAt: now(),
        };
        if (doc.ref) {
          await doc.ref.update(patch);
        } else {
          await db.runTransaction(async tx => {
            tx.update(db.collection('movies').doc(doc.id), patch);
          });
        }
      }

      stats.updated++;
      log(`[${dryRun ? 'DRY-RUN' : 'UPDATED'}:${source}] ${movie.title || doc.id}: [${existingGenres.join(', ')}] -> [${nextGenres.join(', ')}]`);
    } catch (error) {
      stats.failed++;
      log(`[ERROR] ${movie.title || doc.id}: ${error.message}`);
    }
  }

  return stats;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const apply = process.argv.includes('--apply') || process.env.CRAWLER_DRY_RUN === 'false';
  const connection = await connectFirestore();
  try {
    const stats = await syncAllMovieGenres({ db: connection.db, dryRun: !apply });
    console.log('MAL genre sync finished:', JSON.stringify(stats));
  } finally {
    await connection.close();
  }
}
