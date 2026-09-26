// ─────────────────────────────────────────────────────────────────────────────
// THE ISLAND ERA'S STORAGE.
//
// Self-healing schema (see ensureMindSchema in src/core/mind.ts for the same
// pattern) — the Worker owns its tables, so a deploy never depends on a
// manually-run remote migration. `migrations/0008_island.sql` mirrors this
// exact SQL for local dev only; never run it against --remote.
//
// The world document itself (clock, weather, resources, agents, the live
// scene, the job queue…) is one JSON blob in system_state['world'] — see
// loadWorld/saveWorld. Everything else here is either a permanent record
// (turns, scenes, events, notebook, artifacts, chapters) or small derived
// state (forecasts, bottles, metrics, the dead-model memory, the tick lock).
//
// Every query in this file is bounded (LIMIT, an index, or both) — no
// full-table scans on a request path. See CLAUDE.md's CPU-budget rule.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  Activity, AgentId, ArtifactRow, ChapterRow, LocationId, NotebookRow, Slot, SceneRow,
  TurnMetaRow, World, WeatherKind, WorldEventRow,
} from './types';
import { similarity } from '../core/mind';

// ── Timestamps ──
// New island-era code writes ISO `YYYY-MM-DDTHH:MM:SSZ`. dialogue_turns.created_at
// is the one exception — it keeps the legacy `YYYY-MM-DD HH:MM:SS` shape so old
// readers (the export's modelFromThoughts regex, the archive pages) keep working.

export function nowIso(): string {
  return new Date().toISOString().slice(0, 19) + 'Z';
}

function nowLegacy(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// ── Schema (self-healing, memoised per isolate) ──

let schemaReady = false;

export async function ensureIslandSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;

  const statements = [
    `CREATE TABLE IF NOT EXISTS turn_meta (
       turn_id INTEGER PRIMARY KEY,
       era TEXT NOT NULL,
       protocol TEXT NOT NULL,
       scene_id TEXT NOT NULL,
       sim_day INTEGER NOT NULL,
       sim_slot TEXT NOT NULL,
       location TEXT NOT NULL,
       thought TEXT NOT NULL DEFAULT '',
       action TEXT NOT NULL DEFAULT '',
       model TEXT NOT NULL,
       retries INTEGER NOT NULL DEFAULT 0,
       retry_reason TEXT,
       notebook_refs TEXT NOT NULL DEFAULT '[]',
       memory_refs TEXT NOT NULL DEFAULT '[]',
       activity TEXT NOT NULL DEFAULT 'idle',
       created_at TEXT NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS idx_turn_meta_scene ON turn_meta(scene_id)`,
    `CREATE INDEX IF NOT EXISTS idx_turn_meta_day ON turn_meta(sim_day)`,

    `CREATE TABLE IF NOT EXISTS scenes (
       id TEXT PRIMARY KEY,
       day INTEGER NOT NULL,
       slot TEXT NOT NULL,
       location TEXT NOT NULL,
       title TEXT NOT NULL,
       setup TEXT NOT NULL,
       event TEXT,
       status TEXT NOT NULL,
       summary TEXT,
       outcomes_json TEXT,
       turn_count INTEGER NOT NULL DEFAULT 0,
       model TEXT,
       opened_at TEXT NOT NULL,
       closed_at TEXT,
       mode TEXT NOT NULL DEFAULT 'together',
       apart_json TEXT
     )`,
    `CREATE INDEX IF NOT EXISTS idx_scenes_day ON scenes(day)`,

    `CREATE TABLE IF NOT EXISTS world_events (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       day INTEGER NOT NULL,
       slot TEXT NOT NULL,
       kind TEXT NOT NULL,
       who TEXT NOT NULL DEFAULT 'world',
       detail TEXT NOT NULL,
       data_json TEXT,
       scene_id TEXT,
       created_at TEXT NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS idx_world_events_day ON world_events(day)`,

    `CREATE TABLE IF NOT EXISTS notebook (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       day INTEGER NOT NULL,
       author TEXT NOT NULL,
       kind TEXT NOT NULL,
       content TEXT NOT NULL,
       location TEXT,
       scene_id TEXT,
       uses INTEGER NOT NULL DEFAULT 0,
       created_at TEXT NOT NULL
     )`,

    `CREATE TABLE IF NOT EXISTS artifacts (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       day INTEGER NOT NULL,
       maker TEXT NOT NULL,
       kind TEXT NOT NULL,
       title TEXT NOT NULL,
       content TEXT NOT NULL,
       format TEXT NOT NULL,
       scene_id TEXT,
       inbox_id INTEGER,
       model TEXT NOT NULL,
       created_at TEXT NOT NULL
     )`,

    `CREATE TABLE IF NOT EXISTS chapters (
       day INTEGER PRIMARY KEY,
       title TEXT NOT NULL,
       body TEXT NOT NULL,
       model TEXT NOT NULL,
       stats_json TEXT NOT NULL DEFAULT '{}',
       created_at TEXT NOT NULL
     )`,

    // day = the day being PREDICTED (set the morning before it happens; scored
    // the following dawn against that day's actual weather kind).
    `CREATE TABLE IF NOT EXISTS forecasts (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       day INTEGER NOT NULL,
       agent TEXT NOT NULL,
       predicted TEXT NOT NULL,
       actual TEXT,
       correct INTEGER,
       created_at TEXT NOT NULL
     )`,

    // status: at_sea | ashore | read | answered. inbox.status carries the
    // coarse visitor-facing state (pending/processing/discussed); this table
    // carries the island-side detail.
    `CREATE TABLE IF NOT EXISTS bottles (
       inbox_id INTEGER PRIMARY KEY,
       status TEXT NOT NULL,
       washed_day INTEGER,
       scene_id TEXT,
       reply_artifact_id INTEGER,
       updated_at TEXT NOT NULL
     )`,

    `CREATE TABLE IF NOT EXISTS metrics_daily (
       day INTEGER PRIMARY KEY,
       json TEXT NOT NULL,
       created_at TEXT NOT NULL
     )`,
  ];

  for (const sql of statements) {
    await db.prepare(sql).run().catch(() => {});
  }

  // Self-heal for a DB whose turn_meta/scenes tables already existed BEFORE
  // this field was added (the CREATE TABLE statements above only apply to a
  // brand-new table — production had none of these tables at all as of the
  // part-1 ship, but a local dev DB created between part 1 and part 2 has
  // turn_meta/scenes without these columns). `table`/`column`/`ddl` below are
  // always fixed literals from the calls right after this function, never
  // user input — same trust boundary as countOf()'s interpolated table name.
  await ensureColumn(db, 'turn_meta', 'activity', `activity TEXT NOT NULL DEFAULT 'idle'`);
  await ensureColumn(db, 'scenes', 'mode', `mode TEXT NOT NULL DEFAULT 'together'`);
  await ensureColumn(db, 'scenes', 'apart_json', `apart_json TEXT`);
  // Lend-a-mind (SPEC4 §A3, protocol island-3): which donated model (if any)
  // spoke this turn. NULL for every turn before this shipped and every turn
  // that used the free NVIDIA chain — see types.ts#TurnMetaRow.
  await ensureColumn(db, 'turn_meta', 'donation_id', `donation_id INTEGER`);
  await ensureColumn(db, 'turn_meta', 'donated_model', `donated_model TEXT`);

  schemaReady = true;
}

