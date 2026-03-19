import sqlite3
import os
from flask import jsonify
from datetime import datetime, timezone

DB_PATH   = os.path.join(os.path.dirname(__file__), 'dbms.sqlite')
SEED_PATH = os.path.join(os.path.dirname(__file__), 'seed_data.sql')


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def row_to_dict(row):
    return dict(row) if row else None


def rows_to_list(rows):
    return [dict(r) for r in rows]


def init_db():
    conn = get_db()
    tables = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='entities'"
    ).fetchone()
    if not tables:
        with open(SEED_PATH, 'r', encoding='utf-8') as f:
            conn.executescript(f.read())
        conn.commit()

    # Run column migrations — SQLite does not support ADD COLUMN IF NOT EXISTS
    # so we catch OperationalError when the column already exists.
    _migrations = [
        "ALTER TABLE entities ADD COLUMN visa_status TEXT DEFAULT 'None'",
        "ALTER TABLE entities ADD COLUMN passport_photo TEXT",
    ]
    for sql in _migrations:
        try:
            conn.execute(sql)
            conn.commit()
        except Exception:
            pass  # Column already exists

    conn.close()


def api_response(data=None, message="OK", success=True, status=200):
    return jsonify({
        "success": success,
        "data": data,
        "message": message,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }), status


def api_error(message, status=400):
    return api_response(data=None, message=message, success=False, status=status)
