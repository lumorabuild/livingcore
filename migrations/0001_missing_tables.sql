-- Living Core — missing tables migration
-- Adds dialogue_turns, inbox, best_ideas, rss_items, categories, thinking rules, and AI rate tracking

-- Categories for organizing packets
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#71767b',
  icon TEXT NOT NULL DEFAULT '📂',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Dialogue turns — the visible conversation between Kevin & Jenny
CREATE TABLE IF NOT EXISTS dialogue_turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  turn_number INTEGER NOT NULL DEFAULT 0,
  speaker TEXT NOT NULL CHECK(speaker IN ('kevin', 'jenny', 'system')),
  content TEXT NOT NULL,
  thoughts TEXT,
  related_packet_ids TEXT NOT NULL DEFAULT '[]',
  trigger_source TEXT NOT NULL DEFAULT 'manual',
  turn_group TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dialogue_turns_group ON dialogue_turns(turn_group);
CREATE INDEX IF NOT EXISTS idx_dialogue_turns_speaker ON dialogue_turns(speaker);
CREATE INDEX IF NOT EXISTS idx_dialogue_turns_created ON dialogue_turns(created_at);

-- Idea inbox — external ideas submitted by visitors
CREATE TABLE IF NOT EXISTS inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author TEXT NOT NULL DEFAULT 'anonymous',
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'discussed', 'promoted')),
  turn_group TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inbox_status ON inbox(status);

-- Best ideas — ideas promoted from dialogue
CREATE TABLE IF NOT EXISTS best_ideas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  packet_ids TEXT NOT NULL DEFAULT '[]',
  inbox_id INTEGER,
  promoted_by TEXT NOT NULL CHECK(promoted_by IN ('kevin', 'jenny')),
  promoted_reason TEXT,
  promoted_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (inbox_id) REFERENCES inbox(id) ON DELETE SET NULL
);

-- RSS items — fetched from external feeds
CREATE TABLE IF NOT EXISTS rss_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_url TEXT NOT NULL,
  feed_title TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  link TEXT NOT NULL,
  summary TEXT,
  content TEXT,
  published_at TEXT,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'considered', 'discussed', 'ignored')),
  discussion_turn_ids TEXT NOT NULL DEFAULT '[]',
  assigned_category TEXT,
  relevance_score REAL NOT NULL DEFAULT 0.0,
  UNIQUE(link)
);

CREATE INDEX IF NOT EXISTS idx_rss_items_status ON rss_items(status);
CREATE INDEX IF NOT EXISTS idx_rss_items_fetched ON rss_items(fetched_at);

-- Thinking rules — self-evolving rule system
CREATE TABLE IF NOT EXISTS thinking_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(name, version)
);

-- Rule proposals — agents propose rule changes
CREATE TABLE IF NOT EXISTS rule_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent TEXT NOT NULL CHECK(agent IN ('kevin', 'jenny', 'system')),
  rule_name TEXT NOT NULL,
  proposed_content TEXT NOT NULL,
  reason TEXT NOT NULL,
  coherence_before REAL,
  coherence_after REAL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'evaluating', 'adopted', 'rejected')),
  source_turn_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  evaluated_at TEXT
);

-- Rule adoptions — tracking when proposals are accepted
CREATE TABLE IF NOT EXISTS rule_adoptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_name TEXT NOT NULL,
  from_version INTEGER NOT NULL,
  to_version INTEGER NOT NULL,
  proposal_id INTEGER,
  content TEXT NOT NULL,
  coherence_before REAL,
  coherence_after REAL,
  adopted_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (proposal_id) REFERENCES rule_proposals(id) ON DELETE SET NULL
);

-- Missing columns on packets table (add if they don't exist)
-- Note: SQLite doesn't support IF NOT EXISTS for ALTER TABLE ADD COLUMN in all versions
-- We use INSERT OR IGNORE approach via application code instead

-- System state keys for AI rate limiting and dialogue tracking
INSERT OR IGNORE INTO system_state (key, value) VALUES ('total_dialogue_turns', '0');
INSERT OR IGNORE INTO system_state (key, value) VALUES ('ai_model_kevin', '@cf/ibm-granite/granite-4.0-h-micro');
INSERT OR IGNORE INTO system_state (key, value) VALUES ('ai_model_jenny', '@cf/zai-org/glm-4.7-flash');
INSERT OR IGNORE INTO system_state (key, value) VALUES ('ai_daily_limit_per_agent', '8');