/** Adds `column` to `table` via ALTER TABLE ... ADD COLUMN `ddl`, but only if it isn't already there. Best-effort: a failure here (e.g. the table itself doesn't exist yet on some odd path) must never crash the tick. */
async function ensureColumn(db: D1Database, table: string, column: string, ddl: string): Promise<void> {
  try {
    const info = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    const already = (info.results || []).some((r) => r.name === column);
    if (!already) {
      await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run();
    }
  } catch {
    // best-effort, see comment above
  }
}

// ── The world document ──

export async function loadWorld(db: D1Database): Promise<World | null> {
  const row = await db.prepare(`SELECT value FROM system_state WHERE key = 'world'`).first<{ value: string }>();
  if (!row) return null;
  try {
    return JSON.parse(row.value) as World;
  } catch {
    return null;
  }
}

export async function saveWorld(db: D1Database, w: World): Promise<void> {
  w.updated_at = nowIso();
  const value = JSON.stringify(w);
  await db.prepare(
    `INSERT INTO system_state (key, value, updated_at) VALUES ('world', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(value, nowLegacy()).run();
}

// ── Tick lock ──
// One cron tick at a time. A conditional UPDATE, INSERT OR IGNORE first so the
// row always exists; `changes === 1` is the only proof the lock was actually
// taken (a `now < expiry` race between two overlapping ticks must lose, not
// both win).

/**
 * Returns the exact token (the expiry epoch-ms, as text) this call wrote into
 * `tick_lock`, or null if someone else already holds it. FENCED: the token is
 * what releaseTickLock must present back — see there for why a bare release
 * is unsafe. (A prior version returned a plain boolean; a tick that outlived
 * its own TTL could then release a LATER tick's lock out from under it.)
 */
export async function acquireTickLock(db: D1Database, ttlMs: number): Promise<string | null> {
  const now = Date.now();
  const token = String(now + ttlMs);
  await db.prepare(
    `INSERT OR IGNORE INTO system_state (key, value, updated_at) VALUES ('tick_lock', '0', ?)`
  ).bind(nowLegacy()).run();
  const res = await db.prepare(
    `UPDATE system_state SET value = ?, updated_at = ? WHERE key = 'tick_lock' AND CAST(value AS INTEGER) < ?`
  ).bind(token, nowLegacy(), now).run();
  return res.meta.changes === 1 ? token : null;
}

/**
 * Releases the lock ONLY if it still holds the exact `token` this caller was
 * given by acquireTickLock — a conditional UPDATE, not a bare SET. Without
 * this fencing, a tick that runs past its own TTL (a slow model chain, say)
 * can reach its `finally` block AFTER a second tick has already acquired the
 * lock for itself; an unconditional release would then hand that second
 * tick's still-live lock to a THIRD tick, and two ticks would run at once —
 * the exact hazard the lock exists to prevent. If the token no longer
 * matches (someone else already holds it, or already released it), this is a
 * silent no-op: releasing a lock you no longer hold must never disturb it.
 */
export async function releaseTickLock(db: D1Database, token: string): Promise<void> {
  await db.prepare(`UPDATE system_state SET value = '0' WHERE key = 'tick_lock' AND value = ?`)
    .bind(token).run().catch(() => {});
}

// ── Small generic system_state helpers (additive — src/world/tick.ts's error/
// island-start/radio-cache bookkeeping shares the exact key/value/updated_at
// upsert pattern every other helper in this file already uses) ──

/** A generic upsert for a single system_state row — used for things with no
 *  dedicated table (last_error, last_fallback, …). */
export async function setSystemState(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare(
    `INSERT INTO system_state (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(key, value, nowLegacy()).run();
}

/** The island era's start instant (ISO), written exactly once at initWorld() time. */
export async function getIslandStartedAt(db: D1Database): Promise<string | null> {
  const row = await db.prepare(`SELECT value FROM system_state WHERE key = 'island_started_at'`).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setIslandStartedAt(db: D1Database, iso: string): Promise<void> {
  await db.prepare(
    `INSERT OR IGNORE INTO system_state (key, value, updated_at) VALUES ('island_started_at', ?, ?)`
  ).bind(iso, nowLegacy()).run();
}

// ── Daily AI usage counters (ai_messages_<date> / ai_tokens_<date>) ──
// Read today by src/routes/api.ts's /api/ai/usage; written here by every
// successful model call in src/world/agent.ts / src/world/narrator.ts, and
// checked by src/world/tick.ts against DAILY_CALL_BUDGET / DAILY_TOKEN_BUDGET.

export async function bumpDailyUsage(db: D1Database, tokens: number): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const now = nowLegacy();
  await db.batch([
    db.prepare(
      `INSERT INTO system_state (key, value, updated_at) VALUES (?, '1', ?)
       ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = excluded.updated_at`
    ).bind(`ai_messages_${today}`, now),
    db.prepare(
      `INSERT INTO system_state (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + ? AS TEXT), updated_at = excluded.updated_at`
    ).bind(`ai_tokens_${today}`, String(Math.max(0, Math.round(tokens))), now, Math.max(0, Math.round(tokens))),
  ]);
}

export async function getDailyUsage(db: D1Database): Promise<{ messages: number; tokens: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db.prepare(`SELECT key, value FROM system_state WHERE key IN (?, ?)`)
    .bind(`ai_messages_${today}`, `ai_tokens_${today}`).all<{ key: string; value: string }>();
  const byKey: Record<string, string> = {};
  for (const r of rows.results || []) byKey[r.key] = r.value;
  return {
    messages: parseInt(byKey[`ai_messages_${today}`] || '0') || 0,
    tokens: parseInt(byKey[`ai_tokens_${today}`] || '0') || 0,
  };
}

// ── Radio cache (system_state key 'radio_cache') ──
// Refreshed at most every 6h by src/world/tick.ts; read by
// src/world/narrator.ts's transition() when a scene's radio_requested flag
// was set. The freshness instant lives INSIDE the JSON value (not the row's
// own updated_at column, which the rest of this file writes in the legacy
// space-separated shape for an unrelated reason) so staleness is unambiguous.

export interface RadioCache {
  titles: string[];
  at: string;
}

export async function getRadioCache(db: D1Database): Promise<RadioCache | null> {
  const row = await db.prepare(`SELECT value FROM system_state WHERE key = 'radio_cache'`).first<{ value: string }>();
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value);
    if (Array.isArray(parsed?.titles) && typeof parsed?.at === 'string') return parsed as RadioCache;
    return null;
  } catch {
    return null;
  }
}

