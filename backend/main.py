import os
import asyncio
import logging
import sqlite3
import uuid
import hashlib
from contextlib import asynccontextmanager
from typing import List, Optional, Any, Dict
from datetime import datetime
import unicodedata
#test
from fastapi import FastAPI, HTTPException, BackgroundTasks, Request, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
try:
    import clickhouse_connect
except ImportError:
    clickhouse_connect = None
import re
import urllib.request
import urllib.parse
import json
import httpx
try:
    import google.generativeai as genai
except ImportError:
    genai = None

# Logging setup
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("telemetry_ingestion")

# Local SQLite Database for User Interactions (Views, Likes, Real Comments)
INTERACTION_DB_PATH = os.path.join(os.path.dirname(__file__), "interactions.db")

def get_db_connection():
    conn = sqlite3.connect(INTERACTION_DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn

def init_interaction_db():
    """Initialize interaction database tables if not exist."""
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS movie_views (
            movie_id TEXT PRIMARY KEY,
            views INTEGER DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS user_movie_likes (
            user_id TEXT,
            movie_id TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, movie_id)
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS movie_comments (
            id TEXT PRIMARY KEY,
            movie_id TEXT,
            user_id TEXT,
            username TEXT,
            avatar TEXT,
            content TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS movies (
            id TEXT PRIMARY KEY,
            title TEXT,
            original_title TEXT,
            status TEXT DEFAULT 'ongoing',
            episode_current TEXT DEFAULT '',
            director TEXT DEFAULT '',
            country TEXT DEFAULT '',
            year TEXT DEFAULT '',
            imdb TEXT DEFAULT '',
            poster TEXT DEFAULT '',
            banner TEXT DEFAULT '',
            episodes_count TEXT DEFAULT '',
            episodes TEXT DEFAULT '[]',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS view_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            movie_id TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # User Accounts Table for Authentication & Authorization
    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'user',
            age INTEGER DEFAULT 18,
            display_name TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Seed default accounts (admin / admin123 and khale / khale2k5kk) if not exist
    def _hash_pw(pw: str) -> str:
        return hashlib.sha256(pw.encode('utf-8')).hexdigest()

    cur.execute("SELECT COUNT(*) FROM users WHERE username = 'admin'")
    if cur.fetchone()[0] == 0:
        admin_id = str(uuid.uuid4())
        admin_pw = _hash_pw("admin123")
        cur.execute(
            "INSERT INTO users (id, username, password_hash, role, age, display_name) VALUES (?, ?, ?, ?, ?, ?)",
            (admin_id, "admin", admin_pw, "admin", 25, "210LoliPhim Admin")
        )
        logger.info("Initialized default admin user: admin / admin123")

    cur.execute("SELECT COUNT(*) FROM users WHERE username = 'khale'")
    if cur.fetchone()[0] == 0:
        khale_id = str(uuid.uuid4())
        khale_pw = _hash_pw("khale2k5kk")
        cur.execute(
            "INSERT INTO users (id, username, password_hash, role, age, display_name) VALUES (?, ?, ?, ?, ?, ?)",
            (khale_id, "khale", khale_pw, "user", 18, "Khale")
        )
        logger.info("Initialized default user: khale / khale2k5kk")

    conn.commit()
    conn.close()
    logger.info("Initialized interaction database tables successfully.")

# Initialize database tables immediately
try:
    init_interaction_db()
except Exception as e:
    logger.warning(f"Initial interaction DB setup warning: {e}")

# Configuration from Environment
CLICKHOUSE_HOST = os.getenv("CLICKHOUSE_HOST", "localhost")
CLICKHOUSE_PORT = int(os.getenv("CLICKHOUSE_PORT", "8123"))
CLICKHOUSE_DB = os.getenv("CLICKHOUSE_DB", "web_phim")
CLICKHOUSE_USER = os.getenv("CLICKHOUSE_USER", "default")
CLICKHOUSE_PASSWORD = os.getenv("CLICKHOUSE_PASSWORD", "default_password")

BATCH_SIZE = int(os.getenv("BATCH_SIZE", "1"))
FLUSH_INTERVAL_SECONDS = int(os.getenv("FLUSH_INTERVAL_SECONDS", "5"))

# Global State
clickhouse_client = None
event_buffer: List[list] = []
buffer_lock = asyncio.Lock()

def get_clickhouse_client():
    """Establish connection to ClickHouse with retries."""
    if not clickhouse_connect:
        logger.debug("clickhouse_connect not installed, skipping ClickHouse client initialization.")
        return None
    try:
        client = clickhouse_connect.get_client(
            host=CLICKHOUSE_HOST,
            port=CLICKHOUSE_PORT,
            username=CLICKHOUSE_USER,
            password=CLICKHOUSE_PASSWORD,
            database=CLICKHOUSE_DB
        )
        logger.info("Successfully connected to ClickHouse server")
        return client
    except Exception as e:
        logger.error(f"Failed to connect to ClickHouse at {CLICKHOUSE_HOST}:{CLICKHOUSE_PORT}: {e}")
        return None

async def flush_buffer():
    """Flush in-memory event buffer to ClickHouse in a single batch insert."""
    global event_buffer, clickhouse_client
    async with buffer_lock:
        if not event_buffer:
            return
        events_to_insert = event_buffer.copy()
        event_buffer.clear()

    if not clickhouse_client:
        clickhouse_client = get_clickhouse_client()

    if clickhouse_client:
        try:
            # Convert string timestamps to native python datetime objects before inserting
            formatted_events = []
            for row in events_to_insert:
                new_row = list(row)
                created_at_val = new_row[8]
                if isinstance(created_at_val, str):
                    try:
                        created_at_val = datetime.fromisoformat(created_at_val.replace('Z', '+00:00'))
                    except ValueError:
                        try:
                            created_at_val = datetime.strptime(created_at_val, "%Y-%m-%d %H:%M:%S")
                        except ValueError:
                            created_at_val = datetime.utcnow()
                elif not isinstance(created_at_val, datetime):
                    created_at_val = datetime.utcnow()
                new_row[8] = created_at_val
                formatted_events.append(new_row)

            column_names = [
                'user_id', 'session_id', 'movie_id', 'action_type', 
                'watch_time', 'video_quality', 'device_type', 'ip_address', 'created_at'
            ]
            clickhouse_client.insert(
                table='user_telemetry_events',
                data=formatted_events,
                column_names=column_names
            )
            logger.info(f"Successfully bulk inserted {len(formatted_events)} telemetry events to ClickHouse.")
        except Exception as e:
            logger.error(f"Error bulk inserting events to ClickHouse: {e}")
            # Re-queue on failure to prevent data loss
            async with buffer_lock:
                event_buffer.extend(events_to_insert)
    else:
        logger.warning(f"ClickHouse client unavailable. Re-queueing {len(events_to_insert)} events.")
        async with buffer_lock:
            event_buffer.extend(events_to_insert)

async def periodic_flush():
    """Background task to flush buffer periodically."""
    while True:
        await asyncio.sleep(FLUSH_INTERVAL_SECONDS)
        await flush_buffer()

@asynccontextmanager
async def lifespan(app: FastAPI):
    global clickhouse_client
    init_interaction_db()
    clickhouse_client = get_clickhouse_client()
    # Start periodic flush task
    flush_task = asyncio.create_task(periodic_flush())
    yield
    # Cleanup: Flush remaining events on shutdown
    flush_task.cancel()
    await flush_buffer()
    if clickhouse_client:
        clickhouse_client.close()

app = FastAPI(
    title="210LoliPhim Big Data Ingestion API",
    version="1.0.0",
    lifespan=lifespan
)

# Enable CORS for React Frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Event Schema Definition
ALLOWED_ACTIONS = {'click_poster', 'view_detail', 'play', 'pause', 'seek', 'heartbeat', 'search', 'complete'}

class TelemetryEvent(BaseModel):
    user_id: str = Field(default="anonymous", description="User ID or device token")
    session_id: str = Field(default="", description="Unique session ID")
    movie_id: str = Field(..., description="ID of the movie being interacted with")
    action_type: str = Field(..., description="Action type: play, pause, seek, heartbeat, view_detail, click_poster, search, complete")
    watch_time: int = Field(default=0, description="Duration watched in seconds")
    video_quality: str = Field(default="", description="Video quality e.g. 1080p, 4K")
    device_type: str = Field(default="web", description="Device type e.g. web, mobile, tv")

# User Authentication Request Schemas
class RegisterRequest(BaseModel):
    username: str
    password: str
    age: int = 18
    display_name: Optional[str] = None

class LoginRequest(BaseModel):
    username: str
    password: str

@app.get("/health")
def health_check():
    ch_status = "connected" if (clickhouse_client and clickhouse_client.ping()) else "disconnected"
    return {
        "status": "online",
        "clickhouse": ch_status,
        "buffered_events_count": len(event_buffer)
    }

# --- User Authentication Endpoints ---
@app.post("/api/auth/register")
async def auth_register(req: RegisterRequest):
    uname = req.username.strip().lower()
    if len(uname) < 3:
        raise HTTPException(status_code=400, detail="Tên đăng nhập phải có ít nhất 3 ký tự.")
    if not re.match(r'^[a-zA-Z0-9_]+$', uname):
        raise HTTPException(status_code=400, detail="Tên đăng nhập chỉ được chứa chữ cái, số và dấu gạch dưới.")
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Mật khẩu phải có ít nhất 6 ký tự.")
    if req.age < 1 or req.age > 120:
        raise HTTPException(status_code=400, detail="Tuổi phải từ 1 đến 120.")

    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT id FROM users WHERE username = ?", (uname,))
    if cur.fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail="Tên đăng nhập này đã được sử dụng.")

    hashed = hashlib.sha256(req.password.encode('utf-8')).hexdigest()
    user_id = str(uuid.uuid4())
    display = req.display_name.strip() if req.display_name else uname

    cur.execute(
        "INSERT INTO users (id, username, password_hash, role, age, display_name) VALUES (?, ?, ?, ?, ?, ?)",
        (user_id, uname, hashed, "user", req.age, display)
    )
    conn.commit()
    conn.close()

    logger.info(f"New user registered: {uname}")
    return {
        "success": True,
        "message": "Đăng ký tài khoản thành công!",
        "user": {
            "id": user_id,
            "username": uname,
            "displayName": display,
            "age": req.age,
            "role": "user"
        }
    }

@app.post("/api/auth/login")
async def auth_login(req: LoginRequest):
    uname = req.username.strip().lower()
    if not uname or not req.password:
        raise HTTPException(status_code=400, detail="Vui lòng nhập tên đăng nhập và mật khẩu.")

    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT id, username, password_hash, role, age, display_name FROM users WHERE username = ?", (uname,))
    row = cur.fetchone()
    conn.close()

    if not row:
        raise HTTPException(status_code=401, detail="Tên đăng nhập không tồn tại.")

    hashed_input = hashlib.sha256(req.password.encode('utf-8')).hexdigest()
    if hashed_input != row["password_hash"]:
        raise HTTPException(status_code=401, detail="Mật khẩu không chính xác.")

    session = {
        "id": row["id"],
        "username": row["username"],
        "displayName": row["display_name"] or row["username"],
        "role": row["role"],
        "age": row["age"]
    }
    logger.info(f"User logged in: {uname} (role: {row['role']})")
    return {
        "success": True,
        "session": session
    }

@app.get("/api/auth/users")
async def auth_get_users():
    """Retrieve list of user accounts for Admin management."""
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT id, username, role, age, display_name, created_at FROM users ORDER BY created_at DESC")
    rows = cur.fetchall()
    conn.close()
    return [
        {
            "id": r["id"],
            "username": r["username"],
            "role": r["role"],
            "age": r["age"],
            "displayName": r["display_name"],
            "createdAt": r["created_at"]
        }
        for r in rows
    ]

@app.post("/api/track")
async def track_event(event: TelemetryEvent, request: Request, background_tasks: BackgroundTasks):
    """
    Ingest user interaction telemetry event into high-performance buffer.
    """
    if event.action_type not in ALLOWED_ACTIONS:
        raise HTTPException(status_code=400, detail=f"Invalid action_type. Must be one of {ALLOWED_ACTIONS}")

    client_ip = request.client.host if request.client else ""
    now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")

    # Format record matching ClickHouse schema
    record = [
        event.user_id,
        event.session_id,
        event.movie_id,
        event.action_type,
        event.watch_time,
        event.video_quality,
        event.device_type,
        client_ip,
        now_str
    ]

    async with buffer_lock:
        event_buffer.append(record)
        current_len = len(event_buffer)

    # If buffer reaches BATCH_SIZE, trigger immediate background flush
    if current_len >= BATCH_SIZE:
        background_tasks.add_task(flush_buffer)

    return {"status": "accepted", "buffered_count": current_len}

@app.get("/api/analytics/trending")
def get_trending_movies(limit: int = 10):
    """
    Demonstration OLAP Query: Aggregate real-time trending movies from ClickHouse.
    """
    global clickhouse_client
    if not clickhouse_client:
        clickhouse_client = get_clickhouse_client()
    
    if not clickhouse_client:
        raise HTTPException(status_code=503, detail="ClickHouse service unavailable")

    query = """
        SELECT 
            movie_id,
            countIf(action_type = 'play') AS play_count,
            countIf(action_type = 'view_detail') AS detail_views,
            sum(watch_time) AS total_watch_seconds,
            (play_count * 5 + detail_views * 2 + total_watch_seconds / 60) AS score
        FROM web_phim.user_telemetry_events
        WHERE created_at >= now() - INTERVAL 7 DAY
        GROUP BY movie_id
        ORDER BY score DESC
        LIMIT {limit:UInt32}
    """
    try:
        result = clickhouse_client.query(query, parameters={"limit": limit})
        return {
            "timeframe": "7_days",
            "trending": [
                {
                    "movie_id": row[0],
                    "play_count": row[1],
                    "detail_views": row[2],
                    "total_watch_seconds": row[3],
                    "trending_score": round(row[4], 2)
                }
                for row in result.result_rows
            ]
        }
    except Exception as e:
        logger.error(f"Error querying trending analytics: {e}")
        return {"error": str(e), "trending": []}

# -------------------------------------------------------------------
# User Interaction API Endpoints (Views, Likes/Favorites, Real Comments)
# -------------------------------------------------------------------
class LikeRequest(BaseModel):
    user_id: str = Field(default="anonymous", description="ID or username of the user liking the movie")

class CommentRequest(BaseModel):
    user_id: str = Field(default="anonymous")
    username: str = Field(default="Người dùng")
    avatar: Optional[str] = ""
    content: str = Field(..., min_length=1, description="Nội dung bình luận thật")

@app.post("/api/movies/{movie_id}/view")
def increment_movie_view(movie_id: str):
    """
    Tăng tổng lượt xem toàn cầu cho phim (+1).
    """
    clean_id = movie_id.strip()
    if not clean_id:
        raise HTTPException(status_code=400, detail="movie_id is required")

    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO movie_views (movie_id, views, updated_at)
        VALUES (?, 1, CURRENT_TIMESTAMP)
        ON CONFLICT(movie_id) DO UPDATE SET
            views = views + 1,
            updated_at = CURRENT_TIMESTAMP
    """, (clean_id,))
    cur.execute("""
        INSERT INTO view_logs (movie_id, created_at)
        VALUES (?, CURRENT_TIMESTAMP)
    """, (clean_id,))
    conn.commit()

    cur.execute("SELECT views FROM movie_views WHERE movie_id = ?", (clean_id,))
    row = cur.fetchone()
    total_views = row['views'] if row else 1
    conn.close()

    # Optional Sync to ClickHouse if available
    global clickhouse_client
    if clickhouse_client:
        try:
            clickhouse_client.command(
                f"ALTER TABLE web_phim.movie_views UPDATE views = {total_views}, updated_at = now() WHERE movie_id = '{clean_id}'"
            )
        except Exception as e:
            logger.debug(f"ClickHouse view sync skipped: {e}")

    return {
        "status": "success",
        "movie_id": clean_id,
        "views": total_views
    }

@app.get("/api/movies/{movie_id}/stats")
def get_movie_interaction_stats(movie_id: str, user_id: Optional[str] = "anonymous"):
    """
    Lấy thông tin lượt xem toàn cầu, số tim, trạng thái đã thích, và số bình luận.
    """
    clean_id = movie_id.strip()
    conn = get_db_connection()
    cur = conn.cursor()

    cur.execute("SELECT views FROM movie_views WHERE movie_id = ?", (clean_id,))
    v_row = cur.fetchone()
    views = v_row['views'] if v_row else 0

    cur.execute("SELECT COUNT(*) as cnt FROM user_movie_likes WHERE movie_id = ?", (clean_id,))
    likes_count = cur.fetchone()['cnt']

    is_liked = False
    clean_user = (user_id or "anonymous").strip()
    if clean_user and clean_user != "anonymous":
        cur.execute("SELECT 1 FROM user_movie_likes WHERE movie_id = ? AND user_id = ?", (clean_id, clean_user))
        is_liked = cur.fetchone() is not None

    cur.execute("SELECT COUNT(*) as cnt FROM movie_comments WHERE movie_id = ?", (clean_id,))
    comments_count = cur.fetchone()['cnt']

    conn.close()
    return {
        "movie_id": clean_id,
        "views": views,
        "likes_count": likes_count,
        "is_liked": is_liked,
        "comments_count": comments_count
    }

@app.post("/api/movies/{movie_id}/like")
def toggle_movie_like(movie_id: str, payload: LikeRequest):
    """
    Chuyển đổi trạng thái Like (thả tim) của user cho phim và đếm tổng Like để xếp hạng.
    """
    clean_id = movie_id.strip()
    clean_user = payload.user_id.strip() if payload.user_id else "anonymous"

    conn = get_db_connection()
    cur = conn.cursor()

    cur.execute("SELECT 1 FROM user_movie_likes WHERE movie_id = ? AND user_id = ?", (clean_id, clean_user))
    existing = cur.fetchone()

    if existing:
        cur.execute("DELETE FROM user_movie_likes WHERE movie_id = ? AND user_id = ?", (clean_id, clean_user))
        is_liked = False
    else:
        cur.execute("""
            INSERT INTO user_movie_likes (user_id, movie_id, created_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
        """, (clean_user, clean_id))
        is_liked = True

    conn.commit()

    cur.execute("SELECT COUNT(*) as cnt FROM user_movie_likes WHERE movie_id = ?", (clean_id,))
    total_likes = cur.fetchone()['cnt']
    conn.close()

    return {
        "status": "success",
        "movie_id": clean_id,
        "user_id": clean_user,
        "is_liked": is_liked,
        "total_likes": total_likes
    }

@app.get("/api/user/{user_id}/favorites")
def get_user_favorite_movies(user_id: str):
    """
    Lấy danh sách các ID phim mà người dùng hiện tại đã thả tim.
    """
    clean_user = user_id.strip()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT movie_id, created_at
        FROM user_movie_likes
        WHERE user_id = ?
        ORDER BY created_at DESC
    """, (clean_user,))
    rows = cur.fetchall()
    favorites = [row['movie_id'] for row in rows]
    conn.close()

    return {
        "user_id": clean_user,
        "favorites": favorites
    }

@app.get("/api/leaderboard/trending")
@app.get("/api/trending")
def get_leaderboard_trending_views(limit: int = 10):
    """
    Top phim Sôi nổi nhất theo Lượt xem giảm dần.
    ĐIỀU KIỆN BẮT BUỘC: Lượt xem phải >= 1. Không chèn phim 0 view.
    """
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT movie_id, views
        FROM movie_views
        WHERE views >= 1
        ORDER BY views DESC
        LIMIT ?
    """, (limit,))
    rows = cur.fetchall()
    trending = [{"movie_id": row['movie_id'], "views": row['views']} for row in rows]
    conn.close()
    return {"trending": trending}

@app.get("/api/leaderboard/favorites")
def get_leaderboard_favorites_likes(limit: int = 10):
    """
    Top phim Yêu thích nhất theo số lượt thả tim giảm dần.
    ĐIỀU KIỆN BẮT BUỘC: Số tim phải >= 1.
    """
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT movie_id, COUNT(*) as like_count
        FROM user_movie_likes
        GROUP BY movie_id
        HAVING like_count >= 1
        ORDER BY like_count DESC
        LIMIT ?
    """, (limit,))
    rows = cur.fetchall()
    favorites = [{"movie_id": row['movie_id'], "like_count": row['like_count']} for row in rows]
    conn.close()
    return {"favorites": favorites}

@app.get("/api/comments/latest")
@app.get("/api/leaderboard/comments")
def get_latest_real_comments(limit: int = 10):
    """
    Lấy danh sách các bình luận thật mới nhất trên toàn hệ thống (mới nhất lên đầu).
    Đảm bảo 100% không có bình luận ảo (mock data).
    """
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT id, movie_id, user_id, username, avatar, content, created_at
        FROM movie_comments
        ORDER BY created_at DESC
        LIMIT ?
    """, (limit,))
    rows = cur.fetchall()
    comments = [
        {
            "id": str(row['id']),
            "movie_id": row['movie_id'],
            "user_id": row['user_id'],
            "username": row['username'],
            "avatar": row['avatar'] or "",
            "content": row['content'],
            "created_at": row['created_at']
        }
        for row in rows
    ]
    conn.close()
    return {"comments": comments}

@app.get("/api/movies/{movie_id}/comments")
def get_comments_for_movie(movie_id: str):
    """
    Lấy danh sách bình luận thật của 1 phim cụ thể.
    """
    clean_id = movie_id.strip()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT id, movie_id, user_id, username, avatar, content, created_at
        FROM movie_comments
        WHERE movie_id = ?
        ORDER BY created_at DESC
    """, (clean_id,))
    rows = cur.fetchall()
    comments = [
        {
            "id": str(row['id']),
            "movie_id": row['movie_id'],
            "user_id": row['user_id'],
            "username": row['username'],
            "avatar": row['avatar'] or "",
            "content": row['content'],
            "created_at": row['created_at']
        }
        for row in rows
    ]
    conn.close()
    return {"comments": comments}

@app.post("/api/movies/{movie_id}/comments")
def add_movie_real_comment(movie_id: str, payload: CommentRequest):
    """
    Tạo bình luận thật mới cho phim.
    """
    clean_id = movie_id.strip()
    text = payload.content.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Nội dung bình luận không được để trống")

    comment_id = str(uuid.uuid4())
    user_name = payload.username.strip() if payload.username else "Người dùng"
    avatar_url = payload.avatar or "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100"

    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO movie_comments (id, movie_id, user_id, username, avatar, content, created_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    """, (comment_id, clean_id, payload.user_id, user_name, avatar_url, text))
    conn.commit()

    cur.execute("SELECT id, movie_id, user_id, username, avatar, content, created_at FROM movie_comments WHERE id = ?", (comment_id,))
    row = cur.fetchone()
    conn.close()

    return {
        "status": "success",
        "comment": {
            "id": str(row['id']),
            "movie_id": row['movie_id'],
            "user_id": row['user_id'],
            "username": row['username'],
            "avatar": row['avatar'],
            "content": row['content'],
            "created_at": row['created_at']
        }
    }

# -------------------------------------------------------------------
# Admin Dashboard Statistics & Movie Sync Endpoints (Real Data)
# -------------------------------------------------------------------
@app.get("/api/admin/stats")
def get_admin_dashboard_stats(total_movies: Optional[int] = None):
    """
    Nhiệm vụ 5: Cập nhật Thống Kê Thật cho Admin Dashboard
    - 'Tổng Phim Quản Lý': Lấy tổng số phim thực tế trong database.
    - 'Lượt Xem Hôm Nay': Lấy tổng lượt xem của ngày hôm nay (dựa vào created_at trong bảng view_logs).
    """
    conn = get_db_connection()
    cur = conn.cursor()

    # 1. Đếm tổng phim từ SQLite movies table
    cur.execute("SELECT COUNT(*) as cnt FROM movies")
    db_count = cur.fetchone()['cnt']
    final_total_movies = max(db_count, total_movies or 0)

    # 2. Đếm tổng lượt xem hôm nay từ bảng view_logs
    cur.execute("""
        SELECT COUNT(*) as today_views 
        FROM view_logs 
        WHERE date(created_at, 'localtime') = date('now', 'localtime')
    """)
    row = cur.fetchone()
    today_views = row['today_views'] if row else 0

    # 3. Đồng bộ với ClickHouse telemetry events nếu có
    global clickhouse_client
    if clickhouse_client:
        try:
            ch_res = clickhouse_client.query("""
                SELECT count(*) 
                FROM web_phim.user_telemetry_events 
                WHERE (action_type = 'play' OR action_type = 'view_detail') 
                  AND toDate(created_at) = today()
            """)
            if ch_res.result_rows:
                today_views = max(today_views, int(ch_res.result_rows[0][0]))
        except Exception as e:
            logger.debug(f"ClickHouse stats check skipped: {e}")

    conn.close()
    return {
        "status": "success",
        "total_movies": final_total_movies,
        "today_views": today_views
    }

class MovieSyncRequest(BaseModel):
    movies: List[dict]

@app.post("/api/movies/sync")
def sync_movies_to_backend(payload: MovieSyncRequest):
    """
    Đồng bộ danh sách phim từ Firestore / Client vào SQLite backend.
    """
    movies = payload.movies
    if not movies:
        return {"status": "success", "synced_count": 0}

    conn = get_db_connection()
    cur = conn.cursor()
    synced = 0
    for m in movies:
        m_id = str(m.get('id', '')).strip()
        if not m_id:
            continue
        title = str(m.get('title', ''))
        original_title = str(m.get('originalTitle') or m.get('original_title') or '')
        status = str(m.get('status', 'ongoing'))
        episode_current = str(m.get('episodeCurrent') or m.get('episode_current') or m.get('episodesStatus') or '')
        director = str(m.get('director', ''))
        country = str(m.get('country', ''))
        year = str(m.get('year', ''))
        imdb = str(m.get('imdb', ''))
        poster = str(m.get('poster', ''))
        banner = str(m.get('banner', ''))
        episodes_count = str(m.get('episodesCount') or m.get('episodes_count') or '')
        episodes_json = json.dumps(m.get('episodes', []), ensure_ascii=False)

        cur.execute("""
            INSERT INTO movies (id, title, original_title, status, episode_current, director, country, year, imdb, poster, banner, episodes_count, episodes, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                original_title = excluded.original_title,
                status = excluded.status,
                episode_current = excluded.episode_current,
                director = excluded.director,
                country = excluded.country,
                year = excluded.year,
                imdb = excluded.imdb,
                poster = excluded.poster,
                banner = excluded.banner,
                episodes_count = excluded.episodes_count,
                episodes = excluded.episodes,
                updated_at = CURRENT_TIMESTAMP
        """, (m_id, title, original_title, status, episode_current, director, country, year, imdb, poster, banner, episodes_count, episodes_json))
        synced += 1

    conn.commit()
    conn.close()
    return {"status": "success", "synced_count": synced}

# -------------------------------------------------------------------
# Auto-Update & Smart Merge Service (Nhiệm vụ 2)
# -------------------------------------------------------------------
PHIM_API_SINGLE_BASE = os.getenv("PHIM_API_BASE_URL", "https://phimapi.com/phim")
PHIM_API_LIST_BASE = "https://phimapi.com/v1/api"
DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

class AutoUpdatePayload(BaseModel):
    movies: Optional[List[dict]] = None

def normalize_slug_str(text: str) -> str:
    if not text:
        return ''
    s = str(text).replace('đ', 'd').replace('Đ', 'd')
    s = unicodedata.normalize('NFKD', s).encode('ASCII', 'ignore').decode('utf-8')
    s = re.sub(r'[^\w\s-]', '', s.lower())
    return re.sub(r'[-\s]+', '-', s).strip('-')

def is_eligible_for_auto_crawl(movie: dict) -> bool:
    """
    Điều kiện lọc Nhiệm vụ 2:
    - Phim trong DB đang ở trạng thái CHƯA Completed (không phải Hoàn Tất chính thức).
    - VÀ KHÔNG PHẢI là phim lẻ chiếu rạp (bỏ qua phim chỉ có 1 tập thời lượng dài, hoặc thể loại Movie/Chiếu rạp).
    """
    status = str(movie.get('status', '') or '').lower().strip()

    # Bỏ qua phim đã hoàn tất chính thức
    if status in ['completed', 'hoàn tất', 'hoan tat']:
        return False

    # Bỏ qua phim lẻ chiếu rạp
    cat = str(movie.get('category', '') or '').lower()
    badge = str(movie.get('badge', '') or '').lower()
    genres = movie.get('genres', [])
    genres_str = (" ".join(genres) if isinstance(genres, list) else str(genres)).lower()
    movie_type = str(movie.get('type', '') or '').lower()
    chieurap = movie.get('chieurap')

    if chieurap is True or movie_type == 'single':
        return False
    if 'chiếu rạp' in cat or 'phim lẻ' in cat or 'movie' in cat:
        return False
    if 'chiếu rạp' in genres_str or 'phim lẻ' in genres_str:
        return False
    if 'rạp' in badge or 'chiếu rạp' in badge:
        return False

    # Nếu chỉ có 1 tập dạng full/trọn bộ
    episodes = movie.get('episodes', [])
    if isinstance(episodes, list) and len(episodes) == 1:
        ep_name = str(episodes[0].get('name', '')).strip().lower()
        if ep_name in ['full', 'trọn bộ', 'tron bo']:
            return False

    return True

@app.post("/api/movies/auto-update")
async def auto_update_movies(payload: Optional[AutoUpdatePayload] = Body(default=None)):
    """
    Nhiệm vụ 2: Logic Tự Động Cào & Gộp Phim (Auto-Update)
    - Nhận danh sách phim từ Client (hoặc lấy từ SQLite nếu rỗng).
    - Cào lại PhimAPI, so sánh 5 trường:
      1. Tập phim (episodes - tập mới, bổ sung link)
      2. Quốc gia (country)
      3. Đạo diễn / Tác giả (director)
      4. Trạng thái (status: ongoing, completed)
      5. Tập hiện tại (episode_current)
    - Nếu có thay đổi -> Gộp dữ liệu mới và trả về danh sách phim đã cập nhật.
    """
    input_movies = payload.movies if (payload and hasattr(payload, 'movies') and payload.movies) else None

    # Nếu client không gửi danh sách, lấy từ SQLite sắp xếp theo thời gian cập nhật cũ nhất (FIFO xoay vòng toàn kho)
    if not input_movies:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT * FROM movies ORDER BY updated_at ASC LIMIT 30")
        rows = cur.fetchall()
        input_movies = []
        for r in rows:
            m_dict = dict(r)
            try:
                m_dict['episodes'] = json.loads(m_dict.get('episodes') or '[]')
            except Exception:
                m_dict['episodes'] = []
            input_movies.append(m_dict)
        conn.close()

    if not input_movies:
        return {
            "status": "success",
            "message": "Không có phim nào để kiểm tra cập nhật.",
            "checked_count": 0,
            "updated_count": 0,
            "updated_movies": [],
            "checked_details": []
        }

    # Nếu client gửi cụ thể một lô (batch), xử lý toàn bộ lô đó không được tự ý lọc bỏ
    batch_to_check = input_movies
    updated_movies = []
    checked_without_change_ids = []
    checked_details = []

    headers = {"User-Agent": DEFAULT_USER_AGENT}
    async with httpx.AsyncClient(headers=headers, timeout=12.0, follow_redirects=True) as client:
        for movie in batch_to_check:
            m_title = movie.get('title') or movie.get('id') or ''
            m_orig = movie.get('originalTitle') or movie.get('original_title') or ''
            slug = movie.get('slug') or normalize_slug_str(m_title)

            if not slug and not m_orig:
                checked_without_change_ids.append(str(movie.get('id', '')))
                checked_details.append({
                    "id": movie.get('id'),
                    "title": m_title,
                    "status": "error",
                    "has_change": False,
                    "changes_detail": [],
                    "episodes_count": len(movie.get('episodes') or []),
                    "added_episodes_count": 0,
                    "message": f'Không xác định được tiêu đề/slug của phim "{m_title}".'
                })
                continue

            try:
                # Giai đoạn 1: Thử slug chính từ Tiêu đề Việt
                res = None
                if slug:
                    res = await client.get(f"{PHIM_API_SINGLE_BASE.rstrip('/')}/{slug}")

                # Giai đoạn 2: Nếu chưa tìm thấy (hoặc không phải 200), thử slug từ Tên Gốc (English / Original)
                if not res or res.status_code != 200:
                    slug_orig = normalize_slug_str(m_orig)
                    if slug_orig and slug_orig != slug:
                        res = await client.get(f"{PHIM_API_SINGLE_BASE.rstrip('/')}/{slug_orig}")
                        if res.status_code == 200:
                            slug = slug_orig

                # Giai đoạn 3: Nếu vẫn không tìm thấy, gọi Search API của PhimAPI để tìm slug chính xác
                if not res or res.status_code != 200:
                    search_kw = m_title or m_orig
                    if search_kw:
                        try:
                            clean_kw = re.sub(r'\(.*?\)', '', search_kw).strip()[:35]
                            search_url = f"{PHIM_API_LIST_BASE.rstrip('/')}/tim-kiem?keyword={urllib.parse.quote(clean_kw)}"
                            search_res = await client.get(search_url)
                            if search_res.status_code == 200:
                                search_data = search_res.json()
                                items = search_data.get('data', {}).get('items', [])
                                if items:
                                    target_slug = items[0].get('slug')
                                    if target_slug:
                                        res = await client.get(f"{PHIM_API_SINGLE_BASE.rstrip('/')}/{target_slug}")
                                        if res.status_code == 200:
                                            slug = target_slug
                        except Exception as search_err:
                            logger.debug(f"Search fallback exception for '{m_title}': {search_err}")

                if not res or res.status_code != 200:
                    checked_without_change_ids.append(str(movie.get('id', '')))
                    checked_details.append({
                        "id": movie.get('id'),
                        "title": m_title,
                        "status": "error",
                        "has_change": False,
                        "changes_detail": [],
                        "episodes_count": len(movie.get('episodes') or []),
                        "added_episodes_count": 0,
                        "message": f'Lỗi kiểm tra "{m_title}": API phản hồi HTTP {res.status_code if res else "No response"}'
                    })
                    continue

                data = res.json()
                if not data or not data.get('status') or not data.get('movie'):
                    checked_without_change_ids.append(str(movie.get('id', '')))
                    checked_details.append({
                        "id": movie.get('id'),
                        "title": m_title,
                        "status": "unchanged",
                        "has_change": False,
                        "changes_detail": [],
                        "episodes_count": len(movie.get('episodes') or []),
                        "added_episodes_count": 0,
                        "message": f'"{m_title}" dữ liệu từ nguồn API chưa khả dụng, giữ nguyên.'
                    })
                    continue

                api_movie = data.get('movie', {})
                api_episodes_data = data.get('episodes', [])
                api_server_data = api_episodes_data[0].get('server_data', []) if api_episodes_data else []

                # Trích xuất dữ liệu mới từ API
                new_status = str(api_movie.get('status', '') or '').strip().lower()
                new_ep_current = str(api_movie.get('episode_current', '') or '').strip()

                # Quốc gia mới
                api_country = api_movie.get('country', [])
                if isinstance(api_country, list):
                    new_country = ", ".join([c.get('name', '') for c in api_country if isinstance(c, dict) and c.get('name')])
                elif isinstance(api_country, dict):
                    new_country = api_country.get('name', '')
                else:
                    new_country = str(api_country or '')
                new_country = new_country.strip()

                # Đạo diễn / Tác giả mới
                api_director = api_movie.get('director', [])
                if isinstance(api_director, list):
                    new_director = ", ".join([str(d.get('name') if isinstance(d, dict) else d) for d in api_director if d])
                elif isinstance(api_director, dict):
                    new_director = api_director.get('name', '')
                else:
                    new_director = str(api_director or '')
                new_director = new_director.strip()

                # So sánh 5 tiêu chí Thông Minh (Smart Comparison):
                has_change = False
                changes_detail = []

                # 1. So sánh Tập phim (episodes): gộp tập mới, bổ sung link m3u8 nếu tập cũ bị thiếu link
                existing_eps = movie.get('episodes') or []
                
                def normalize_ep_key(name_or_num):
                    s = str(name_or_num or '').strip()
                    m = re.search(r'\d+', s)
                    return str(int(m.group())) if m else s.lower()

                merged_eps_map = {}
                seen_urls = set()
                for ep in existing_eps:
                    name_clean = str(ep.get('name', '')).strip()
                    key = normalize_ep_key(name_clean)
                    url = str(ep.get('url') or ep.get('m3u8Url') or '').strip()
                    if url and url in seen_urls:
                        continue
                    if key and key in merged_eps_map:
                        continue
                    if url:
                        seen_urls.add(url)
                    if key:
                        merged_eps_map[key] = {
                            "name": name_clean or f"Tập {key}",
                            "url": url
                        }

                new_ep_found = False
                for idx, ep in enumerate(api_server_data):
                    ep_name = str(ep.get('name', str(idx + 1))).strip()
                    ep_url = str(ep.get('link_m3u8', '') or ep.get('link_embed', '')).strip()
                    num_key = normalize_ep_key(ep_name)

                    if not num_key:
                        continue

                    # Nếu tập đã có nhưng chưa có URL mà nguồn API có URL
                    if num_key in merged_eps_map:
                        if not merged_eps_map[num_key].get('url') and ep_url:
                            merged_eps_map[num_key]['url'] = ep_url
                            has_change = True
                        continue

                    if ep_url and ep_url in seen_urls:
                        continue

                    new_ep_found = True
                    if ep_url:
                        seen_urls.add(ep_url)
                    merged_eps_map[num_key] = {"name": ep_name, "url": ep_url}

                def sort_ep_key(item):
                    match = re.search(r'\d+', str(item['name']))
                    return int(match.group()) if match else 9999

                merged_eps = sorted(list(merged_eps_map.values()), key=sort_ep_key)
                added_episodes_count = max(0, len(merged_eps) - len(existing_eps))
                if new_ep_found or len(merged_eps) > len(existing_eps):
                    has_change = True
                    changes_detail.append(f"+{added_episodes_count} Tập mới")

                # 2. So sánh Quốc gia
                old_country = str(movie.get('country', '') or '').strip()
                has_country_update = False
                if new_country and new_country.lower() not in ['đang cập nhật', 'dang cap nhat']:
                    if not old_country or old_country.lower() in ['đang cập nhật', 'dang cap nhat', 'n/a'] or new_country != old_country:
                        has_country_update = True
                        has_change = True
                        changes_detail.append(f"Quốc gia: {old_country or 'Chưa có'} -> {new_country}")

                # 3. So sánh Đạo diễn / Tác giả
                old_director = str(movie.get('director', '') or '').strip()
                has_director_update = False
                if new_director and new_director.lower() not in ['đang cập nhật', 'dang cap nhat']:
                    if not old_director or old_director.lower() in ['đang cập nhật', 'dang cap nhat', 'n/a'] or new_director != old_director:
                        has_director_update = True
                        has_change = True
                        changes_detail.append(f"Đạo diễn: {old_director or 'Chưa có'} -> {new_director}")

                # 4. So sánh Trạng thái (status: ongoing, completed)
                old_status = str(movie.get('status', '') or '').strip().lower()
                has_status_update = False
                if new_status and (new_status != old_status or old_status == 'active'):
                    has_status_update = True
                    has_change = True
                    changes_detail.append(f"Trạng thái: {old_status or 'Chưa có'} -> {new_status}")

                # 5. So sánh Tập hiện tại (episodeCurrent)
                old_ep_current = str(movie.get('episodeCurrent') or movie.get('episode_current') or movie.get('episodesStatus') or '').strip()
                has_ep_current_update = False
                if new_ep_current and new_ep_current != old_ep_current:
                    has_ep_current_update = True
                    has_change = True
                    changes_detail.append(f"Tập hiện tại: {old_ep_current or 'Chưa có'} -> {new_ep_current}")

                final_country = new_country if has_country_update else (old_country or '')
                final_director = new_director if has_director_update else (old_director or '')
                final_status = new_status if has_status_update else (old_status or 'ongoing')
                final_ep_current = new_ep_current if has_ep_current_update else old_ep_current
                final_episodes_count = f"{len(merged_eps)} Tập" if merged_eps else (movie.get('episodesCount') or '1 Tập')
                final_episodes_status = final_ep_current or f"Tập {len(merged_eps)}"

                # Nếu có thay đổi -> Tiến hành gộp dữ liệu
                if has_change:
                    updated_item = {
                        **movie,
                        "country": final_country,
                        "director": final_director,
                        "status": final_status,
                        "episodeCurrent": final_ep_current,
                        "episode_current": final_ep_current,
                        "episodes": merged_eps,
                        "episodesCount": final_episodes_count,
                        "episodes_count": final_episodes_count,
                        "episodesStatus": final_episodes_status,
                        "slug": slug,
                        "changes_detail": changes_detail,
                        "updatedAt": datetime.utcnow().isoformat()
                    }
                    if merged_eps and (not updated_item.get('m3u8Url') or updated_item.get('m3u8Url') == ''):
                        updated_item['m3u8Url'] = merged_eps[0].get('url', '')

                    updated_movies.append(updated_item)
                    checked_details.append({
                        "id": movie.get('id'),
                        "title": m_title,
                        "status": "updated",
                        "has_change": True,
                        "changes_detail": changes_detail,
                        "episodes_count": len(merged_eps),
                        "added_episodes_count": added_episodes_count,
                        "message": f'Cập nhật "{m_title}": {", ".join(changes_detail)}'
                    })
                    logger.info(f"🔄 Đã gộp phim '{m_title}': {', '.join(changes_detail)}")
                else:
                    checked_without_change_ids.append(str(movie.get('id', '')))
                    checked_details.append({
                        "id": movie.get('id'),
                        "title": m_title,
                        "status": "unchanged",
                        "has_change": False,
                        "changes_detail": [],
                        "episodes_count": len(existing_eps),
                        "added_episodes_count": 0,
                        "message": f'"{m_title}" đã chuẩn xác đủ {len(existing_eps)} tập, không cần sửa.'
                    })

            except Exception as e:
                logger.warning(f"Lỗi khi kiểm tra auto-update phim {m_title}: {e}")
                checked_without_change_ids.append(str(movie.get('id', '')))
                checked_details.append({
                    "id": movie.get('id'),
                    "title": m_title,
                    "status": "error",
                    "has_change": False,
                    "changes_detail": [],
                    "episodes_count": len(movie.get('episodes') or []),
                    "added_episodes_count": 0,
                    "message": f'Lỗi khi kiểm tra "{m_title}": {str(e)}'
                })
                continue

    # Cập nhật vào SQLite nếu có phim được gộp
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        if updated_movies:
            for um in updated_movies:
                um_id = str(um.get('id', '')).strip()
                if um_id:
                    cur.execute("""
                        INSERT INTO movies (id, title, original_title, status, episode_current, director, country, episodes_count, episodes, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                        ON CONFLICT(id) DO UPDATE SET
                            status = excluded.status,
                            episode_current = excluded.episode_current,
                            director = excluded.director,
                            country = excluded.country,
                            episodes_count = excluded.episodes_count,
                            episodes = excluded.episodes,
                            updated_at = CURRENT_TIMESTAMP
                    """, (
                        um_id,
                        str(um.get('title', '')),
                        str(um.get('originalTitle') or um.get('original_title') or ''),
                        str(um.get('status', 'ongoing')),
                        str(um.get('episodeCurrent') or um.get('episode_current') or ''),
                        str(um.get('director', '')),
                        str(um.get('country', '')),
                        str(um.get('episodesCount', '')),
                        json.dumps(um.get('episodes', []), ensure_ascii=False)
                    ))

        # Cập nhật updated_at cho các phim đã kiểm tra mà không có thay đổi để xoay vòng hàng đợi
        for no_ch_id in checked_without_change_ids:
            if no_ch_id:
                cur.execute("UPDATE movies SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", (no_ch_id,))

        conn.commit()
        conn.close()
    except Exception as e:
        logger.error(f"Lỗi ghi sqlite khi gộp phim: {e}")

    return {
        "status": "success",
        "checked_count": len(batch_to_check),
        "updated_count": len(updated_movies),
        "updated_movies": updated_movies,
        "checked_details": checked_details
    }

@app.get("/api/movies")
def get_all_movies_from_db(limit: int = 300):
    """
    Lấy toàn bộ danh sách phim hiện có trong SQLite backend.
    """
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT * FROM movies ORDER BY updated_at DESC LIMIT ?", (limit,))
    rows = cur.fetchall()
    result = []
    for r in rows:
        m = dict(r)
        try:
            m['episodes'] = json.loads(m.get('episodes') or '[]')
        except Exception:
            m['episodes'] = []
        result.append(m)
    conn.close()
    return {"status": "success", "count": len(result), "movies": result}
# -------------------------------------------------------------------
# Movie Crawler API Endpoint (PhimAPI -> TSV format for Magic Import)
# Hỗ trợ cào cả 1 Phim lẻ hoặc CẢ MỘT TRANG DANH SÁCH (Đa luồng Async)
# -------------------------------------------------------------------
class CrawlRequest(BaseModel):
    url: str

PHIM_API_SINGLE_BASE = os.getenv("PHIM_API_BASE_URL", "https://phimapi.com/phim")
PHIM_API_LIST_BASE = "https://phimapi.com/v1/api"
DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'


def classify_crawl_url(input_url: str):
    """
    Phân loại URL đầu vào thành ('single', slug) hoặc ('list', api_url)
    """
    raw_url = input_url.strip()
    parsed = urllib.parse.urlparse(raw_url)
    path = parsed.path.rstrip('/')
    query = parsed.query

    # 1. URL Phim lẻ: Có dạng /phim/slug (ví dụ: https://phimapi.com/phim/cuoc-chien-bang-dang)
    if '/phim/' in path:
        slug = path.split('/phim/')[-1].split('/')[0]
        return ('single', slug)

    # 2. Direct API List URL từ phimapi.com
    if 'phimapi.com/v1/api/' in raw_url:
        return ('list', raw_url)

    # 3. URL Web Danh sách (/danh-sach/..., /quoc-gia/..., /the-loai/...)
    if '/danh-sach/' in path:
        cat_slug = path.split('/danh-sach/')[-1].split('/')[0]
        api_url = f"{PHIM_API_LIST_BASE}/danh-sach/{cat_slug}"
        if query:
            api_url += f"?{query}"
        return ('list', api_url)

    if '/quoc-gia/' in path:
        country_slug = path.split('/quoc-gia/')[-1].split('/')[0]
        api_url = f"{PHIM_API_LIST_BASE}/quoc-gia/{country_slug}"
        if query:
            api_url += f"?{query}"
        return ('list', api_url)

    if '/the-loai/' in path:
        genre_slug = path.split('/the-loai/')[-1].split('/')[0]
        api_url = f"{PHIM_API_LIST_BASE}/the-loai/{genre_slug}"
        if query:
            api_url += f"?{query}"
        return ('list', api_url)

    # Fallback 1: Nếu là slug trực tiếp (không chứa slash hoặc query), coi là phim lẻ
    last_seg = path.split('/')[-1] if path else raw_url
    if last_seg and not query and 'danh-sach' not in last_seg and 'page=' not in raw_url:
        return ('single', last_seg)

    # Fallback 2: Nếu có query như ?page=2
    if last_seg:
        api_url = f"{PHIM_API_LIST_BASE}/danh-sach/{last_seg}"
        if query:
            api_url += f"?{query}"
        return ('list', api_url)

    return ('single', raw_url)


async def fetch_movie_detail(client: httpx.AsyncClient, slug: str) -> Optional[dict]:
    """
    Gọi API lấy chi tiết 1 phim bất đồng bộ. Bao bọc try/catch để 1 phim lỗi không làm chết cả list!
    """
    url = f"{PHIM_API_SINGLE_BASE.rstrip('/')}/{slug}"
    try:
        res = await client.get(url, timeout=12.0)
        if res.status_code == 200:
            data = res.json()
            if data and data.get('status'):
                return data
    except Exception as e:
        logger.warning(f"⚠️ Lỗi khi cào phim '{slug}': {e}")
    return None


def convert_movie_data_to_tsv_rows(data: dict) -> List[str]:
    """
    Format dữ liệu JSON của 1 bộ phim thành các dòng dữ liệu TSV (không bao gồm Header).
    Cột Thể Loại luôn để trống cho mọi dòng.
    """
    if not data or not data.get('status'):
        return []

    movie = data.get('movie', {})
    title = movie.get('name', '')
    original_title = movie.get('origin_name', '')
    year = str(movie.get('year', '2026'))

    # Xử lý Ảnh bìa (Ưu tiên poster_url - ảnh dọc, fallback về thumb_url - ảnh ngang)
    poster_url = movie.get('poster_url', '') or movie.get('thumb_url', '')
    if poster_url and not poster_url.startswith('http'): #ảnh poster
        poster_url = f"https://phimimg.com/{poster_url}"

    # Xử lý điểm IMDb / TMDB
    imdb_data = movie.get('imdb', {}) or {}
    tmdb_data = movie.get('tmdb', {}) or {}
    raw_score = imdb_data.get('vote_average') or tmdb_data.get('vote_average')
    imdb = f"{raw_score} /10" if raw_score else ""

    # Xử lý Quốc Gia
    country_data = movie.get('country', [])
    if isinstance(country_data, list):
        country_str = ", ".join([c.get('name', '') for c in country_data if isinstance(c, dict) and c.get('name')])
    elif isinstance(country_data, dict):
        country_str = country_data.get('name', '')
    else:
        country_str = str(country_data or '')

    # Xử lý Đạo Diễn
    director_data = movie.get('director', [])
    if isinstance(director_data, list):
        director_str = ", ".join([str(d.get('name') if isinstance(d, dict) else d) for d in director_data if d])
    elif isinstance(director_data, dict):
        director_str = director_data.get('name', '')
    else:
        director_str = str(director_data or '')

    # Xử lý Thông Tin (Status, vd: completed, ongoing) & Tập hiện tại (vd: Hoàn Tất (12/12), Tập 5)
    status_str = str(movie.get('status', '') or '').strip()
    episode_current_str = str(movie.get('episode_current', '') or '').strip()

    episodes_data = data.get('episodes', [])
    if not episodes_data:
        return []

    server_data = episodes_data[0].get('server_data', [])
    if not server_data:
        return []

    rows = []
    for index, ep in enumerate(server_data):
        raw_ep_name = ep.get('name', str(index + 1))
        ep_url = ep.get('link_m3u8', '') or ep.get('link_embed', '')

        # Chuẩn hóa số tập (bỏ chữ hoặc số 0 thừa nếu có)
        match = re.fullmatch(r'(?:(?:tập|tap|episode|ep)\s*)*(\d+)', str(raw_ep_name).strip(), re.IGNORECASE)
        if match:
            ep_num = str(int(match.group(1)))
        else:
            ep_num = str(raw_ep_name)

        # Dòng 1 (Tập 1): Full metadata theo thứ tự 12 cột bắt buộc:
        # Tên Phim | Tên Gốc | Tập | Link Video | Ảnh bìa | Điểm IMDb | Năm | Quốc Gia | Đạo Diễn | Thông Tin | Tập hiện tại | Thể Loại
        if index == 0:
            row = [title, original_title, ep_num, ep_url, poster_url, imdb, year, country_str, director_str, status_str, episode_current_str, ""]
        else:
            # Các tập sau: Bỏ trống metadata (12 cột)
            row = ["", "", ep_num, ep_url, "", "", "", "", "", "", "", ""]

        rows.append("\t".join(row))

    return rows


@app.post("/api/crawl")
@app.get("/api/crawl")
async def crawl_movie_api(request: Optional[CrawlRequest] = None, url: Optional[str] = None):
    """
    API Cào dữ liệu Phim Đa Luồng (Bất đồng bộ asyncio.gather / httpx):
    - Nhận vào URL Phim lẻ HOẶC URL Cả Trang Danh Sách.
    - Xuất ra chuỗi TSV duy nhất nối dữ liệu của TẤT CẢ các phim cào được chuẩn 12 cột.
    """
    target_url = (request.url if request else url) or ""
    target_url = target_url.strip()

    if not target_url:
        raise HTTPException(status_code=400, detail="Vui lòng cung cấp URL hoặc Slug phim/trang danh sách!")

    url_type, param = classify_crawl_url(target_url)
    logger.info(f"🌐 Crawl Request - Phân loại URL: [{url_type}] | Param: {param}")

    headers = {"User-Agent": DEFAULT_USER_AGENT}

    async with httpx.AsyncClient(headers=headers, timeout=15.0, follow_redirects=True) as client:
        slugs_to_crawl = []

        if url_type == 'single':
            slugs_to_crawl = [param]
        else:
            # Gọi API danh sách của PhimAPI để lấy danh sách slug
            try:
                list_res = await client.get(param)
                if list_res.status_code != 200:
                    raise HTTPException(status_code=400, detail=f"Không thể tải trang danh sách API (HTTP {list_res.status_code})!")
                
                list_data = list_res.json()
                items = list_data.get('data', {}).get('items', []) or list_data.get('items', [])
                if not items:
                    raise HTTPException(status_code=404, detail="Không tìm thấy phim nào trong trang danh sách này!")
                
                slugs_to_crawl = [item.get('slug') for item in items if item and item.get('slug')]
            except HTTPException:
                raise
            except Exception as e:
                logger.error(f"❌ Lỗi khi tải API trang danh sách: {e}")
                raise HTTPException(status_code=500, detail=f"Lỗi khi đọc danh sách phim: {str(e)}")

        if not slugs_to_crawl:
            raise HTTPException(status_code=404, detail="Danh sách slug phim rỗng!")

        logger.info(f"⚡ Bắt đầu cào ĐA LUỒNG đồng thời cho {len(slugs_to_crawl)} phim...")

        # ĐA LUỒNG CONCURRENT FETCH VỚI asyncio.gather
        movie_results = await asyncio.gather(*[fetch_movie_detail(client, slug) for slug in slugs_to_crawl])

        # Lọc ra các phim cào thành công
        successful_movies = [m for m in movie_results if m is not None]
        if not successful_movies:
            raise HTTPException(status_code=404, detail="Tất cả các phim trong danh sách đều không cào được dữ liệu!")

        # Chuẩn bị Header TSV 12 cột theo thứ tự bắt buộc:
        # Tên Phim | Tên Gốc | Tập | Link Video | Ảnh bìa | Điểm IMDb | Năm | Quốc Gia | Đạo Diễn | Thông Tin | Tập hiện tại | Thể Loại
        tsv_headers = ["Tên Phim", "Tên Gốc", "Tập", "Link Video", "Ảnh bìa", "Điểm IMDb", "Năm", "Quốc Gia", "Đạo Diễn", "Thông Tin", "Tập hiện tại", "Thể Loại"]
        all_tsv_lines = ["\t".join(tsv_headers)]

        for m_data in successful_movies:
            m_rows = convert_movie_data_to_tsv_rows(m_data)
            all_tsv_lines.extend(m_rows)

        final_tsv = "\n".join(all_tsv_lines)

        return {
            "status": True,
            "message": f"Cào thành công {len(successful_movies)}/{len(slugs_to_crawl)} bộ phim!",
            "crawled_count": len(successful_movies),
            "total_requested": len(slugs_to_crawl),
            "tsv": final_tsv,
            "movies": successful_movies
        }


# -------------------------------------------------------------------
# CineSmart AI Assistant Endpoint (Gemini-1.5-Flash + ClickHouse OLAP)
# -------------------------------------------------------------------
class ChatRequest(BaseModel):
    message: str
    user_id: Optional[str] = "anonymous"
    available_movies: Optional[List[Any]] = []
    user_history: Optional[List[Dict[str, Any]]] = []
    top_genre: Optional[str] = None

def resolve_movie_title(raw_id: str, available_movies: Optional[List[Any]] = None) -> str:
    """Chuyển đổi movie_id (Document ID Firestore hoặc mã hash) thành tên phim người đọc hiểu được."""
    if not raw_id:
        return "Phim Hay Tuyển Chọn"

    # 1. Tra cứu trong bảng SQLite movies nếu có lưu
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT title FROM movies WHERE id = ?", (raw_id,))
        row = cur.fetchone()
        conn.close()
        if row and row[0] and row[0].strip():
            return row[0].strip()
    except Exception:
        pass

    # 2. Nếu raw_id đã là tên phim có nghĩa (chứa khoảng trắng và không phải mã Document ID Firestore 20 ký tự)
    if " " in raw_id and len(raw_id) < 60:
        return raw_id

    # 3. Lấy từ danh sách available_movies người dùng truyền lên
    if available_movies and len(available_movies) > 0:
        first_m = available_movies[0]
        if isinstance(first_m, dict):
            return first_m.get("title") or "Thất Nghiệp Chuyển Sinh"
        return str(first_m)

    return "Thất Nghiệp Chuyển Sinh"


def find_relevant_movies_for_prompt(user_query: str, limit: int = 6) -> str:
    """Tìm kiếm các bộ phim liên quan trực tiếp đến câu hỏi trong database và trích xuất thông tin chi tiết."""
    if not user_query:
        return ""
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT title, original_title, episode_current, status, episodes_count, year, director FROM movies")
        all_movies = cur.fetchall()
        conn.close()

        q = user_query.lower()
        words = [w for w in re.findall(r'[\w\d]+', q) if len(w) > 1 and w not in ['phim', 'cho', 'tôi', 'hỏi', 'xem', 'hay', 'ra', 'hết', 'chưa', 'co', 'không', 'nhỉ', 'với', 'bộ', 'phần', 'mùa', 'tập']]

        matched = []
        for m in all_movies:
            title = m[0] or ''
            orig = m[1] or ''
            combined = f"{title} {orig}".lower()
            score = 0
            if title.lower() in q:
                score += 30
            elif orig and orig.lower() in q:
                score += 25
            for w in words:
                if w in combined:
                    score += 5
            if score > 0:
                matched.append((score, m))

        matched.sort(key=lambda x: x[0], reverse=True)
        top_matches = [item[1] for item in matched[:limit]]
        if not top_matches:
            return ""

        lines = ["🎬 THÔNG TIN PHIM TRONG KHO DỮ LIỆU 210LOLIPHIM LIÊN QUAN TRỰC TIẾP ĐẾN CÂU HỎI:"]
        for m in top_matches:
            title = m[0]
            orig = f" ({m[1]})" if m[1] else ""
            ep = m[2] or "Đang cập nhật"
            st = m[3] or "ongoing"
            st_lower = st.lower()
            ep_lower = ep.lower()
            is_finished = (
                st_lower in ['completed', 'hoàn tất', 'hoan tat'] or 
                'hoàn tất' in ep_lower or 
                'hoan tat' in ep_lower or
                ('full' in ep_lower and 'full' in ep_lower)
            )
            st_text = f"ĐÃ RA HẾT TRỌN BỘ ({ep})" if is_finished else f"ĐANG CHIẾU / ĐANG CẬP NHẬT (Hiện có: {ep})"
            lines.append(f"- Phim: '{title}'{orig} => Tình trạng: {st_text}")

        return "\n".join(lines)
    except Exception as e:
        logger.warning(f"Error searching relevant movies for AI prompt: {e}")
        return ""


@app.post("/api/chat")
async def cine_smart_ai_chat(payload: ChatRequest):
    """
    Endpoint xử lý trò chuyện thông minh với CineSmart AI.
    1. Tiếp nhận lịch sử xem phim THỰC TẾ của tài khoản người dùng và phân tích thể loại xem nhiều nhất.
    2. Gợi ý phim cùng thể loại chính xác từ kho phim 210LoliPhim, tuyệt đối không bịa phim người dùng chưa xem.
    3. Tích hợp dữ liệu thời gian thực Top Trending từ ClickHouse vào System Prompt của Gemini API.
    """
    user_message = payload.message.strip()
    if not user_message:
        raise HTTPException(status_code=400, detail="Tin nhắn không được để trống!")

    # 1. Lấy danh sách Top 10 Trending từ ClickHouse theo thời gian thực
    trending_movies = []
    global clickhouse_client
    if not clickhouse_client:
        clickhouse_client = get_clickhouse_client()

    if clickhouse_client:
        try:
            query = """
                SELECT 
                    movie_id,
                    countIf(action_type = 'play') AS play_count,
                    countIf(action_type = 'view_detail') AS detail_views,
                    sum(watch_time) AS total_watch_seconds,
                    (play_count * 5 + detail_views * 2 + total_watch_seconds / 60) AS score
                FROM web_phim.user_telemetry_events
                WHERE created_at >= now() - INTERVAL 7 DAY
                GROUP BY movie_id
                ORDER BY score DESC
                LIMIT 10
            """
            result = clickhouse_client.query(query)
            for row in result.result_rows:
                raw_id = str(row[0])
                resolved_title = resolve_movie_title(raw_id, payload.available_movies)
                trending_movies.append({
                    "movie_id": raw_id,
                    "movie_title": resolved_title,
                    "play_count": int(row[1]),
                    "trending_score": round(float(row[4]), 1)
                })
        except Exception as e:
            logger.warning(f"Không thể truy vấn ClickHouse trending for AI context: {e}")

    # Danh sách dự phòng nếu ClickHouse chưa có đủ dữ liệu telemetry
    if not trending_movies:
        trending_movies = [
            {"movie_id": "Demon Slayer: Hashira Training Arc", "movie_title": "Demon Slayer: Hashira Training Arc", "trending_score": 95.0},
            {"movie_id": "Thất Nghiệp Chuyển Sinh Phần 3", "movie_title": "Thất Nghiệp Chuyển Sinh Phần 3", "trending_score": 92.3},
            {"movie_id": "Solo Leveling", "movie_title": "Solo Leveling", "trending_score": 89.1},
            {"movie_id": "Jujutsu Kaisen Season 2", "movie_title": "Jujutsu Kaisen Season 2", "trending_score": 87.4}
        ]

    # 2. Xử lý danh sách toàn bộ phim từ frontend payload + SQLite DB
    all_catalog_movies = []
    raw_available = payload.available_movies or []
    for item in raw_available:
        if isinstance(item, dict):
            t = (item.get("title") or "").strip()
            if t:
                all_catalog_movies.append({
                    "title": t,
                    "original_title": item.get("originalTitle") or item.get("original_title") or "",
                    "genres": item.get("genres") or [],
                    "description": item.get("description") or ""
                })
        elif isinstance(item, str) and item.strip():
            all_catalog_movies.append({
                "title": item.strip(),
                "original_title": "",
                "genres": [],
                "description": ""
            })

    # Bổ sung các phim từ SQLite DB nếu chưa có
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT title, original_title FROM movies ORDER BY updated_at DESC LIMIT 300")
        for row in cur.fetchall():
            db_title = (row[0] or "").strip()
            if db_title and not any(m["title"] == db_title for m in all_catalog_movies):
                all_catalog_movies.append({
                    "title": db_title,
                    "original_title": (row[1] or "").strip(),
                    "genres": [],
                    "description": ""
                })
        conn.close()
    except Exception:
        pass

    real_movies_list = [m["title"] for m in all_catalog_movies if m["title"]]
    real_movies_str = ", ".join([f"'{t}'" for t in real_movies_list[:250]])

    # 3. Lấy thông tin chi tiết các phim khớp với câu hỏi người dùng
    relevant_movies_info = find_relevant_movies_for_prompt(user_message, limit=6)

    # 4. Phân tích LỊCH SỬ XEM PHIM THỰC TẾ của tài khoản người dùng
    watched_movie_titles = []
    watched_movies_info = []
    genre_tally = {}

    for h in (payload.user_history or []):
        if isinstance(h, dict):
            title = (h.get("title") or "").strip()
            if title and title not in watched_movie_titles:
                watched_movie_titles.append(title)
            raw_genres = h.get("genres") or []
            clean_genres = []
            if isinstance(raw_genres, list):
                for g in raw_genres:
                    if g and isinstance(g, str):
                        gc = g.strip()
                        if gc.lower() not in ["4k", "full hd", "hd", "thuyết minh", "vietsub", "phim bộ", "phim lẻ"]:
                            clean_genres.append(gc)
                            genre_tally[gc] = genre_tally.get(gc, 0) + 1
            elif isinstance(raw_genres, str) and raw_genres.strip():
                gc = raw_genres.strip()
                clean_genres.append(gc)
                genre_tally[gc] = genre_tally.get(gc, 0) + 1

            genre_text = f" (Thể loại: {', '.join(clean_genres)})" if clean_genres else ""
            watched_movies_info.append(f"- Phim đã xem: '{title}'{genre_text}")
        elif isinstance(h, str) and h.strip():
            t_str = h.strip()
            if t_str not in watched_movie_titles:
                watched_movie_titles.append(t_str)
                watched_movies_info.append(f"- Phim đã xem: '{t_str}'")

    # Xác định thể loại xem nhiều nhất
    top_genre = (payload.top_genre or "").strip()
    if not top_genre and genre_tally:
        top_genre = max(genre_tally.items(), key=lambda x: x[1])[0]

    # Telemetry ClickHouse dự phòng: CHỈ tra cứu đúng user_id của tài khoản này nếu frontend chưa có user_history
    if not watched_movie_titles and clickhouse_client and payload.user_id and payload.user_id != 'anonymous':
        try:
            user_fav_query = """
                SELECT movie_id, sum(watch_time) AS total_seconds
                FROM web_phim.user_telemetry_events
                WHERE user_id = {user_id:String} AND movie_id != ''
                GROUP BY movie_id
                ORDER BY total_seconds DESC
                LIMIT 5
            """
            user_fav_res = clickhouse_client.query(user_fav_query, parameters={"user_id": payload.user_id})
            for r in user_fav_res.result_rows:
                raw_m_id = str(r[0])
                resolved_name = resolve_movie_title(raw_m_id, payload.available_movies)
                if resolved_name and resolved_name not in watched_movie_titles:
                    watched_movie_titles.append(resolved_name)
                    watched_movies_info.append(f"- Phim đã xem: '{resolved_name}'")
        except Exception as e:
            logger.warning(f"Lỗi truy vấn telemetry cho user {payload.user_id}: {e}")

    # 5. Từ điển thể loại & từ đồng nghĩa để nhận diện yêu cầu cụ thể của người dùng
    genre_synonyms_map = {
        "Romance / Tình cảm": ["romance", "tình cảm", "lãng mạn", "tình yêu", "ngôn tình", "love", "yêu", "hẹn hò", "bạn gái", "người yêu"],
        "Hành động / Action": ["action", "hành động", "chiến đấu", "võ thuật", "đánh nhau", "cày cấp", "chiến binh", "thợ săn"],
        "Hài hước / Comedy": ["comedy", "hài", "hài hước", "vui nhộn", "buồn cười", "bựa", "gây cười"],
        "Kinh dị / Horror": ["horror", "kinh dị", "rùng rợn", "ma", "quái vật", "u ám", "zombie", "ác quỷ"],
        "Chuyển sinh / Isekai": ["isekai", "chuyển sinh", "dị giới", "xuyên không", "tái sinh", "trọng sinh"],
        "Phiêu lưu / Adventure": ["adventure", "phiêu lưu", "khám phá", "hành trình", "thám hiểm"],
        "Học đường / School": ["school", "học đường", "trường học", "học sinh", "thanh xuân", "cấp 3"],
        "Khoa học viễn tưởng / Sci-Fi": ["sci-fi", "scifi", "viễn tưởng", "khoa học viễn tưởng", "vũ trụ", "tương lai", "robot", "mecha"],
        "Trinh thám / Bí ẩn": ["mystery", "trinh thám", "bí ẩn", "thám tử", "phá án", "điều tra"],
        "Giả tưởng / Fantasy": ["fantasy", "giả tưởng", "phép thuật", "ma thuật", "phù thủy", "thần thoại"]
    }

    msg_lower = user_message.lower()

    # Kiểm tra xem người dùng có yêu cầu ĐÍCH DANH một thể loại cụ thể hay không
    detected_genre = None
    detected_genre_kws = []
    for g_name, kws in genre_synonyms_map.items():
        if any(re.search(r'\b' + re.escape(kw) + r'\b', msg_lower) for kw in kws):
            detected_genre = g_name
            detected_genre_kws = kws
            break

    # Kiểm tra xem người dùng có chủ động hỏi về GU CÁ NHÂN hay không
    is_asking_personal_taste = any(phrase in msg_lower for phrase in [
        "hợp gu", "gu tôi", "gu của tôi", "gu mình", "hợp với tôi", "hợp với mình",
        "gu phim của tôi", "sở thích của tôi", "tôi nên xem phim gì", "phim cho tôi"
    ]) and not detected_genre

    # Tìm các phim trong kho phù hợp với thể loại người dùng CỤ THỂ YÊU CẦU (nếu có)
    specific_genre_candidates = []
    if detected_genre:
        for m in all_catalog_movies:
            t = m.get("title", "")
            orig = m.get("original_title", "")
            desc = m.get("description", "")
            genres = [str(g).lower() for g in m.get("genres", [])]
            combined = f"{t} {orig} {desc} {' '.join(genres)}".lower()
            if any(kw in combined for kw in detected_genre_kws):
                if t not in specific_genre_candidates:
                    specific_genre_candidates.append(t)

    # Tìm các phim trong kho CÙNG THỂ LOẠI với top_genre (chưa xem) để gợi ý khi hỏi gu
    same_genre_candidates = []
    if top_genre:
        top_lower = top_genre.lower()
        for m in all_catalog_movies:
            t = m["title"]
            if t in watched_movie_titles:
                continue
            m_genres = [str(g).lower() for g in m.get("genres", [])]
            m_desc = (m.get("description") or "").lower()
            if any(top_lower in g for g in m_genres) or top_lower in m_desc:
                if t not in same_genre_candidates:
                    same_genre_candidates.append(t)

    if not same_genre_candidates:
        same_genre_candidates = [
            m["title"] for m in all_catalog_movies if m["title"] not in watched_movie_titles
        ][:6]

    # 6. Xây dựng ngữ cảnh và System Prompt linh hoạt theo đúng câu hỏi người dùng
    if detected_genre:
        user_intent_section = (
            f"=== YÊU CẦU HIỆN TẠI CỦA NGƯỜI DÙNG ===\n"
            f"Người dùng đang nhắn: '{user_message}'\n"
            f"🎯 THỂ LOẠI NGƯỜI DÙNG ĐANG YÊU CẦU: **{detected_genre}**!\n"
            f"Danh sách các phim {detected_genre} có sẵn trong kho 210LoliPhim: [{', '.join(specific_genre_candidates[:12])}].\n\n"
            f"=== QUY TẮC BẮT BUỘC CHO CÂU TRẢ LỜI NÀY ===\n"
            f"1. Người dùng đang yêu cầu phim thể loại {detected_genre}, vì vậy BẮT BUỘC phải giới thiệu 2-3 bộ phim {detected_genre} từ danh sách trên kèm 1-2 câu tóm tắt nội dung ngọt ngào, hấp dẫn.\n"
            f"2. TUYỆT ĐỐI KHÔNG mở đầu bằng câu rập khuôn 'Với gu thích xem Action của bạn...'! Trả lời tự nhiên, hào hứng, đúng vào thể loại {detected_genre} người dùng muốn xem.\n"
            f"3. TUYỆT ĐỐI KHÔNG gợi ý phim hành động cày cấp hay thể loại khác khi người dùng hỏi {detected_genre}."
        )
    elif is_asking_personal_taste and watched_movie_titles and top_genre:
        user_intent_section = (
            f"=== YÊU CẦU HIỆN TẠI: NGƯỜI DÙNG HỎI VỀ GU PHIM CỦA MÌNH ('{user_message}') ===\n"
            f"- Lịch sử xem phim thực tế của tài khoản: [{', '.join(watched_movie_titles)}].\n"
            f"- Thể loại xem nhiều nhất: **{top_genre}**.\n"
            f"- Các phim cùng thể loại '{top_genre}' trong kho (chưa xem): [{', '.join(same_genre_candidates[:8])}].\n\n"
            f"=== QUY TẮC BẮT BUỘC ===\n"
            f"1. Trả lời linh hoạt, tự nhiên, sinh động (TUYỆT ĐỐI KHÔNG copy rập khuôn 1 câu duy nhất). Nêu bật rằng qua lịch sử xem phim của họ, họ rất chuộng thể loại **{top_genre}**, sau đó giới thiệu 2-3 phim {top_genre} từ danh sách trên.\n"
            f"2. KHÔNG bịa phim ngoài lịch sử và KHÔNG gợi ý lại phim đã xem."
        )
    elif is_asking_personal_taste:
        user_intent_section = (
            f"=== YÊU CẦU: HỎI VỀ GU PHIM NHƯNG CHƯA CÓ LỊCH SỬ XEM ===\n"
            f"Tài khoản hiện chưa có lịch sử xem phim nào. Hãy thân thiện thông báo tài khoản chưa có lịch sử để phân tích gu riêng, và gợi ý 2-3 phim đang HOT nhất trên 210LoliPhim."
        )
    else:
        user_intent_section = (
            f"=== YÊU CẦU HIỆN TẠI CỦA NGƯỜI DÙNG ===\n"
            f"Người dùng nhắn: '{user_message}'.\n"
            f"Hãy trả lời tự nhiên, linh hoạt, đúng trọng tâm câu hỏi. TUYỆT ĐỐI KHÔNG tự động chèn vào câu mở đầu rập khuôn hay gợi ý phim lạc đề!"
        )

    system_prompt = (
        "Bạn là 'Trợ lý CineSmart AI', một chuyên gia điện ảnh & anime thông minh, sành sỏi, am hiểu kho phim của nền tảng 210LoliPhim.\n\n"
        "=== DỮ LIỆU KHO PHIM THỰC TẾ TRÊN HỆ THỐNG ===\n"
        f"{relevant_movies_info}\n\n"
        f"Danh sách các phim đang có trên trang web 210LoliPhim gồm: [{real_movies_str}].\n\n"
        f"{user_intent_section}\n\n"
        "=== QUY TẮC PHẢN HỒI CHUNG ===\n"
        "1. KHI NGƯỜI DÙNG HỎI VỀ TÌNH TRẠNG MỘT BỘ PHIM CỤ THỂ (ví dụ: 'ra hết chưa', 'có bao nhiêu tập', 'đã có phim X chưa'):\n"
        "   - Tra cứu phần 'THÔNG TIN PHIM TRONG KHO DỮ LIỆU'. Nếu phim có tên trong đó hoặc trong kho phim, "
        "BẮT BUỘC PHẢI KHẲNG ĐỊNH LÀ ĐÃ CÓ TRÊN TRANG WEB 210LoliPhim!\n"
        "   - TUYỆT ĐỐI KHÔNG ĐƯỢC NÓI LÀ CHƯA CÓ khi dữ liệu đã cung cấp thông tin về bộ phim đó!\n"
        "   - Dựa vào phần 'Tình trạng' được cung cấp để trả lời: nếu 'ĐÃ RA HẾT TRỌN BỘ' thì khẳng định phim đã ra hết đủ tập, nếu 'ĐANG CHIẾU' thì báo số tập hiện có và đang cập nhật tiếp.\n"
        "2. TUYỆT ĐỐI KHÔNG TỰ BỊA RA CÁC PHIM HOẶC MÙA PHIM KHÔNG TỒN TẠI.\n"
        "3. Hãy luôn trả lời linh hoạt, tự nhiên, vui tính, đúng trọng tâm câu hỏi của người dùng, dùng icon sinh động và định dạng Markdown (in đậm, danh sách bullet)."
    )

    # 3. Gửi System Prompt + Tin nhắn tới Gemini
    # Ưu tiên đọc key mới nhất từ file .env nếu có để khi người dùng sửa .env là có hiệu lực ngay
    gemini_key = ""
    for env_candidate in ["/app/.env", ".env", "../.env", "/app/../.env"]:
        if os.path.exists(env_candidate):
            try:
                with open(env_candidate, "r", encoding="utf-8") as ef:
                    for eline in ef:
                        if eline.strip().startswith("GEMINI_API_KEY="):
                            k = eline.split("=", 1)[1].strip().strip('"').strip("'")
                            if k:
                                gemini_key = k
                                break
            except Exception:
                pass
        if gemini_key:
            break

    if not gemini_key:
        gemini_key = os.getenv("GEMINI_API_KEY", "").strip()

    if not gemini_key:
        logger.warning("GEMINI_API_KEY chưa được thiết lập.")
        # Phản hồi dự phòng thông minh khi chưa có API Key
        if detected_genre and specific_genre_candidates:
            fallback_reply = (
                f"Chào bạn! ✨ Dưới đây là những bộ phim thể loại **{detected_genre}** cực hay trên 210LoliPhim mà bạn không nên bỏ lỡ:\n\n"
                + "\n".join([f"• **{t}**" for t in specific_genre_candidates[:3]])
                + "\n\nChúc bạn có những giờ phút xem phim ngọt ngào và vui vẻ nhé! 🍿"
            )
        elif is_asking_personal_taste and top_genre and same_genre_candidates:
            fallback_reply = (
                f"Chào bạn! ✨ Điểm qua lịch sử xem phim của bạn, mình thấy bạn rất chuộng thể loại **{top_genre}**. Dưới đây là vài bộ phim siêu đỉnh đúng gu của bạn trên 210LoliPhim:\n\n"
                + "\n".join([f"• **{t}**" for t in same_genre_candidates[:3]])
                + "\n\nChúc bạn xem phim vui vẻ nhé! 🚀"
            )
        else:
            fallback_reply = (
                f"🎬 **Trợ lý CineSmart AI**:\n"
                f"Dưới đây là các phim đang **HOT nhất** trên hệ thống 210LoliPhim theo thống kê thời gian thực:\n"
                + "\n".join([f"• **{m.get('movie_title', m['movie_id'])}** (Độ HOT: {m['trending_score']})" for m in trending_movies[:5]])
                + "\n\n*(Lưu ý: Hãy thiết lập `GEMINI_API_KEY` trong môi trường Docker để kích hoạt mô hình Gemini đầy đủ!)*"
            )
        return {
            "status": True,
            "reply": fallback_reply,
            "trending_used": trending_movies
        }

    try:
        full_prompt = f"{system_prompt}\n\nNgười dùng nhắn: {user_message}\nCineSmart AI trả lời:"
        candidate_models = [
            "gemini-2.5-flash",
            "gemini-flash-latest",
            "gemini-3.7-flash",
            "gemini-3.6-flash",
            "gemini-2.5-pro",
            "gemini-pro-latest"
        ]

        reply_text = None
        last_error = None

        # 1. Thử gọi trực tiếp REST API qua httpx (hỗ trợ hoàn hảo cả x-goog-api-key và AQ. keys)
        async with httpx.AsyncClient(timeout=25.0) as client:
            headers = {
                "Content-Type": "application/json",
                "x-goog-api-key": gemini_key
            }
            for model_name in candidate_models:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={gemini_key}"
                payload_json = {
                    "contents": [{"parts": [{"text": full_prompt}]}]
                }
                try:
                    res = await client.post(url, headers=headers, json=payload_json)
                    if res.status_code == 200:
                        data = res.json()
                        candidates = data.get("candidates", [])
                        if candidates:
                            parts = candidates[0].get("content", {}).get("parts", [])
                            if parts:
                                reply_text = parts[0].get("text", "")
                                break
                    else:
                        last_error = Exception(f"HTTP {res.status_code}: {res.text[:200]}")
                except Exception as e:
                    last_error = e
                    continue

        # 2. Fallback sang genai SDK nếu không phải key dạng AQ.
        if not reply_text and genai is not None and not gemini_key.startswith("AQ."):
            try:
                genai.configure(api_key=gemini_key)
                for model_name in candidate_models:
                    try:
                        model = genai.GenerativeModel(model_name)
                        res = model.generate_content(full_prompt)
                        if res and hasattr(res, 'text') and res.text:
                            reply_text = res.text
                            break
                    except Exception as e:
                        last_error = e
                        continue
            except Exception as e:
                last_error = e

        if not reply_text:
            if last_error:
                raise last_error
            reply_text = "Xin lỗi, tôi chưa thể xử lý phản hồi từ Gemini lúc này."

        return {
            "status": True,
            "reply": reply_text,
            "trending_used": trending_movies
        }

    except Exception as err:
        logger.error(f"Lỗi khi gọi Gemini API: {err}")
        err_msg = str(err)
        
        # Nếu lỗi và người dùng hỏi thể loại cụ thể hoặc hợp gu, ưu tiên phản hồi thông minh theo đúng yêu cầu
        if detected_genre and specific_genre_candidates:
            reply = (
                f"Chào bạn! ✨ Dưới đây là những bộ phim thể loại **{detected_genre}** cực hay trên 210LoliPhim mà bạn không nên bỏ lỡ:\n\n"
                + "\n".join([f"• **{t}**" for t in specific_genre_candidates[:3]])
                + "\n\nChúc bạn xem phim vui vẻ nhé! 🍿"
            )
        elif is_asking_personal_taste and top_genre and same_genre_candidates:
            reply = (
                f"Chào bạn! ✨ Điểm qua lịch sử xem phim của bạn, mình thấy bạn rất chuộng thể loại **{top_genre}**. Dưới đây là vài bộ phim siêu đỉnh đúng gu của bạn trên 210LoliPhim:\n\n"
                + "\n".join([f"• **{t}**" for t in same_genre_candidates[:3]])
                + "\n\nChúc bạn xem phim vui vẻ nhé! 🚀"
            )
        else:
            suggested_movie = (
                trending_movies[0].get('movie_title')
                if trending_movies and trending_movies[0].get('movie_title')
                else (real_movies_list[0] if real_movies_list else "Thất Nghiệp Chuyển Sinh")
            )

            if "401" in err_msg or "ACCESS_TOKEN_TYPE_UNSUPPORTED" in err_msg or "invalid authentication" in err_msg:
                reply = (
                    f"🤖 **Trợ lý CineSmart AI**: Khóa API Gemini hiện tại chưa hợp lệ hoặc đã hết hạn (Lỗi 401: Unauthorized).\n\n"
                    f"💡 **Nguyên nhân & Cách khắc phục:**\n"
                    f"- Khóa `GEMINI_API_KEY` trong file `.env` chưa đúng hoặc đã hết hạn.\n"
                    f"- Bạn hãy vào [Google AI Studio](https://aistudio.google.com/app/apikey) tạo một API Key Gemini miễn phí rồi dán vào file `.env`.\n\n"
                    f"🍿 Dù vậy, tôi gợi ý bạn trải nghiệm ngay bộ phim **{suggested_movie}** đang làm mưa làm gió trên hệ thống!"
                )
            else:
                reply = (
                    f"🤖 **Trợ lý CineSmart AI**: Rất tiếc có sự cố kết nối với Gemini API ({err_msg}). "
                    f"Tuy nhiên tôi gợi ý bạn trải nghiệm ngay bộ phim **{suggested_movie}** đang làm mưa làm gió!"
                )

        return {
            "status": True,
            "reply": reply,
            "error": err_msg
        }


