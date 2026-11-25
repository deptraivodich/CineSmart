// Official MyAnimeList (MAL / Jikan v4) Genres, Explicit Genres, Themes & Demographics (Sorted A-Z)
export const MAL_GENRES = [
  'Action',
  'Adult Cast',
  'Adventure',
  'Anthropomorphic',
  'Avant Garde',
  'Award Winning',
  'Boys Love',
  'CGDCT',
  'Childcare',
  'Combat Sports',
  'Comedy',
  'Crossdressing',
  'Delinquents',
  'Detective',
  'Drama',
  'Ecchi',
  'Educational',
  'Erotica',
  'Fantasy',
  'Gag Humor',
  'Girls Love',
  'Gore',
  'Gourmet',
  'Harem',
  'Hentai',
  'High Stakes Game',
  'Historical',
  'Horror',
  'Idols (Female)',
  'Idols (Male)',
  'Isekai',
  'Iyashikei',
  'Josei',
  'Kids',
  'Love Polygon',
  'Love Status Quo',
  'Magical Sex Shift',
  'Mahou Shoujo',
  'Martial Arts',
  'Mecha',
  'Medical',
  'Military',
  'Music',
  'Mystery',
  'Mythology',
  'Organized Crime',
  'Otaku Culture',
  'Parody',
  'Performing Arts',
  'Pets',
  'Psychological',
  'Racing',
  'Reincarnation',
  'Reverse Harem',
  'Romance',
  'Samurai',
  'School',
  'Sci-Fi',
  'Seinen',
  'Shoujo',
  'Shounen',
  'Showbiz',
  'Slice of Life',
  'Space',
  'Sports',
  'Strategy Game',
  'Super Power',
  'Supernatural',
  'Survival',
  'Suspense',
  'Team Sports',
  'Time Travel',
  'Urban Fantasy',
  'Vampire',
  'Video Game',
  'Villainess',
  'Visual Arts',
  'Workplace'
];

const MAL_GENRE_SET = new Set(MAL_GENRES);
const MAL_LOWER_MAP = new Map(MAL_GENRES.map(g => [g.toLowerCase(), g]));

// Mapping from KKPhim Vietnamese categories and deprecated/alias MAL tags to official MAL genres.
// Value `null` drops format/meta tags that are not anime genres on MyAnimeList.
export const LEGACY_GENRE_MAP = {
  // Deprecated / renamed MAL & AnimeVietsub tags
  'dementia': 'Avant Garde',
  'demons': 'Mythology',
  'game': 'Video Game',
  'magic': 'Fantasy',
  'police': 'Detective',
  'shoujo ai': 'Girls Love',
  'yuri': 'Girls Love',
  'shounen ai': 'Boys Love',
  'yaoi': 'Boys Love',
  'thriller': 'Suspense',
  'cars': 'Racing',
  'romantic subtext': 'Love Status Quo',
  'cartoon': null,
  'live action': null,
  'movie': null,
  'tokusatsu': null,
  'anime': null,

  // KKPhim / PhimAPI Vietnamese categories
  'hành động': 'Action',
  'phiêu lưu': 'Adventure',
  'hài hước': 'Comedy',
  'hài': 'Comedy',
  'tâm lý': 'Drama',
  'chính kịch': 'Drama',
  'viễn tưởng': 'Fantasy',
  'khoa học': 'Sci-Fi',
  'khoa học viễn tưởng': 'Sci-Fi',
  'kinh dị': 'Horror',
  'bí ẩn': 'Mystery',
  'lãng mạn': 'Romance',
  'tình cảm': 'Romance',
  'học đường': 'School',
  'võ thuật': 'Martial Arts',
  'thể thao': 'Sports',
  'âm nhạc': 'Music',
  'lịch sử': 'Historical',
  'cổ trang': 'Historical',
  'chiến tranh': 'Military',
  'gia đình': 'Slice of Life',
  'đời thường': 'Slice of Life',
  'trẻ em': 'Kids',
  'thiếu nhi': 'Kids',
  'siêu nhiên': 'Supernatural',
  'hình sự': 'Detective',
  'tội phạm': 'Organized Crime',
  'giật gân': 'Suspense',
  'tài liệu': 'Educational',
  'thần thoại': 'Mythology',
  'ma cà rồng': 'Vampire',
  'xuyên không': 'Isekai',
  'chuyển sinh': 'Reincarnation',
  'hậu cung': 'Harem',
  'hoạt hình': null,
  'chiếu rạp': null,
  'phim bộ': null,
  'phim lẻ': null,
  '18+': 'Ecchi',
  'người lớn': 'Adult Cast',
  'action': 'Action',
  'mahou shoujo': 'Mahou Shoujo',
  'sci-fi': 'Sci-Fi',
  'slice of life': 'Slice of Life',
  'thriller': 'Suspense',
  'anti-hero': null,
  'cycling': 'Sports',
  'male protagonist': null,
  'female protagonist': null,
  'shounen': 'Shounen',
  'shoujo': 'Shoujo',
  'seinen': 'Seinen',
  'josei': 'Josei',
  'kids': 'Kids'
};