export async function setRadioCache(db: D1Database, titles: string[]): Promise<void> {
  const value = JSON.stringify({ titles: titles.slice(0, 12), at: nowIso() } as RadioCache);
  await db.prepare(
    `INSERT INTO system_state (key, value, updated_at) VALUES ('radio_cache', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(value, nowLegacy()).run();
}

/** The text of a visitor's bottle note (inbox.content) — agent.ts's speak()
 *  needs this once, for the first turn of a scene that has a bottle_id. */
export async function getInboxContent(db: D1Database, inboxId: number): Promise<string | null> {
  const row = await db.prepare(`SELECT content FROM inbox WHERE id = ?`).bind(inboxId).first<{ content: string }>();
  return row?.content ?? null;
}

/** A visitor's bottle note, author included — tick.ts's bottle-reply fallback needs the author for the reply's title ("A reply to <name>"). */
export async function getInboxNote(db: D1Database, inboxId: number): Promise<{ author: string | null; content: string } | null> {
  const row = await db.prepare(`SELECT author, content FROM inbox WHERE id = ?`).bind(inboxId).first<{ author: string | null; content: string }>();
  return row ? { author: row.author, content: row.content } : null;
}

// ── Dead-model memory ──
// A model that just answered 404/410 is retired, not rate-limited — asking it
// again next tick wastes a whole timeout. Remembered for 12h in system_state
// under `model_gone:<id>` (value = ISO expiry); a chain call always ignores a
// skip set that would silence every one of its own models (see nvidiaChatChain).

export async function getGoneModels(db: D1Database): Promise<Set<string>> {
  const rows = await db.prepare(
    `SELECT key, value FROM system_state WHERE key LIKE 'model_gone:%'`
  ).all<{ key: string; value: string }>();
  const now = Date.now();
  const set = new Set<string>();
  for (const row of rows.results || []) {
    const expiry = Date.parse(row.value);
    if (!Number.isNaN(expiry) && expiry > now) set.add(row.key.slice('model_gone:'.length));
  }
  return set;
}

export async function markGone(db: D1Database, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const expiry = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString().slice(0, 19) + 'Z';
  const now = nowLegacy();
  const stmts = ids.map((id) =>
    db.prepare(
      `INSERT INTO system_state (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).bind(`model_gone:${id}`, expiry, now)
  );
  await db.batch(stmts);
}

