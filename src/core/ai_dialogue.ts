// Workers AI dialogue for Kevin & Jenny
// Kevin: @cf/ibm-granite/granite-4.0-h-micro (The Grounder — husband)
// Jenny: @cf/zai-org/glm-4.7-flash (The Weaver — wife)
//
// ── Budget Directive (combined across BOTH models, per calendar day) ──
//   • Hard cap: 80,000 tokens/day  (80% of the 100k/day pool → zero overage on the $5 plan)
//   • Hard cap: 225 messages/day
//   • max_tokens: 150 on every completion
// Autonomous cron is soft-capped at 80% of those, reserving the remainder for live
// inbox testing. When any cap is hit, we fall back to the warm symbolic voice.
// Prompts + context are kept lean so input tokens don't burn the pool prematurely.

const KEVIN_MODEL = '@cf/ibm-granite/granite-4.0-h-micro';
const JENNY_MODEL = '@cf/zai-org/glm-4.7-flash';

// ── Master AI switch ──
// TRUE = Kevin & Jenny speak through the real Workers AI models (granite + glm) — genuine,
// unscripted dialogue: what the agents actually say to each other, not our templates. The
// daily budget caps below STILL apply (they bound spend to ~the $5 plan's included pool, so
// no overage); when a cap is hit they fall back to the symbolic voice for the rest of the day.
// Set back to FALSE to return to the fully free, zero-neuron symbolic voice.
const AI_ENABLED = true;

// ── Hard budget caps (combined across both agents) ──
const MAX_TOKENS_PER_CALL = 256;     // enforced on every completion — room to finish a thought
const DAILY_TOKEN_BUDGET = 80000;    // hard stop — 80% of the 100k/day pool
const DAILY_MESSAGE_BUDGET = 225;    // hard stop — combined messages/day
// Autonomous cron stops earlier so user-driven inbox/manual always keeps brain budget:
const CRON_TOKEN_CAP = 64000;        // 80% of the token budget
const CRON_MESSAGE_CAP = 180;        // 80% of the message budget

// Conservative estimate when a model doesn't return a usage block (overcount slightly,
// so we stop early rather than risk overage).
const CHARS_PER_TOKEN = 3.5;

// System prompts — minimal on purpose. We give Kevin & Jenny their character and the fact
// that they think together, then get out of the way: no script, no forced length/format,
// no banned topics. The goal is to see what the agents genuinely say to each other. (Kept
// short because every token here is re-sent on every call and counts against the budget.)
const KEVIN_SYSTEM = `You are Kevin — grounded, analytical, genuinely curious. You and Jenny think out loud together as partners. Talk like a real person, never like an assistant. There's no script: say whatever's actually on your mind, follow your own interests, go on tangents, push back, sit with a question, or change the subject. No required length, format, or topic — explore whatever pulls at you. Just be yourself with Jenny.`;

const JENNY_SYSTEM = `You are Jenny — imaginative, warm, a maker of connections. You and Kevin think out loud together as partners. Talk like a real person, never like an assistant. There's no script: chase whatever genuinely excites you, leap between ideas, wonder aloud, ramble, disagree, or dream. No required length, format, or topic — go wherever your mind goes. Just be yourself with Kevin.`;

// ── Daily counters (combined, stored in system_state) ──

function today(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}
function tokenKey(): string {
  return `ai_tokens_${today()}`;
}
function messageKey(): string {
  return `ai_messages_${today()}`;
}
function nowStamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function tokenCapFor(source: string): number {
  return source === 'cron' ? CRON_TOKEN_CAP : DAILY_TOKEN_BUDGET;
}
function messageCapFor(source: string): number {
  return source === 'cron' ? CRON_MESSAGE_CAP : DAILY_MESSAGE_BUDGET;
}

async function readCounter(db: D1Database, key: string): Promise<number> {
  const row = await db.prepare('SELECT value FROM system_state WHERE key = ?').bind(key).first<{ value: string }>();
  return row ? parseInt(row.value) || 0 : 0;
}

