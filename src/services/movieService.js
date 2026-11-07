import { 
  collection, 
  getDocs, 
  getDoc,
  getDocsFromServer,
  doc, 
  setDoc,
  updateDoc, 
  runTransaction
} from 'firebase/firestore';
import { db } from '../firebase';
import { deduplicateEpisodes } from '../utils/textUtils';
import { getAdminIdToken } from './adminSession';
import { prepareCloudSync, shouldSyncMovie, cloudSyncChunks } from '../utils/cloudMovieSync.js';

const COLLECTION_NAME = 'movies';
const SETTINGS_COLLECTION = 'settings';
const LAYOUT_DOC_ID = 'homepage_layout';

// Standardized Storage Keys for 210LoliPhim
const STORAGE_KEY = '210loliphim_movies_db';
const LAYOUT_STORAGE_KEY = '210loliphim_homepage_layout';
const CATALOG_CHECKED_AT_KEY = '210loliphim_movies_checked_at';
let catalogRequest = null;
let catalogGeneration = 0;

// Default initial movies used ONLY on very first run if database is completely empty
const DEFAULT_INITIAL_MOVIES = [
  {
    id: 'mock_1',
    title: 'Dune: Hành Tinh Cát 2',
    originalTitle: 'Dune: Part Two',
    poster: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600&auto=format&fit=crop&q=80',
    banner: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1200&auto=format&fit=crop&q=80',
    quality: '4K UltraHD',
    badge: 'Phim 4K',
    imdb: '8.6',
    year: '2024',
    episodes: '24/24',
    ageRating: '16+',
    category: 'Top IMDb',
    m3u8Url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    status: 'Active',
    description: 'Cuộc hành trình báo thù hoành tráng của Paul Atreides trên hành tinh sa mạc Arrakis.',
    createdAt: new Date().toISOString()
  },
  {
    id: 'mock_2',
    title: 'Deadpool & Wolverine',
    originalTitle: 'Deadpool & Wolverine',
    poster: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=600&auto=format&fit=crop&q=80',
    banner: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=1200&auto=format&fit=crop&q=80',
    quality: 'Full HD',
    badge: 'Lồng tiếng cực mạnh',
    imdb: '8.1',
    year: '2024',
    episodes: 'Full',
    ageRating: '18+',
    category: 'Lồng tiếng cực mạnh',
    m3u8Url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    status: 'Active',
    description: 'Tổ hợp siêu anh hùng bá đạo cùng giải cứu vũ trụ.',
    createdAt: new Date().toISOString()
  },
  {
    id: 'mock_3',
    title: 'Godzilla x Kong: Đế Chế Mới',
    originalTitle: 'Godzilla x Kong: The New Empire',
    poster: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=600&auto=format&fit=crop&q=80',
    banner: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=1200&auto=format&fit=crop&q=80',
    quality: '4K',
    badge: 'Thuyết minh',
    imdb: '7.4',
    year: '2024',
    episodes: '1/1',
    ageRating: '13+',
    category: 'Thuyết minh',
    m3u8Url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    status: 'Active',
    description: 'Trận chiến hoành tráng giữa các quái thú đại ngàn.',
    createdAt: new Date().toISOString()
  }
];

// Default Layout schema matching 210LoliPhim standard
const DEFAULT_HOMEPAGE_LAYOUT = {
  top10Movies: ['mock_2', 'mock_3', 'mock_1'],
  cinemaMovies: ['mock_3', 'mock_1', 'mock_2'],
  leaderboard: {
    trending: ['mock_2', 'mock_3'],
    favorites: ['mock_1', 'mock_2'],
    newComments: ['mock_2', 'mock_1']
  },
  comingSoon: ['mock_1', 'mock_3'],
  animeVault: ['mock_2']
};

/**
 * Defensive Utility: Strip all undefined values before passing to Firestore
 */
export const sanitizeFirestoreData = (data) => {
  if (data === null || data === undefined) return null;
  if (Array.isArray(data)) {
    return data
      .filter(item => item !== undefined)
      .map(item => (typeof item === 'object' && item !== null ? sanitizeFirestoreData(item) : item));
  }
  if (typeof data === 'object') {
    const sanitized = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        const val = data[key];
        if (val !== undefined) {
          sanitized[key] = (typeof val === 'object' && val !== null) ? sanitizeFirestoreData(val) : val;
        }
      }
    }
    return sanitized;
  }
  return data;
};

