import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { extractCleanEpisodeNumber } from '../../utils/textUtils';

const CHUNK_SIZE = 100;

const EpisodeSelector = ({
  episodes = [],
  servers = [],
  activeServerName = '',
  onSelectServer,
  activeEpisode,
  onSelectEpisode,
  getEpisodeLink,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const resolvedServers = useMemo(() => {
    if (Array.isArray(servers) && servers.length > 0) return servers;
    return [{ name: 'Vietsub', episodes: Array.isArray(episodes) ? episodes : [] }];
  }, [servers, episodes]);

  const isLockedSingleServer = resolvedServers.length <= 1;
  const currentServerName = activeServerName || resolvedServers[0]?.name || 'Vietsub';

  const normalized = useMemo(() => (
    (Array.isArray(episodes) ? episodes : []).map((ep, idx) => {
      const raw = ep.number ?? ep.name ?? (idx + 1);
      const num = extractCleanEpisodeNumber(raw, idx + 1);
      const label = ep.title || (String(num).toLowerCase().includes('tập') ? String(num) : `Tập ${num}`);
      return { raw: ep, idx, num: String(num), label };
    })
  ), [episodes]);

  const totalCount = normalized.length;
  const chunkCount = Math.ceil(totalCount / CHUNK_SIZE);

  const activeIndex = useMemo(() => {
    const cleanActive = extractCleanEpisodeNumber(activeEpisode || '1', '1');
    return normalized.findIndex(item => item.num === String(cleanActive));
  }, [normalized, activeEpisode]);

  const [selectedRangeIndex, setSelectedRangeIndex] = useState(
    activeIndex >= 0 ? Math.floor(activeIndex / CHUNK_SIZE) : 0
  );

  useEffect(() => {
    if (activeIndex >= 0) {
      setSelectedRangeIndex(Math.floor(activeIndex / CHUNK_SIZE));
    }
  }, [activeIndex]);

  const visibleEpisodes = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (q) {
      return normalized.filter(item =>
        item.num.toLowerCase().includes(q) || item.label.toLowerCase().includes(q)
      );
    }
    return normalized.slice(selectedRangeIndex * CHUNK_SIZE, (selectedRangeIndex + 1) * CHUNK_SIZE);
  }, [normalized, searchTerm, selectedRangeIndex]);

  const cleanActiveStr = String(extractCleanEpisodeNumber(activeEpisode || '1', '1'));

  return (
    <div className="space-y-4">
      {/* Audio / Subtitle Server Switcher (Locked display-only when <= 1 option) */}
      <div className="flex flex-wrap items-center gap-2.5">
        {resolvedServers.map((srv) => {
          const isCurrent = srv.name === currentServerName;
          const srvCount = Array.isArray(srv.episodes) ? srv.episodes.length : 0;
          return (
            <button
              key={srv.name}
              type="button"
              disabled={isLockedSingleServer}
              onClick={() => !isLockedSingleServer && onSelectServer?.(srv.name)}
              title={isLockedSingleServer ? `Phim hiện chỉ có bản ${srv.name}` : `Chuyển sang bản ${srv.name}`}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold border flex items-center gap-2 transition-all ${
                isLockedSingleServer
                  ? 'bg-[#1a1f36] text-emerald-400 border-emerald-500/40 cursor-default opacity-90'
                  : isCurrent
                    ? 'bg-[#1a1f36] text-red-400 border-red-500 shadow-[0_0_12px_rgba(239,68,68,0.35)] cursor-pointer'
                    : 'bg-[#1a1f36]/70 text-gray-200 border-white/15 hover:border-white/35 hover:text-white cursor-pointer'
              }`}
            >
              <span>▶</span>
              <span>{srv.name}</span>
              {srvCount > 0 && (
                <span className="px-2 py-0.5 rounded-md bg-amber-400 text-black font-black text-[10px]">
                  {srvCount} tập
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Episode Search Input */}
      {totalCount > 12 && (
        <div className="relative">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Tìm tập... (vd: 5, 12, 1016)"
            className="w-full py-2.5 pl-4 pr-9 rounded-xl bg-background/80 border border-white/15 text-xs sm:text-sm text-white placeholder-gray-400 focus:outline-none focus:border-neon-red transition-colors"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-2.5 text-xs text-gray-400 hover:text-white cursor-pointer"
              title="Xóa tìm kiếm"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* 100-Episode Range Tabs */}
      {chunkCount > 1 && (
        <div className="flex flex-wrap gap-2 pb-3 border-b border-white/10">
          {Array.from({ length: chunkCount }).map((_, chunkIdx) => {
            const startEp = chunkIdx * CHUNK_SIZE + 1;
            const endEp = Math.min(totalCount, (chunkIdx + 1) * CHUNK_SIZE);
            const isSelectedRange = !searchTerm.trim() && selectedRangeIndex === chunkIdx;

            return (
              <button
                key={`ep-range-${chunkIdx}`}
                type="button"
                onClick={() => {
                  setSearchTerm('');
                  setSelectedRangeIndex(chunkIdx);
                }}
                className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all border cursor-pointer ${
                  isSelectedRange
                    ? 'bg-red-600 text-white border-red-500 shadow-[0_0_12px_rgba(225,29,72,0.55)]'
                    : 'bg-surface/80 text-gray-300 hover:text-white border-white/10 hover:border-white/30 hover:bg-white/10'
                }`}
              >
                {startEp} - {endEp}
              </button>
            );
          })}
        </div>
      )}

      {/* Episode Grid */}
      {visibleEpisodes.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-4">Không tìm thấy tập phù hợp.</p>
      ) : (
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2 max-h-72 overflow-y-auto custom-scrollbar pr-1">
          {visibleEpisodes.map((item) => {
            const isActive = item.num === cleanActiveStr;
            const baseClass = `py-2.5 px-2 rounded-xl text-center text-xs font-bold transition-all duration-200 border cursor-pointer ${
              isActive
                ? 'bg-neon-red text-white border-neon-red shadow-[0_0_15px_#e50914]'
                : 'bg-background/80 text-gray-300 hover:text-white border-glass-border hover:border-neon-red/50 hover:bg-neon-red/20'
            }`;

            if (getEpisodeLink) {
              return (
                <Link
                  key={`${item.idx}-${item.num}`}
                  to={getEpisodeLink(item.raw, item.num)}
                  onClick={() => onSelectEpisode?.(item.num)}
                  className={baseClass}
                >
                  {item.label}
                </Link>
              );
            }

            return (
              <button
                key={`${item.idx}-${item.num}`}
                type="button"
                onClick={() => onSelectEpisode?.(item.num)}
                className={baseClass}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default EpisodeSelector;
