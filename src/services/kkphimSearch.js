import { collection, doc, getDocFromServer, getDocsFromServer, limit, query, runTransaction, where } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { adminRequest, getAdminIdToken } from './adminSession';
import { findMovie, planImport, sourceMovieId } from '../utils/movieImport.js';
import { getStoredMovies, saveStoredMovies } from './movieService';

export const searchKKPhim = (keyword, page, signal) => adminRequest({ operation: 'search', keyword, page }, { signal });

async function resolveTargetMovieId(incoming, slug, yearCache, runCatalog) {
  if (runCatalog.size) {
    const inRun = findMovie([...runCatalog.values()], incoming);
    if (inRun) return inRun.id;
  }
  const directId = sourceMovieId(slug);
  const directSnap = await getDocFromServer(doc(db, 'movies', directId));
  if (directSnap.exists()) return directSnap.id;

  const moviesCol = collection(db, 'movies');
  const [bySourceSnap, bySlugSnap] = await Promise.all([
    getDocsFromServer(query(moviesCol, where('sourceSlug', '==', slug), limit(2))),
    getDocsFromServer(query(moviesCol, where('slug', '==', slug), limit(2))),
  ]);
  const exact = new Map();
  for (const d of [...bySourceSnap.docs, ...bySlugSnap.docs]) exact.set(d.id, { ...d.data(), id: d.id });
  if (exact.size > 1) throw new Error('Phim bị trùng định danh nguồn trong kho; cần xử lý thủ công.');
  if (exact.size === 1) return [...exact.keys()][0];

  const yearStr = String(incoming.year ?? '').trim();
  if (!yearStr) return directId;
  if (!yearCache.has(yearStr)) {
    const yearNum = /^\d{4}$/.test(yearStr) ? Number(yearStr) : null;
    const yearFilter = yearNum !== null ? where('year', 'in', [yearStr, yearNum]) : where('year', '==', yearStr);
    const snap = await getDocsFromServer(query(moviesCol, yearFilter, limit(1000)));
    yearCache.set(yearStr, snap.docs.map(d => ({ ...d.data(), id: d.id })));
  }
  const candidates = new Map(yearCache.get(yearStr).map(m => [m.id, m]));
  for (const [id, m] of runCatalog) {
    if (String(m.year ?? '').trim() === yearStr) candidates.set(id, m);
  }
  const match = candidates.size ? findMovie([...candidates.values()], incoming) : null;
  return match?.id || directId;
}

export async function importKKPhim(slugs, { signal, onResult = () => {} } = {}) {
  await getAdminIdToken();
  const owner = auth.currentUser;
  const check = () => {
    signal?.throwIfAborted();
    if (!owner || auth.currentUser !== owner) throw new Error('Phiên Admin đã thay đổi. Hãy đăng nhập lại.');
  };
  check();
  const yearCache = new Map();
  const runCatalog = new Map();
  const cachedMovies = getStoredMovies();
  for (const slug of slugs) {
    check();
    try {
      const result = await adminRequest({ operation: 'selected', slugs: [slug] }, { signal });
      check();
      const incoming = result.movies?.[0];
      if (incoming?.sourceSlug !== slug || !incoming.episodes?.length) throw new Error('Phim chưa có tập phát hợp lệ.');
      const targetId = await resolveTargetMovieId(incoming, slug, yearCache, runCatalog);
      check();
      const ref = doc(db, 'movies', targetId);
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
      runCatalog.set(ref.id, saved.movie);
      const index = cachedMovies.findIndex(movie => movie.id === ref.id);
      if (index < 0) cachedMovies.unshift(saved.movie); else cachedMovies[index] = saved.movie;
      saveStoredMovies(cachedMovies);
      onResult({ slug, title: saved.movie.title, ok: true, action: saved.action, episodes: saved.movie.episodes?.length || 0 });
    } catch (error) {
      if (signal?.aborted || auth.currentUser !== owner) throw error;
      onResult({ slug, ok: false, error: error.message });
    }
  }
  window.dispatchEvent(new CustomEvent('210loliphim_movies_updated'));
}
