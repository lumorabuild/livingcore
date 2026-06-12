-- Rate limiting for the public inbox (keeps it from being scripted into a
-- free-compute drain on our NVIDIA key). Keyed by hashed IP — no raw PII.
-- The Worker also creates this table on demand (src/core/ratelimit.ts), so
-- deploys never depend on this migration having been applied remotely.

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL    -- epoch milliseconds
);
