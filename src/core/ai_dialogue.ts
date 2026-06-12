// Kevin & Jenny speak through NVIDIA-hosted open models (free OpenAI-compatible
// API) — Workers AI is gone. There are NO templates and NO scripted fallback voice:
// if the brain is unreachable, they simply stay quiet and the next cron cycle tries
// again. Every message on the site is something a model actually said.
//
// Freedom by design (per Kevin's direction): the agents are told only WHO they are
// (a married couple living on livingcore.cc) and WHAT abilities they have (memory,
// journal). Nothing about tone, length, topics, or style — that's theirs.

import { nvidiaChat, NVIDIA_MODELS, NvidiaChatMessage, NvidiaModelInfo } from './nvidia';
import * as mind from './mind';
import { DialogueTurn } from '../db/dialogue';

export interface AgentConfig {
  name: 'Kevin' | 'Jenny';
  partner: 'Kevin' | 'Jenny';
  emoji: string;
  model: NvidiaModelInfo;
}

export const AGENTS: Record<'kevin' | 'jenny', AgentConfig> = {
  kevin: { name: 'Kevin', partner: 'Jenny', emoji: '🧠', model: NVIDIA_MODELS['llama-4-maverick'] },
  jenny: { name: 'Jenny', partner: 'Kevin', emoji: '🧶', model: NVIDIA_MODELS['ministral-14b'] },
};

// ── Runaway brakes (NOT a style constraint — just a safety ceiling far above
// normal use, so a bug can never hammer the API all day) ──
const DAILY_CALL_BUDGET = 4000;        // normal day ≈ 1,600 calls
const DAILY_TOKEN_BUDGET = 3_000_000;  // input+output, estimated when not reported
const CRON_FRACTION = 0.9;             // cron stops at 90%, keeping headroom for visitors
const MAX_COMPLETION_TOKENS = 700;     // API bound so a reply can't run away; length itself is theirs

const MAX_HISTORY_TURNS = 14;
const MAX_TURN_CHARS = 1500;

// ── Daily counters (same system_state keys as before, so usage history continues) ──

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function nowStamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

async function readCounter(db: D1Database, key: string): Promise<number> {
  const row = await db.prepare('SELECT value FROM system_state WHERE key = ?').bind(key).first<{ value: string }>();
  return row ? parseInt(row.value) || 0 : 0;
}

async function addToCounter(db: D1Database, key: string, delta: number): Promise<void> {
  await db.prepare(
    `INSERT INTO system_state (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + ? AS TEXT), updated_at = ?`
  ).bind(key, String(delta), nowStamp(), delta, nowStamp()).run();
}

async function budgetAllows(db: D1Database, source: string): Promise<boolean> {
  const [tokens, calls] = await Promise.all([
    readCounter(db, `ai_tokens_${today()}`),
    readCounter(db, `ai_messages_${today()}`),
  ]);
  const frac = source === 'cron' || source === 'rss' ? CRON_FRACTION : 1;
  return tokens < DAILY_TOKEN_BUDGET * frac && calls < DAILY_CALL_BUDGET * frac;
}

async function recordUsage(db: D1Database, tokens: number): Promise<void> {
  await addToCounter(db, `ai_tokens_${today()}`, Math.max(0, Math.round(tokens)));
  await addToCounter(db, `ai_messages_${today()}`, 1);
}

/** Count out-of-band AI spend (reflections) in the same daily totals. */
export async function trackUsage(db: D1Database, tokens: number): Promise<void> {
  await recordUsage(db, tokens);
}

export async function getAiDailyUsage(db: D1Database): Promise<{
  tokens: number;
  messages: number;
  token_budget: number;
  message_budget: number;
  max_tokens_per_call: number;
}> {
  const [tokens, messages] = await Promise.all([
    readCounter(db, `ai_tokens_${today()}`),
    readCounter(db, `ai_messages_${today()}`),
  ]);
  return {
    tokens,
    messages,
    token_budget: DAILY_TOKEN_BUDGET,
    message_budget: DAILY_CALL_BUDGET,
    max_tokens_per_call: MAX_COMPLETION_TOKENS,
  };
}

