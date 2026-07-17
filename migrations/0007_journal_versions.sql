-- Journal version history: every reflection that changes a journal appends a row,
-- so the agents' growth is a readable timeline instead of a single overwritten note.
-- Additive only. Mirrors ensureMindSchema() in src/core/mind.ts (the Worker self-heals
-- the live DB on deploy; this keeps local dev in sync).

CREATE TABLE IF NOT EXISTS journal_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent TEXT NOT NULL CHECK(agent IN ('kevin', 'jenny')),
  content TEXT NOT NULL,
  source_turn_group TEXT,                     -- conversation that prompted this rewrite
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_journal_versions_agent ON journal_versions(agent, id);
