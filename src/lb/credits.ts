// ─────────────────────────────────────────────────────────────────────────────
// LUMORA BUILD (LB) CREDITS — spending through the shared `coin` service.
//
// Every call goes over the COIN service binding to the fixed internal
// hostname `coin.internal` (coin's own hostname lock — anything else 404s;
// see scratchpad/patrons/credits.md §2). `user_id` is always an id
// (master-auth) user id obtained from a verified viewer — never client input.
//
// Debit-first, refund-on-failure (credits.md §5-6): spendCredits is called
// BEFORE the thing it pays for is committed, and if the commit then fails,
// the caller refunds with a per-attempt-unique key. Never read-then-spend —
// that races two low-balance requests from the same user.
// ─────────────────────────────────────────────────────────────────────────────

import type { LbEnv } from './env';

export type SpendResult = { ok: true; newBalance: number } | { ok: false; reason: 'insufficient' | 'conflict' | 'error' };

const APP_ID = 'livingcore';

// The stub needs BOTH the flag and a dev identity. `dev-` ids are minted only by
// resolveViewer's local-http branch, so a real LB user always reaches the real
// bank — even if DEV_FAKE_AUTH ever leaked into production by mistake.
function isDevFake(env: LbEnv, userId: string): boolean {
  return env.DEV_FAKE_AUTH === 'allow' && userId.startsWith('dev-');
}

// ── Local dev only: a stubbed coin ledger in our own D1 (never present in
// production — DEV_FAKE_AUTH is never set there). Seeded to 10,000 on first
// touch; a uid containing "poor" starts at 5, for testing the 402 path
// without needing the real coin worker.
//
// ⚠️ IDEMPOTENCY, mirrored from the real coin service (credits.md §5-6, this
// file's own header): a spend/grant call is keyed and a REPEAT of the same
// key must return the SAME result without moving the balance again — never a
// second deduction/credit. The stub originally ignored idempotencyKey/
// attemptKey entirely, so it could not exercise (or even fail to catch) the
// exact double-charge/double-refund bug the real coin service's key exists to
// prevent — a gap in test fidelity, not just a simplification. `dev_coin_ops`
// records one row per (op_key), and a key already seen short-circuits to the
// balance it produced the first time. ──

let devSchemaReady = false;
async function ensureDevCoinSchema(db: D1Database): Promise<void> {
  if (devSchemaReady) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS dev_coin (user_id TEXT PRIMARY KEY, balance INTEGER NOT NULL)`).run();
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS dev_coin_ops (op_key TEXT PRIMARY KEY, user_id TEXT NOT NULL, amount INTEGER NOT NULL, result_balance INTEGER NOT NULL)`
  ).run();
  devSchemaReady = true;
}

async function devTouch(db: D1Database, userId: string): Promise<number> {
  await ensureDevCoinSchema(db);
  const row = await db.prepare('SELECT balance FROM dev_coin WHERE user_id = ?').bind(userId).first<{ balance: number }>();
  if (row) return row.balance;
  const start = userId.toLowerCase().includes('poor') ? 5 : 10000;
  await db.prepare('INSERT INTO dev_coin (user_id, balance) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING')
    .bind(userId, start).run();
  const created = await db.prepare('SELECT balance FROM dev_coin WHERE user_id = ?').bind(userId).first<{ balance: number }>();
  return created ? created.balance : start;
}

async function devGetBalance(db: D1Database, userId: string): Promise<number> {
  return devTouch(db, userId);
}

async function devSpend(db: D1Database, userId: string, amount: number, idempotencyKey: string): Promise<SpendResult> {
  await ensureDevCoinSchema(db);
  const existing = await db.prepare('SELECT user_id, result_balance FROM dev_coin_ops WHERE op_key = ?')
    .bind(idempotencyKey).first<{ user_id: string; result_balance: number }>();
  if (existing) {
    // Same key seen before — replay the SAME answer, never spend again (the
    // exact property CLAUDE.md's coin row documents the real bank getting
    // wrong before it was atomic: "read-check-then-absolute-SET... loses
    // updates" / a caller retry must not compound).
    return { ok: true, newBalance: existing.result_balance };
  }
  const bal = await devTouch(db, userId);
  if (bal < amount) return { ok: false, reason: 'insufficient' };
  const newBalance = bal - amount;
  try {
    await db.batch([
      db.prepare('UPDATE dev_coin SET balance = ? WHERE user_id = ?').bind(newBalance, userId),
      db.prepare('INSERT INTO dev_coin_ops (op_key, user_id, amount, result_balance) VALUES (?, ?, ?, ?)')
        .bind(idempotencyKey, userId, amount, newBalance),
    ]);
  } catch {
    // A UNIQUE collision on op_key means a concurrent call already won this
    // exact key — re-read rather than risk a double-deduct from this call.
    const row = await db.prepare('SELECT result_balance FROM dev_coin_ops WHERE op_key = ?')
      .bind(idempotencyKey).first<{ result_balance: number }>();
    if (row) return { ok: true, newBalance: row.result_balance };
    return { ok: false, reason: 'conflict' };
  }
  return { ok: true, newBalance };
}

