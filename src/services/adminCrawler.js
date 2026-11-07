import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase';
import { findMovie, planImport } from '../utils/movieImport.js';
import { adminRequest, getAdminIdToken } from './adminSession';
import { getStoredMovies, saveStoredMovies } from './movieService';

export async function runAdminAutoUpdateBatch(batch) {
  const checkedDetails = [];
  const updatedMovies = [];
  try {
    for (let offset = 0; offset < batch.length; offset += 5) {
      const { movies } = await adminRequest({ operation: 'batch', movies: batch.slice(offset, offset + 5).map(movie => ({
        id: movie.id, sourceSlug: movie.sourceSlug, slug: movie.slug, title: movie.title,
        originalTitle: movie.originalTitle || movie.original_title, year: movie.year,
      })) });
      for (const movie of movies) {
        try {
          if (movie.error) throw new Error(movie.error);
          const result = await runTransaction(db, async transaction => {
            await getAdminIdToken();
            const ref = doc(db, 'movies', movie.id);
            const snapshot = await transaction.get(ref);
            if (!snapshot.exists()) throw new Error('Phim đã bị xóa khỏi Cloud.');
            const current = { id: snapshot.id, ...snapshot.data() };
            if (!findMovie([current], movie.incoming)) throw new Error('Dữ liệu nguồn không khớp phim hiện tại.');
            const plan = planImport(current, movie.incoming);
            if (plan.action === 'update') transaction.update(ref, plan.data);
            return { plan, current };
          });
          const updated = result.plan.action === 'update';
          checkedDetails.push({ id: movie.id, title: result.current.title, status: updated ? 'updated' : 'unchanged',
            added_episodes_count: result.plan.added, message: `${result.current.title} — ${updated ? 'đã cập nhật Cloud' : 'không có thay đổi'}` });
          if (updated) updatedMovies.push({ ...result.current, ...result.plan.data });
        } catch (error) {
          checkedDetails.push({ id: movie.id, status: 'error', message: error.message });
        }
      }
    }
    if (updatedMovies.length) {
      const updates = new Map(updatedMovies.map(movie => [movie.id, movie]));
      saveStoredMovies(getStoredMovies().map(movie => updates.get(movie.id) || movie));
      window.dispatchEvent(new CustomEvent('210loliphim_movies_updated'));
    }
    return { status: 'success', checkedCount: checkedDetails.length, updatedCount: updatedMovies.length, updatedMovies, checkedDetails };
  } catch (error) {
    return { status: 'error', error: error.message, checkedCount: checkedDetails.length, updatedCount: updatedMovies.length, updatedMovies, checkedDetails };
  }
}
