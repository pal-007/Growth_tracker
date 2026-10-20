import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  avatar        TEXT NOT NULL DEFAULT 'rocket',
  demo_mode     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  json    TEXT NOT NULL
);

-- A task is a template. Recurrence is computed from it; per-day state lives in task_logs
-- so a new day never overwrites or deletes earlier completion records.
CREATE TABLE IF NOT EXISTS tasks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  category        TEXT NOT NULL DEFAULT 'Personal',
  scheduled_time  TEXT,                       -- HH:MM
  reminder_minutes INTEGER,                   -- minutes before scheduled_time
  duration_min    INTEGER,
  priority        TEXT NOT NULL DEFAULT 'medium',
  repeat_type     TEXT NOT NULL DEFAULT 'none', -- none|daily|selected_days|weekly|custom
  repeat_days     TEXT NOT NULL DEFAULT '[]', -- JSON array, 0=Sun..6=Sat
  repeat_interval INTEGER NOT NULL DEFAULT 1, -- custom: every N days
  start_date      TEXT NOT NULL,
  end_date        TEXT,
  goal_id         INTEGER REFERENCES goals(id) ON DELETE SET NULL,
  is_habit        INTEGER NOT NULL DEFAULT 0,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  archived        INTEGER NOT NULL DEFAULT 0,
  demo            INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, demo, archived);

CREATE TABLE IF NOT EXISTS task_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id      INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  date         TEXT NOT NULL,
  status       TEXT NOT NULL,                 -- in_progress|completed|skipped
  completed_at TEXT,
  note         TEXT NOT NULL DEFAULT '',
  demo         INTEGER NOT NULL DEFAULT 0,
  UNIQUE(task_id, date)
);
CREATE INDEX IF NOT EXISTS idx_logs_user_date ON task_logs(user_id, demo, date);

CREATE TABLE IF NOT EXISTS goals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL DEFAULT 'Personal',
  start_date    TEXT,
  target_date   TEXT,
  priority      TEXT NOT NULL DEFAULT 'medium',
  target_value  REAL,                         -- measurable target, e.g. 60
  current_value REAL NOT NULL DEFAULT 0,
  unit          TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'not_started', -- not_started|in_progress|completed|paused
  completed_at  TEXT,
  demo          INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS milestones (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id   INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title     TEXT NOT NULL,
  due_date  TEXT,
  done      INTEGER NOT NULL DEFAULT 0,
  done_at   TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS journal (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  went_well   TEXT NOT NULL DEFAULT '',
  learned     TEXT NOT NULL DEFAULT '',
  difficult   TEXT NOT NULL DEFAULT '',
  distracted  TEXT NOT NULL DEFAULT '',
  proud       TEXT NOT NULL DEFAULT '',
  improve     TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  mood        INTEGER,                        -- 1..5
  energy      INTEGER,                        -- 1..5
  demo        INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, date, demo)
);

CREATE TABLE IF NOT EXISTS focus_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id     INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  date        TEXT NOT NULL,
  work_min    INTEGER NOT NULL,
  break_min   INTEGER NOT NULL,
  actual_min  INTEGER NOT NULL DEFAULT 0,
  completed   INTEGER NOT NULL DEFAULT 0,
  demo        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Idempotent XP ledger: (user, kind, ref) is unique so replays and undo/redo never double count.
CREATE TABLE IF NOT EXISTS xp_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  ref        TEXT NOT NULL,
  xp         INTEGER NOT NULL,
  date       TEXT NOT NULL,
  demo       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, kind, ref, demo)
);

CREATE TABLE IF NOT EXISTS achievements (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  unlocked_at TEXT NOT NULL DEFAULT (datetime('now')),
  date        TEXT NOT NULL,
  demo        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, key, demo)
);
`;

export function openDb(file: string = config.databasePath): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