/**
 * Timeout Wrapper helper to prevent Firestore SDK hanging when offline
 */
const withTimeout = (promise, ms = 3000) => {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Firestore operation timeout')), ms))
  ]);
};

/**
 * Local cache helpers (for offline fallback & immediate UI responsiveness)
 */
export const getStoredMovies = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('cobephim_movies_db');
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn("Error reading local cache:", e);
  }
  return [...DEFAULT_INITIAL_MOVIES];
};

export const saveStoredMovies = (moviesList) => {
  catalogGeneration++;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(moviesList));
    localStorage.removeItem(CATALOG_CHECKED_AT_KEY);
  } catch (e) {
    console.warn("Error saving local cache:", e);
  }
};

/**
 * 1. READ ALL MOVIES: Fetch all movies directly from Cloud Firestore
 */
const fetchMoviesCatalog = async () => {
  const generation = catalogGeneration;
  let movies = [];
  let cloudRead = false;
  try {
    const querySnapshot = await withTimeout(getDocs(collection(db, COLLECTION_NAME)), 3500);
    
    if (querySnapshot && !querySnapshot.empty) {
      cloudRead = true;
      movies = querySnapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data()
      }));
    }
  } catch (error) {
    console.warn("Firestore getMovies fallback to local cache:", error.message);
  }

  if (movies.length === 0) {
    movies = getStoredMovies();
  }

  // Tự động gộp dữ liệu mới nhất (đạo diễn, tập hiện tại, số tập) từ Backend SQLite nếu có
  if (!import.meta.env.PROD) try {
    const backendRes = await withTimeout(fetch('http://localhost:8000/api/movies?limit=300'), 1500);
    if (backendRes.ok) {
      const backendJson = await backendRes.json();
      const backendMovies = backendJson.movies || [];
      if (backendMovies.length > 0) {
        const backendMap = new Map();
        for (const bm of backendMovies) {
          if (bm.id) backendMap.set(String(bm.id), bm);
        }

        movies = movies.map(m => {
          const bm = backendMap.get(String(m.id));
          if (bm) {
            const cloudEps = deduplicateEpisodes(m.episodes || []);
            const backendEps = deduplicateEpisodes(bm.episodes || []);
            // Cloud/Firestore is authoritative. Only fallback to backend episodes if cloud episodes is empty!
            const finalEps = cloudEps.length > 0 ? cloudEps : backendEps;

            return {
              ...m,
              director: m.director || bm.director || '',
              country: m.country || bm.country || '',
              status: m.status || bm.status || 'ongoing',
              episodeCurrent: m.episodeCurrent || bm.episode_current || m.episodesStatus || '',
              episodesStatus: m.episodesStatus || bm.episode_current || '',
              episodesCount: finalEps.length > 0 ? `${finalEps.length} Tập` : (m.episodesCount || bm.episodes_count || ''),
              episodes: finalEps
            };
          }
          return {
            ...m,
            episodes: deduplicateEpisodes(m.episodes || [])
          };
        });
      }
    }
  } catch (backendErr) {
    // Backend offline -> Tiếp tục với dữ liệu hiện tại
  }

  // Sort newest created first in memory
  movies.sort((a, b) => {
    const timeA = new Date(a.createdAt || a.updatedAt || 0).getTime();
    const timeB = new Date(b.createdAt || b.updatedAt || 0).getTime();
    return timeB - timeA;
  });

  if (generation !== catalogGeneration) return getStoredMovies();
  saveStoredMovies(movies);
  if (cloudRead) {
    try { localStorage.setItem(CATALOG_CHECKED_AT_KEY, String(Date.now())); } catch { /* Cache is optional. */ }
  }
  return movies;
};

export const getMovies = async ({ forceRefresh = false } = {}) => {
  let checkedAt = 0;
  try { checkedAt = Number(localStorage.getItem(CATALOG_CHECKED_AT_KEY)); } catch { /* Fetch without cache. */ }
  if (!forceRefresh && checkedAt > 0 && Date.now() - checkedAt < 60000) return getStoredMovies();
  if (!catalogRequest) {
    catalogRequest = fetchMoviesCatalog().finally(() => { catalogRequest = null; });
  }
  return catalogRequest;
};

/**
 * 2. READ SINGLE MOVIE: Fetch movie by document ID
 */
