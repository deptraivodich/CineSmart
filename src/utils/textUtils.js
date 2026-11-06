/**
 * textUtils.js - Text normalization utilities with Defensive Fallbacks
 */

/**
 * Formats a Vietnamese title to Sentence Case:
 * Only capitalizes the very first letter of the sentence; the rest is lowercased.
 * Defensive against undefined/null/non-string values.
 * Example: "THẤT NGHIỆP CHUYỂN SINH (PHẦN 3)" -> "Thất nghiệp chuyển sinh (phần 3)"
 * Example: "Chuyến Du Hành Dị Giới Của Nhà Thu Thập Nguyên Liệu" -> "Chuyến du hành dị giới của nhà thu thập nguyên liệu"
 */
export const formatVietnameseSentenceCase = (text) => {
  if (text === null || text === undefined) return 'Phim chưa có tên';
  const str = typeof text === 'string' ? text : String(text);
  const trimmed = str.trim();
  if (!trimmed) return 'Phim chưa có tên';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
};

export { generateSlug } from './slugUtils.js';

/**
 * Defensive Helper: Extracts clean episode number/string without repeated "Tập" prefixes
 * Example: "Tập 01" -> "1"
 * Example: "Tập 1" -> "1"
 * Example: "02" -> "2"
 * Example: "Tập Tập 03" -> "3"
 * Example: "Full" -> "Full"
 */
export const extractCleanEpisodeNumber = (name, fallback = '1') => {
  if (name === null || name === undefined || name === '') {
    return String(fallback);
  }
  const str = String(name).trim();
  // Strip repeated "Tập", "Tap", "Ep", "Episode" prefixes
  const stripped = str.replace(/^(?:tập|tap|ep|episode)[\s:–-]*/gi, '').trim();
  // If purely digits, convert '01', '02', '1' -> '1', '2'
  if (/^\d+$/.test(stripped)) {
    return String(parseInt(stripped, 10));
  }
  return stripped || String(fallback);
};

/**
 * Defensive Helper: Formats an episode title cleanly for button/display
 * Example: "1" -> "Tập 1"
 * Example: "Tập 01" -> "Tập 1"
 * Example: "Tập Tập 02" -> "Tập 2"
 * Example: "Full" -> "Full"
 */
export const formatEpisodeTitle = (name, fallback = '1') => {
  const clean = extractCleanEpisodeNumber(name, fallback);
  if (/^\d+$/.test(clean)) {
    return `Tập ${clean}`;
  }
  if (/^(?:tập|tap)\b/i.test(clean)) {
    return clean;
  }
  if (clean.toLowerCase() === 'full' || clean.toLowerCase() === 'trọn bộ') {
    return clean;
  }
  return `Tập ${clean}`;
};

/**
 * Defensive Helper: Deduplicates an array of episodes by normalized number and video URL
 * Guarantees that duplicate episodes (e.g. "1" and "Tập 01" pointing to the same or conflicting stream)
 * are cleanly merged into one single episode in correct numeric order.
 */
export const deduplicateEpisodes = (episodesList) => {
  if (!Array.isArray(episodesList)) return [];
  const seenKeys = new Set();
  const seenUrls = new Set();
  const result = [];

  for (let i = 0; i < episodesList.length; i++) {
    const ep = episodesList[i];
    if (!ep) continue;

    const rawName = ep.name || ep.number || '';
    const rawUrl = String(ep.url || ep.m3u8Url || '').trim();
    const cleanNum = extractCleanEpisodeNumber(rawName, i + 1);

    // If identical stream URL is already seen, skip duplicate
    if (rawUrl && seenUrls.has(rawUrl)) {
      continue;
    }

    // If identical episode number/key is already seen, skip duplicate
    const epKey = cleanNum.toLowerCase();
    if (seenKeys.has(epKey)) {
      continue;
    }

    if (epKey) seenKeys.add(epKey);
    if (rawUrl) seenUrls.add(rawUrl);

    result.push({
      ...ep,
      name: ep.name ? String(ep.name) : cleanNum,
      cleanNumber: cleanNum
    });
  }

  // Sort episodes in numeric order
  result.sort((a, b) => {
    const numA = parseInt(a.cleanNumber || extractCleanEpisodeNumber(a.name || a.number), 10);
    const numB = parseInt(b.cleanNumber || extractCleanEpisodeNumber(b.name || b.number), 10);
    if (!isNaN(numA) && !isNaN(numB)) {
      return numA - numB;
    }
    return 0;
  });

  return result;
};

