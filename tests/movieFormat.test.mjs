import test from 'node:test';
import assert from 'node:assert/strict';
import { durationMinutes, isFeatureMovie, withMovieFormat } from '../src/utils/movieFormat.js';
import { normalizePhimApiMovie, movieToTSV, planImport } from '../src/utils/movieImport.js';
import { parseTSV } from '../src/utils/MagicParser.js';

const oneEpisode = { episodes: [{ name: '1', url: 'https://example.com/full.m3u8' }] };

test('runtime parsing uses actual minutes, including hours and clocks', () => {
  for (const [value, expected] of [['109 phút', 109], ['1 giờ 5 phút', 65], ['1h30', 90], ['1h', 60], ['01:00:30', 60.5], ['90 phút/tập', 90], [61, 61]]) {
    assert.equal(durationMinutes(value), expected);
  }
  for (const value of [undefined, '', 'Đang cập nhật', 'Full', 'Tập 1', 0, -2, Infinity]) assert.equal(durationMinutes(value), null);
});

test('Movie requires strictly over 60 minutes and one episode, not an incomplete series', () => {
  assert.equal(isFeatureMovie({ ...oneEpisode, duration: '60 phút' }), false);
  assert.equal(isFeatureMovie({ ...oneEpisode, duration: '61 phút' }), true);
  assert.equal(isFeatureMovie({ ...oneEpisode, duration: '109 phút', totalEpisodes: '12' }), false);
  assert.equal(isFeatureMovie({ ...oneEpisode }), false);
  assert.equal(isFeatureMovie({ duration: '109 phút' }), false);
  assert.equal(isFeatureMovie({ duration: '109 phút', episodes: [...oneEpisode.episodes, { name: '2', url: 'https://example.com/2.m3u8' }] }), false);
  assert.equal(isFeatureMovie({ duration: '109 phút', episodes: [...oneEpisode.episodes, { ...oneEpisode.episodes[0], name: 'Tập 01' }] }), true);
});

test('legacy runtime metadata classifies the reported Conan film without mutating records', () => {
  const original = { ...oneEpisode, sourceSlug: 'tham-tu-lung-danh-conan-15-15-phut-tinh-lang', genres: ['Bí Ẩn'] };
  const result = withMovieFormat(original);
  assert.equal(result.duration, '109 phút');
  assert.equal(result.format, 'Movie');
  assert.deepEqual(result.genres, ['Bí Ẩn', 'Movie']);
  assert.deepEqual(original.genres, ['Bí Ẩn']);
  assert.equal(original.duration, undefined);
  assert.deepEqual(withMovieFormat(result), result);
  assert.equal(isFeatureMovie(withMovieFormat({ ...original, duration: '24 phút' })), false);
});

test('source import and Magic Import retain runtime and total episodes across TSV and updates', () => {
  const incoming = normalizePhimApiMovie({ status: true, movie: { name: 'Feature', slug: 'feature', time: '109 phút', episode_total: '1' }, episodes: [{ server_data: [{ name: 'Full', link_m3u8: 'https://example.com/full.m3u8' }] }] });
  const [parsed] = parseTSV(movieToTSV(incoming));
  assert.equal(parsed.duration, '109 phút');
  assert.equal(parsed.totalEpisodes, '1');
  assert.equal(isFeatureMovie(parsed), true);
  const created = planImport(null, parsed).data;
  assert.equal(created.duration, '109 phút');
  const legacy = { ...created };
  delete legacy.duration;
  delete legacy.totalEpisodes;
  const update = planImport(legacy, parsed);
  assert.equal(update.action, 'update');
  assert.equal(update.data.duration, '109 phút');
  assert.equal(update.data.totalEpisodes, '1');
});
