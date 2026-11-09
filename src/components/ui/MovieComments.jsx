import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { addMovieComment, getMovieCommentsPage } from '../../services/interactionService';

const MovieComments = ({ movieId }) => {
  const { currentUser } = useAuth();
  const [comments, setComments] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [saved, setSaved] = useState(false);
  const activeMovie = useRef(movieId);
  const pending = useRef(null);
  const submitting = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    generation.current++;
    activeMovie.current = movieId;
    pending.current = null;
    submitting.current = false;
    setComments([]); setCursor(null); setContent(''); setError(''); setLoading(true); setSaved(false); setSending(false); setLoadingMore(false);
    const controller = new AbortController();
    getMovieCommentsPage(movieId, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) { setComments(result.comments); setCursor(result.nextCursor); }
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { generation.current++; activeMovie.current = null; controller.abort(); };
  }, [movieId]);

  const send = async event => {
    event.preventDefault();
    if (!currentUser || !content.trim() || submitting.current || loading) return;
    const target = movieId, text = content.trim(), epoch = generation.current;
    const name = [currentUser.displayName, currentUser.username].find(value => value && !String(value).includes('@'));
    const username = String(name || 'Người xem').slice(0, 60);
    if (!pending.current || pending.current.content !== text || pending.current.username !== username) pending.current = { content: text, username, requestId: crypto.randomUUID() };
    const attempt = pending.current;
    submitting.current = true; setSending(true); setError(''); setSaved(false);
    try {
      const comment = await addMovieComment(target, attempt);
      if (activeMovie.current !== target || generation.current !== epoch) return;
      setComments(previous => [comment, ...previous.filter(item => item.id !== comment.id)]);
      setContent(''); pending.current = null; setSaved(true);
      window.dispatchEvent(new CustomEvent('210loliphim_interactions_updated'));
    } catch (error) {
      if (activeMovie.current === target && generation.current === epoch) setError('Chưa xác nhận lưu bình luận: ' + error.message);
    } finally {
      if (activeMovie.current === target && generation.current === epoch) { submitting.current = false; setSending(false); }
    }
  };

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    const target = movieId, epoch = generation.current;
    setLoadingMore(true); setError('');
    try {
      const result = await getMovieCommentsPage(target, { cursor });
      if (activeMovie.current !== target || generation.current !== epoch) return;
      setComments(previous => [...new Map([...previous, ...result.comments].map(comment => [comment.id, comment])).values()]);
      setCursor(result.nextCursor);
    } catch (error) { if (activeMovie.current === target && generation.current === epoch) setError(error.message); }
    finally { if (activeMovie.current === target && generation.current === epoch) setLoadingMore(false); }
  };

  return (
    <section id="comments-section" className="p-4 sm:p-6 rounded-2xl glass-panel space-y-5 min-w-0 scroll-mt-24">
      <h3 className="text-lg font-bold text-white">Bình luận &amp; Đánh giá</h3>
      <p className="text-xs text-gray-400">Bình luận đã gửi được lưu chung để mọi người cùng xem.</p>
      {currentUser ? <form onSubmit={send} className="space-y-3">
        <label htmlFor="movie-comment" className="text-sm text-gray-300">Bình luận của bạn</label>
        <textarea id="movie-comment" value={content} onChange={event => { setContent(event.target.value); setSaved(false); }} maxLength={2000} rows={3} required disabled={sending}
          placeholder="Chia sẻ cảm nhận về phim..." className="block w-full rounded-xl bg-black/30 border border-white/10 p-3 text-sm text-white focus:outline-none focus:border-cyan-400 disabled:opacity-60" />
        <div className="flex items-center justify-between gap-3 text-xs text-gray-400">
          <span>{content.length}/2000 ký tự</span>
          <button type="submit" disabled={loading || sending || !content.trim()} className="px-5 py-2.5 rounded-xl bg-cyan-400 text-black font-bold disabled:opacity-50">{sending ? 'Đang lưu...' : 'Gửi bình luận'}</button>
        </div>
      </form> : <p className="text-sm text-gray-400">Đăng nhập để gửi bình luận.</p>}
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {saved && <p role="status" className="text-sm text-emerald-300">Đã lưu bình luận.</p>}
      {loading ? <p className="text-sm text-gray-400">Đang tải bình luận...</p> : comments.length === 0 && !error ? <p className="text-sm text-gray-400">Chưa có bình luận. Hãy chia sẻ cảm nhận đầu tiên!</p> : null}
      <div className="space-y-3">
        {comments.map(comment => <article key={comment.id} className="rounded-xl bg-black/20 border border-white/5 p-4 min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <strong className="text-cyan-300 break-words">{comment.username}</strong>
            <time dateTime={comment.created_at} className="text-gray-500">{new Date(comment.created_at).toLocaleString('vi-VN')}</time>
          </div>
          <p className="mt-2 text-sm text-gray-200 whitespace-pre-wrap break-words">{comment.content}</p>
        </article>)}
      </div>
      {cursor && <button type="button" disabled={loadingMore} onClick={loadMore} className="px-4 py-2 rounded-lg border border-white/20 text-sm text-gray-200 disabled:opacity-50">{loadingMore ? 'Đang tải...' : 'Xem thêm bình luận'}</button>}
    </section>
  );
};

export default MovieComments;
