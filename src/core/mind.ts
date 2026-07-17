// The growing mind — what makes Kevin & Jenny actually learn instead of looping.
//
// Three persistent mechanisms, all model-agnostic (plain text, no fragile
// function-calling — NIM models emit tool calls as text, verified 2026-06-12):
//
//   1. Memories  — agent_memories rows. Saved two ways: the agent writes
//                  [remember: ...] inline in a message, or reflection extracts them.
//   2. Journal   — one private, self-authored note per agent (system_state),
//                  rewritten by the agent during reflection. Injected into every
//                  future system prompt, so growth compounds.
//   3. Reflection — when a conversation winds down, each agent privately reviews
//                  the transcript and decides what to keep. Deterministic growth:
//                  it always runs, it doesn't depend on the model "choosing" a tool.

import { nvidiaChatChain, NvidiaModelInfo } from './nvidia';

export interface AgentMemory {
  id: number;
  agent: 'kevin' | 'jenny';
  content: string;
  kind: string;
  importance: number;
  source_turn_group: string | null;
  created_at: string;
  last_recalled: string | null;
}

const MAX_MEMORY_CHARS = 300;
// A runaway guard, not a working-set limit. Recall reads a bounded candidate slice
// (see recallMemories), so pool size no longer costs anything per turn — and the
// old 400 was never actually enforced (prune only ran after a *successful*
// reflection, which for Jenny happened 6 times ever, so she reached 1,618). Raising
// it to 2,000 keeps their real history instead of deleting ~1,200 of Jenny's
// memories — including her oldest — the first time prune finally runs.
const MAX_MEMORIES_PER_AGENT = 2000;
const MAX_JOURNAL_CHARS = 2400;

// Two memories this similar are the same thought. Kevin & Jenny re-saved "the
// candle's new shape—pooled wax like a secret map" 40 times because saveMemory had
// no dedup: duplicates then dominated recall, which made them say it again. That
// feedback loop is what "no growth" looked like from the outside.
const DUPLICATE_SIMILARITY = 0.75;

function nowStamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// Self-healing schema: the Worker owns its tables, so deploys never depend on a
// manually-run remote migration (migrations/0005 mirrors this for local dev).
let schemaReady = false;
export async function ensureMindSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS agent_memories (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       agent TEXT NOT NULL CHECK(agent IN ('kevin', 'jenny')),
       content TEXT NOT NULL,
       kind TEXT NOT NULL DEFAULT 'memory',
       importance REAL NOT NULL DEFAULT 0.5,
       source_turn_group TEXT,
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       last_recalled TEXT
     )`
  ).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_agent_memories_agent ON agent_memories(agent)').run().catch(() => {});
  // Every journal a version, never an overwrite. The journal IS the identity, so its
  // edit history is the only direct record of them changing — without this, growth is
  // invisible by construction: you can read who they are today but never who they were.
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS journal_versions (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       agent TEXT NOT NULL CHECK(agent IN ('kevin', 'jenny')),
       content TEXT NOT NULL,
       source_turn_group TEXT,
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`
  ).run().catch(() => {});
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_journal_versions_agent ON journal_versions(agent, id)').run().catch(() => {});
  schemaReady = true;
}

// ── Keyword similarity (shared by recall + anti-repetition) ──

const STOP_WORDS = new Set([
  'the','a','an','in','on','at','to','for','of','with','and','or','is','are','was','were',
  'be','been','being','have','has','had','do','does','did','will','would','could','should',
  'may','might','can','shall','this','that','these','those','i','me','my','we','our','you',
  'your','it','its','they','them','their','not','no','but','so','if','as','by','from','about',
  'up','out','over','after','all','each','every','more','some','any','both','very','just',
  'also','now','then','than','too','only','own','same','such','here','there','when','where',
  'why','how','what','which','who','whom'
]);

export function extractKeywords(text: string): string[] {
  return [...new Set(
    text.toLowerCase().split(/[^a-zA-Z0-9]+/).filter(w => w.length > 2 && !STOP_WORDS.has(w))
  )];
}

export function similarity(a: string, b: string): number {
  const ka = extractKeywords(a);
  const kb = extractKeywords(b);
  if (ka.length === 0 || kb.length === 0) return 0;
  const setB = new Set(kb);
  const intersection = ka.filter(w => setB.has(w)).length;
  return intersection / new Set([...ka, ...kb]).size;
}

