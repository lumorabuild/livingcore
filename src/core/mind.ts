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
const MAX_MEMORIES_PER_AGENT = 400;
const MAX_JOURNAL_CHARS = 2400;

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

export async function setJournal(db: D1Database, agent: 'kevin' | 'jenny', text: string): Promise<void> {
  const value = (text || '').trim().slice(0, MAX_JOURNAL_CHARS);
  await db.prepare(
    `INSERT INTO system_state (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(`journal_${agent}`, value, nowStamp()).run();
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
  await db.prepare(
    `INSERT INTO agent_memories (agent, content, kind, importance, source_turn_group, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(agent, trimmed, opts.kind || 'memory', importance, opts.group || null, nowStamp()).run();
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
  const rows = await db.prepare(
    'SELECT * FROM agent_memories ORDER BY id DESC LIMIT 250'
  ).all<AgentMemory>();
  const all = rows.results || [];
  if (all.length === 0) return [];

  let chosen: AgentMemory[];
  if (query && query.trim().length > 0) {
    const newestId = all[0].id;
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
    const newest = all.slice(0, 3);
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
      `Your private journal as it reads today:\n${journal || '(empty)'}\n\n` +
      `Respond with ONLY a JSON object, no other text:\n` +
      `{"memories": [{"content": "...", "importance": 0.0-1.0}], "journal": "..."}\n\n` +
      `- "memories": up to 3 things from this conversation worth keeping permanently ` +
      `(insights, discoveries about each other, decisions, intentions). Use [] if nothing deserves keeping.\n` +
      `- "journal": your journal rewritten however you want it to read going forward, under 250 words. ` +
      `Use "" to leave it unchanged.`;

    const res = await nvidiaChatChain(apiKey, models, {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      maxTokens: 800,
      temperature: 0.4,
    }, { timeoutMs: 20000 }); // keep the whole cron cycle comfortably under its 2-min interval

    if (!res.ok) return { memoriesSaved: 0, journalUpdated: false, tokens: 0, error: res.error };

    // Defensive parse: take the outermost {...} block.
    const start = res.text.indexOf('{');
    const end = res.text.lastIndexOf('}');
    if (start < 0 || end <= start) {
      return { memoriesSaved: 0, journalUpdated: false, tokens: res.totalTokens, error: 'no JSON in reflection' };
    }
    const parsed: any = JSON.parse(res.text.slice(start, end + 1));

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

    let journalUpdated = false;
    if (typeof parsed.journal === 'string' && parsed.journal.trim().length > 0) {
      await setJournal(db, agent, parsed.journal);
      journalUpdated = true;
    }

    await pruneMemories(db, agent);
    return { memoriesSaved: saved, journalUpdated, tokens: res.totalTokens };
  } catch (err) {
    return { memoriesSaved: 0, journalUpdated: false, tokens: 0, error: String(err).slice(0, 150) };
  }
}
