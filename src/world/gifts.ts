// ─────────────────────────────────────────────────────────────────────────────
// GIFTS — patrons, spec §A2. Owns the `gifts` table end to end (self-healing
// schema here, never in world/store.ts's ensureIslandSchema — that table
// belongs to this file the same way `bottles`/`inbox` belong to store.ts).
//
// Money safety (spec's "Money safety" section, CLAUDE.md RULE 4) — RESERVE,
// THEN CHARGE, THEN SETTLE:
//   1. One conditional INSERT reserves a 'pending' row, and only if the
//      patron's daily cap and the item's world-wide cooldown still hold
//      COUNTING OTHER PENDING ROWS — so two simultaneous buys cannot both slip
//      under either limit (D1 runs one statement at a time).
//   2. spendCredits over the COIN binding, keyed by the gift's own id. The id
//      comes from the form's per-page `intent`, so a double-clicked or resent
//      form maps to the SAME row and the SAME coin key: charged once.
//   3. ok → 'queued'; a definitive "not enough" → 'failed' (never charged).
//      An unclear answer (timeout / 5xx after the debit may have landed) leaves
//      the row 'pending', and reconcileGifts (the cron) re-asks coin with the
//      same key — coin replays a charge that landed and answers 402 for one
//      that didn't — so a purchase is finished or dropped exactly once, and
//      nobody is ever told "not charged" when they might have been.
//
// The fiction rule (spec's "Fiction" section): Kevin and Jenny never see a
// gift id, a credit amount or a user id — only a crate, a burned-in label
// (the patron's OPT-IN public name, or "an unseen friend"), and whatever
// physically arrived. The label is resolved when it is USED (patronLabel over
// the patrons row), never frozen at purchase, so hiding your name also hides it
// on every crate not yet delivered and on /shrine.
// ─────────────────────────────────────────────────────────────────────────────

import type { AgentId, World } from './types';
import { AGENT_IDS } from './types';
import { CATALOG, findItem, type CatalogItem, type GiftEffect } from './catalog';
import { logEvent, nowIso } from './store';
import { ensurePatronsSchema, getPatron, patronLabel } from '../lb/patrons';
import { spendCredits, refundCredits } from '../lb/credits';
import type { Viewer } from '../lb/auth';
import type { LbEnv } from '../lb/env';

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// ── Schema (self-healing, memoised per isolate — same pattern as
//    src/world/store.ts#ensureIslandSchema and src/core/ratelimit.ts) ──

let schemaReady = false;

