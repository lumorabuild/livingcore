-- Lend a mind (SPEC4 §A3, BYOK) — LOCAL DEV MIRROR ONLY.
--
-- The Worker creates model_donations/donation_usage itself at runtime
-- (src/world/donations.ts#ensureDonationsSchema, the same self-healing
-- pattern as migrations/0008-0010), so a live deploy never depends on this
-- file having been applied remotely.
--
-- NEVER run this with --remote: production has none of these tables yet,
-- and the Worker will create them itself on first use.

CREATE TABLE IF NOT EXISTS model_donations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  role TEXT NOT NULL,                 -- 'kevin' | 'jenny' | 'narrator'
  key_enc TEXT NOT NULL DEFAULT '',   -- v1.<iv>.<ct>, AES-256-GCM, AAD = this row's own id
  key_preview TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active', -- active | paused | paused_errors | revoked
  calls_per_day INTEGER NOT NULL DEFAULT 200,
  tokens_per_day INTEGER NOT NULL DEFAULT 300000,
  fail_streak INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  validated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  consent_version TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_model_donations_user ON model_donations(user_id);
CREATE INDEX IF NOT EXISTS idx_model_donations_role_status ON model_donations(role, status);

CREATE TABLE IF NOT EXISTS donation_usage (
  donation_id INTEGER NOT NULL,
  day TEXT NOT NULL,                  -- 'YYYY-MM-DD'
  calls INTEGER NOT NULL DEFAULT 0,
  tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (donation_id, day)
);

-- turn_meta already exists (migrations/0008_island.sql). These two columns
-- are self-healed at runtime via ALTER TABLE (src/world/store.ts's
-- ensureColumn, guarded on a PRAGMA table_info check) — added here bare
-- because this migration runs in sequence AFTER 0008 on a fresh local DB,
-- where the columns provably don't exist yet.
ALTER TABLE turn_meta ADD COLUMN donation_id INTEGER;
ALTER TABLE turn_meta ADD COLUMN donated_model TEXT;