export function normalizeMalGenre(raw) {
  const cleaned = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!cleaned) return null;
  const lower = cleaned.toLowerCase();
  if (MAL_LOWER_MAP.has(lower)) return MAL_LOWER_MAP.get(lower);
  if (Object.prototype.hasOwnProperty.call(LEGACY_GENRE_MAP, lower)) {
    return LEGACY_GENRE_MAP[lower];
  }
  return null;
}

export function mapGenresToMal(input) {
  const list = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(',')
      : [];
  const result = [];
  const seen = new Set();
  for (const item of list) {
    const raw = typeof item === 'object' && item !== null ? item.name : item;
    const mapped = normalizeMalGenre(raw);
    if (mapped && !seen.has(mapped)) {
      seen.add(mapped);
      result.push(mapped);
    }
  }
  return result;
}

export function isMalGenreList(genres) {
  return Array.isArray(genres) && genres.length > 0 && genres.every(g => MAL_GENRE_SET.has(g));
}

const cleanText = v => String(v ?? '').trim().replace(/\s+/g, ' ');

export function normalizeMalSearchTitle(raw) {
  return cleanText(raw)
    .normalize('NFC')
    .toLowerCase()
    .replace(/\((?:19|20)\d{2}\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[-:–—]+\s*(?:tập|tap|episode|ep)\s*\d+.*$/i, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractSeasonNumber(raw) {
  const s = cleanText(raw).toLowerCase();
  const numMatch = s.match(/(?:season|part|phần|phan|mùa|mua)\s*(\d+)/i)
    || s.match(/\b(\d+)(?:st|nd|rd|th)\s*season\b/i);
  if (numMatch) return Number(numMatch[1]);
  const romanMatch = s.match(/\b(ii|iii|iv|v)\s*$/i);
  if (romanMatch) {
    return { ii: 2, iii: 3, iv: 4, v: 5 }[romanMatch[1].toLowerCase()] || null;
  }
  return null;
}

export function stripSeasonAndNoise(raw) {
  return cleanText(raw)
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\((?:19|20)\d{2}\)/g, ' ')
    .replace(/\b(?:vietsub|thuyết minh|thuyet minh|lồng tiếng|long tieng|full|hd)\b/gi, ' ')
    .replace(/(?:[-:–—]|\s)+(?:phần|phan|mùa|mua)\s*\d+.*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(str) {
  return new Set(normalizeMalSearchTitle(str).split(' ').filter(Boolean));
}

function jaccardSimilarity(a, b) {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

export function findBestMalMatch(candidates, movie) {
  if (!Array.isArray(candidates) || !candidates.length) return null;

  const movieTitles = [movie.originalTitle, movie.title]
    .map(t => normalizeMalSearchTitle(t))
    .filter(Boolean);
  if (!movieTitles.length) return null;

  const movieTokenSets = movieTitles.map(tokenSet);
  const movieYear = Number(movie.year) || null;
  const movieSeason = extractSeasonNumber(movie.originalTitle) ?? extractSeasonNumber(movie.title);
  const epCount = Array.isArray(movie.episodes) ? movie.episodes.length : 0;
  const durationMins = Number(String(movie.duration || '').match(/(\d+)\s*phút/i)?.[1] || 0);
  const expectsMovie = epCount === 1 && durationMins > 60;

  let best = null;
  let bestScore = -Infinity;

  for (const cand of candidates) {
    const candTitlesRaw = [
      cand.title,
      cand.title_english,
      cand.title_japanese,
      ...(Array.isArray(cand.titles) ? cand.titles.map(t => t?.title) : []),
    ].filter(Boolean);

    const candTitles = [...new Set(candTitlesRaw.map(normalizeMalSearchTitle).filter(Boolean))];
    if (!candTitles.length) continue;

    let titleScore = 0;
    for (let i = 0; i < movieTitles.length; i++) {
      const mt = movieTitles[i];
      const mSet = movieTokenSets[i];
      for (const ct of candTitles) {
        if (ct === mt) {
          titleScore = Math.max(titleScore, 100);
        } else if (ct.includes(mt) || mt.includes(ct)) {
          const sim = jaccardSimilarity(mSet, tokenSet(ct));
          titleScore = Math.max(titleScore, 45 + Math.round(sim * 40));
        } else {
          const sim = jaccardSimilarity(mSet, tokenSet(ct));
          titleScore = Math.max(titleScore, Math.round(sim * 75));
        }
      }
    }

    if (titleScore < 35) continue;

    let score = titleScore;

    const candYear = Number(cand.year || cand.aired?.prop?.from?.year) || null;
    if (movieYear && candYear) {
      const diff = Math.abs(movieYear - candYear);
      if (diff === 0) score += 30;
      else if (diff === 1) score += 15;
      else if (diff > 2) score -= 40;
    }

    const candSeason = extractSeasonNumber(cand.title) ?? extractSeasonNumber(cand.title_english);
    if (movieSeason !== null || candSeason !== null) {
      if (movieSeason === candSeason) score += 25;
      else if (movieSeason !== null && candSeason !== null) score -= 35;
      else score -= 10;
    }

    if (expectsMovie) {
      if (cand.type === 'Movie') score += 15;
      else if (cand.type === 'TV') score -= 10;
    } else if (epCount > 1) {
      if (['TV', 'ONA', 'OVA'].includes(cand.type)) score += 10;
    }

    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }

  return bestScore >= 55 ? best : null;
}

export function extractMalGenres(malAnime) {
  if (!malAnime || typeof malAnime !== 'object') return [];
  const combined = [
    ...(Array.isArray(malAnime.genres) ? malAnime.genres : []),
    ...(Array.isArray(malAnime.explicit_genres) ? malAnime.explicit_genres : []),
    ...(Array.isArray(malAnime.themes) ? malAnime.themes : []),
    ...(Array.isArray(malAnime.demographics) ? malAnime.demographics : []),
  ];
  return mapGenresToMal(combined);
}

export function monthToAnimeSeason(month) {
  const m = Number(month);
  if (!Number.isFinite(m) || m < 1 || m > 12) return '';
  if (m <= 3) return 'winter';
  if (m <= 6) return 'spring';
  if (m <= 9) return 'summer';
  return 'fall';
}

export function extractMalSeason(malAnime) {
  if (!malAnime || typeof malAnime !== 'object') return { animeSeason: '', animeSeasonYear: '' };
  const rawSeason = String(malAnime.season || '').trim().toLowerCase();
  const validSeason = ['winter', 'spring', 'summer', 'fall'].includes(rawSeason)
    ? rawSeason
    : monthToAnimeSeason(malAnime.aired?.prop?.from?.month);
  const rawYear = malAnime.year || malAnime.aired?.prop?.from?.year;
  const animeSeasonYear = rawYear ? String(rawYear) : '';
  return { animeSeason: validSeason, animeSeasonYear };
}

export function extractAniListSeason(media) {
  if (!media || typeof media !== 'object') return { animeSeason: '', animeSeasonYear: '' };
  const rawSeason = String(media.season || '').trim().toLowerCase();
  const validSeason = ['winter', 'spring', 'summer', 'fall'].includes(rawSeason)
    ? rawSeason
    : monthToAnimeSeason(media.startDate?.month);
  const rawYear = media.seasonYear || media.startDate?.year;
  const animeSeasonYear = rawYear ? String(rawYear) : '';
  return { animeSeason: validSeason, animeSeasonYear };
}

export function extractAniListGenres(media) {
  if (!media || typeof media !== 'object') return [];
  const tagNames = Array.isArray(media.tags)
    ? media.tags.filter(t => (t?.rank ?? 0) >= 40 && !t?.isMediaSpoiler).map(t => t.name)
    : [];
  const combined = [
    ...(Array.isArray(media.genres) ? media.genres : []),
    ...tagNames,
  ];
  return mapGenresToMal(combined);
}

const ANILIST_QUERY = `
query ($search: String) {
  Page(page: 1, perPage: 10) {
    media(search: $search, type: ANIME) {
      idMal
      format
      season
      seasonYear
      startDate { year month }
      title { romaji english native }
      synonyms
      genres
      tags { name rank isMediaSpoiler }
    }
  }
}`;

export function createMalGenreLookup({
  fetchImpl = fetch,
  sleep = ms => new Promise(r => setTimeout(r, ms)),
  delayMs = 450,
  timeoutMs = 4500,
  includeUserAgent = false,
} = {}) {
  const jikanCache = new Map();
  const anilistCache = new Map();
  let jikanUnavailable = false;

  async function searchJikan(query) {
    if (jikanUnavailable) return [];
    const key = query.toLowerCase();
    if (jikanCache.has(key)) return jikanCache.get(key);

    const url = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=10`;
    const headers = { Accept: 'application/json' };
    if (includeUserAgent) headers['User-Agent'] = 'CineSmart-Metadata-Sync/1.0';

    for (let attempt = 0; attempt < 2; attempt++) {
      await sleep(delayMs);
      let res;
      try {
        res = await fetchImpl(url, {
          headers,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        if (attempt === 1) {
          jikanUnavailable = true;
          return [];
        }
        await sleep(500);
        continue;
      }

      if (res.status === 429 || res.status >= 500) {
        if (attempt === 1) return [];
        await sleep(1500);
        continue;
      }
      if (!res.ok) return [];
      try {
        const json = await res.json();
        const items = Array.isArray(json?.data) ? json.data : [];
        jikanCache.set(key, items);
        return items;
      } catch {
        return [];
      }
    }
    return [];
  }

  async function searchAniList(query) {
    const key = query.toLowerCase();
    if (anilistCache.has(key)) return anilistCache.get(key);

    for (let attempt = 0; attempt < 2; attempt++) {
      await sleep(delayMs);
      let res;
      try {
        res = await fetchImpl('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ query: ANILIST_QUERY, variables: { search: query } }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        if (attempt === 1) return [];
        await sleep(500);
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt === 1) return [];
        await sleep(1500);
        continue;
      }
      if (!res.ok) return [];
      try {
        const json = await res.json();
        const rawList = Array.isArray(json?.data?.Page?.media) ? json.data.Page.media : [];
        const normalized = rawList.map(m => ({
          mal_id: m.idMal,
          title: m.title?.romaji || m.title?.english || '',
          title_english: m.title?.english || '',
          title_japanese: m.title?.native || '',
          titles: (m.synonyms || []).map(s => ({ title: s })),
          year: m.seasonYear || m.startDate?.year || null,
          type: m.format === 'MOVIE' ? 'Movie' : m.format || '',
          _rawAniList: m,
        }));
        anilistCache.set(key, normalized);
        return normalized;
      } catch {
        return [];
      }
    }
    return [];
  }

  return {
    async lookupGenres(movie) {
      const queries = [];
      const orig = stripSeasonAndNoise(movie.originalTitle);
      const title = stripSeasonAndNoise(movie.title);
      if (orig) queries.push(orig);
      if (title && title.toLowerCase() !== orig.toLowerCase()) queries.push(title);

      for (const q of queries) {
        const jikanCandidates = await searchJikan(q);
        const jikanMatch = findBestMalMatch(jikanCandidates, movie);
        if (jikanMatch) {
          const genres = extractMalGenres(jikanMatch);
          const { animeSeason, animeSeasonYear } = extractMalSeason(jikanMatch);
          if (genres.length || animeSeason) {
            return { genres, malId: jikanMatch.mal_id, malTitle: jikanMatch.title, animeSeason, animeSeasonYear };
          }
        }
      }

      // Fallback to AniList GraphQL when Jikan is unreachable or returns no match
      for (const q of queries) {
        const aniCandidates = await searchAniList(q);
        const aniMatch = findBestMalMatch(aniCandidates, movie);
        if (aniMatch?._rawAniList) {
          const genres = extractAniListGenres(aniMatch._rawAniList);
          const { animeSeason, animeSeasonYear } = extractAniListSeason(aniMatch._rawAniList);
          if (genres.length || animeSeason) {
            return { genres, malId: aniMatch.mal_id, malTitle: aniMatch.title, animeSeason, animeSeasonYear };
          }
        }
      }
      return null;
    },
  };
}

export const MAL_GENRE_DESCRIPTIONS = {
  'Action': 'Hành động, chiến đấu kịch tính, tốc độ cao',
  'Adult Cast': 'Nhân vật chính là người trưởng thành (công sở, xã hội)',
  'Adventure': 'Phiêu lưu, khám phá vùng đất mới và hành trình dài',
  'Anthropomorphic': 'Nhân vật là động vật/vật thể được nhân cách hóa',
  'Avant Garde': 'Phong cách nghệ thuật thử nghiệm, siêu thực, trừu tượng',
  'Award Winning': 'Tác phẩm từng đoạt các giải thưởng lớn về anime',
  'Boys Love': 'Tình cảm lãng mạn giữa các nhân vật nam',
  'CGDCT': 'Các cô gái dễ thương làm những điều dễ thương, đời thường',
  'Childcare': 'Nuôi dạy, chăm sóc trẻ nhỏ đầy ấm áp và hài hước',
  'Combat Sports': 'Các môn thể thao đối kháng (boxing, MMA, đấu vật...)',
  'Comedy': 'Hài hước, gây cười, tình huống vui nhộn giải trí',
  'Crossdressing': 'Nhân vật cải trang thành giới tính khác',
  'Delinquents': 'Học sinh cá biệt, băng nhóm đường phố, bất hảo',
  'Detective': 'Trinh thám, điều tra phá án và truy tìm thủ phạm',
  'Drama': 'Chính kịch, tâm lý sâu sắc, nhiều biến cố cảm xúc',
  'Ecchi': 'Có yếu tố gợi cảm, hớ hênh nhẹ nhàng (không phản cảm)',
  'Educational': 'Mang tính giáo dục, cung cấp kiến thức khoa học/đời sống',
  'Erotica': 'Nội dung tình cảm 18+ thiên về nhục cảm',
  'Fantasy': 'Thế giới giả tưởng, phép thuật, quái vật và anh hùng',
  'Gag Humor': 'Hài nhảm, mảng miếng gây cười liên tục và cường điệu',
  'Girls Love': 'Tình cảm lãng mạn giữa các nhân vật nữ',
  'Gore': 'Máu me, bạo lực trực diện và rùng rợn',
  'Gourmet': 'Ẩm thực, nấu ăn và khám phá món ngon',
  'Harem': 'Một nhân vật chính được nhiều người khác giới yêu thích',
  'Hentai': 'Nội dung người lớn 18+ (chỉ dành cho người trưởng thành)',
  'High Stakes Game': 'Trò chơi sinh tử, đánh cược tính mạng hoặc tài sản lớn',
  'Historical': 'Bối cảnh lịch sử có thật hoặc cổ đại',
  'Horror': 'Kinh dị, ma quái, tạo cảm giác rùng rợn và sợ hãi',
  'Idols (Female)': 'Thần tượng âm nhạc nữ, ca hát và biểu diễn sân khấu',
  'Idols (Male)': 'Thần tượng âm nhạc nam, nhóm nhạc và sân khấu',
  'Isekai': 'Xuyên không hoặc chuyển sinh sang một thế giới khác',
  'Iyashikei': 'Chữa lành tâm hồn, nhịp độ chậm rãi, thư giãn nhẹ nhàng',
  'Josei': 'Hướng tới phụ nữ trưởng thành, tình cảm và cuộc sống thực tế',
  'Kids': 'Dành cho trẻ em, nội dung trong sáng và dễ hiểu',
  'Love Polygon': 'Tình tay ba hoặc mối quan hệ tình cảm nhiều chiều phức tạp',
  'Love Status Quo': 'Hai nhân vật thích nhau nhưng cứ vờn nhau, chưa chịu tỏ tình',
  'Magical Sex Shift': 'Biến đổi giới tính nhờ phép thuật hoặc hiện tượng siêu nhiên',
  'Mahou Shoujo': 'Thiếu nữ phép thuật biến hình chiến đấu bảo vệ công lý',
  'Martial Arts': 'Võ thuật, giao đấu tay đôi bằng kỹ năng và chiêu thức',
  'Mecha': 'Robot khổng lồ, người máy chiến đấu và cơ khí tương lai',
  'Medical': 'Y học, bác sĩ, bệnh viện và cứu chữa bệnh nhân',
  'Military': 'Quân đội, chiến tranh, chiến thuật và binh lính',
  'Music': 'Âm nhạc, ban nhạc, nhạc cụ và đam mê ca hát',
  'Mystery': 'Bí ẩn, câu đố chưa có lời giải, kích thích tò mò',
  'Mythology': 'Thần thoại, truyền thuyết, các vị thần và ác quỷ',
  'Organized Crime': 'Thế giới ngầm, Yakuza, mafia và tội phạm có tổ chức',
  'Otaku Culture': 'Văn hóa Otaku, anime, manga, game và figure',
  'Parody': 'Châm biếm, nhại lại các tác phẩm hoặc mô-típ nổi tiếng',
  'Performing Arts': 'Nghệ thuật biểu diễn (kịch, múa, trượt băng nghệ thuật...)',
  'Pets': 'Thú cưng dễ thương và tình cảm giữa người với vật nuôi',
  'Psychological': 'Tâm lý học, đấu trí, dằn vặt nội tâm và thao túng',
  'Racing': 'Đua xe, tốc độ cao và những chặng đua kịch tính',
  'Reincarnation': 'Tái sinh, đầu thai sang kiếp mới giữ lại ký ức cũ',
  'Reverse Harem': 'Một nữ chính được nhiều chàng trai vây quanh theo đuổi',
  'Romance': 'Tình cảm lãng mạn, rung động và chuyện tình đôi lứa',
  'Samurai': 'Kiếm sĩ Samurai, tinh thần võ sĩ đạo Nhật Bản xưa',
  'School': 'Học đường, tuổi học trò, lớp học và câu lạc bộ',
  'Sci-Fi': 'Khoa học viễn tưởng, công nghệ tương lai và vũ trụ',
  'Seinen': 'Hướng tới nam giới trưởng thành, nội dung sâu sắc/gai góc',
  'Shoujo': 'Hướng tới thiếu nữ, lãng mạn, mộng mơ và tinh tế',
  'Shounen': 'Hướng tới thiếu niên nam, nhiệt huyết, tình bạn và vượt khó',
  'Showbiz': 'Giới giải trí, hậu trường nghệ sĩ, diễn viên và truyền thông',
  'Slice of Life': 'Đời thường nhẹ nhàng, câu chuyện sinh hoạt hằng ngày',
  'Space': 'Ngoài không gian, du hành vũ trụ và các hành tinh xa xôi',
  'Sports': 'Thể thao, thi đấu đồng đội và tinh thần vươn tới đỉnh cao',
  'Strategy Game': 'Trò chơi trí tuệ, cờ, bài và đấu chiến thuật cân não',
  'Super Power': 'Siêu năng lực, dị năng đặc biệt vượt qua người thường',
  'Supernatural': 'Siêu nhiên, linh hồn, ma quỷ và hiện tượng kỳ bí',
  'Survival': 'Sinh tồn khắc nghiệt, đấu tranh để sống sót',
  'Suspense': 'Hồi hộp, căng thẳng tột độ, kịch tính đến nghẹt thở',
  'Team Sports': 'Thể thao đồng đội (bóng đá, bóng rổ, bóng chuyền...)',
  'Time Travel': 'Du hành thời gian, quay về quá khứ hoặc tới tương lai',
  'Urban Fantasy': 'Giả tưởng đô thị, phép thuật/quái vật ẩn mình trong thành phố hiện đại',
  'Vampire': 'Ma cà rồng, huyết tộc và thế giới bóng đêm',
  'Video Game': 'Trò chơi điện tử, thực tế ảo (VRMMO) và thế giới game',
  'Villainess': 'Nữ phản diện trọng sinh tìm cách tránh kết cục bi thảm',
  'Visual Arts': 'Hội họa, vẽ truyện tranh, nhiếp ảnh và nghệ thuật thị giác',
  'Workplace': 'Công sở, nghề nghiệp, đồng nghiệp và môi trường làm việc'
};

export function getGenreDescription(genre) {
  return MAL_GENRE_DESCRIPTIONS[genre] || '';
}