export async function ensureGiftsSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS gifts (
       id TEXT PRIMARY KEY,
       user_id TEXT NOT NULL,
       item_id TEXT NOT NULL,
       credits INTEGER NOT NULL,
       status TEXT NOT NULL DEFAULT 'pending',
       created_at TEXT NOT NULL,
       delivered_day INTEGER,
       scene_id TEXT
     )`
  ).run().catch(() => {});
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_gifts_user ON gifts(user_id)`).run().catch(() => {});
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_gifts_status ON gifts(status)`).run().catch(() => {});
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_gifts_item ON gifts(item_id)`).run().catch(() => {});
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_gifts_created ON gifts(created_at)`).run().catch(() => {});
  // Reads below JOIN patrons for the live label.
  await ensurePatronsSchema(db);
  schemaReady = true;
}

/**
 * pending   — reserved; the charge is not confirmed yet (reconcileGifts settles it)
 * queued    — paid; the crate is at sea
 * delivered — it washed up in a scene
 * failed      — never charged (not enough credits, or the charge was refused)
 * unconfirmed — the bank's answer stayed unclear for a day; a person must check
 *               (never shown as "not charged" — it might have been)
 * stale       — paid, but its item left the catalog; a refund is owed
 * refunded    — a stale gift's credits went back to the patron
 */
export type GiftStatus = 'pending' | 'queued' | 'delivered' | 'failed' | 'unconfirmed' | 'stale' | 'refunded';

/** Statuses that hold credits against the daily cap / a cooldown right now. */
const HOLDING = `('pending','queued','delivered')`;
/** Statuses that count as a gift the island actually received or will receive. */
const GIVEN = `('queued','delivered')`;

interface GiftRow {
  id: string;
  user_id: string;
  item_id: string;
  credits: number;
  status: GiftStatus;
  created_at: string;
  delivered_day: number | null;
  scene_id: string | null;
}

// ── Buying a gift ──

export type BuyResult =
  | { ok: true; giftId: string; item: CatalogItem }
  | {
      ok: false;
      reason: 'signed_out' | 'not_found' | 'needs_confirm' | 'daily_cap' | 'cooldown' | 'insufficient' | 'not_sent' | 'pending' | 'unconfirmed' | 'refunded' | 'error';
      message: string;
      item?: CatalogItem;
    };

function isTruthyConfirm(v: unknown): boolean {
  return v === true || v === '1' || v === 'true' || v === 1;
}

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The gift id for one purchase INTENT (a form render), scoped to its buyer. */
async function giftIdFor(userId: string, intent: string | null): Promise<string> {
  if (!intent || !/^[A-Za-z0-9-]{16,64}$/.test(intent)) return crypto.randomUUID();
  return `g_${(await sha256Hex(`${userId}:${intent}`)).slice(0, 32)}`;
}

/**
 * The world-wide cooldown as SQL, for the reserving INSERT: every item in a
 * shared GROUP (e.g. all Big Gifts) draws on the SAME clock — the world can
 * only absorb so much per stretch (catalog.ts's header), whoever buys. Blocked
 * while one is reserved or at sea, or delivered fewer than `cooldownDays` ago.
 */
function cooldownClause(item: CatalogItem, currentDay: number): { sql: string; binds: (string | number)[] } {
  if (!item.cooldownDays) return { sql: '', binds: [] };
  const groupIds = item.cooldownGroup
    ? CATALOG.filter((i) => i.cooldownGroup === item.cooldownGroup).map((i) => i.id)
    : [item.id];
  const ph = groupIds.map(() => '?').join(',');
  return {
    sql: ` AND NOT EXISTS (SELECT 1 FROM gifts WHERE item_id IN (${ph}) AND (status IN ('pending','queued') OR (status = 'delivered' AND delivered_day > ?)))`,
    binds: [...groupIds, currentDay - item.cooldownDays],
  };
}

function resultForRow(row: GiftRow, item: CatalogItem): BuyResult {
  if (row.status === 'queued' || row.status === 'delivered') return { ok: true, giftId: row.id, item };
  if (row.status === 'pending') return { ok: false, reason: 'pending', message: PENDING_MESSAGE, item };
  if (row.status === 'failed') return { ok: false, reason: 'not_sent', message: "This gift wasn't sent, and you weren't charged.", item };
  if (row.status === 'unconfirmed') return { ok: false, reason: 'unconfirmed', message: UNCONFIRMED_MESSAGE, item };
  return { ok: false, reason: 'refunded', message: REFUNDED_MESSAGE, item };
}

const UNCONFIRMED_MESSAGE = "We couldn't confirm whether this payment went through. If credits left your balance, contact support and we'll put it right.";
const REFUNDED_MESSAGE = "This gift couldn't be delivered, so its credits are going back to you.";

const PENDING_MESSAGE = 'This gift is still being confirmed. It will show in your gift history within a few minutes — no need to send it again.';

/** A charge is retried with the SAME key: coin replays one that landed and never takes it twice. */
async function chargeWithRetry(env: LbEnv, userId: string, row: { id: string; item_id: string; credits: number }) {
  let spend = await spendCredits(env, { userId, amount: row.credits, reason: `shop:${row.item_id}`, idempotencyKey: row.id });
  for (let i = 0; i < 2 && !spend.ok && spend.reason === 'error'; i++) {
    spend = await spendCredits(env, { userId, amount: row.credits, reason: `shop:${row.item_id}`, idempotencyKey: row.id });
  }
  return spend;
}

/** Moves a pending row on. Returns false if the write itself failed (the cron retries it). */
async function settle(db: D1Database, giftId: string, to: 'queued' | 'failed' | 'unconfirmed'): Promise<boolean> {
  for (let i = 0; i < 2; i++) {
    try {
      await db.prepare(`UPDATE gifts SET status = ? WHERE id = ? AND status = 'pending'`).bind(to, giftId).run();
      return true;
    } catch { /* one retry */ }
  }
  return false;
}

/**
 * validate → confirm-gate ≥500 → reserve (cap + cooldown, atomically) → charge
 * → settle. Never mutates the live `World`: the effect happens in deliverGift,
 * when a scene opens with this crate (tick.ts).
 */
export async function buyGift(
  env: LbEnv,
  viewer: Viewer,
  itemId: string,
  confirm: boolean,
  intent: string | null
): Promise<BuyResult> {
  if (viewer.kind !== 'member') {
    return { ok: false, reason: 'signed_out', message: 'Sign in with your Lumora Build account to send a gift.' };
  }
  const item = findItem(itemId);
  if (!item) {
    return { ok: false, reason: 'not_found', message: "That isn't something the shop sells." };
  }
  if (item.credits >= 500 && !isTruthyConfirm(confirm)) {
    return { ok: false, reason: 'needs_confirm', message: 'This is a big gift — review it before sending.', item };
  }

  const db = env.DB;
  await ensureGiftsSchema(db);
  const giftId = await giftIdFor(viewer.userId, intent);

  // The same form sent twice: answer with what the first one did.
  const existing = await db.prepare(`SELECT * FROM gifts WHERE id = ?`).bind(giftId).first<GiftRow>();
  if (existing) return resultForRow(existing, findItem(existing.item_id) || item);

  const patron = await getPatron(db, viewer.userId).catch(() => null);
  const dailyCap = patron?.daily_cap ?? 1000;
  const todayPrefix = new Date().toISOString().slice(0, 10); // UTC calendar day
  const { loadWorld } = await import('./store');
  const w = await loadWorld(db).catch(() => null);
  const cooldown = cooldownClause(item, w?.day ?? 1);

  const reserved = await db.prepare(
    `INSERT OR IGNORE INTO gifts (id, user_id, item_id, credits, status, created_at)
     SELECT ?, ?, ?, ?, 'pending', ?
     WHERE (SELECT COALESCE(SUM(credits), 0) FROM gifts
            WHERE user_id = ? AND status IN ${HOLDING} AND substr(created_at, 1, 10) = ?) + ? <= ?${cooldown.sql}`
  ).bind(
    giftId, viewer.userId, item.id, item.credits, nowIso(),
    viewer.userId, todayPrefix, item.credits, dailyCap,
    ...cooldown.binds,
  ).run();

  if (!reserved.meta.changes) {
    const raced = await db.prepare(`SELECT * FROM gifts WHERE id = ?`).bind(giftId).first<GiftRow>();
    if (raced) return resultForRow(raced, item);
    const spent = await db.prepare(
      `SELECT COALESCE(SUM(credits), 0) AS total FROM gifts WHERE user_id = ? AND status IN ${HOLDING} AND substr(created_at, 1, 10) = ?`
    ).bind(viewer.userId, todayPrefix).first<{ total: number }>();
    if ((spent?.total || 0) + item.credits > dailyCap) {
      return { ok: false, reason: 'daily_cap', message: `That would pass your daily gift cap (${dailyCap} credits) — raise it in your account settings if you meant to.`, item };
    }
    return { ok: false, reason: 'cooldown', message: 'The world can only take so much of this at once — this gift is resting; try again in a few island days.', item };
  }

  const spend = await chargeWithRetry(env, viewer.userId, { id: giftId, item_id: item.id, credits: item.credits });
  if (spend.ok) {
    await settle(db, giftId, 'queued'); // a failed write leaves it 'pending'; the cron replays the charge and queues it
    return { ok: true, giftId, item };
  }
  if (spend.reason === 'insufficient' || spend.reason === 'conflict') {
    await settle(db, giftId, 'failed');
    return spend.reason === 'insufficient'
      ? { ok: false, reason: 'insufficient', message: "You don't have enough credits for this gift.", item }
      : { ok: false, reason: 'error', message: 'This gift could not be sent. You were not charged.', item };
  }
  console.warn('AMBIGUOUS-SPEND', JSON.stringify({ giftId, userId: viewer.userId, credits: item.credits }));
  return { ok: false, reason: 'pending', message: PENDING_MESSAGE, item };
}

/**
 * Cron-side settling (called from the two-minute cron, 5 rows a run):
 *  - a 'pending' row older than 2 minutes is re-charged with its own key —
 *    coin replays a charge that landed, answers 402 for one that didn't, and
 *    never takes it twice — then queued or failed. After a day of unclear
 *    answers it is marked failed and logged for a person to check.
 *  - a 'stale' row (paid, item gone) is refunded once, keyed by the gift id,
 *    so a retried refund is a no-op at the bank.
 */
export async function reconcileGifts(env: LbEnv): Promise<void> {
  const db = env.DB;
  await ensureGiftsSchema(db);
  const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString().slice(0, 19) + 'Z';
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 19) + 'Z';
  // Two separate batches, so refunds that keep failing can never crowd out
  // payments waiting to be settled (or the other way round).
  // 'unconfirmed' rows are deliberately NOT retried: coin has no read-only
  // "did this key land?", so asking again would CHARGE a purchase that never
  // went through, a day later. A person checks those (docs/LB-INTEGRATION.md §7).
  const [pending, stale] = await Promise.all([
    db.prepare(`SELECT * FROM gifts WHERE status = 'pending' AND created_at < ? ORDER BY created_at ASC LIMIT 5`).bind(cutoff).all<GiftRow>(),
    db.prepare(`SELECT * FROM gifts WHERE status = 'stale' ORDER BY created_at ASC LIMIT 5`).all<GiftRow>(),
  ]);
  for (const row of stale.results || []) {
    const ok = await refundCredits(env, {
      userId: row.user_id, amount: row.credits, reason: `shop_refund:${row.item_id}`, attemptKey: `stale:${row.id}`,
    });
    if (ok) await db.prepare(`UPDATE gifts SET status = 'refunded' WHERE id = ? AND status = 'stale'`).bind(row.id).run();
    else console.warn('REFUND-OWED', JSON.stringify({ giftId: row.id, userId: row.user_id, credits: row.credits }));
  }
  for (const row of pending.results || []) {
    const spend = await spendCredits(env, { userId: row.user_id, amount: row.credits, reason: `shop:${row.item_id}`, idempotencyKey: row.id });
    if (spend.ok) await settle(db, row.id, 'queued');
    else if (spend.reason !== 'error') await settle(db, row.id, 'failed');
    else if (row.created_at < dayAgo) {
      // A day of unclear answers: a person has to look (docs/LB-INTEGRATION.md §7).
      console.warn('AMBIGUOUS-SPEND-ABANDONED', JSON.stringify({ giftId: row.id, userId: row.user_id, credits: row.credits }));
      await settle(db, row.id, 'unconfirmed');
    }
  }
}

// ── Delivery — CODE applies every effect, never the model (spec §A2) ──

const CRATE_FLAVOR: Record<CatalogItem['category'], string> = {
  pantry: 'A small crate rolls in with the tide, light enough to carry alone',
  treats: 'A wooden crate, packed with straw, washes up in the shallows',
  feasts: 'A large, heavy crate is dragged up out of the surf, smelling faintly of good food',
  survival: 'A sealed, watertight crate rolls in on the morning tide',
  tools: 'A wooden crate, full of hardware that rattles when it moves, washes ashore',
  big: 'An unusually large crate is half-buried in the sand at low tide',
};

function craftCrateEventText(item: CatalogItem, label: string): string {
  const flavor = CRATE_FLAVOR[item.category] || 'A wooden crate rolls in the surf, sealed';
  return `${flavor}. Burned into the lid, a name: "From ${label}." Inside: ${item.name.toLowerCase()}.`;
}

/** The label a gift carries RIGHT NOW (the patron's current opt-in), joined in one query. */
const LABEL_JOIN = `LEFT JOIN patrons p ON p.user_id = g.user_id`;
function labelOf(r: { public_name: string | null; show_name: number | null }): string {
  return patronLabel({ public_name: r.public_name, show_name: r.show_name ? 1 : 0 });
}

/**
 * narrator.ts's pickUpcomingEvent candidate — the oldest crate at sea, FIFO,
 * as text + ids (sim.ts never touches the DB). A row whose item has since left
 * the catalog is marked 'stale' (reconcileGifts refunds it) and skipped, so one
 * retired item can never jam every later patron's crate behind it.
 */
export async function pendingCrateEvent(db: D1Database): Promise<{ text: string; giftId: string; itemId: string } | null> {
  await ensureGiftsSchema(db);
  const rows = await db.prepare(
    `SELECT g.id, g.item_id, p.public_name, p.show_name FROM gifts g ${LABEL_JOIN}
     WHERE g.status = 'queued' ORDER BY g.created_at ASC LIMIT 10`
  ).all<{ id: string; item_id: string; public_name: string | null; show_name: number | null }>();
  for (const r of rows.results || []) {
    const item = findItem(r.item_id);
    if (item) return { text: craftCrateEventText(item, labelOf(r)), giftId: r.id, itemId: r.item_id };
    console.warn('GIFT-STALE', JSON.stringify({ giftId: r.id, itemId: r.item_id }));
    await db.prepare(`UPDATE gifts SET status = 'stale' WHERE id = ? AND status = 'queued'`).bind(r.id).run().catch(() => {});
  }
  return null;
}

function findMatchingProject(w: World, match: RegExp) {
  return w.projects.find((p) => p.status !== 'done' && match.test(p.name));
}

function tryCureSick(w: World): AgentId | null {
  for (const id of AGENT_IDS) {
    const a = w.agents[id];
    if (a.health === 'hurt' || a.health === 'sick') {
      a.health = 'well';
      a.condition = '';
      return id;
    }
  }
  return null;
}

/**
 * Mutates `w` with one item's bounded effect and returns event lines to log —
 * the same "delta, not a total; clamped; never invents a story" boundary
 * sim.ts#applyTransition already enforces for the narrator's own output.
 */
function applyGiftEffect(w: World, item: CatalogItem, label: string): string[] {
  const e: GiftEffect = item.effect;
  const events: string[] = [];

  if (e.water_l) {
    w.resources.water_l = clamp(w.resources.water_l + e.water_l, 0, 400);
    events.push(`The rain tank gained about ${e.water_l} litres, from ${label}'s gift.`);
  }
  if (e.food_days) {
    w.resources.food_days = Math.max(0, w.resources.food_days + e.food_days);
  }
  if (e.firewood) {
    w.resources.firewood = Math.max(0, w.resources.firewood + e.firewood);
  }
  if (e.mood || e.energy || e.hunger) {
    for (const id of AGENT_IDS) {
      const a = w.agents[id];
      if (e.mood) a.mood = clamp(a.mood + e.mood, -5, 5);
      if (e.energy) a.energy = clamp(a.energy + e.energy, 0, 100);
      if (e.hunger) a.hunger = clamp(a.hunger + e.hunger, 0, 100);
    }
  }

  let handled = false;
  if (e.projectBump) {
    const project = findMatchingProject(w, e.projectBump.match);
    if (project) {
      const before = project.progress;
      // Never completes a project outright from a gift alone (catalog.ts's
      // header rule) — clamped strictly under 100 even if the raw sum would
      // cross it.
      project.progress = Math.min(99, project.progress + e.projectBump.amount);
      if (project.status === 'idea' && project.progress > before) project.status = 'active';
      events.push(`${project.name}: nudged forward by ${label}'s gift (${Math.round(before)}% → ${Math.round(project.progress)}%).`);
      handled = true;
    }
  }
  if (!handled && e.cureSick) {
    const cured = tryCureSick(w);
    if (cured) {
      events.push(`${cured === 'kevin' ? 'Kevin' : 'Jenny'} is well again, thanks to ${label}'s gift.`);
      handled = true;
    }
  }
  if (!handled && e.item) {
    const key = e.item.name.toLowerCase();
    const already = w.items.some((i) => i.name.toLowerCase() === key);
    if (!already) w.items.push({ id: `item-${w.seq++}`, name: e.item.name, note: e.item.note, where: 'cottage', found_day: w.day });
  }

  return events;
}

