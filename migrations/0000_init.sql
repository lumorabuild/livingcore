-- Living Core D1 Schema
-- A lightweight, self-evolving cognitive architecture

-- Thought Packets: the fundamental unit of memory
-- Every piece of knowledge is a packet with its own content, type, and metadata
CREATE TABLE IF NOT EXISTS packets (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('experience', 'observation', 'concept', 'hypothesis', 'rule')),
  strength REAL NOT NULL DEFAULT 0.3,
  tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_updated TEXT NOT NULL DEFAULT (datetime('now')),
  rewrite_count INTEGER NOT NULL DEFAULT 0,
  coherence_score REAL NOT NULL DEFAULT 0.0
);

-- Connections: how packets relate to each other (many-to-many)
-- The graph of connections IS the understanding
CREATE TABLE IF NOT EXISTS connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relationship TEXT NOT NULL DEFAULT 'related',
  strength REAL NOT NULL DEFAULT 0.5,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (source_id) REFERENCES packets(id) ON DELETE CASCADE,
  FOREIGN KEY (target_id) REFERENCES packets(id) ON DELETE CASCADE,
  UNIQUE(source_id, target_id)
);

-- Agent action log: visible record of every thought
CREATE TABLE IF NOT EXISTS agent_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent TEXT NOT NULL CHECK(agent IN ('kevin', 'jenny', 'system')),
  action TEXT NOT NULL,
  packet_id TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (packet_id) REFERENCES packets(id) ON DELETE SET NULL
);

-- System state: key-value store for counters, configuration, etc.
CREATE TABLE IF NOT EXISTS system_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_packets_type ON packets(type);
CREATE INDEX IF NOT EXISTS idx_packets_strength ON packets(strength);
CREATE INDEX IF NOT EXISTS idx_connections_source ON connections(source_id);
CREATE INDEX IF NOT EXISTS idx_connections_target ON connections(target_id);
CREATE INDEX IF NOT EXISTS idx_agent_log_agent ON agent_log(agent);
CREATE INDEX IF NOT EXISTS idx_agent_log_created ON agent_log(created_at);

-- Initial system state
INSERT OR IGNORE INTO system_state (key, value) VALUES ('total_interactions', '0');
INSERT OR IGNORE INTO system_state (key, value) VALUES ('total_rewrites', '0');
INSERT OR IGNORE INTO system_state (key, value) VALUES ('avg_coherence', '0.0');
INSERT OR IGNORE INTO system_state (key, value) VALUES ('concept_count', '0');
INSERT OR IGNORE INTO system_state (key, value) VALUES ('version', '1.0.0');
INSERT OR IGNORE INTO system_state (key, value) VALUES ('born_at', '');