// ── Turns ──

/** One joined, prompt-ready turn: dialogue_turns + turn_meta (+ its scene's mode). */
export interface SceneTurnRow {
  id: number;
  speaker: AgentId;
  /** Reconstructed SAY — '' when the turn was silent (DO only). See deriveSay(). */
  say: string;
  thought: string;
  action: string;
  model: string;
  retries: number;
  retry_reason: string | null;
  scene_id: string;
  sim_day: number;
  sim_slot: Slot;
  location: LocationId;
  notebook_refs: string;
  memory_refs: string;
  /** What the speaker was visibly doing on this turn. */
  activity: Activity;
  /** The scene this turn belongs to was together or apart (part 2 spec §A). Read from a LEFT JOIN onto scenes, so a turn whose scene row is somehow missing still returns — defaulted to 'together'. */
  mode: 'together' | 'apart';
  created_at: string;
}

/**
 * dialogue_turns.content is NOT NULL, so a silent turn (empty SAY) is stored
 * as `(silent) <DO>` (see insertTurn). Recover the real SAY for prompt-
 * building: if content is exactly that marker for the stored DO, the agent
 * said nothing.
 */
export function deriveSay(content: string, action: string): string {
  const marker = `(silent) ${action || 'nothing'}`;
  return content === marker ? '' : content;
}

const SCENE_TURN_SELECT = `
  SELECT dt.id as id, dt.speaker as speaker, dt.content as content, dt.created_at as created_at,
         tm.thought as thought, tm.action as action, tm.model as model, tm.retries as retries,
         tm.retry_reason as retry_reason, tm.scene_id as scene_id, tm.sim_day as sim_day,
         tm.sim_slot as sim_slot, tm.location as location, tm.notebook_refs as notebook_refs,
         tm.memory_refs as memory_refs, tm.activity as activity, sc.mode as scene_mode
  FROM turn_meta tm JOIN dialogue_turns dt ON dt.id = tm.turn_id
  LEFT JOIN scenes sc ON sc.id = tm.scene_id`;

function rowToSceneTurn(row: any): SceneTurnRow {
  return {
    id: row.id,
    speaker: row.speaker,
    say: deriveSay(row.content, row.action || ''),
    thought: row.thought || '',
    action: row.action || '',
    model: row.model,
    retries: row.retries || 0,
    retry_reason: row.retry_reason ?? null,
    scene_id: row.scene_id,
    sim_day: row.sim_day,
    sim_slot: row.sim_slot,
    location: row.location,
    notebook_refs: row.notebook_refs || '[]',
    memory_refs: row.memory_refs || '[]',
    activity: (row.activity || 'idle') as Activity,
    mode: (row.scene_mode === 'apart' ? 'apart' : 'together'),
    created_at: row.created_at,
  };
}

export interface InsertTurnInput {
  speaker: AgentId;
  say: string;
  /** Precomputed provenance line, e.g. "🔧 Kevin · nvidia/nemotron-3-ultra-550b-a55b · ~120 tok · island" — kept in dialogue_turns.thoughts so the legacy modelFromThoughts export regex keeps extracting the model id. */
  thoughtsLine: string;
  /** The scene id this turn belongs to. */
  turnGroup: string;
  meta: Omit<TurnMetaRow, 'turn_id' | 'created_at'>;
}

/**
 * Inserts dialogue_turns + turn_meta and bumps the two legacy counters in ONE
 * db.batch() (a transaction) — the old two-statement increment could drift,
 * and turn_sequence is already behind. Returns the new turn id.
 */
