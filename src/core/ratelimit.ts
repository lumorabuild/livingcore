// Lightweight D1-backed fixed-window rate limiter.
//
// Its job: keep the public inbox — the ONE place outside input reaches our
// NVIDIA key — from being scripted into a free-compute drain or an indirect
// "use someone else's AI" proxy. The hosted brain is for this experiment only;
// anyone who wants to run their own copy clones the repo and brings their own key.
//
// IPs are hashed (never stored raw), and this lives in its own table — NOT in
// system_state, which /api/state exposes publicly — so no visitor data leaks.

let ready = false;
async function ensure(db: D1Database): Promise<void> {
  if (ready) return;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS rate_limits (
       key TEXT PRIMARY KEY,
       count INTEGER NOT NULL,
       window_start INTEGER NOT NULL
     )`
  ).run();
  ready = true;
}

// Non-cryptographic hash (FNV-1a) — enough to key a rate limit without storing
// raw IP addresses.
export function hashId(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export interface RateLimitResult {
  ok: boolean;
  retryAfterSec: number;
}

/**
 * Fixed-window limit: at most `limit` hits per `windowMs` for `key`.
 * ONE statement counts the hit and returns the new count, so parallel requests
 * cannot all read the same old count and all pass (a read-then-write limiter
 * lets N simultaneous requests through as if they were one).
 */
export async function rateLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  await ensure(db);
  const now = Date.now();
  const row = await db.prepare(
    `INSERT INTO rate_limits (key, count, window_start) VALUES (?1, 1, ?2)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN ?2 - window_start >= ?3 THEN 1 ELSE count + 1 END,
       window_start = CASE WHEN ?2 - window_start >= ?3 THEN ?2 ELSE window_start END
     RETURNING count, window_start`
  ).bind(key, now, windowMs).first<{ count: number; window_start: number }>();

  if (row && row.count > limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((row.window_start + windowMs - now) / 1000)) };
  }
  return { ok: true, retryAfterSec: 0 };
}

/** Drop stale rows so the table can't grow unbounded (called from cron). */
export async function cleanupRateLimits(db: D1Database, maxAgeMs: number): Promise<void> {
  await ensure(db);
  await db.prepare('DELETE FROM rate_limits WHERE window_start < ?')
    .bind(Date.now() - maxAgeMs).run().catch(() => {});
}
