import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

export const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS programs (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  slot_labels TEXT NOT NULL,      -- JSON array of 4 labels
  slot_guidance TEXT NOT NULL,    -- JSON array of 4 guidance strings
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('dreamer','coach','director')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS dreamers (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  coach_user_id INTEGER REFERENCES users(id),
  program_id INTEGER NOT NULL REFERENCES programs(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed')),
  joined_on TEXT NOT NULL,
  about TEXT
);

CREATE TABLE IF NOT EXISTS dreams (
  id INTEGER PRIMARY KEY,
  dreamer_id INTEGER NOT NULL REFERENCES dreamers(id),
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 4),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  achieved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (dreamer_id, slot)
);

CREATE TABLE IF NOT EXISTS coaching_sessions (
  id INTEGER PRIMARY KEY,
  dreamer_id INTEGER NOT NULL REFERENCES dreamers(id),
  coach_user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  occurred_at TEXT NOT NULL,
  completed_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  focus TEXT NOT NULL DEFAULT '',
  actions_reviewed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_dreamer ON coaching_sessions(dreamer_id, occurred_at);

-- A self check-in groups several entries made together by the dreamer.
CREATE TABLE IF NOT EXISTS check_ins (
  id INTEGER PRIMARY KEY,
  dreamer_id INTEGER NOT NULL REFERENCES dreamers(id),
  occurred_at TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ratings (
  id INTEGER PRIMARY KEY,
  dreamer_id INTEGER NOT NULL REFERENCES dreamers(id),
  category TEXT NOT NULL CHECK (category IN ('contribution','alignment','relationships','energy','commitment','satisfaction')),
  value INTEGER NOT NULL CHECK (value BETWEEN 0 AND 10),
  occurred_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('session','self')),
  session_id INTEGER REFERENCES coaching_sessions(id) ON DELETE CASCADE,
  check_in_id INTEGER REFERENCES check_ins(id) ON DELETE CASCADE,
  recorded_by INTEGER NOT NULL REFERENCES users(id),
  is_private INTEGER NOT NULL DEFAULT 0 CHECK (is_private IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ratings_dreamer ON ratings(dreamer_id, category, occurred_at);
DROP INDEX IF EXISTS idx_ratings_session_cat;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ratings_session_cat_v2 ON ratings(session_id, category, is_private) WHERE session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS dream_progress (
  id INTEGER PRIMARY KEY,
  dreamer_id INTEGER NOT NULL REFERENCES dreamers(id),
  dream_id INTEGER NOT NULL REFERENCES dreams(id),
  value INTEGER NOT NULL CHECK (value BETWEEN 0 AND 100),
  occurred_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('session','self')),
  session_id INTEGER REFERENCES coaching_sessions(id) ON DELETE CASCADE,
  check_in_id INTEGER REFERENCES check_ins(id) ON DELETE CASCADE,
  recorded_by INTEGER NOT NULL REFERENCES users(id),
  is_private INTEGER NOT NULL DEFAULT 0 CHECK (is_private IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_progress_dream ON dream_progress(dream_id, occurred_at);
DROP INDEX IF EXISTS idx_progress_session_dream;
CREATE UNIQUE INDEX IF NOT EXISTS idx_progress_session_dream_v2 ON dream_progress(session_id, dream_id, is_private) WHERE session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS journal_entries (
  id INTEGER PRIMARY KEY,
  dreamer_id INTEGER NOT NULL REFERENCES dreamers(id),
  body TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  is_private INTEGER NOT NULL DEFAULT 0 CHECK (is_private IN (0,1)),
  source TEXT NOT NULL CHECK (source IN ('session','self')),
  session_id INTEGER REFERENCES coaching_sessions(id) ON DELETE SET NULL,
  check_in_id INTEGER REFERENCES check_ins(id) ON DELETE SET NULL,
  rating_id INTEGER UNIQUE REFERENCES ratings(id) ON DELETE CASCADE,
  progress_id INTEGER UNIQUE REFERENCES dream_progress(id) ON DELETE CASCADE,
  dream_id INTEGER REFERENCES dreams(id),
  category TEXT CHECK (category IS NULL OR category IN ('contribution','alignment','relationships','energy','commitment','satisfaction')),
  author_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_journal_dreamer ON journal_entries(dreamer_id, occurred_at);

CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY,
  dreamer_id INTEGER NOT NULL REFERENCES dreamers(id),
  title TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','archived')),
  dream_id INTEGER REFERENCES dreams(id),
  category TEXT CHECK (category IS NULL OR category IN ('contribution','alignment','relationships','energy')),
  is_private INTEGER NOT NULL DEFAULT 0 CHECK (is_private IN (0,1)),
  created_by INTEGER NOT NULL REFERENCES users(id),
  session_id INTEGER REFERENCES coaching_sessions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  archived_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_actions_dreamer ON actions(dreamer_id, status);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  private_unlocked_until TEXT
);
CREATE INDEX IF NOT EXISTS idx_auth_user ON auth_sessions(user_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT
);
`;

export function openDatabase(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  // Columns added after the first release; CREATE TABLE IF NOT EXISTS leaves older databases without them.
  const sessionCols = (db.prepare('PRAGMA table_info(coaching_sessions)').all() as { name: string }[]).map((c) => c.name);
  if (!sessionCols.includes('actions_reviewed')) db.exec('ALTER TABLE coaching_sessions ADD COLUMN actions_reviewed INTEGER NOT NULL DEFAULT 0');
  return db;
}

export function nowIso(): string {
  return new Date().toISOString();
}