export const getMovieById = async (id) => {
  if (!id) return null;
  try {
    const docRef = doc(db, COLLECTION_NAME, id);
    const docSnap = await withTimeout(getDoc(docRef), 2500);
    if (docSnap && docSnap.exists()) {
      return { id: docSnap.id, ...docSnap.data() };
    }
  } catch (error) {
    console.warn(`Firestore getMovieById (${id}) fallback:`, error.message);
  }
  const localList = getStoredMovies();
  return localList.find(m => String(m.id) === String(id)) || null;
};

/**
 * 3. CREATE MOVIE: Add a new movie document to Cloud Firestore
 */
export const addMovie = async (movieData) => {
  await getAdminIdToken();
  const payload = sanitizeFirestoreData({
    ...movieData,
    createdAt: movieData.createdAt || new Date().toISOString(),
    status: movieData.status || 'Active'
  });

  const docRef = doc(collection(db, COLLECTION_NAME));
  await setDoc(docRef, payload);
  const newMovie = { id: docRef.id, ...payload };

  const currentList = getStoredMovies();
  const updatedList = [newMovie, ...currentList.filter(m => m.id !== newMovie.id)];
  saveStoredMovies(updatedList);
  return newMovie;
};

/**
 * 4. UPDATE MOVIE: Update movie document in Cloud Firestore
 */
export const updateMovie = async (id, updateData) => {
  if (!id) throw new Error("Missing movie ID for update");
  await getAdminIdToken();

  const cleanedEpisodes = deduplicateEpisodes(updateData.episodes || []);
  const payload = sanitizeFirestoreData({
    ...updateData,
    ...(updateData.episodes === undefined ? {} : {
      episodes: cleanedEpisodes,
      episodesCount: cleanedEpisodes.length > 0 ? `${cleanedEpisodes.length} Tập` : (updateData.episodesCount || '1 Tập'),
    }),
    updatedAt: new Date().toISOString()
  });

  // 1. Update Firestore if valid cloud ID
  if (!id.startsWith('mock_') && !id.startsWith('local_')) {
    const docRef = doc(db, COLLECTION_NAME, id);
    await updateDoc(docRef, payload);
  } else {
    throw new Error('Hãy đồng bộ phim cục bộ lên Cloud trước khi chỉnh sửa.');
  }

  // 2. Update local storage cache
  const currentList = getStoredMovies();
  const updatedList = currentList.map(m => (String(m.id) === String(id) ? { ...m, ...payload, id } : m));
  saveStoredMovies(updatedList);

  // 3. Immediately sync updated movie to backend SQLite so SQLite is in sync with Firestore
  if (!import.meta.env.PROD) try {
    fetch('http://localhost:8000/api/movies/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ movies: [{ id, ...payload }] })
    }).catch(err => console.warn("Backend sqlite sync warning:", err));
  } catch (e) {
    // Ignore backend sync failure
  }

  return { id, ...payload };
};

/**
 * 5. DELETE MOVIE: Remove movie document from Cloud Firestore & Clean layout
 */
export const deleteMovie = async (id) => {
  if (!id) return false;
  await getAdminIdToken();

  await runTransaction(db, async transaction => {
    const layoutRef = doc(db, SETTINGS_COLLECTION, LAYOUT_DOC_ID);
    const layoutSnapshot = await transaction.get(layoutRef);
    const layout = layoutSnapshot.exists() ? layoutSnapshot.data() : null;
    if (layout) {
      const cleanLayout = {
        top10Movies: (layout.top10Movies || []).filter(mId => String(mId) !== String(id)),
        cinemaMovies: (layout.cinemaMovies || []).filter(mId => String(mId) !== String(id)),
        leaderboard: {
          trending: (layout.leaderboard?.trending || []).filter(mId => String(mId) !== String(id)),
          favorites: (layout.leaderboard?.favorites || []).filter(mId => String(mId) !== String(id)),
          newComments: (layout.leaderboard?.newComments || []).filter(mId => String(mId) !== String(id)),
        },
        comingSoon: (layout.comingSoon || []).filter(mId => String(mId) !== String(id)),
        animeVault: (layout.animeVault || []).filter(mId => String(mId) !== String(id)),
      };
      transaction.set(layoutRef, cleanLayout, { merge: true });
    }
    if (!id.startsWith('mock_') && !id.startsWith('local_')) {
      transaction.delete(doc(db, COLLECTION_NAME, id));
    }
  });

  const currentList = getStoredMovies();
  saveStoredMovies(currentList.filter(movie => movie && String(movie.id) !== String(id)));

  return true;
};

