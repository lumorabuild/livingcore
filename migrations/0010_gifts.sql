-- Gifts (patrons, spec §A2) — LOCAL DEV MIRROR ONLY.
--
-- The Worker creates this itself at runtime (src/world/gifts.ts,
-- ensureGiftsSchema — same self-healing pattern as migrations/0008's
-- ensureIslandSchema), so a live deploy never depends on this file having
-- been applied remotely. This migration exists only so `wrangler d1
-- migrations apply livingcore --local` gives a fresh local DB the same
-- schema.
--
-- NEVER run this with --remote: production has no `gifts` table yet, and the
-- Worker's own self-heal is what creates it on first use there.

CREATE TABLE IF NOT EXISTS gifts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  credits INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | queued | delivered | failed | stale | refunded (see gifts.ts#GiftStatus)
  created_at TEXT NOT NULL,
  delivered_day INTEGER,
  scene_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_gifts_user ON gifts(user_id);
CREATE INDEX IF NOT EXISTS idx_gifts_status ON gifts(status);
CREATE INDEX IF NOT EXISTS idx_gifts_item ON gifts(item_id);
CREATE INDEX IF NOT EXISTS idx_gifts_created ON gifts(created_at);