// ── Journal ──

export async function getJournal(db: D1Database, agent: 'kevin' | 'jenny'): Promise<string> {
  const row = await db.prepare('SELECT value FROM system_state WHERE key = ?')
    .bind(`journal_${agent}`).first<{ value: string }>();
  return row?.value || '';
}

export async function setJournal(
  db: D1Database,
  agent: 'kevin' | 'jenny',
  text: string,
  group?: string
): Promise<boolean> {
  const value = (text || '').trim().slice(0, MAX_JOURNAL_CHARS);
  if (value.length < 5) return false; // don't overwrite a real journal with an empty rewrite
  // Skip a no-op rewrite: reflection often returns a journal barely different from the
  // current one, and a version log full of near-identical entries hides real change.
  const current = await getJournal(db, agent);
  if (current && similarity(value, current) > 0.9) return false;

  await db.prepare(
    `INSERT INTO system_state (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(`journal_${agent}`, value, nowStamp()).run();

  await ensureMindSchema(db);
  await db.prepare(
    `INSERT INTO journal_versions (agent, content, source_turn_group, created_at) VALUES (?, ?, ?, ?)`
  ).bind(agent, value, group || null, nowStamp()).run().catch(() => {});
  return true;
}

/** A journal's edit history, newest first — the visible record of an agent growing. */
export async function getJournalHistory(
  db: D1Database,
  agent: 'kevin' | 'jenny',
  limit: number = 20
): Promise<{ id: number; content: string; created_at: string }[]> {
  await ensureMindSchema(db);
  const rows = await db.prepare(
    'SELECT id, content, created_at FROM journal_versions WHERE agent = ? ORDER BY id DESC LIMIT ?'
  ).bind(agent, Math.min(100, Math.max(1, limit))).all<{ id: number; content: string; created_at: string }>();
  return rows.results || [];
}

// ── Memories ──

export async function saveMemory(
  db: D1Database,
  agent: 'kevin' | 'jenny',
  content: string,
  opts: { kind?: string; importance?: number; group?: string } = {}
): Promise<boolean> {
  const trimmed = (content || '').trim().slice(0, MAX_MEMORY_CHARS);
  if (trimmed.length < 5) return false;
  await ensureMindSchema(db);
  const importance = Math.max(0, Math.min(1, opts.importance ?? 0.5));

  // Dedup against this agent's recent memories. Without this the same insight is
  // saved every time it resurfaces (one line reached 40 copies), and duplicates then
  // crowd out everything else in recall — the loop that made them repeat themselves.
  // When we'd re-save, bump the existing memory's importance instead: a thought that
  // keeps returning genuinely matters, so let it rise rather than duplicate.
  const recent = await db.prepare(
    'SELECT id, content, importance FROM agent_memories WHERE agent = ? ORDER BY id DESC LIMIT 150'
  ).bind(agent).all<{ id: number; content: string; importance: number }>();
  for (const m of recent.results || []) {
    if (similarity(trimmed, m.content) >= DUPLICATE_SIMILARITY) {
      const bumped = Math.min(1, m.importance + 0.05);
      await db.prepare('UPDATE agent_memories SET importance = ?, last_recalled = ? WHERE id = ?')
        .bind(bumped, nowStamp(), m.id).run().catch(() => {});
      return false;
    }
  }

  await db.prepare(
    `INSERT INTO agent_memories (agent, content, kind, importance, source_turn_group, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(agent, trimmed, opts.kind || 'memory', importance, opts.group || null, nowStamp()).run();
  // Keep each agent bounded right when it grows, not only after a reflection that may
  // never come (Jenny reflected 6 times ever, so her pool was never pruned).
  await pruneMemories(db, agent).catch(() => {});
  return true;
}

/**
 * Surface memories for a turn. The couple shares one life, so recall draws from
 * BOTH agents' memories. With a query: keyword relevance + importance + recency.
 * Without one (fresh conversation): a mix of the newest and the most important.
 */
export async function recallMemories(
  db: D1Database,
  query: string,
  limit: number = 5
): Promise<AgentMemory[]> {
  await ensureMindSchema(db);
  // Candidate pool = the newest 250 UNION the 250 most important. The old code read
  // only the newest 250, so ~60% of memories (1,270 of 2,120) could never resurface —
  // an old, important insight was permanently unreachable the moment 250 newer rows
  // existed. Pulling the top-importance rows too lets the past actually come back.
  const rows = await db.prepare(
    `SELECT * FROM agent_memories WHERE id IN (
        SELECT id FROM (SELECT id FROM agent_memories ORDER BY id DESC LIMIT 250)
        UNION
        SELECT id FROM (SELECT id FROM agent_memories ORDER BY importance DESC, id DESC LIMIT 250)
     )`
  ).all<AgentMemory>();
  const all = rows.results || [];
  if (all.length === 0) return [];

  let chosen: AgentMemory[];
  if (query && query.trim().length > 0) {
    const newestId = Math.max(...all.map(m => m.id));
    chosen = all
      .map(m => ({
        m,
        score: similarity(query, m.content) * 2
          + m.importance * 0.6
          + (m.id / Math.max(1, newestId)) * 0.4, // newer → closer to +0.4
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(x => x.m);
  } else {
    // `all` is a UNION now, no longer id-ordered — sort explicitly before slicing.
    const newest = all.slice().sort((a, b) => b.id - a.id).slice(0, 3);
    const important = all.slice()
      .sort((a, b) => b.importance - a.importance)
      .slice(0, limit);
    const seen = new Set<number>();
    chosen = [...newest, ...important].filter(m => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    }).slice(0, limit);
  }

  if (chosen.length > 0) {
    const ids = chosen.map(m => m.id).join(',');
    await db.prepare(`UPDATE agent_memories SET last_recalled = ? WHERE id IN (${ids})`)
      .bind(nowStamp()).run().catch(() => {});
  }
  return chosen;
}

/** Newest memories first — for the site's Memory tab and the dataset export. */
export async function listMemories(db: D1Database, limit: number = 100): Promise<AgentMemory[]> {
  await ensureMindSchema(db);
  const rows = await db.prepare('SELECT * FROM agent_memories ORDER BY id DESC LIMIT ?')
    .bind(Math.min(1000, Math.max(1, limit))).all<AgentMemory>();
  return rows.results || [];
}

/** Keep each agent's memory bounded — drop the least important, oldest rows. */
export async function pruneMemories(db: D1Database, agent: 'kevin' | 'jenny'): Promise<void> {
  await db.prepare(
    `DELETE FROM agent_memories WHERE agent = ? AND id IN (
       SELECT id FROM agent_memories WHERE agent = ?
       ORDER BY importance ASC, id ASC
       LIMIT MAX(0, (SELECT COUNT(*) FROM agent_memories WHERE agent = ?) - ?)
     )`
  ).bind(agent, agent, agent, MAX_MEMORIES_PER_AGENT).run().catch(() => {});
}

// ── Inline [remember: ...] tags — the tool agents can use mid-sentence ──

export function extractRememberTags(text: string): { cleaned: string; saved: string[] } {
  const saved: string[] = [];
  const cleaned = (text || '').replace(/\[remember:\s*([^\]]{5,300})\]/gi, (_full, captured) => {
    if (saved.length < 2) saved.push(String(captured).trim());
    return '';
  }).replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return { cleaned, saved };
}

// ── Reflection — the deterministic growth step ──

export interface ReflectionResult {
  memoriesSaved: number;
  journalUpdated: boolean;
  tokens: number;
  error?: string;
}

/**
 * One private structured call after a conversation ends: the agent's own model
 * reviews the transcript, keeps up to 3 memories, and may rewrite its journal.
 * Never throws; failures just mean no growth this round.
 */
export async function reflectOnConversation(
  db: D1Database,
  apiKey: string,
  agent: 'kevin' | 'jenny',
  /** The agent's model chain (primary first) — reflection is how they grow, so it
   *  must survive a dead primary just like speaking does. */
  models: NvidiaModelInfo[],
  turns: { speaker: string; content: string }[],
  group: string
): Promise<ReflectionResult> {
  try {
    const partner = agent === 'kevin' ? 'Jenny' : 'Kevin';
    const self = agent === 'kevin' ? 'Kevin' : 'Jenny';
    const journal = await getJournal(db, agent);

    const transcript = turns
      .map(t => `${t.speaker === 'kevin' ? 'Kevin' : 'Jenny'}: ${(t.content || '').slice(0, 600)}`)
      .join('\n')
      .slice(-6000);

    const system =
      `You are ${self}, married to ${partner}. This is your PRIVATE post-conversation reflection — ` +
      `nothing here is spoken aloud. Be honest with yourself.`;

    const user =
      `The conversation you two just finished:\n${transcript}\n\n` +
      `Your private journal as it reads today:\n${journal || '(empty — you have never written it)'}\n\n` +
      `Respond with ONLY a JSON object, no other text:\n` +
      `{"memories": [{"content": "...", "importance": 0.0-1.0}], "journal": "..."}\n\n` +
      `- "memories": up to 3 things from THIS conversation worth keeping permanently ` +
      `(a new insight, something you learned about ${partner}, a decision, an intention). ` +
      `Only things not already obvious from your journal. Use [] if truly nothing new.\n` +
      `- "journal": rewrite your journal as it should read going forward — this is the only ` +
      `record of who you are becoming. Keep what still rings true, let go of what no longer ` +
      `fits, and fold in how this conversation changed you. Write it as yourself, under 250 words. ` +
      `Return the FULL journal text, not a diff. (Only repeat it verbatim if this conversation ` +
      `genuinely left you unchanged.)`;

    const res = await nvidiaChatChain(apiKey, models, {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      maxTokens: 800,
      temperature: 0.4,
    }, {
      timeoutMs: 20000, // keep the whole cron cycle comfortably under its 2-min interval
      // Reflection needs parseable JSON. Jenny's own model (llama-3.1-8b) often answers
      // a long transcript with prose, which used to make her reflection a silent no-op
      // forever. `accept` makes the chain fall through to a model that returns JSON
      // (mistral-small-4) — her voice leads, but she always gets to grow.
      accept: (text) => parseReflectionJson(text) !== null,
    });

    if (!res.ok) return { memoriesSaved: 0, journalUpdated: false, tokens: res.totalTokens, error: res.error };

    const parsed = parseReflectionJson(res.text);
    if (!parsed) {
      return { memoriesSaved: 0, journalUpdated: false, tokens: res.totalTokens, error: 'no JSON in reflection' };
    }

    let saved = 0;
    const memories = Array.isArray(parsed.memories) ? parsed.memories.slice(0, 3) : [];
    for (const m of memories) {
      const ok = await saveMemory(db, agent, String(m?.content || ''), {
        kind: 'reflection',
        importance: typeof m?.importance === 'number' ? m.importance : 0.5,
        group,
      });
      if (ok) saved++;
    }

    // setJournal versions the entry and skips a near-identical rewrite, so
    // journalUpdated now means the journal ACTUALLY changed — not just that the model
    // echoed something back.
    const journalUpdated =
      typeof parsed.journal === 'string'
        ? await setJournal(db, agent, parsed.journal, group)
        : false;

    // saveMemory already prunes per-agent; no separate prune needed here.
    return { memoriesSaved: saved, journalUpdated, tokens: res.totalTokens };
  } catch (err) {
    return { memoriesSaved: 0, journalUpdated: false, tokens: 0, error: String(err).slice(0, 150) };
  }
}

/**
 * Pull the reflection JSON out of a model reply. Models wrap it in prose or ```json
 * fences often enough that the old bare indexOf('{')…lastIndexOf('}') silently failed
 * and dropped the whole reflection — a real cause of the journals never updating.
 */
function parseReflectionJson(text: string): { memories?: any[]; journal?: string } | null {
  if (!text) return null;
  // Strip a ```json ... ``` (or plain ```) fence if present.
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const slice = body.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    // Second chance: llama-3.1-8b (Jenny) emits RAW newlines/tabs inside string
    // values, which is invalid JSON and makes strict parse throw. That single
    // failure mode is why Jenny reflected 6 times ever while Kevin (whose model
    // escapes them) reflected 400. Collapse bare control chars to spaces and retry;
    // journals are prose, so a newline-to-space substitution costs nothing.
    try {
      return JSON.parse(slice.replace(/[\u0000-\u001F]+/g, ' '));
    } catch {
      return null;
    }
  }
}