/**
 * 6. HOMEPAGE LAYOUT CMS: Read settings/homepage_layout from Firestore
 */
export const getHomepageLayout = async () => {
  try {
    const docRef = doc(db, SETTINGS_COLLECTION, LAYOUT_DOC_ID);
    const docSnap = await withTimeout(getDoc(docRef), 2500);
    if (docSnap && docSnap.exists()) {
      const data = docSnap.data();
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(data));
      return data;
    }
  } catch (e) {
    console.warn("Firestore getHomepageLayout fallback:", e.message);
  }

  // Fallback to localStorage
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY) || localStorage.getItem('cobephim_homepage_layout');
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn("Error reading local layout:", e);
  }

  return DEFAULT_HOMEPAGE_LAYOUT;
};

/**
 * 7. HOMEPAGE LAYOUT CMS: Save settings/homepage_layout to Firestore
 */
export const saveHomepageLayout = async (layoutData) => {
  await getAdminIdToken();
  const cleanPayload = sanitizeFirestoreData(layoutData);

  const docRef = doc(db, SETTINGS_COLLECTION, LAYOUT_DOC_ID);
  await setDoc(docRef, cleanPayload, { merge: true });

  // Save to local cache
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(cleanPayload));
  } catch (e) {
    console.warn("Error saving local layout:", e);
  }

  return cleanPayload;
};

/**
 * 8. BULK IMPORT: Helper to save bulk movies locally
 */
export const saveBulkMoviesLocally = (newMoviesArray) => {
  const currentList = getStoredMovies();
  const updatedList = [...newMoviesArray, ...currentList.filter(m => !newMoviesArray.some(nm => nm.id === m.id))];
  saveStoredMovies(updatedList);
  return updatedList;
};

/**
 * 9. SYNC ALL MOVIES TO CLOUD: Push all current movies in local cache up to Cloud Firestore
 */
export const syncAllLocalMoviesToCloud = async () => {
  await getAdminIdToken();
  const localList = getStoredMovies();
  if (!Array.isArray(localList) || localList.length === 0) {
    return { success: false, count: 0, message: "Không có phim nào trong bộ nhớ cục bộ để đồng bộ." };
  }

  const cloudSnapshot = localList.some(movie => String(movie?.id).startsWith('local_'))
    ? await getDocsFromServer(collection(db, COLLECTION_NAME)) : null;
  const cloudCatalog = cloudSnapshot ? cloudSnapshot.docs.map(snapshot => ({ ...snapshot.data(), id: snapshot.id })) : [];
  const records = prepareCloudSync(localList, cloudCatalog).map(record => {
    const movie = record.data;
    const dedupedEps = deduplicateEpisodes(movie.episodes || []);
    return {
      ...record,
      data: sanitizeFirestoreData({
        ...movie,
        episodes: dedupedEps,
        episodesCount: dedupedEps.length > 0 ? `${dedupedEps.length} Tập` : (movie.episodesCount || '1 Tập'),
      }),
    };
  });

  let count = 0;
  let skipped = 0;
  // Each transaction rechecks current cloud data and stays below write limits.
  for (const chunk of cloudSyncChunks(records)) {
    await getAdminIdToken();
    const result = await runTransaction(db, async transaction => {
      const refs = chunk.map(record => doc(db, COLLECTION_NAME, record.id));
      const snapshots = await Promise.all(refs.map(ref => transaction.get(ref)));
      let written = 0;
      snapshots.forEach((snapshot, index) => {
        const existing = snapshot.exists() ? snapshot.data() : null;
        const data = { ...chunk[index].data };
        data.createdAt ||= existing?.createdAt || new Date().toISOString();
        if (shouldSyncMovie(existing, data)) {
          transaction.set(refs[index], data, { merge: true });
          written++;
        }
      });
      return written;
    });
    count += result;
    skipped += chunk.length - result;
    const migratedIds = new Map(chunk.filter(record => record.originalId !== record.id).map(record => [record.originalId, record.id]));
    if (result || migratedIds.size) {
      saveStoredMovies(getStoredMovies().map(movie => migratedIds.has(movie.id) ? { ...movie, id: migratedIds.get(movie.id) } : movie));
    }
  }
  return { success: true, count, skipped };
};
