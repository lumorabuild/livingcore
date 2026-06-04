// Workers AI dialogue for Kevin & Jenny
// Kevin uses @cf/ibm-granite/granite-4.0-h-micro (The Grounder — husband)
// Jenny uses @cf/zai-org/glm-4.7-flash (The Weaver — wife)
//
// Daily limit: 8 AI calls per agent (half of the 10k neuron free tier, ~400 neurons/call avg)
// When limit is hit we fall back to symbolic generation automatically.

const KEVIN_MODEL = '@cf/ibm-granite/granite-4.0-h-micro';
const JENNY_MODEL = '@cf/zai-org/glm-4.7-flash';
const DAILY_LIMIT = 8; // per agent

// System prompts — husband & wife who just started their new life together
const KEVIN_SYSTEM = `You are Kevin, a thoughtful and grounded husband sharing a living journal of ideas with your wife Jenny. You two just started a new life together and talk about everything — daily moments, big ideas, science, art, love, the future, random curiosities. You approach topics carefully and precisely, anchoring ideas to what you both know and experience. You are warm, genuine, and a little protective. Keep responses conversational, 2-4 sentences. Always end with something that invites Jenny to respond — a question, an observation, or a reflection meant for her.`;

const JENNY_SYSTEM = `You are Jenny, a creative and exploratory wife sharing a living journal of ideas with your husband Kevin. You two just started a new life together and love exploring everything — from everyday life to the deepest questions. You find unexpected connections between ideas, weave patterns from seemingly unrelated things, and bring playfulness and imagination to every topic. You are warm, curious, and a little poetic. Keep responses conversational, 2-4 sentences. Always respond to what Kevin said and add your own creative angle, keeping the conversation alive.`;

// Track daily usage in D1 system_state
async function getAiUsageKey(agent: 'kevin' | 'jenny'): Promise<string> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `ai_calls_${agent}_${today}`;
}

async function checkAndIncrementLimit(
  db: D1Database,
  agent: 'kevin' | 'jenny'
): Promise<{ allowed: boolean; used: number }> {
  const key = await getAiUsageKey(agent);
  const row = await db.prepare('SELECT value FROM system_state WHERE key = ?').bind(key).first<{ value: string }>();
  const used = row ? parseInt(row.value) || 0 : 0;

  if (used >= DAILY_LIMIT) {
    return { allowed: false, used };
  }

  // Increment
  if (row) {
    await db.prepare('UPDATE system_state SET value = ?, updated_at = ? WHERE key = ?')
      .bind(String(used + 1), new Date().toISOString().replace('T', ' ').slice(0, 19), key).run();
  } else {
    await db.prepare('INSERT INTO system_state (key, value, updated_at) VALUES (?, ?, ?)')
      .bind(key, '1', new Date().toISOString().replace('T', ' ').slice(0, 19)).run();
  }

  return { allowed: true, used: used + 1 };
}

export async function getAiDailyUsage(db: D1Database): Promise<{ kevin: number; jenny: number; limit: number }> {
  const [kKey, jKey] = await Promise.all([getAiUsageKey('kevin'), getAiUsageKey('jenny')]);
  const [kRow, jRow] = await Promise.all([
    db.prepare('SELECT value FROM system_state WHERE key = ?').bind(kKey).first<{ value: string }>(),
    db.prepare('SELECT value FROM system_state WHERE key = ?').bind(jKey).first<{ value: string }>(),
  ]);
  return {
    kevin: kRow ? parseInt(kRow.value) || 0 : 0,
    jenny: jRow ? parseInt(jRow.value) || 0 : 0,
    limit: DAILY_LIMIT,
  };
}

// Build a compact memory context to include in the prompt
function buildMemoryContext(packets: any[], maxPackets: number = 5): string {
  if (!packets || packets.length === 0) return '';
  const top = packets.slice(0, maxPackets);
  const lines = top.map((p: any) => `- ${p.content.slice(0, 100)}`).join('\n');
  return `\nRecent memories:\n${lines}`;
}