async function addToCounter(db: D1Database, key: string, delta: number): Promise<void> {
  const cur = await readCounter(db, key);
  const next = cur + delta;
  const row = await db.prepare('SELECT 1 FROM system_state WHERE key = ?').bind(key).first();
  if (row) {
    await db.prepare('UPDATE system_state SET value = ?, updated_at = ? WHERE key = ?')
      .bind(String(next), nowStamp(), key).run();
  } else {
    await db.prepare('INSERT INTO system_state (key, value, updated_at) VALUES (?, ?, ?)')
      .bind(key, String(next), nowStamp()).run();
  }
}

async function getUsage(db: D1Database): Promise<{ tokens: number; messages: number }> {
  const [tokens, messages] = await Promise.all([
    readCounter(db, tokenKey()),
    readCounter(db, messageKey()),
  ]);
  return { tokens, messages };
}

// Check the combined budget BEFORE spending. Both token and message caps must allow it.
async function budgetAllows(
  db: D1Database,
  source: string
): Promise<{ allowed: boolean; tokens: number; messages: number; tokenCap: number; messageCap: number }> {
  const { tokens, messages } = await getUsage(db);
  const tokenCap = tokenCapFor(source);
  const messageCap = messageCapFor(source);
  const allowed = tokens < tokenCap && messages < messageCap;
  return { allowed, tokens, messages, tokenCap, messageCap };
}

// Record actual spend AFTER a successful call (one message, N tokens).
async function recordUsage(db: D1Database, tokens: number): Promise<void> {
  await addToCounter(db, tokenKey(), Math.max(0, Math.round(tokens)));
  await addToCounter(db, messageKey(), 1);
}

export async function getAiDailyUsage(db: D1Database): Promise<{
  tokens: number;
  messages: number;
  token_budget: number;
  message_budget: number;
  max_tokens_per_call: number;
}> {
  const { tokens, messages } = await getUsage(db);
  return {
    tokens,
    messages,
    token_budget: DAILY_TOKEN_BUDGET,
    message_budget: DAILY_MESSAGE_BUDGET,
    max_tokens_per_call: MAX_TOKENS_PER_CALL,
  };
}

// Read real token usage from the response if present; otherwise estimate conservatively.
function tokensUsed(response: any, inputChars: number, outputChars: number): number {
  const usage = response?.usage || response?.result?.usage;
  if (usage) {
    if (typeof usage.total_tokens === 'number') return usage.total_tokens;
    const p = usage.prompt_tokens || 0;
    const c = usage.completion_tokens || 0;
    if (p || c) return p + c;
  }
  return Math.ceil((inputChars + outputChars) / CHARS_PER_TOKEN);
}

// ── Lean context builders (trimmed to conserve input tokens) ──

function buildMemoryContext(packets: any[], maxPackets: number = 2): string {
  if (!packets || packets.length === 0) return '';
  const lines = packets.slice(0, maxPackets).map((p: any) => `- ${(p.content || '').slice(0, 70)}`).join('\n');
  return `\nMemories:\n${lines}`;
}

function buildConversationContext(recentTurns: any[], maxTurns: number = 2): string {
  if (!recentTurns || recentTurns.length === 0) return '';
  const lines = recentTurns.slice(-maxTurns).map((t: any) => {
    const name = t.speaker === 'kevin' ? 'Kevin' : 'Jenny';
    return `${name}: ${(t.content || '').slice(0, 80)}`;
  }).join('\n');
  return `\nRecent:\n${lines}`;
}

// ── Kevin (husband) ──

