-- Phase 0: Dialogue, Inbox, Best Ideas
-- Preserves all existing tables — adds new capabilities

-- Dialogue Turns: permanent record of every Kevin/Jenny conversation
CREATE TABLE IF NOT EXISTS dialogue_turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  turn_number INTEGER NOT NULL,
  speaker TEXT NOT NULL CHECK(speaker IN ('kevin', 'jenny', 'system')),
  content TEXT NOT NULL,
  thoughts TEXT,                          -- internal reasoning (visible on request)
  related_packet_ids TEXT DEFAULT '[]',   -- JSON array of packet IDs referenced
  trigger_source TEXT DEFAULT 'system',   -- 'inbox', 'cron', 'manual'
  turn_group TEXT NOT NULL,               -- UUID grouping a chain of dialogue turns
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dialogue_turn_group ON dialogue_turns(turn_group);
CREATE INDEX IF NOT EXISTS idx_dialogue_speaker ON dialogue_turns(speaker);
CREATE INDEX IF NOT EXISTS idx_dialogue_created ON dialogue_turns(created_at);

-- Idea Inbox: anyone can drop an idea
CREATE TABLE IF NOT EXISTS inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author TEXT NOT NULL DEFAULT 'anonymous',
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'processing', 'discussed', 'promoted')),
  turn_group TEXT,                       -- dialogue chain triggered by this idea
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inbox_status ON inbox(status);
CREATE INDEX IF NOT EXISTS idx_inbox_created ON inbox(created_at);

-- Best Ideas: promoted by Kevin & Jenny
CREATE TABLE IF NOT EXISTS best_ideas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  packet_ids TEXT DEFAULT '[]',           -- related packet IDs
  inbox_id INTEGER,                       -- originated from which inbox item
  promoted_by TEXT NOT NULL CHECK(promoted_by IN ('kevin', 'jenny')),
  promoted_reason TEXT,
  promoted_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (inbox_id) REFERENCES inbox(id) ON DELETE SET NULL
);

-- Add turn_number sequence to system_state
INSERT OR IGNORE INTO system_state (key, value) VALUES ('turn_sequence', '0');
INSERT OR IGNORE INTO system_state (key, value) VALUES ('total_dialogue_turns', '0');