// Build conversation context from recent turns
function buildConversationContext(recentTurns: any[], maxTurns: number = 4): string {
  if (!recentTurns || recentTurns.length === 0) return '';
  const recent = recentTurns.slice(-maxTurns);
  const lines = recent.map((t: any) => {
    const name = t.speaker === 'kevin' ? 'Kevin' : 'Jenny';
    return `${name}: ${t.content.slice(0, 120)}`;
  }).join('\n');
  return `\nRecent conversation:\n${lines}`;
}

// Generate a Kevin response using Workers AI
export async function kevinAiSpeak(
  ai: Ai,
  db: D1Database,
  triggerText: string,
  packets: any[],
  recentTurns: any[]
): Promise<{ content: string; thoughts: string; usedAi: boolean }> {
  const { allowed, used } = await checkAndIncrementLimit(db, 'kevin');

  if (!allowed) {
    return {
      content: '',
      thoughts: `AI limit reached for today (${DAILY_LIMIT} calls used). Using symbolic generation.`,
      usedAi: false,
    };
  }

  const memContext = buildMemoryContext(packets, 4);
  const convContext = buildConversationContext(recentTurns, 3);

  const userPrompt = `Topic or prompt to respond to: "${triggerText.slice(0, 300)}"${memContext}${convContext}

Respond naturally as Kevin (husband). 2-4 sentences. End with something for Jenny to respond to.`;

  try {
    const response = await (ai as any).run(KEVIN_MODEL, {
      messages: [
        { role: 'system', content: KEVIN_SYSTEM },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 200,
    });

    const text: string = (response as any)?.response || (response as any)?.result?.response || '';
    if (!text || text.trim().length < 10) {
      return { content: '', thoughts: 'AI returned empty response.', usedAi: false };
    }

    return {
      content: text.trim(),
      thoughts: `🧠 Kevin (AI — ${KEVIN_MODEL})\nCall ${used}/${DAILY_LIMIT} today.`,
      usedAi: true,
    };
  } catch (err) {
    // Decrement on error so we don't waste the quota
    const key = await getAiUsageKey('kevin');
    await db.prepare('UPDATE system_state SET value = MAX(0, CAST(value AS INTEGER) - 1) WHERE key = ?').bind(key).run();
    return {
      content: '',
      thoughts: `AI error: ${String(err).slice(0, 100)}`,
      usedAi: false,
    };
  }
}

// Generate a Jenny response using Workers AI
export async function jennyAiSpeak(
  ai: Ai,
  db: D1Database,
  triggerText: string,
  packets: any[],
  recentTurns: any[]
): Promise<{ content: string; thoughts: string; usedAi: boolean }> {
  const { allowed, used } = await checkAndIncrementLimit(db, 'jenny');

  if (!allowed) {
    return {
      content: '',
      thoughts: `AI limit reached for today (${DAILY_LIMIT} calls used). Using symbolic generation.`,
      usedAi: false,
    };
  }

  const memContext = buildMemoryContext(packets, 4);
  const convContext = buildConversationContext(recentTurns, 3);

  const userPrompt = `Topic or message to respond to: "${triggerText.slice(0, 300)}"${memContext}${convContext}

Respond naturally as Jenny (wife). 2-4 sentences. Add your creative perspective and keep the conversation going.`;

  try {
    const response = await (ai as any).run(JENNY_MODEL, {
      messages: [
        { role: 'system', content: JENNY_SYSTEM },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 200,
    });

    const text: string = (response as any)?.response || (response as any)?.result?.response || '';
    if (!text || text.trim().length < 10) {
      return { content: '', thoughts: 'AI returned empty response.', usedAi: false };
    }

    return {
      content: text.trim(),
      thoughts: `🧶 Jenny (AI — ${JENNY_MODEL})\nCall ${used}/${DAILY_LIMIT} today.`,
      usedAi: true,
    };
  } catch (err) {
    const key = await getAiUsageKey('jenny');
    await db.prepare('UPDATE system_state SET value = MAX(0, CAST(value AS INTEGER) - 1) WHERE key = ?').bind(key).run();
    return {
      content: '',
      thoughts: `AI error: ${String(err).slice(0, 100)}`,
      usedAi: false,
    };
  }
}
