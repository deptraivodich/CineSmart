import React, { useState, useEffect } from 'react';
import { parseTSV, getTSVTemplateExample } from '../../utils/MagicParser';
import { db } from '../../services/firebase';
import { collection, getDocsFromServer, doc, runTransaction } from 'firebase/firestore';
import { findMovie, planImport, episodeKey, MOVIE_FIELDS, sourceMovieId } from '../../utils/movieImport.js';
import { crawlManualUrl, detailsToTSV } from '../../services/phimApiImport.js';

const MagicImport = ({ readOnly = false }) => {
  const [rawText, setRawText] = useState('');
  const [parsedData, setParsedData] = useState([]);
  const [, setExistingMovies] = useState([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [expandedEpisodeIndex, setExpandedEpisodeIndex] = useState(null);

  // States for Automated PhimAPI Crawler (Support List & Single URLs)
  const [targetUrl, setTargetUrl] = useState('');
  const [isFetchingApi, setIsFetchingApi] = useState(false);
  const [crawlStatus, setCrawlStatus] = useState(null);

  // Fetch API crawler logic (Runs Backend FastAPI Multi-threaded Crawl with Client Fallback)
  const handleFetchApi = async () => {
    if (readOnly) return;
    if (!targetUrl.trim()) {
      setCrawlStatus({ type: 'error', text: 'Vui lòng nhập URL phim hoặc link trang danh sách phim!' });
      return;
    }

    setIsFetchingApi(true);
    setCrawlStatus({ type: 'info', text: '🌐 Đang gọi API bóc tách dữ liệu phim (Đa luồng)...' });
    setErrorMessage('');

    try {
      const rawInput = targetUrl.trim();
      let tsvResult = '';
      let crawledCount = 0;

      // 1. Gọi API Backend FastAPI (Chạy cào ĐA LUỒNG Asyncio + Httpx)
      const backendApiUrl = import.meta.env.VITE_CRAWLER_API_URL || 'http://localhost:8000/api/crawl';
      try {
        const response = await fetch(backendApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: rawInput })
        });

        if (response.ok) {
          const resData = await response.json();
          if (resData.status && (resData.movies?.length || resData.tsv)) {
            tsvResult = resData.movies?.length ? detailsToTSV(resData.movies) : resData.tsv;
            crawledCount = resData.crawled_count || 1;
          }
        }
      } catch (backendError) {
        console.warn("Backend API chưa chạy hoặc offline, chuyển sang Client Fallback:", backendError);
      }

      // 2. Client-side Fetch Fallback nếu Backend chưa được khởi chạy
      if (!tsvResult) {
        const result = await crawlManualUrl(rawInput);
        tsvResult = result.tsv;
        crawledCount = result.count;
      }

      setRawText(tsvResult);
      setCrawlStatus({ 
        type: 'success', 
        text: `🎉 Fetch thành công! Đã tự động cào và điền dữ liệu TSV của ${crawledCount} phim vào ô bên dưới.` 
      });
    } catch (err) {
      setCrawlStatus({ 
        type: 'error', 
        text: `❌ Lỗi: ${err.message || 'Không thể cào dữ liệu phim.'}` 
      });
    } finally {
      setIsFetchingApi(false);
    }
  };

  // Fetch current existing movies in database to detect matches
  const loadExistingMovies = async () => {
    const snapshot = await getDocsFromServer(collection(db, 'movies'));
    const list = snapshot.docs.map(d => ({ ...d.data(), id: d.id }));
    setExistingMovies(list);
    return list;
  };

  useEffect(() => {
    loadExistingMovies().catch(() => setErrorMessage('Firestore unavailable. Check Admin permissions and connection.'));
  }, []);

  /**
   * Logic Phân Tích & Kiểm Tra Trùng Khớp 3 Kịch Bản:
   * 1. Kịch bản 1 ('new'): Phim chưa có trong DB -> [+ Tạo mới (X tập)]
   * 2. Kịch bản 2 ('update'): Phim đã có trong DB + CÓ TẬP MỚI -> [🔄 Tự Động Gộp (+X Tập Mới)]
   * 3. Kịch bản 3 ('duplicate'): Phim đã có trong DB + KHÔNG CÓ TẬP MỚI -> [✅ Đã Trùng - Bỏ qua]
   */
  const handleParse = async () => {
    setErrorMessage('');
    setParsedData([]);
    setUploadStatus(null);
    if (!rawText.trim()) {
      setErrorMessage('Vui lòng dán dữ liệu TSV từ Excel vào ô văn bản bên dưới.');
      return;
    }

    setIsParsing(true);
    try {
      const currentDbMovies = await loadExistingMovies();
      const results = parseTSV(rawText);

      const annotatedResults = [];
      const catalog = [...currentDbMovies];
      for (const movie of results) {
        const match = findMovie(catalog, movie);
        const plan = planImport(match, movie);
        const existingEps = Array.isArray(match?.episodes) ? match.episodes : [];
        const merged = plan.data.episodes || existingEps;
        const row = {
          ...movie,
          movieStatus: movie.status,
          status: plan.action === 'skip' ? 'duplicate' : plan.action,
          isExistingMatch: Boolean(match),
          matchedMovieId: match?.id,
          matchedMovieTitle: match?.title,
          hasNewEpisodes: plan.added > 0,
          updateReasonText: plan.added ? `🔄 Gộp +${plan.added} tập mới` : '🔄 Thông tin hoặc liên kết tập phim có thay đổi',
          newEpisodes: movie.episodes.filter(ep => !existingEps.some(old => episodeKey(old.name) === episodeKey(ep.name))),
          newEpisodesCount: plan.added,
          existingEpisodesCount: existingEps.length,
          totalAfterMergeCount: merged.length,
          mergedEpisodes: merged
        };
        annotatedResults.push(row);
        // Detect duplicate entries within the same pasted list as well.
        if (!match) catalog.push({ ...plan.data, id: 'preview-' + annotatedResults.length });
      }

      setParsedData(annotatedResults);
      if (annotatedResults.length === 0) {
        setErrorMessage('Không tìm thấy dòng dữ liệu hợp lệ trong chuỗi TSV.');
      }
    } catch (err) {
      setErrorMessage(err.message || 'Lỗi khi phân tích cú pháp TSV.');
    } finally {
      setIsParsing(false);
    }
  };

  const handleLoadTemplate = () => {
    const template = getTSVTemplateExample();
    setRawText(template);
    setErrorMessage('');
  };

  // Nạp dữ liệu lên Database (Bỏ qua các phim có status === 'duplicate')
  const handleUploadToFirebase = async () => {
    if (readOnly) return;
    const validMovies = parsedData.filter(m => m.isValid && m.status !== 'duplicate');
    if (!validMovies.length) {
      setErrorMessage('Không có phim mới hoặc thay đổi hợp lệ để nạp.');
      return;
    }
    setIsUploading(true);
    setErrorMessage('');
    setUploadStatus({ type: 'info', text: 'Đang xác minh và ghi Firestore...' });
    let written = 0, updated = 0, skipped = 0;
    try {
      const catalog = await loadExistingMovies();
      for (const movie of validMovies) {
        const incoming = Object.fromEntries([...MOVIE_FIELDS, 'episodes'].filter(k => movie[k] !== undefined).map(k => [k, movie[k]]));
        incoming.status = movie.movieStatus || 'ongoing';
        const match = findMovie(catalog, incoming);
        const ref = match ? doc(db, 'movies', match.id) : incoming.sourceSlug ? doc(db, 'movies', sourceMovieId(incoming.sourceSlug)) : doc(collection(db, 'movies'));
        const saved = await runTransaction(db, async tx => {
          const snapshot = await tx.get(ref);
          const existing = snapshot.exists() ? snapshot.data() : null;
          const plan = planImport(existing, incoming);
          if (plan.action === 'new') tx.set(ref, plan.data);
          else if (plan.action === 'update') tx.update(ref, plan.data);
          return { action: plan.action, movie: { ...existing, ...plan.data, id: ref.id } };
        });
        if (saved.action === 'skip') skipped++;
        else { written++; if (saved.action === 'update') updated++; }
        const index = catalog.findIndex(m => m.id === ref.id);
        if (index < 0) catalog.push(saved.movie); else catalog[index] = saved.movie;
      }
      // Cache only the documents confirmed by Firestore, using their real IDs.
      try { localStorage.setItem('210loliphim_movies_db', JSON.stringify(catalog)); }
      catch { console.warn('Không cập nhật được cache; dữ liệu đã được ghi Firestore.'); }
      window.dispatchEvent(new CustomEvent('210loliphim_movies_updated'));
      setUploadStatus({ type: 'success', text: `Đã ghi Firestore ${written} phim (cập nhật ${updated}, bỏ qua ${skipped}).` });
      await loadExistingMovies();
    } catch (err) {
      setErrorMessage('Không hoàn tất ghi Firestore: ' + err.message);
      setUploadStatus({ type: 'error', text: `Đã ghi ${written} phim trước lỗi. Hãy kiểm tra kết nối/quyền Firestore và phân tích lại; không có thông báo thành công bằng cache.` });
    } finally {
      setIsUploading(false);
    }
  };

  const countNew = parsedData.filter(m => m.status === 'new').length;
  const countUpdate = parsedData.filter(m => m.status === 'update').length;
  const countDuplicate = parsedData.filter(m => m.status === 'duplicate').length;

  return (
    <div className="w-full space-y-6">
      {/* Component Header & Actions */}
      <div className="glass-panel p-6 rounded-2xl space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <span>✨ Magic Import & Crawl Phim Đa Luồng</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold">
                Multi-Thread Enabled
              </span>
            </h2>
            <p className="text-xs text-gray-400 mt-1">
              Hỗ trợ nhập link <strong>CẢ TRANG DANH SÁCH</strong> hoặc <strong>1 Phim lẻ</strong>. Tự động phân loại 3 kịch bản: <strong>Tạo mới</strong>, <strong>Gộp tập mới</strong>, và <strong>Bỏ qua trùng hoàn toàn</strong>.
            </p>
          </div>

          <button 
            type="button"
            onClick={handleLoadTemplate}
            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold text-gray-200 border border-white/15 transition-all flex items-center gap-1.5 self-start md:self-auto cursor-pointer"
          >
            <span>📄 Nạp Bảng Mẫu Phim Bộ (Series)</span>
          </button>
        </div>

        {/* Automated PhimAPI Crawler Input Section */}
        <div className="p-4 rounded-xl bg-surface-card/60 border border-amber-500/30 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
            <label htmlFor="target_url" className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
              <span>🚀 Tự Động Cào Phim Qua URL (Hỗ trợ Trang Danh Sách / Phim Lẻ):</span>
            </label>
            <span className="text-[11px] text-gray-400">
              Ví dụ: <code className="text-neon-cyan font-mono bg-black/40 px-1.5 py-0.5 rounded">https://www.kkphim1.com/danh-sach/hoat-hinh?country=nhat-ban&page=2</code>
            </span>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-2">
            <input 
              id="target_url"
              name="target_url"
              type="text"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="Dán link cả trang danh sách hoặc link 1 phim lẻ vào đây..."
              className="flex-1 w-full px-4 py-2.5 rounded-xl bg-black/50 border border-glass-border text-xs text-white placeholder-gray-500 focus:outline-none focus:border-amber-400 font-mono transition-all"
            />
            <button
              type="button"
              onClick={handleFetchApi}
              disabled={readOnly || isFetchingApi || !targetUrl.trim()}
              className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-black text-xs font-black transition-all shadow-[0_0_15px_rgba(245,158,11,0.4)] disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
            >
              {isFetchingApi ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
                  <span>Đang Cào Đa Luồng...</span>
                </>
              ) : (
                <>
                  <span>⚡ Fetch & Cào API</span>
                </>
              )}
            </button>
          </div>

          {crawlStatus && (
            <div className={`p-2.5 rounded-lg border text-xs flex items-center gap-2 animate-fadeIn ${
              crawlStatus.type === 'success' ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' :
              crawlStatus.type === 'error' ? 'bg-red-500/15 border-red-500/30 text-red-300' :
              'bg-neon-cyan/15 border-neon-cyan/30 text-neon-cyan'
            }`}>
              <span>{crawlStatus.type === 'success' ? '✅' : crawlStatus.type === 'error' ? '❌' : 'ℹ️'}</span>
              <span>{crawlStatus.text}</span>
            </div>
          )}
        </div>

        {/* Textarea Input */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-gray-300">Dữ liệu Raw TSV từ Excel / Cào tự động:</label>
          <textarea 
            rows="6"
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="Dán dữ liệu copy từ Excel hoặc Google Sheets vào đây (Ctrl+V)..."
            className="w-full p-4 rounded-xl bg-surface/90 border border-glass-border font-mono text-xs text-gray-200 focus:outline-none focus:border-amber-400 custom-scrollbar"
          />
        </div>

        {/* Controls Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <button
            type="button"
            onClick={handleParse}
            disabled={isParsing || isUploading}
            className="px-5 py-2.5 rounded-xl bg-neon-cyan/20 hover:bg-neon-cyan/30 text-neon-cyan border border-neon-cyan/40 text-xs font-bold transition-all shadow-[0_0_15px_rgba(0,240,255,0.3)] disabled:opacity-50 flex items-center gap-2 cursor-pointer"
          >
            {isParsing ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin"></div>
                <span>Đang phân tích dữ liệu...</span>
              </>
            ) : (
              <>
                <span>⚡ Phân Tích & Kiểm Tra Trùng Khớp</span>
              </>
            )}
          </button>

          {parsedData.length > 0 && (
            <button
              type="button"
              onClick={handleUploadToFirebase}
              disabled={readOnly || isUploading || isParsing || (countNew === 0 && countUpdate === 0)}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white text-xs font-black transition-all shadow-[0_0_20px_rgba(245,158,11,0.5)] disabled:opacity-50 flex items-center gap-2 cursor-pointer"
            >
              {isUploading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Đang nạp lên Database...</span>
                </>
              ) : (
                <>
                  <span>🔥 Nạp {countNew + countUpdate} Bộ Phim Lên DB ({countDuplicate} Trùng - Bỏ Qua)</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Error Notification */}
        {errorMessage && (
          <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs flex items-center gap-2 animate-fadeIn">
            <span>⚠️</span>
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Status Notification */}
        {uploadStatus && (
          <div className={`p-4 rounded-xl border text-xs flex items-center gap-2.5 animate-fadeIn ${
            uploadStatus.type === 'success' ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' :
            uploadStatus.type === 'error' ? 'bg-red-500/15 border-red-500/30 text-red-300' :
            'bg-neon-cyan/15 border-neon-cyan/30 text-neon-cyan'
          }`}>
            <span>{uploadStatus.type === 'success' ? '✅' : uploadStatus.type === 'error' ? '❌' : 'ℹ️'}</span>
            <span className="font-semibold">{uploadStatus.text}</span>
          </div>
        )}
      </div>

      {/* PREVIEW PANEL & 3 SCENARIOS COUNTERS */}
      {parsedData.length > 0 && (
        <div className="glass-panel p-6 rounded-2xl space-y-5">
          {/* Header Title */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-glass-border pb-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span>Bảng Xem Trước (Preview):</span>
              <span className="text-neon-cyan">({parsedData.length} Bộ Phim)</span>
            </h3>
          </div>

          {/* 3 COUNTERS SUMMARY CARDS UI */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* 1. Tạo Mới */}
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-lg">➕</span>
                <div>
                  <div className="text-xs text-amber-300 font-bold">Tạo Mới</div>
                  <div className="text-[10px] text-amber-400/70">Phim chưa có trong DB</div>
                </div>
              </div>
              <span className="text-xl font-black text-amber-400 font-mono">
                {countNew}
              </span>
            </div>

            {/* 2. Tự Động Gộp */}
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-lg">🔄</span>
                <div>
                  <div className="text-xs text-emerald-300 font-bold">Tự Động Gộp Tập</div>
                  <div className="text-[10px] text-emerald-400/70">Phim cũ + Có tập mới</div>
                </div>
              </div>
              <span className="text-xl font-black text-emerald-400 font-mono">
                {countUpdate}
              </span>
            </div>

            {/* 3. Đã Trùng */}
            <div className="p-3.5 rounded-xl bg-slate-500/10 border border-slate-500/30 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-lg">✅</span>
                <div>
                  <div className="text-xs text-slate-300 font-bold">Đã Trùng (Bỏ Qua)</div>
                  <div className="text-[10px] text-slate-400/70">Không có tập mới nào</div>
                </div>
              </div>
              <span className="text-xl font-black text-slate-300 font-mono">
                {countDuplicate}
              </span>
            </div>
          </div>

          {/* TABLE PREVIEW */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-surface-card border-b border-glass-border text-gray-300 font-semibold">
                  <th className="p-3">#</th>
                  <th className="p-3">Ảnh Bìa / Poster</th>
                  <th className="p-3">Trạng Thái Hệ Thống</th>
                  <th className="p-3">Tên Phim (Tiếng Việt)</th>
                  <th className="p-3">Chi Tiết Tập Phim</th>
                  <th className="p-3">Tổng Tập Sau Gộp</th>
                  <th className="p-3">Link Video Tập Đầu</th>
                  <th className="p-3">Năm</th>
                  <th className="p-3">Quốc Gia</th>
                  <th className="p-3">IMDb</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-glass-border text-gray-300">
                {parsedData.map((movie, idx) => (
                  <tr key={idx} className={`transition-colors ${
                    movie.status === 'duplicate' ? 'opacity-60 bg-white/[0.01]' : 'hover:bg-white/5'
                  }`}>
                    <td className="p-3 font-mono text-gray-500">{idx + 1}</td>
                    
                    {/* Poster Thumbnail */}
                    <td className="p-3">
                      <div className="w-10 h-14 rounded-lg overflow-hidden border border-glass-border bg-surface flex-shrink-0 shadow-sm">
                        <img 
                          src={movie.poster || movie.banner || 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=200'} 
                          alt={movie.title}
                          onError={e => { e.target.src = 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=200'; }}
                          className="w-full h-full object-cover hover:scale-110 transition-transform"
                          title={movie.poster || movie.banner}
                        />
                      </div>
                    </td>

                    {/* Action badge for 3 Scenarios */}
                    <td className="p-3">
                      {movie.status === 'new' && (
                        <span className="px-2.5 py-1 rounded-lg text-[11px] bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold inline-flex items-center gap-1">
                          ➕ Tạo Mới ({movie.episodes?.length || 1} Tập)
                        </span>
                      )}

                      {movie.status === 'update' && (
                        <div className="space-y-0.5">
                          <span className="px-2.5 py-1 rounded-lg text-[11px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-bold inline-flex items-center gap-1">
                            {movie.updateReasonText || `🔄 Tự Động Gộp (+${movie.newEpisodesCount} Tập Mới)`}
                          </span>
                          <p className="text-[10px] text-gray-400 truncate max-w-[170px]">
                            {movie.hasNewEpisodes ? `Đã có sẵn ${movie.existingEpisodesCount} tập` : `Cập nhật Quốc gia: ${movie.country}`}
                          </p>
                        </div>
                      )}

                      {movie.status === 'duplicate' && (
                        <span className="px-2.5 py-1 rounded-lg text-[11px] bg-slate-700/50 text-slate-400 border border-slate-600/50 font-semibold inline-flex items-center gap-1">
                          ✅ Đã Trùng - Bỏ Qua
                        </span>
                      )}
                    </td>

                    <td className="p-3 font-bold text-white max-w-[180px] truncate">
                      {movie.title}
                      {movie.originalTitle && <span className="block text-[10px] text-gray-400 font-normal truncate">{movie.originalTitle}</span>}
                    </td>
                    
                    {/* Episodes Count & Details */}
                    <td className="p-3">
                      {movie.status === 'duplicate' ? (
                        <span className="text-[11px] text-slate-400 italic">Đã trùng - Bỏ qua</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="px-2.5 py-0.5 rounded-full bg-neon-cyan/20 text-neon-cyan font-black text-[11px] border border-neon-cyan/30">
                            +{movie.newEpisodesCount ?? movie.episodes?.length ?? 0} Tập mới
                          </span>
                          {movie.episodes?.length > 1 && (
                            <button
                              type="button"
                              onClick={() => setExpandedEpisodeIndex(expandedEpisodeIndex === idx ? null : idx)}
                              className="text-[10px] text-gray-400 hover:text-white underline cursor-pointer"
                            >
                              {expandedEpisodeIndex === idx ? 'Ẩn' : 'Xem'}
                            </button>
                          )}
                        </div>
                      )}

                      {/* Dropdown list of episode links if expanded */}
                      {expandedEpisodeIndex === idx && movie.episodes?.length > 0 && (
                        <div className="mt-2 p-2 rounded-lg bg-surface border border-glass-border space-y-1 max-h-32 overflow-y-auto">
                          {movie.episodes.map((ep, eIdx) => (
                            <div key={eIdx} className="flex items-center justify-between gap-2 text-[10px]">
                              <span className="font-bold text-amber-400">Tập {ep.name}:</span>
                              <span className="text-gray-400 font-mono truncate max-w-[180px]">{ep.url}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>

                    {/* Total Episodes After Merge */}
                    <td className="p-3">
                      <span className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 font-black text-[11px] border border-emerald-500/30">
                        {movie.totalAfterMergeCount || movie.episodes?.length || 1} Tập Trọn Bộ
                      </span>
                    </td>

                    <td className="p-3 font-mono text-neon-cyan max-w-[180px] truncate">{movie.m3u8Url}</td>
                    <td className="p-3">{movie.year}</td>
                    <td className="p-3 font-semibold text-emerald-300">{movie.country || 'N/A'}</td>
                    <td className="p-3 text-yellow-400 font-bold">★ {movie.imdb}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default MagicImport;