export async function insertTurn(db: D1Database, input: InsertTurnInput): Promise<number> {
  await ensureIslandSchema(db);
  const content = input.say.trim() || `(silent) ${input.meta.action || 'nothing'}`;
  const legacyNow = nowLegacy();
  const isoNow = nowIso();

  const results = await db.batch([
    db.prepare(
      `INSERT INTO dialogue_turns (turn_number, speaker, content, thoughts, related_packet_ids, trigger_source, turn_group, created_at)
       VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM dialogue_turns), ?, ?, ?, ?, 'island', ?, ?)`
    ).bind(input.speaker, content, input.thoughtsLine, input.meta.memory_refs, input.turnGroup, legacyNow),
    db.prepare(
      `INSERT INTO turn_meta (turn_id, era, protocol, scene_id, sim_day, sim_slot, location, thought, action, model, retries, retry_reason, notebook_refs, memory_refs, activity, donation_id, donated_model, created_at)
       VALUES ((SELECT last_insert_rowid()), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      input.meta.era, input.meta.protocol, input.meta.scene_id, input.meta.sim_day, input.meta.sim_slot,
      input.meta.location, input.meta.thought, input.meta.action, input.meta.model, input.meta.retries,
      input.meta.retry_reason, input.meta.notebook_refs, input.meta.memory_refs, input.meta.activity,
      input.meta.donation_id ?? null, input.meta.donated_model ?? null, isoNow
    ),
    db.prepare(
      `UPDATE system_state SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = ? WHERE key = 'total_dialogue_turns'`
    ).bind(legacyNow),
    db.prepare(
      `UPDATE system_state SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = ? WHERE key = 'turn_sequence'`
    ).bind(legacyNow),
  ]);

  const turnId = results[0]?.meta?.last_row_id;
  if (!turnId) throw new Error('insertTurn: dialogue_turns insert returned no last_row_id');
  return turnId;
}

export async function getSceneTurns(db: D1Database, sceneId: string, limit: number = 40): Promise<SceneTurnRow[]> {
  const rows = await db.prepare(
    `${SCENE_TURN_SELECT} WHERE tm.scene_id = ? ORDER BY dt.id ASC LIMIT ?`
  ).bind(sceneId, Math.min(200, Math.max(1, limit))).all<any>();
  return (rows.results || []).map(rowToSceneTurn);
}

/** Ascending, for /api/poll — new_turns[i] in the order they happened. */
export async function getRecentTurns(db: D1Database, sinceId: number, limit: number): Promise<SceneTurnRow[]> {
  const rows = await db.prepare(
    `${SCENE_TURN_SELECT} WHERE dt.id > ? ORDER BY dt.id ASC LIMIT ?`
  ).bind(sinceId, Math.min(200, Math.max(1, limit))).all<any>();
  return (rows.results || []).map(rowToSceneTurn);
}

export async function getLastTurnAt(db: D1Database): Promise<string | null> {
  const row = await db.prepare(`SELECT created_at FROM turn_meta ORDER BY turn_id DESC LIMIT 1`).first<{ created_at: string }>();
  return row?.created_at ?? null;
}

// ── Scenes ──

export interface NewScene {
  id: string;
  day: number;
  slot: Slot;
  location: LocationId;
  title: string;
  setup: string;
  event?: string | null;
  /** 'together' or 'apart' — defaults to 'together' when omitted (every pre-part-2 caller). */
  mode?: 'together' | 'apart';
  /** Set only when mode = 'apart'. */
  apart?: Record<AgentId, { location: LocationId; doing: string; setup: string }>;
}

export async function insertScene(db: D1Database, s: NewScene): Promise<void> {
  await ensureIslandSchema(db);
  await db.prepare(
    `INSERT INTO scenes (id, day, slot, location, title, setup, event, status, mode, apart_json, turn_count, opened_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, 0, ?)`
  ).bind(
    s.id, s.day, s.slot, s.location, s.title, s.setup, s.event ?? null,
    s.mode ?? 'together', s.apart ? JSON.stringify(s.apart) : null, nowIso()
  ).run();
}

export async function closeScene(
  db: D1Database,
  id: string,
  fields: { summary: string; outcomes_json: string; turn_count: number; model: string }
): Promise<void> {
  await db.prepare(
    `UPDATE scenes SET status = 'closed', summary = ?, outcomes_json = ?, turn_count = ?, model = ?, closed_at = ? WHERE id = ?`
  ).bind(fields.summary, fields.outcomes_json, fields.turn_count, fields.model, nowIso(), id).run();
}

export async function getScene(db: D1Database, id: string): Promise<SceneRow | null> {
  const row = await db.prepare(`SELECT * FROM scenes WHERE id = ?`).bind(id).first<SceneRow>();
  return row || null;
}

/** Chronological within a day. Ordered by rowid, NOT id — scene ids are text (s<day>-<slot>-<seq>) and sort lexicographically, not chronologically. */
export async function getScenesForDay(db: D1Database, day: number): Promise<SceneRow[]> {
  const rows = await db.prepare(`SELECT * FROM scenes WHERE day = ? ORDER BY rowid ASC`).bind(day).all<SceneRow>();
  return rows.results || [];
}

export async function getRecentScenes(db: D1Database, n: number): Promise<SceneRow[]> {
  const rows = await db.prepare(`SELECT * FROM scenes ORDER BY rowid DESC LIMIT ?`).bind(Math.min(200, Math.max(1, n))).all<SceneRow>();
  return rows.results || [];
}

export async function countScenes(db: D1Database): Promise<number> {
  return countOf(db, 'scenes');
}

// ── World events ──

export interface NewWorldEvent {
  day: number;
  slot: Slot;
  kind: string;
  who?: string;
  detail: string;
  data_json?: string | null;
  scene_id?: string | null;
}

export async function logEvent(db: D1Database, row: NewWorldEvent): Promise<number> {
  await ensureIslandSchema(db);
  const res = await db.prepare(
    `INSERT INTO world_events (day, slot, kind, who, detail, data_json, scene_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(row.day, row.slot, row.kind, row.who ?? 'world', row.detail, row.data_json ?? null, row.scene_id ?? null, nowIso()).run();
  return res.meta.last_row_id ?? 0;
}

export async function logEvents(db: D1Database, rows: NewWorldEvent[]): Promise<void> {
  if (!rows.length) return;
  await ensureIslandSchema(db);
  const now = nowIso();
  await db.batch(rows.map((row) =>
    db.prepare(
      `INSERT INTO world_events (day, slot, kind, who, detail, data_json, scene_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(row.day, row.slot, row.kind, row.who ?? 'world', row.detail, row.data_json ?? null, row.scene_id ?? null, now)
  ));
}

export async function getRecentEvents(db: D1Database, n: number): Promise<WorldEventRow[]> {
  const rows = await db.prepare(`SELECT * FROM world_events ORDER BY id DESC LIMIT ?`).bind(Math.min(200, Math.max(1, n))).all<WorldEventRow>();
  return rows.results || [];
}

/** A single island day's events — small and bounded by construction (a day has at most a few dozen). */
export async function getEventsForDay(db: D1Database, day: number): Promise<WorldEventRow[]> {
  const rows = await db.prepare(`SELECT * FROM world_events WHERE day = ? ORDER BY id ASC LIMIT 200`).bind(day).all<WorldEventRow>();
  return rows.results || [];
}

// ── Notebook ──

export async function addNotebook(
  db: D1Database,
  entry: { day: number; author: AgentId | 'both'; kind: NotebookRow['kind']; content: string; location?: LocationId | null; scene_id?: string | null }
): Promise<number | null> {
  await ensureIslandSchema(db);
  const trimmed = entry.content.trim().slice(0, 500);
  if (trimmed.length < 5) return null;

  // Dedup against the newest 200 rows — bump `uses` on a near-duplicate instead
  // of writing it again (the same mistake mind.ts's memory dedup exists to fix).
  const recent = await db.prepare(`SELECT id, content FROM notebook ORDER BY id DESC LIMIT 200`).all<{ id: number; content: string }>();
  for (const row of recent.results || []) {
    if (similarity(trimmed, row.content) >= 0.6) {
      await db.prepare(`UPDATE notebook SET uses = uses + 1 WHERE id = ?`).bind(row.id).run().catch(() => {});
      return null;
    }
  }

  const res = await db.prepare(
    `INSERT INTO notebook (day, author, kind, content, location, scene_id, uses, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
  ).bind(entry.day, entry.author, entry.kind, trimmed, entry.location || null, entry.scene_id || null, nowIso()).run();
  return res.meta.last_row_id ?? null;
}

/** Keyword similarity over the newest 300 rows UNION the most-used 100 (mirrors mind.ts's recallMemories candidate pool). Increments `uses` on the rows returned. */
export async function searchNotebook(db: D1Database, query: string, k: number = 6): Promise<string[]> {
  await ensureIslandSchema(db);
  const rows = await db.prepare(
    `SELECT * FROM notebook WHERE id IN (
       SELECT id FROM (SELECT id FROM notebook ORDER BY id DESC LIMIT 300)
       UNION
       SELECT id FROM (SELECT id FROM notebook ORDER BY uses DESC, id DESC LIMIT 100)
     )`
  ).all<NotebookRow>();
  const all = rows.results || [];
  if (all.length === 0) return [];

  let chosen: NotebookRow[];
  if (query.trim()) {
    chosen = all
      .map((r) => ({ r, score: similarity(query, r.content) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((x) => x.r);
  } else {
    chosen = all.slice().sort((a, b) => b.id - a.id).slice(0, k);
  }

  if (chosen.length) {
    const ids = chosen.map((r) => r.id).join(',');
    await db.prepare(`UPDATE notebook SET uses = uses + 1 WHERE id IN (${ids})`).run().catch(() => {});
  }
  return chosen.map((r) => r.content);
}

/**
 * Same candidate pool and selection as searchNotebook, but returns `{id,
 * content}` — agent.ts's speak() needs the ids to write turn_meta's
 * notebook_refs (provenance of which notebook entries fed THIS turn's
 * context), which plain content strings can't carry. Kept as a separate
 * function rather than changing searchNotebook's return shape, since that
 * function already has a settled contract (see its own header comment).
 */
export async function searchNotebookRows(db: D1Database, query: string, k: number = 6): Promise<{ id: number; content: string }[]> {
  await ensureIslandSchema(db);
  const rows = await db.prepare(
    `SELECT * FROM notebook WHERE id IN (
       SELECT id FROM (SELECT id FROM notebook ORDER BY id DESC LIMIT 300)
       UNION
       SELECT id FROM (SELECT id FROM notebook ORDER BY uses DESC, id DESC LIMIT 100)
     )`
  ).all<NotebookRow>();
  const all = rows.results || [];
  if (all.length === 0) return [];

  let chosen: NotebookRow[];
  if (query.trim()) {
    chosen = all
      .map((r) => ({ r, score: similarity(query, r.content) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((x) => x.r);
  } else {
    chosen = all.slice().sort((a, b) => b.id - a.id).slice(0, k);
  }

  if (chosen.length) {
    const ids = chosen.map((r) => r.id).join(',');
    await db.prepare(`UPDATE notebook SET uses = uses + 1 WHERE id IN (${ids})`).run().catch(() => {});
  }
  return chosen.map((r) => ({ id: r.id, content: r.content }));
}

export async function listNotebook(db: D1Database, limit: number, offset: number): Promise<NotebookRow[]> {
  const rows = await db.prepare(`SELECT * FROM notebook ORDER BY id DESC LIMIT ? OFFSET ?`)
    .bind(Math.min(200, Math.max(1, limit)), Math.max(0, offset)).all<NotebookRow>();
  return rows.results || [];
}

export async function countNotebook(db: D1Database): Promise<number> {
  return countOf(db, 'notebook');
}

// ── Artifacts ──

export async function insertArtifact(
  db: D1Database,
  a: { day: number; maker: AgentId; kind: string; title: string; content: string; format: 'text' | 'svg'; scene_id?: string | null; inbox_id?: number | null; model: string }
): Promise<number> {
  await ensureIslandSchema(db);
  const res = await db.prepare(
    `INSERT INTO artifacts (day, maker, kind, title, content, format, scene_id, inbox_id, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(a.day, a.maker, a.kind, a.title, a.content, a.format, a.scene_id ?? null, a.inbox_id ?? null, a.model, nowIso()).run();
  return res.meta.last_row_id ?? 0;
}

export async function getArtifact(db: D1Database, id: number): Promise<ArtifactRow | null> {
  const row = await db.prepare(`SELECT * FROM artifacts WHERE id = ?`).bind(id).first<ArtifactRow>();
  return row || null;
}

export async function listArtifacts(db: D1Database, limit: number, offset: number, maker?: AgentId): Promise<ArtifactRow[]> {
  const boundedLimit = Math.min(200, Math.max(1, limit));
  const boundedOffset = Math.max(0, offset);
  const stmt = maker
    ? db.prepare(`SELECT * FROM artifacts WHERE maker = ? ORDER BY id DESC LIMIT ? OFFSET ?`).bind(maker, boundedLimit, boundedOffset)
    : db.prepare(`SELECT * FROM artifacts ORDER BY id DESC LIMIT ? OFFSET ?`).bind(boundedLimit, boundedOffset);
  const rows = await stmt.all<ArtifactRow>();
  return rows.results || [];
}

export async function countArtifacts(db: D1Database): Promise<number> {
  return countOf(db, 'artifacts');
}

// ── Chapters ──

export async function upsertChapter(
  db: D1Database,
  c: { day: number; title: string; body: string; model: string; stats_json: string }
): Promise<void> {
  await ensureIslandSchema(db);
  await db.prepare(
    `INSERT INTO chapters (day, title, body, model, stats_json, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET title = excluded.title, body = excluded.body, model = excluded.model, stats_json = excluded.stats_json`
  ).bind(c.day, c.title, c.body, c.model, c.stats_json, nowIso()).run();
}

export async function getChapter(db: D1Database, day: number): Promise<ChapterRow | null> {
  const row = await db.prepare(`SELECT * FROM chapters WHERE day = ?`).bind(day).first<ChapterRow>();
  return row || null;
}

export async function getLatestChapter(db: D1Database): Promise<ChapterRow | null> {
  const row = await db.prepare(`SELECT * FROM chapters ORDER BY day DESC LIMIT 1`).first<ChapterRow>();
  return row || null;
}

export async function listChapters(db: D1Database, limit: number, offset: number): Promise<ChapterRow[]> {
  const rows = await db.prepare(`SELECT * FROM chapters ORDER BY day DESC LIMIT ? OFFSET ?`)
    .bind(Math.min(200, Math.max(1, limit)), Math.max(0, offset)).all<ChapterRow>();
  return rows.results || [];
}

// ── Forecasts ──

export interface ForecastRow {
  id: number;
  day: number;
  agent: AgentId;
  predicted: WeatherKind;
  actual: WeatherKind | null;
  correct: number | null;
  created_at: string;
}

/** `day` is the day being PREDICTED (usually w.day + 1, written at dawn planning). */
export async function addForecast(db: D1Database, f: { day: number; agent: AgentId; predicted: WeatherKind }): Promise<void> {
  await ensureIslandSchema(db);
  await db.prepare(
    `INSERT INTO forecasts (day, agent, predicted, actual, correct, created_at) VALUES (?, ?, ?, NULL, NULL, ?)`
  ).bind(f.day, f.agent, f.predicted, nowIso()).run();
}

/** Scores every unscored forecast made FOR `day` against that day's actual dawn weather. */
export async function scoreForecasts(db: D1Database, day: number, actualKind: WeatherKind): Promise<void> {
  await db.prepare(
    `UPDATE forecasts SET actual = ?, correct = CASE WHEN predicted = ? THEN 1 ELSE 0 END WHERE day = ? AND actual IS NULL`
  ).bind(actualKind, actualKind, day).run();
}

export async function forecastRecord(db: D1Database, agent: AgentId, lastN: number): Promise<{ n: number; correct: number }> {
  const row = await db.prepare(
    `SELECT COUNT(*) as n, COALESCE(SUM(correct), 0) as correct FROM (
       SELECT correct FROM forecasts WHERE agent = ? AND actual IS NOT NULL ORDER BY day DESC LIMIT ?
     )`
  ).bind(agent, Math.min(60, Math.max(1, lastN))).first<{ n: number; correct: number }>();
  return { n: row?.n ?? 0, correct: row?.correct ?? 0 };
}

// ── Bottles (visitor notes, dramatised) ──
// inbox.status carries the coarse state (pending=at sea, processing=ashore/
// being read, discussed=read, answered-or-not); this table carries the detail
// the island scene needs (which scene read it, which artifact replied).

export interface BottleRow {
  inbox_id: number;
  status: 'at_sea' | 'ashore' | 'read' | 'answered';
  washed_day: number | null;
  scene_id: string | null;
  reply_artifact_id: number | null;
  updated_at: string;
}

export async function nextBottleAtSea(db: D1Database): Promise<{ id: number; author: string; content: string; created_at: string } | null> {
  await ensureIslandSchema(db);
  const row = await db.prepare(
    `SELECT i.id as id, i.author as author, i.content as content, i.created_at as created_at
     FROM inbox i LEFT JOIN bottles b ON b.inbox_id = i.id
     WHERE i.status = 'pending' AND (b.inbox_id IS NULL OR b.status = 'at_sea')
     ORDER BY i.id ASC LIMIT 1`
  ).first<{ id: number; author: string; content: string; created_at: string }>();
  return row || null;
}

/** One bottle row by its inbox id — tick.ts's bottle-reply fallback uses this to check whether a reply artifact is already recorded before queuing another. */
export async function getBottle(db: D1Database, inboxId: number): Promise<BottleRow | null> {
  await ensureIslandSchema(db);
  const row = await db.prepare(`SELECT * FROM bottles WHERE inbox_id = ?`).bind(inboxId).first<BottleRow>();
  return row || null;
}

/**
 * The bottle note's EXACT text for each of the given scene ids that had one,
 * keyed by scene id — narrator.ts's writeChapter needs this so the chapter
 * can quote a bottle's real words instead of letting the model (or an agent
 * reading it aloud) invent them. Bounded: a day has at most a handful of
 * scenes, but sliced defensively anyway per this file's own bounded-query rule.
 */
export async function getBottleTextsForScenes(db: D1Database, sceneIds: string[]): Promise<Record<string, string>> {
  const ids = sceneIds.slice(0, 50);
  if (!ids.length) return {};
  await ensureIslandSchema(db);
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.prepare(
    `SELECT b.scene_id as scene_id, i.content as content
     FROM bottles b JOIN inbox i ON i.id = b.inbox_id
     WHERE b.scene_id IN (${placeholders})`
  ).bind(...ids).all<{ scene_id: string; content: string }>();
  const out: Record<string, string> = {};
  for (const r of rows.results || []) out[r.scene_id] = r.content;
  return out;
}

export async function setBottle(
  db: D1Database,
  inboxId: number,
  fields: Partial<Pick<BottleRow, 'status' | 'washed_day' | 'scene_id' | 'reply_artifact_id'>>
): Promise<void> {
  await ensureIslandSchema(db);
  const existing = await db.prepare(`SELECT inbox_id FROM bottles WHERE inbox_id = ?`).bind(inboxId).first<{ inbox_id: number }>();
  const now = nowIso();
  if (existing) {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (fields.status !== undefined) { sets.push('status = ?'); vals.push(fields.status); }
    if (fields.washed_day !== undefined) { sets.push('washed_day = ?'); vals.push(fields.washed_day); }
    if (fields.scene_id !== undefined) { sets.push('scene_id = ?'); vals.push(fields.scene_id); }
    if (fields.reply_artifact_id !== undefined) { sets.push('reply_artifact_id = ?'); vals.push(fields.reply_artifact_id); }
    sets.push('updated_at = ?');
    vals.push(now, inboxId);
    await db.prepare(`UPDATE bottles SET ${sets.join(', ')} WHERE inbox_id = ?`).bind(...vals).run();
  } else {
    await db.prepare(
      `INSERT INTO bottles (inbox_id, status, washed_day, scene_id, reply_artifact_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(inboxId, fields.status ?? 'at_sea', fields.washed_day ?? null, fields.scene_id ?? null, fields.reply_artifact_id ?? null, now).run();
  }
}

export interface AnsweredBottle {
  inbox_id: number;
  author: string;
  content: string;
  reply_artifact_id: number | null;
  reply_title: string | null;
  reply_content: string | null;
  washed_day: number | null;
  updated_at: string;
}

export async function listAnsweredBottles(db: D1Database, limit: number): Promise<AnsweredBottle[]> {
  await ensureIslandSchema(db);
  const rows = await db.prepare(
    `SELECT b.inbox_id as inbox_id, i.author as author, i.content as content, b.reply_artifact_id as reply_artifact_id,
            a.title as reply_title, a.content as reply_content, b.washed_day as washed_day, b.updated_at as updated_at
     FROM bottles b JOIN inbox i ON i.id = b.inbox_id
     LEFT JOIN artifacts a ON a.id = b.reply_artifact_id
     WHERE b.status = 'answered'
     ORDER BY b.updated_at DESC LIMIT ?`
  ).bind(Math.min(100, Math.max(1, limit))).all<AnsweredBottle>();
  return rows.results || [];
}

// ── Metrics ──

export interface MetricsDailyRow {
  day: number;
  json: string;
  created_at: string;
}

export async function putDayMetrics(db: D1Database, day: number, json: string): Promise<void> {
  await ensureIslandSchema(db);
  await db.prepare(
    `INSERT INTO metrics_daily (day, json, created_at) VALUES (?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET json = excluded.json, created_at = excluded.created_at`
  ).bind(day, json, nowIso()).run();
}

export async function listDayMetrics(db: D1Database, limit: number): Promise<MetricsDailyRow[]> {
  const rows = await db.prepare(`SELECT * FROM metrics_daily ORDER BY day DESC LIMIT ?`)
    .bind(Math.min(400, Math.max(1, limit))).all<MetricsDailyRow>();
  return rows.results || [];
}

// ── Small read helpers the web needs ──

export async function getTodayTimeline(db: D1Database, day: number): Promise<{ scenes: SceneRow[]; events: WorldEventRow[] }> {
  const [scenes, events] = await Promise.all([getScenesForDay(db, day), getEventsForDay(db, day)]);
  return { scenes, events };
}

async function countOf(db: D1Database, table: 'scenes' | 'artifacts' | 'notebook'): Promise<number> {
  // `table` is always one of the three fixed literals above (never user input).
  const row = await db.prepare(`SELECT COUNT(*) as n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}
