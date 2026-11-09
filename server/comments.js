import { createHash } from 'node:crypto';
import { HttpError, budget } from './httpPolicy.js';

const publicComment = comment => Object.fromEntries(['id', 'movie_id', 'movie_title', 'user_id', 'username', 'avatar', 'content', 'created_at'].map(field => [field, comment[field]]));

export function movieId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.-]{1,200}$/.test(value)) throw new HttpError(400, 'ID phim không hợp lệ.');
  return value;
}

export async function createComment(body, { db, key, now = Date.now() }) {
  const id = movieId(body.movieId);
  if (typeof body.requestId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(body.requestId) ||
      typeof body.content !== 'string' || !body.content.trim() || body.content.length > 2000 ||
      typeof body.username !== 'string' || !body.username.trim() || body.username.length > 60) throw new HttpError(400, 'Bình luận hoặc tên hiển thị không hợp lệ (tối đa 2000 ký tự).');
  const content = body.content.trim(), username = body.username.trim();
  const fingerprint = createHash('sha256').update(JSON.stringify([id, username, content])).digest('hex');
  const commentId = createHash('sha256').update(id + ':' + body.requestId).digest('hex');
  const ref = db.doc(`movieComments/${id}/entries/${commentId}`);
  return db.runTransaction(async tx => {
    const old = (await tx.get(ref)).data();
    if (old) {
      if (old.fingerprint !== fingerprint) throw new HttpError(409, 'Yêu cầu bình luận đã được dùng cho nội dung khác.');
      return publicComment(old);
    }
    const movie = (await tx.get(db.doc('movies/' + id))).data();
    if (!movie) throw new HttpError(404, 'Không tìm thấy phim để bình luận.');
    const commitBudget = await budget(tx, db, [
      { id: 'comments-ip-' + key, max: 20, window: 3600000, cooldown: 10000 },
      { id: 'comments-global', max: 500, window: 3600000 },
      { id: 'comments-daily', max: 1000, window: 86400000 },
    ], now);
    const comment = { id: commentId, movie_id: id, movie_title: String(movie.title || '').slice(0, 200), user_id: 'guest', username, avatar: '', content, created_at: new Date(now).toISOString() };
    tx.create(ref, { ...comment, fingerprint });
    tx.create(db.doc('recentComments/' + commentId), comment);
    commitBudget();
    return comment;
  });
}

export async function listComments(query, { db }) {
  const limit = Number(query.limit || 30);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new HttpError(400, 'Giới hạn bình luận không hợp lệ.');
  const collection = query.movieId ? db.collection(`movieComments/${movieId(query.movieId)}/entries`) : db.collection('recentComments');
  let lookup = collection.orderBy('created_at', 'desc').orderBy('__name__', 'desc');
  if (query.cursor) {
    let cursor;
    try { cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString()); } catch { throw new HttpError(400, 'Trang bình luận không hợp lệ.'); }
    if (!Array.isArray(cursor) || typeof cursor[0] !== 'string' || !Number.isFinite(Date.parse(cursor[0])) || !/^[a-f0-9]{64}$/.test(cursor[1])) throw new HttpError(400, 'Trang bình luận không hợp lệ.');
    lookup = lookup.startAfter(...cursor);
  }
  const snapshot = await lookup.limit(limit + 1).get();
  const comments = snapshot.docs.slice(0, limit).map(doc => publicComment(doc.data()));
  const last = comments.at(-1);
  return { comments, nextCursor: snapshot.docs.length > limit && last ? Buffer.from(JSON.stringify([last.created_at, last.id])).toString('base64url') : null };
}