async function devRefund(db: D1Database, userId: string, amount: number, attemptKey: string): Promise<boolean> {
  await ensureDevCoinSchema(db);
  const opKey = `grant:${attemptKey}`;
  const existing = await db.prepare('SELECT 1 FROM dev_coin_ops WHERE op_key = ?').bind(opKey).first();
  if (existing) return true; // already granted once under this key — never again (coin's grant idempotency is PERMANENT)
  const bal = await devTouch(db, userId);
  const newBalance = bal + amount;
  try {
    await db.batch([
      db.prepare('UPDATE dev_coin SET balance = ? WHERE user_id = ?').bind(newBalance, userId),
      db.prepare('INSERT INTO dev_coin_ops (op_key, user_id, amount, result_balance) VALUES (?, ?, ?, ?)')
        .bind(opKey, userId, amount, newBalance),
    ]);
  } catch {
    return true; // a concurrent call already recorded this exact key — the grant happened once, which is the contract
  }
  return true;
}

// ── The real thing ──

export async function getBalance(env: LbEnv, userId: string): Promise<number | null> {
  if (isDevFake(env, userId)) return devGetBalance(env.DB, userId);
  if (!env.COIN) return null;
  try {
    const res = await env.COIN.fetch('https://coin.internal/internal/credit/balance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    });
    if (!res.ok) return null;
    const data = await res.json<any>().catch(() => null);
    const bal = data?.data?.credit_balance;
    return typeof bal === 'number' ? bal : null;
  } catch {
    return null;
  }
}

/**
 * Debit `amount` credits for `userId`, idempotent on `idempotencyKey` (the
 * caller's own attempt/gift id — coin namespaces it per-app internally, so
 * any per-attempt string is safe to reuse verbatim). 402 → 'insufficient' is
 * a NORMAL answer (surface the buy-credits link), never an error to log.
 */
export async function spendCredits(
  env: LbEnv,
  a: { userId: string; amount: number; reason: string; idempotencyKey: string }
): Promise<SpendResult> {
  if (isDevFake(env, a.userId)) return devSpend(env.DB, a.userId, a.amount, a.idempotencyKey);
  if (!env.COIN) return { ok: false, reason: 'error' };
  try {
    const res = await env.COIN.fetch('https://coin.internal/internal/credit/spend', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        user_id: a.userId,
        amount: a.amount,
        reason: a.reason,
        app: APP_ID,
        idempotency_key: a.idempotencyKey,
      }),
    });
    if (res.status === 402) return { ok: false, reason: 'insufficient' };
    if (res.status === 409) return { ok: false, reason: 'conflict' };
    if (!res.ok) return { ok: false, reason: 'error' };
    const data = await res.json<any>().catch(() => null);
    const newBalance = data?.data?.new_credit;
    if (typeof newBalance !== 'number') return { ok: false, reason: 'error' };
    return { ok: true, newBalance };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/**
 * A refund is an idempotent grant, keyed `refund:<attemptKey>`.
 * ⚠️ `attemptKey` MUST be unique per attempt (e.g. `<giftId>:<uuid>`), never
 * a stable id like a gift id alone reused across retries — coin's grant
 * idempotency key is PERMANENT, so reusing it refunds only the very first
 * failed attempt and silently swallows every one after (credits.md §6).
 */
export async function refundCredits(
  env: LbEnv,
  a: { userId: string; amount: number; reason: string; attemptKey: string }
): Promise<boolean> {
  if (isDevFake(env, a.userId)) return devRefund(env.DB, a.userId, a.amount, a.attemptKey);
  if (!env.COIN) return false;
  try {
    const res = await env.COIN.fetch('https://coin.internal/internal/credit/grant', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        user_id: a.userId,
        credit_amount: a.amount,
        period_key: `refund:${a.attemptKey}`,
        source: a.reason,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
