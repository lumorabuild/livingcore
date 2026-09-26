-- Patrons — LOCAL DEV MIRROR ONLY (see migrations/0008_island.sql's header
-- for why this file exists at all: the Worker creates these tables itself at
-- runtime, self-healing — src/lb/patrons.ts's ensurePatronsSchema and
-- src/lb/credits.ts's ensureDevCoinSchema — so a live deploy never depends
-- on this having been applied remotely. This migration only gives a fresh
-- LOCAL D1 the same schema for `wrangler d1 migrations apply --local`.
--
-- NEVER run this with --remote: production has neither table yet, and the
-- Worker will create `patrons` itself on first use.

CREATE TABLE IF NOT EXISTS patrons (
  user_id TEXT PRIMARY KEY,
  public_name TEXT,
  show_name INTEGER NOT NULL DEFAULT 0,
  daily_cap INTEGER NOT NULL DEFAULT 1000,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Local-dev-only stubbed coin ledger (src/lb/credits.ts). DEV_FAKE_AUTH is
-- never set in production, so this table is never touched there.
CREATE TABLE IF NOT EXISTS dev_coin (
  user_id TEXT PRIMARY KEY,
  balance INTEGER NOT NULL
);

-- Idempotency ledger for the dev coin stub — mirrors the real coin service's
-- idempotency-key contract (spendCredits/refundCredits' own doc comments) so
-- a repeated spend/refund key never moves the balance twice, even in local
-- dev. One row per (op_key); a grant's key is prefixed "grant:" so a spend
-- and a refund can never collide on the same literal key.
CREATE TABLE IF NOT EXISTS dev_coin_ops (
  op_key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  result_balance INTEGER NOT NULL
);