/**
 * Called from tick.ts's runOpenSceneJob the moment the scene carrying this
 * gift's crate opens. The status flip is the CLAIM and it comes first: only
 * the call that moves the row from 'queued' to 'delivered' applies the effect,
 * so a retried tick — or a write that failed half-way — can never apply one
 * gift twice.
 */
export async function deliverGift(db: D1Database, w: World, giftId: string, sceneId: string): Promise<void> {
  await ensureGiftsSchema(db);
  const row = await db.prepare(
    `SELECT g.item_id, g.credits, p.public_name, p.show_name FROM gifts g ${LABEL_JOIN} WHERE g.id = ? AND g.status = 'queued'`
  ).bind(giftId).first<{ item_id: string; credits: number; public_name: string | null; show_name: number | null }>();
  if (!row) return;
  const item = findItem(row.item_id);
  if (!item) {
    // Its item left the catalog after the crate was picked: refund instead of
    // "delivering" nothing (reconcileGifts pays it back).
    await db.prepare(`UPDATE gifts SET status = 'stale' WHERE id = ? AND status = 'queued'`).bind(giftId).run();
    return;
  }
  const claim = await db.prepare(`UPDATE gifts SET status = 'delivered', delivered_day = ?, scene_id = ? WHERE id = ? AND status = 'queued'`)
    .bind(w.day, sceneId, giftId).run();
  if (!claim.meta.changes) return;

  const label = labelOf(row);
  const wasShrineDiscovered = w.discovered.includes('shrine');

  const effectEvents = applyGiftEffect(w, item, label);

  if (!wasShrineDiscovered) {
    w.discovered.push('shrine');
  }

  w.last_crate_day = w.day;

  await logEvent(db, {
    day: w.day, slot: w.slot, kind: 'gift_delivered', who: 'world',
    detail: `A crate arrived from ${label}: ${item.name}.`,
    data_json: JSON.stringify({ giftId, itemId: row.item_id, credits: row.credits }),
    scene_id: sceneId,
  }).catch(() => {});
  for (const detail of effectEvents) {
    await logEvent(db, { day: w.day, slot: w.slot, kind: 'gift_effect', who: 'world', detail, data_json: null, scene_id: sceneId }).catch(() => {});
  }
  if (!wasShrineDiscovered) {
    await logEvent(db, {
      day: w.day, slot: w.slot, kind: 'discovered', who: 'world',
      detail: 'They have found the old shrine, a ring of weathered stones on the ridge.',
      data_json: null, scene_id: sceneId,
    }).catch(() => {});
  }
}