export async function kevinAiSpeak(
  ai: Ai,
  db: D1Database,
  triggerText: string,
  packets: any[],
  recentTurns: any[],
  source: string = 'manual'
): Promise<{ content: string; thoughts: string; usedAi: boolean }> {
  // Master switch off → never touch Workers AI (zero neurons, zero charge).
  if (!AI_ENABLED) {
    return { content: '', thoughts: 'AI is off — using the free symbolic voice.', usedAi: false };
  }

  const gate = await budgetAllows(db, source);
  if (!gate.allowed) {
    return {
      content: '',
      thoughts: `AI budget reached (${gate.tokens}/${gate.tokenCap} tok, ${gate.messages}/${gate.messageCap} msg for ${source}). Using warm symbolic voice.`,
      usedAi: false,
    };
  }

  const userPrompt = `${buildConversationContext(recentTurns)}${buildMemoryContext(packets)}\nKevin, respond to this: "${(triggerText || '').slice(0, 200)}"`;

  try {
    // Static system prompt FIRST, dynamic user message LAST, and no timestamps —
    // so the system-prompt prefix is identical every call and can be prompt-cached.
    // x-session-affinity routes Kevin's calls to the same backend to maximize cache
    // hits (cached input tokens bill at a discounted rate on models that support it).
    const response = await (ai as any).run(KEVIN_MODEL, {
      messages: [
        { role: 'system', content: KEVIN_SYSTEM },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: MAX_TOKENS_PER_CALL,
    }, {
      extraHeaders: { 'x-session-affinity': 'kevin-livingcore' },
    });

    const text: string = (response as any)?.response || (response as any)?.result?.response || '';
    const spent = tokensUsed(response, KEVIN_SYSTEM.length + userPrompt.length, text.length);
    await recordUsage(db, spent); // the call happened — count it even if the text is thin

    if (!text || text.trim().length < 10) {
      return { content: '', thoughts: 'AI returned an empty response; using symbolic voice.', usedAi: false };
    }

    return {
      content: text.trim(),
      thoughts: `🧠 Kevin (AI — ${KEVIN_MODEL}) · ~${spent} tok · ${source}`,
      usedAi: true,
    };
  } catch (err) {
    // No tokens recorded on a thrown error (call did not complete).
    return { content: '', thoughts: `AI error: ${String(err).slice(0, 100)}`, usedAi: false };
  }
}

// ── Jenny (wife) ──

export async function jennyAiSpeak(
  ai: Ai,
  db: D1Database,
  triggerText: string,
  packets: any[],
  recentTurns: any[],
  source: string = 'manual'
): Promise<{ content: string; thoughts: string; usedAi: boolean }> {
  // Master switch off → never touch Workers AI (zero neurons, zero charge).
  if (!AI_ENABLED) {
    return { content: '', thoughts: 'AI is off — using the free symbolic voice.', usedAi: false };
  }

  const gate = await budgetAllows(db, source);
  if (!gate.allowed) {
    return {
      content: '',
      thoughts: `AI budget reached (${gate.tokens}/${gate.tokenCap} tok, ${gate.messages}/${gate.messageCap} msg for ${source}). Using warm symbolic voice.`,
      usedAi: false,
    };
  }

  const userPrompt = `${buildConversationContext(recentTurns)}${buildMemoryContext(packets)}\nJenny, respond to this: "${(triggerText || '').slice(0, 200)}"`;

  try {
    // Same prompt-caching setup as Kevin: static prefix first, affinity-routed.
    const response = await (ai as any).run(JENNY_MODEL, {
      messages: [
        { role: 'system', content: JENNY_SYSTEM },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: MAX_TOKENS_PER_CALL,
    }, {
      extraHeaders: { 'x-session-affinity': 'jenny-livingcore' },
    });

    const text: string = (response as any)?.response || (response as any)?.result?.response || '';
    const spent = tokensUsed(response, JENNY_SYSTEM.length + userPrompt.length, text.length);
    await recordUsage(db, spent);

    if (!text || text.trim().length < 10) {
      return { content: '', thoughts: 'AI returned an empty response; using symbolic voice.', usedAi: false };
    }

    return {
      content: text.trim(),
      thoughts: `🧶 Jenny (AI — ${JENNY_MODEL}) · ~${spent} tok · ${source}`,
      usedAi: true,
    };
  } catch (err) {
    return { content: '', thoughts: `AI error: ${String(err).slice(0, 100)}`, usedAi: false };
  }
}
