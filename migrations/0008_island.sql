-- Island era tables — LOCAL DEV MIRROR ONLY.
--
-- The Worker creates these itself at runtime (src/world/store.ts,
-- ensureIslandSchema — the same self-healing pattern as migrations/0005's
-- ensureMindSchema), so a live deploy never depends on this file having been
-- applied remotely. This migration exists only so `wrangler d1 migrations
-- apply livingcore --local` gives a fresh local DB the same schema.
--
-- NEVER run this with --remote: the live table set is already there.

CREATE TABLE IF NOT EXISTS turn_meta (
  turn_id INTEGER PRIMARY KEY,
  era TEXT NOT NULL,
  protocol TEXT NOT NULL,
  scene_id TEXT NOT NULL,
  sim_day INTEGER NOT NULL,
  sim_slot TEXT NOT NULL,
  location TEXT NOT NULL,
  thought TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL,
  retries INTEGER NOT NULL DEFAULT 0,
  retry_reason TEXT,
  notebook_refs TEXT NOT NULL DEFAULT '[]',
  memory_refs TEXT NOT NULL DEFAULT '[]',
  -- Part 2 (apart time / activities): what the speaker was visibly doing.
  activity TEXT NOT NULL DEFAULT 'idle',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_turn_meta_scene ON turn_meta(scene_id);
CREATE INDEX IF NOT EXISTS idx_turn_meta_day ON turn_meta(sim_day);

CREATE TABLE IF NOT EXISTS scenes (
  id TEXT PRIMARY KEY,
  day INTEGER NOT NULL,
  slot TEXT NOT NULL,
  location TEXT NOT NULL,
  title TEXT NOT NULL,
  setup TEXT NOT NULL,
  event TEXT,
  status TEXT NOT NULL,
  summary TEXT,
  outcomes_json TEXT,
  turn_count INTEGER NOT NULL DEFAULT 0,
  model TEXT,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  -- Part 2 (apart time): 'together' or 'apart', and (only for 'apart') each
  -- agent's own place/doing/setup, JSON-encoded.
  mode TEXT NOT NULL DEFAULT 'together',
  apart_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_scenes_day ON scenes(day);

CREATE TABLE IF NOT EXISTS world_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day INTEGER NOT NULL,
  slot TEXT NOT NULL,
  kind TEXT NOT NULL,
  who TEXT NOT NULL DEFAULT 'world',
  detail TEXT NOT NULL,
  data_json TEXT,
  scene_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_world_events_day ON world_events(day);

CREATE TABLE IF NOT EXISTS notebook (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day INTEGER NOT NULL,
  author TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  location TEXT,
  scene_id TEXT,
  uses INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day INTEGER NOT NULL,
  maker TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  format TEXT NOT NULL,
  scene_id TEXT,
  inbox_id INTEGER,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chapters (
  day INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  model TEXT NOT NULL,
  stats_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

-- day = the day being PREDICTED.
CREATE TABLE IF NOT EXISTS forecasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day INTEGER NOT NULL,
  agent TEXT NOT NULL,
  predicted TEXT NOT NULL,
  actual TEXT,
  correct INTEGER,
  created_at TEXT NOT NULL
);

-- status: at_sea | ashore | read | answered
CREATE TABLE IF NOT EXISTS bottles (
  inbox_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL,
  washed_day INTEGER,
  scene_id TEXT,
  reply_artifact_id INTEGER,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS metrics_daily (
  day INTEGER PRIMARY KEY,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
