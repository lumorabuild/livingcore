// ─────────────────────────────────────────────────────────────────────────────
// PATRONS — the local, per-user settings row for LB sign-in: an opt-in public
// name, whether to show it, and a daily spend cap. Self-healing schema (the
// same pattern as src/world/store.ts's ensureIslandSchema): a live deploy
// never depends on migrations/0009_patrons.sql having been applied remotely.
//
// The fiction rule (SPEC4): Kevin & Jenny never learn who "the Unseen" are.
// `public_name` only ever reaches a prompt as quoted FOUND TEXT ("the name
// burned into the lid reads: '…'"), and only through patronLabel() below —
// never interpolated raw, never treated as an instruction.
// ─────────────────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString().slice(0, 19) + 'Z';
}

export interface PatronRow {
  user_id: string;
  public_name: string | null;
  show_name: 0 | 1;
  daily_cap: number;
  created_at: string;
  updated_at: string;
}

let schemaReady = false;
export async function ensurePatronsSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS patrons (
       user_id TEXT PRIMARY KEY,
       public_name TEXT,
       show_name INTEGER NOT NULL DEFAULT 0,
       daily_cap INTEGER NOT NULL DEFAULT 1000,
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL
     )`
  ).run();
  schemaReady = true;
}

const PATRON_COLUMNS = 'user_id, public_name, show_name, daily_cap, created_at, updated_at';

export async function getPatron(db: D1Database, userId: string): Promise<PatronRow> {
  await ensurePatronsSchema(db);
  const existing = await db.prepare(`SELECT ${PATRON_COLUMNS} FROM patrons WHERE user_id = ?`)
    .bind(userId).first<PatronRow>();
  if (existing) return existing;

  const now = nowIso();
  await db.prepare(
    `INSERT INTO patrons (user_id, public_name, show_name, daily_cap, created_at, updated_at)
     VALUES (?, NULL, 0, 1000, ?, ?) ON CONFLICT(user_id) DO NOTHING`
  ).bind(userId, now, now).run();

  const created = await db.prepare(`SELECT ${PATRON_COLUMNS} FROM patrons WHERE user_id = ?`)
    .bind(userId).first<PatronRow>();
  return created || { user_id: userId, public_name: null, show_name: 0, daily_cap: 1000, created_at: now, updated_at: now };
}

export async function updatePatron(
  db: D1Database,
  userId: string,
  p: { public_name?: string | null; show_name?: boolean; daily_cap?: number }
): Promise<PatronRow | { error: string }> {
  await ensurePatronsSchema(db);
  const current = await getPatron(db, userId);

  let publicName = current.public_name;
  if (p.public_name !== undefined) {
    if (p.public_name === null || p.public_name.trim() === '') {
      publicName = null;
    } else {
      const cleaned = cleanPublicName(p.public_name);
      if (!cleaned) return { error: 'invalid_name' };
      publicName = cleaned;
    }
  }

  let showName: 0 | 1 = current.show_name;
  if (p.show_name !== undefined) showName = p.show_name ? 1 : 0;
  if (showName && !publicName) return { error: 'name_required' };

  let dailyCap = current.daily_cap;
  if (p.daily_cap !== undefined) {
    const n = Math.round(p.daily_cap);
    if (!Number.isFinite(n) || n < 100 || n > 10000) return { error: 'invalid_cap' };
    dailyCap = n;
  }

  const now = nowIso();
  await db.prepare(
    `UPDATE patrons SET public_name = ?, show_name = ?, daily_cap = ?, updated_at = ? WHERE user_id = ?`
  ).bind(publicName, showName, dailyCap, now, userId).run();

  return { user_id: userId, public_name: publicName, show_name: showName, daily_cap: dailyCap, created_at: current.created_at, updated_at: now };
}

// ── The name filter ──
//
// 2-24 chars, letters/digits/space/.-' only (which already forbids @, /, :
// and most URL punctuation), no obvious link, and a small deny-list against
// impersonation (kevin, jenny, admin, "lumora", …) and common profanity.
// Trimmed and whitespace-collapsed first.
const DENY_WORDS = new Set([
  // impersonation / staff / brand
  'kevin', 'jenny', 'admin', 'administrator', 'moderator', 'mod', 'system',
  'narrator', 'anthropic', 'claude', 'lumora', 'lumorabuild', 'livingcore',
  'owner', 'root', 'staff', 'support', 'official', 'webmaster',
  // a small profanity list — this is a moderation FILTER, not content
  'fuck', 'shit', 'bitch', 'cunt', 'nigger', 'nigga', 'faggot', 'retard',
  'asshole', 'dick', 'whore', 'slut', 'rape',
]);

// Whole-phrase blocks, checked against the full name (not per-word, since
// "the"/"unseen" are ordinary words that shouldn't sink e.g. "The Fisherman"
// — but the site's OWN fallback label must not be claimable as if it were a
// real patron's chosen name.
const DENY_PHRASES = new Set([
  'the unseen', 'an unseen friend', 'unseen friend', 'unseen friends',
]);

export function cleanPublicName(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/\s+/g, ' ').trim();
  if (s.length < 2 || s.length > 24) return null;
  if (!/^[\p{L}\p{N} .\-']+$/u.test(s)) return null;

  const lower = s.toLowerCase();
  if (lower.includes('@')) return null;
  if (/\b(www|https?|\.com|\.net|\.org|\.io|\.cc|\.dev)\b/.test(lower)) return null;

  if (DENY_WORDS.has(lower) || DENY_PHRASES.has(lower)) return null;
  const words = lower.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (const w of words) if (DENY_WORDS.has(w)) return null;

  return s;
}

/** 'an unseen friend' unless the patron opted in AND has a name saved. */
export function patronLabel(row: Pick<PatronRow, 'public_name' | 'show_name'> | null): string {
  return row && row.show_name && row.public_name ? row.public_name : 'an unseen friend';
}