// ── Patrons, tiers, the shrine ──

export function tierFor(lifetimeCreditsSpent: number): string {
  if (lifetimeCreditsSpent >= 8000) return 'Benefactor';
  if (lifetimeCreditsSpent >= 2000) return 'Provider';
  if (lifetimeCreditsSpent >= 500) return 'Keeper of the pantry';
  return 'Friend of the tide';
}

export interface PatronRank {
  label: string;
  /** Whether `label` is the patron's own opt-in name (vs. "an unseen friend"). */
  shown: boolean;
  lifetimeCredits: number;
  tier: string;
  deliveries: number;
}

/** Every patron who has ever sent a gift, ranked by lifetime credits — one query, labels joined in. */
export async function topPatrons(db: D1Database, n: number): Promise<PatronRank[]> {
  await ensureGiftsSchema(db);
  const rows = await db.prepare(
    `SELECT g.user_id, SUM(g.credits) AS total, COUNT(*) AS n, MAX(p.public_name) AS public_name, MAX(p.show_name) AS show_name
     FROM gifts g ${LABEL_JOIN} WHERE g.status IN ${GIVEN} GROUP BY g.user_id ORDER BY total DESC LIMIT ?`
  ).bind(Math.min(50, Math.max(1, n))).all<{ user_id: string; total: number; n: number; public_name: string | null; show_name: number | null }>();
  return (rows.results || []).map((r) => {
    const label = labelOf(r);
    return { label, shown: label !== patronLabel(null), lifetimeCredits: r.total, tier: tierFor(r.total), deliveries: r.n };
  });
}

