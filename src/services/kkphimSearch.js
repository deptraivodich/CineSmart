import { collection, doc, getDocsFromServer, limit, query, runTransaction } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { adminRequest, getAdminIdToken } from './adminSession';
import { findMovie, planImport, sourceMovieId } from '../utils/movieImport.js';
import { saveStoredMovies } from './movieService';

export const searchKKPhim = (keyword, page, signal) => adminRequest({ operation: 'search', keyword, page }, { signal });

export async function importKKPhim(slugs, { signal, onResult = () => {} } = {}) {
  await getAdminIdToken();
  const owner = auth.currentUser;
  const check = () => {
    signal?.throwIfAborted();
    if (!owner || auth.currentUser !== owner) throw new Error('Phiên Admin đã thay đổi. Hãy đăng nhập lại.');
  };
  check();
  const snapshot = await getDocsFromServer(query(collection(db, 'movies'), limit(10001)));
  if (snapshot.size > 10000) throw new Error('Kho phim quá lớn để kiểm tra trùng.');
  const catalog = snapshot.docs.map(item => ({ ...item.data(), id: item.id }));
  for (const slug of slugs) {
    check();
    try {
      const result = await adminRequest({ operation: 'selected', slugs: [slug] }, { signal });
      check();
      const incoming = result.movies?.[0];
      if (incoming?.sourceSlug !== slug || !incoming.episodes?.length) throw new Error('Phim chưa có tập phát hợp lệ.');
      const match = findMovie(catalog, incoming);
      const ref = doc(db, 'movies', match?.id || sourceMovieId(slug));
      await getAdminIdToken();
      const saved = await runTransaction(db, async tx => {
        const current = await tx.get(ref);
        check();
        const existing = current.exists() ? current.data() : null;
        const plan = planImport(existing, incoming);
        if (plan.action !== 'skip' && new TextEncoder().encode(JSON.stringify({ ...existing, ...plan.data })).length > 850000) throw new Error('Phim vượt giới hạn lưu trữ; cần tách dữ liệu tập.');
        if (plan.action === 'new') tx.set(ref, plan.data);
        else if (plan.action === 'update') tx.update(ref, plan.data);
        return { ...plan, movie: { ...existing, ...plan.data, id: ref.id } };
      });
      const index = catalog.findIndex(movie => movie.id === ref.id);
      if (index < 0) catalog.push(saved.movie); else catalog[index] = saved.movie;
      saveStoredMovies(catalog);
      onResult({ slug, title: saved.movie.title, ok: true, action: saved.action, episodes: saved.movie.episodes?.length || 0 });
    } catch (error) {
      if (signal?.aborted || auth.currentUser !== owner) throw error;
      onResult({ slug, ok: false, error: error.message });
    }
  }
  window.dispatchEvent(new CustomEvent('210loliphim_movies_updated'));
}
