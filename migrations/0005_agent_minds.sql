-- Agent minds: persistent memories + private journals.
-- Additive only — no existing data is touched.

CREATE TABLE IF NOT EXISTS agent_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent TEXT NOT NULL CHECK(agent IN ('kevin', 'jenny')),
  content TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'memory',        -- 'memory' | 'deliberate' | 'reflection'
  importance REAL NOT NULL DEFAULT 0.5,       -- 0..1, set by the agent
  source_turn_group TEXT,                     -- conversation it came from (if any)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_recalled TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_memories_agent ON agent_memories(agent);
CREATE INDEX IF NOT EXISTS idx_agent_memories_importance ON agent_memories(importance);

-- Private journals (one per agent), rewritten by the agents themselves at reflection.
INSERT OR IGNORE INTO system_state (key, value) VALUES ('journal_kevin', '');
INSERT OR IGNORE INTO system_state (key, value) VALUES ('journal_jenny', '');
