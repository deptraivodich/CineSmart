import React, { useEffect, useRef, useState } from 'react';
import { searchKKPhim, importKKPhim } from '../../services/kkphimSearch';

const KKPhimSearch = ({ readOnly = false }) => {
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ movies: [], totalPages: 1 });
  const [selected, setSelected] = useState(new Map());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState([]);
  const importController = useRef(null);
  const running = useRef(false);

  useEffect(() => () => importController.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    if (keyword.trim().length < 2 || readOnly) { setResult({ movies: [], totalPages: 1 }); setLoading(false); return () => controller.abort(); }
    setLoading(true); setError('');
    const timer = setTimeout(async () => {
      try {
        const data = await searchKKPhim(keyword.trim(), page, controller.signal);
        if (!controller.signal.aborted) setResult(data);
      } catch (error) { if (!controller.signal.aborted) { setError(error.message); setResult({ movies: [], totalPages: 1 }); } }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [keyword, page, readOnly]);

  const toggle = movie => setSelected(previous => {
    const next = new Map(previous);
    if (next.has(movie.slug)) next.delete(movie.slug); else next.set(movie.slug, movie);
    return next;
  });
  const startImport = async slugs => {
    if (running.current || readOnly || !slugs.length) return;
    running.current = true; setImporting(true); setProgress([]); setError('');
    const controller = new AbortController();
    importController.current = controller;
    try {
      await importKKPhim(slugs, { signal: controller.signal, onResult: entry => {
        if (controller.signal.aborted) return;
        setProgress(previous => [...previous, entry]);
        if (entry.ok) setSelected(previous => { const next = new Map(previous); next.delete(entry.slug); return next; });
      } });
    } catch (error) { if (!controller.signal.aborted) setError(error.message); }
    finally { running.current = false; if (!controller.signal.aborted) setImporting(false); }
  };

  return <section className="p-4 sm:p-6 rounded-2xl glass-panel space-y-5 min-w-0">
    <div><h2 className="text-xl font-extrabold text-emerald-300">Tìm phim trên KKPhim</h2>
      <p className="mt-1 text-xs text-gray-400">Tìm theo tên Việt hoặc tên gốc. Import sẽ lấy thông tin và toàn bộ tập hiện có của phim đã chọn, rồi lưu lên Cloud. Giữ trang mở đến khi hoàn tất.</p></div>
    <label className="block text-sm text-gray-300">Tên phim cần tìm
      <input value={keyword} onChange={event => { setKeyword(event.target.value); setPage(1); }} maxLength={100} disabled={readOnly || importing} placeholder="Nhập ít nhất 2 ký tự..."
        className="mt-2 block w-full p-3 rounded-xl bg-black/30 border border-white/15 text-white focus:outline-none focus:border-emerald-400 disabled:opacity-50" />
    </label>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-sm text-gray-300">Đã chọn: {selected.size} phim</span>
      <button type="button" onClick={() => startImport([...selected.keys()])} disabled={readOnly || importing || selected.size === 0} className="px-5 py-2.5 bg-emerald-600 rounded-xl text-white font-bold text-sm disabled:opacity-40">{importing ? 'Đang import...' : 'Import phim đã chọn'}</button>
    </div>
    {selected.size > 0 && <div role="group" aria-label="Phim đã chọn" className="flex flex-wrap gap-2">
      {[...selected.values()].map(movie => <button key={movie.slug} type="button" disabled={importing} onClick={() => toggle(movie)} className="px-3 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-xs text-emerald-200 disabled:opacity-50">{movie.title} ×</button>)}
    </div>}
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {loading && <p role="status" className="text-sm text-gray-400">Đang tìm phim...</p>}
    {!loading && keyword.trim().length >= 2 && !result.movies.length && !error && <p className="text-sm text-gray-400">Không tìm thấy phim phù hợp.</p>}
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {!loading && result.movies.map(movie => <article key={movie.slug} className="p-3 flex gap-3 rounded-xl bg-black/25 border border-white/10 min-w-0">
        {movie.poster && <img src={movie.poster} alt="" loading="lazy" className="w-16 h-24 object-cover rounded-lg shrink-0" />}
        <div className="min-w-0 flex-1 space-y-2">
          <label className="flex items-start gap-2 text-sm font-bold text-white"><input type="checkbox" checked={selected.has(movie.slug)} disabled={importing} onChange={() => toggle(movie)} className="mt-1 shrink-0" /><span className="break-words">{movie.title}</span></label>
          <p className="text-xs text-gray-400 break-words">{movie.originalTitle} · {movie.year}</p>
          <p className="text-xs text-emerald-300">{movie.episodeCurrent || 'Xem chi tiết khi import'}</p>
          <button type="button" disabled={readOnly || importing} onClick={() => startImport([movie.slug])} className="px-3 py-1.5 rounded-lg border border-emerald-400/40 text-emerald-300 text-xs font-bold disabled:opacity-40">Import phim này</button>
        </div>
      </article>)}
    </div>
    {!loading && result.movies.length > 0 && <div className="flex items-center justify-center gap-4 text-sm">
      <button type="button" disabled={page <= 1 || importing} onClick={() => setPage(value => value - 1)} className="disabled:opacity-30">Trang trước</button>
      <span className="text-gray-400">Trang {page}/{result.totalPages}</span>
      <button type="button" disabled={page >= result.totalPages || importing} onClick={() => setPage(value => value + 1)} className="disabled:opacity-30">Trang sau</button>
    </div>}
    {progress.length > 0 && <div aria-live="polite" className="space-y-2 text-xs">
      {progress.map(entry => <p key={entry.slug} className={entry.ok ? 'text-emerald-300' : 'text-red-300'}>{entry.title || selected.get(entry.slug)?.title || entry.slug}: {entry.ok ? entry.action === 'skip' ? `Đã có đủ ${entry.episodes} tập, không ghi trùng.` : `Đã lưu ${entry.episodes} tập lên Cloud.` : `Chưa import được: ${entry.error}`}</p>)}
    </div>}
  </section>;
};

export default KKPhimSearch;