/** Anyone who has ever sent a gift — sim.ts#shouldVisitShrine's "≥ 1 patron" gate. */
export async function countActivePatrons(db: D1Database): Promise<number> {
  await ensureGiftsSchema(db);
  const row = await db.prepare(`SELECT COUNT(DISTINCT user_id) as n FROM gifts WHERE status IN ${GIVEN}`).first<{ n: number }>();
  return row?.n || 0;
}

export interface DeliveredGift {
  id: string;
  itemName: string;
  emoji: string;
  label: string;
  day: number | null;
  createdAt: string;
}

export async function recentDeliveries(db: D1Database, limit: number): Promise<DeliveredGift[]> {
  await ensureGiftsSchema(db);
  const rows = await db.prepare(
    `SELECT g.id, g.item_id, g.delivered_day, g.created_at, p.public_name, p.show_name FROM gifts g ${LABEL_JOIN}
     WHERE g.status = 'delivered' ORDER BY g.delivered_day DESC, g.created_at DESC LIMIT ?`
  ).bind(Math.min(100, Math.max(1, limit))).all<{ id: string; item_id: string; delivered_day: number | null; created_at: string; public_name: string | null; show_name: number | null }>();
  return (rows.results || []).map((r) => {
    const item = findItem(r.item_id);
    return { id: r.id, itemName: item?.name || r.item_id, emoji: item?.emoji || '🎁', label: labelOf(r), day: r.delivered_day, createdAt: r.created_at };
  });
}