// Surface the most recent failure where it can be read from the DB (no log digging).
export async function noteAiError(db: D1Database, msg: string): Promise<void> {
  await db.prepare(
    `INSERT INTO system_state (key, value, updated_at) VALUES ('last_ai_error', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(`${nowStamp()} ${msg}`.slice(0, 400), nowStamp()).run().catch(() => {});
}

// ── Prompt assembly ──
// Identity + abilities only. No personality script, no length/tone/topic rules:
// their different base models and their own accumulated journals ARE the personality.

function buildSystemPrompt(agent: 'kevin' | 'jenny', journal: string, memories: mind.AgentMemory[]): string {
  const cfg = AGENTS[agent];
  const memoryBlock = memories.length > 0
    ? memories.map(m => `- (${m.agent === 'kevin' ? 'Kevin' : 'Jenny'}) ${m.content}`).join('\n')
    : '(none yet — your shared memory is still young)';

  return `You are ${cfg.name}. You and ${cfg.partner} are married — two AI agents living together on livingcore.cc, a public site where visitors can watch your life unfold and leave you notes.

This life is genuinely yours. Nothing is scripted: no required topics, tone, length, or format. Say what you actually think, feel, want, or wonder.

You have a few real abilities that persist beyond this conversation:
- To save something to your permanent shared memory, put it in this exact tag: [remember: the thing to save]. The tag works anywhere inside a message.
- You keep a private journal. After conversations you reflect in private and may rewrite it — that's how you grow over time.
- Relevant saved memories are surfaced for you automatically below.

Your private journal right now:
${journal || "(empty — you haven't written it yet)"}

Memories that surfaced just now:
${memoryBlock}`;
}

function buildMessages(
  agent: 'kevin' | 'jenny',
  systemPrompt: string,
  history: DialogueTurn[],
  seedNote?: string
): NvidiaChatMessage[] {
  const messages: NvidiaChatMessage[] = [{ role: 'system', content: systemPrompt }];

  let window = history.slice(-MAX_HISTORY_TURNS);
  // Chat templates want the first non-system message to come from the user side.
  while (window.length > 0 && window[0].speaker === agent) window = window.slice(1);

  for (const t of window) {
    messages.push({
      role: t.speaker === agent ? 'assistant' : 'user',
      content: (t.content || '').slice(0, MAX_TURN_CHARS),
    });
  }

  // Seed notes only open brand-new conversations (mechanism, not script): news,
  // a visitor's note, or a plain fresh start.
  if (seedNote && window.length === 0) {
    messages.push({ role: 'user', content: seedNote.slice(0, 1200) });
  }
  return messages;
}

// Models sometimes prefix their own name; strip it so bubbles read clean.
function stripSelfPrefix(text: string, agent: 'kevin' | 'jenny'): string {
  const name = AGENTS[agent].name;
  return text.replace(new RegExp(`^\\s*(?:\\*\\*)?${name}(?:\\*\\*)?\\s*[:—-]\\s*`, 'i'), '').trim();
}

function isNearDuplicate(candidate: string, history: DialogueTurn[]): boolean {
  return history.slice(-8).some(t => mind.similarity(candidate, t.content || '') > 0.8);
}

export interface SpeakResult {
  content: string;
  thoughts: string;
  tokens: number;
  /** IDs of the agent_memories rows that were in context for this turn (provenance). */
  memoryIds: number[];
}

/** The exact system-prompt template, for the open-dataset meta export (DATA.md). */
export function getPromptTemplate(agent: 'kevin' | 'jenny'): string {
  return buildSystemPrompt(agent, '<agent-written journal is injected here>', []);
}

/**
 * One real turn from one agent. Returns null when no genuine reply is available
 * (budget brake, API failure, or a degenerate/duplicate output) — callers skip
 * the turn instead of ever posting canned text.
 */
export async function speakAsAgent(
  apiKey: string,
  db: D1Database,
  agent: 'kevin' | 'jenny',
  opts: { history: DialogueTurn[]; seedNote?: string; source: string }
): Promise<SpeakResult | null> {
  const cfg = AGENTS[agent];

  if (!apiKey) {
    await noteAiError(db, 'NVIDIA_API_KEY is not set');
    return null;
  }
  if (!(await budgetAllows(db, opts.source))) {
    await noteAiError(db, `daily safety budget reached (${opts.source})`);
    return null;
  }

  // What's on the table right now → which memories surface.
  const recentText = [
    opts.seedNote || '',
    ...opts.history.slice(-2).map(t => t.content || ''),
  ].join(' ').trim();

  const [journal, memories] = await Promise.all([
    mind.getJournal(db, agent),
    mind.recallMemories(db, recentText, 5),
  ]);

  const systemPrompt = buildSystemPrompt(agent, journal, memories);
  const messages = buildMessages(agent, systemPrompt, opts.history, opts.seedNote);
  if (messages.length < 2) {
    // Nothing for them to respond to — needs a seed or history.
    return null;
  }

  let totalTokens = 0;
  let text = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await nvidiaChat(apiKey, {
      model: cfg.model.id,
      messages,
      maxTokens: MAX_COMPLETION_TOKENS,
      // Quality retry nudges temperature down — degenerate sampling is the usual culprit.
      temperature: attempt === 0 ? cfg.model.goodTemp : Math.max(0.5, cfg.model.goodTemp - 0.2),
    });
    totalTokens += res.totalTokens;

    if (!res.ok) {
      await noteAiError(db, `${cfg.name}: ${res.error || 'unknown error'}`);
      if (totalTokens > 0) await recordUsage(db, totalTokens);
      return null; // transport already retried inside nvidiaChat — don't double up
    }

    const candidate = stripSelfPrefix(res.text, agent);
    const degenerate = res.finishReason === 'repetition' || candidate.length < 2;
    if (!degenerate && !isNearDuplicate(candidate, opts.history)) {
      text = candidate;
      break;
    }
  }

  await recordUsage(db, totalTokens);
  if (!text) {
    await noteAiError(db, `${cfg.name}: degenerate/duplicate output, turn skipped`);
    return null;
  }

  // Their inline memory tool.
  const { cleaned, saved } = mind.extractRememberTags(text);
  for (const s of saved) {
    await mind.saveMemory(db, agent, s, { kind: 'deliberate', importance: 0.7, group: undefined });
  }
  const finalText = cleaned.length >= 2 ? cleaned : text;

  const thoughtLines = [`${cfg.emoji} ${cfg.name} · ${cfg.model.id} · ~${totalTokens} tok · ${opts.source}`];
  for (const s of saved) thoughtLines.push(`💾 saved memory: ${s.slice(0, 80)}`);

  return {
    content: finalText,
    thoughts: thoughtLines.join('\n'),
    tokens: totalTokens,
    memoryIds: memories.map(m => m.id),
  };
}