/** What "THE SHRINE" found-text block tells the narrator (prompts.ts#shrineFoundText) — top patron first, up to `limit` named, the rest folded into a count. */
export async function shrineFacts(db: D1Database, limit: number): Promise<{ names: string[]; othersCount: number; recent: string[] }> {
  const [top, recent] = await Promise.all([topPatrons(db, 50), recentDeliveries(db, 5)]);
  const named = top.filter((p) => p.shown).slice(0, limit).map((p) => p.label);
  const othersCount = top.length - named.length;
  return { names: named, othersCount: Math.max(0, othersCount), recent: recent.map((d) => d.itemName.toLowerCase()) };
}

export interface GiftHistoryEntry {
  id: string;
  itemId: string;
  itemName: string;
  emoji: string;
  credits: number;
  status: GiftStatus;
  createdAt: string;
  deliveredDay: number | null;
}

export async function giftHistory(db: D1Database, userId: string): Promise<GiftHistoryEntry[]> {
  await ensureGiftsSchema(db);
  const rows = await db.prepare(
    `SELECT id, item_id, credits, status, created_at, delivered_day FROM gifts WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`
  ).bind(userId).all<{ id: string; item_id: string; credits: number; status: GiftStatus; created_at: string; delivered_day: number | null }>();
  return (rows.results || []).map((r) => {
    const item = findItem(r.item_id);
    return {
      id: r.id, itemId: r.item_id, itemName: item?.name || r.item_id, emoji: item?.emoji || '🎁',
      credits: r.credits, status: r.status, createdAt: r.created_at, deliveredDay: r.delivered_day,
    };
  });
}

export interface GiftExportRow {
  id: string;
  item_id: string;
  item_name: string;
  credits: number;
  created_at: string;
  delivered_day: number | null;
  status: string;
  patron: string;
}

/**
 * /api/export/gifts.jsonl's rows (spec's "Research integrity" section): every
 * gift the island received or will receive, in one query. The buyer is their
 * opt-in public name, else a stable pseudonym keyed by `salt` (derived from a
 * Worker secret), else — when there is no secret — just "anonymous". Never a
 * raw LB user id, and never a hash anyone could recompute from a user id.
 */
export async function exportGifts(
  db: D1Database,
  opts: { sinceIso: string | null; afterId: string | null; limit: number },
  salt: string | null
): Promise<GiftExportRow[]> {
  await ensureGiftsSchema(db);
  const limit = Math.min(2000, Math.max(1, opts.limit));
  const since = opts.sinceIso || '';
  const rows = await db.prepare(
    `SELECT g.id, g.user_id, g.item_id, g.credits, g.created_at, g.delivered_day, g.status, p.public_name, p.show_name
     FROM gifts g ${LABEL_JOIN}
     WHERE g.status IN ${GIVEN} AND (g.created_at > ? OR (g.created_at = ? AND g.id > ?))
     ORDER BY g.created_at ASC, g.id ASC LIMIT ?`
  ).bind(since, since, opts.afterId || '', limit).all<{ id: string; user_id: string; item_id: string; credits: number; created_at: string; delivered_day: number | null; status: string; public_name: string | null; show_name: number | null }>();
  const out: GiftExportRow[] = [];
  for (const r of rows.results || []) {
    const item = findItem(r.item_id);
    const shown = labelOf(r);
    const patron = shown !== patronLabel(null) ? shown
      : salt ? `patron_${(await sha256Hex(`gifts-export:${salt}:${r.user_id}`)).slice(0, 16)}`
      : 'anonymous';
    out.push({
      id: r.id, item_id: r.item_id, item_name: item?.name || r.item_id, credits: r.credits,
      created_at: r.created_at, delivered_day: r.delivered_day, status: r.status, patron,
    });
  }
  return out;
}
