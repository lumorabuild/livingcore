// ─────────────────────────────────────────────────────────────────────────────
// A TURN — what Kevin or Jenny actually say and do (spec §4).
//
// speak/planDay/reflect are the island era's per-agent model calls. Each one
// takes the tick's already-fetched dead-model skip set (`gone`) and an
// accumulator array (`goneOut`) that newly-404/410'd model ids are pushed
// onto — src/world/tick.ts marks them all gone ONCE at the end of the tick
// (see store.markGone), rather than every function writing its own row.
//
// `parseTurn` is pure (no DB, no model call) and was already fully
// implemented here before this file was handed off — untouched below.
// ─────────────────────────────────────────────────────────────────────────────

import type { AgentId, ParsedTurn, World } from './types';
import { BIOGRAPHIES, LOCATIONS } from './bio';
import {
  extractRememberTags, getJournal, recallMemories, saveMemory, setJournal,
} from '../core/mind';
import { chainFor, NARRATOR_CHAIN } from './models';
import { NvidiaModelInfo, nvidiaChatChain } from '../core/nvidia';
import {
  agentSystemPrompt, heardTurn, ownTurn, planPrompt, reflectionPrompt, RETRY_NOTE, sceneOpening,
  soloOpening, SOLO_LATER,
} from './prompts';
import {
  addForecast, addNotebook, bumpDailyUsage, getChapter, getInboxContent, getIslandStartedAt,
  getScenesForDay, getSceneTurns, logEvent, searchNotebookRows,
} from './store';
import { blissHits } from './metrics';
import type { IslandEnv } from './tick';
// Lend-a-mind (SPEC4 §A3): donatedChain resolves a signed-in patron's own
// model+key into ready-to-call chain entries that sit IN FRONT OF the free
// NVIDIA chain (never replacing it); recordChainDonations feeds each donor's
// own daily limits and auto-pause-on-errors.
import { donatedChain, recordChainDonations } from './donations';

/** One fully spoken, gated, persisted turn — what speak() returns and tick.ts records via store.insertTurn. */
export interface SpokenTurn {
  thought: string;
  say: string;
  do: string;
  /** [remember: …] tags already extracted and (by speak()) saved as memories. */
  remember: string[];
  make?: { kind: string; title: string };
  model: string;
  /** Set when this turn was spoken by a DONATED model (SPEC4 §A3) — the model_donations.id that answered. */
  donationId?: number;
  /** The donated model's own id — same string as `model` above when donationId is set; kept separately so tick.ts's meta object is self-explanatory. */
  donatedModel?: string;
  tokens: number;
  retries: number;
  retry_reason?: string;
  /** ids of any memories saved from this turn's [remember: …] tags. */
  memoryIds: number[];
  /** ids of any notebook entries this turn's context drew on (store.searchNotebookRows results actually used). */
  notebookIds: number[];
  /** DO/SAY reads as leaving/sleeping — the scene should wrap up soon. */
  endHint: boolean;
  /** DO mentions the radio/shortwave/listening to the news — the transition should carry a radio line. */
  radio: boolean;
  /** The quality gate had to retry, or this turn reads as a stall (empty/near-duplicate DO against the previous partner SAY). */
  stale: boolean;
  /**
   * `mem:<id>` provenance strings for the RECALLED memories that fed this
   * turn's prompt (distinct from `memoryIds`, which is memories newly SAVED
   * by this turn's own [remember: …] tags) — written verbatim to
   * turn_meta.memory_refs / dialogue_turns.related_packet_ids, matching the
   * shape src/routes/exports.ts's dialogue.jsonl already documents
   * (`context_memory_refs`). Additive: not in the original stub interface,
   * needed because tick.ts has no other way to see what was recalled.
   */
  recalledMemoryRefs: string[];
}

const WORD_RE = /[a-z0-9']+/g;

function words(s: string): string[] {
  return (s || '').toLowerCase().match(WORD_RE) || [];
}

function trigramSet(s: string): Set<string> {
  const w = words(s);
  const out = new Set<string>();
  for (let i = 0; i + 2 < w.length; i++) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
  return out;
}

function trigramJaccard(a: string, b: string): number {
  const A = trigramSet(a);
  const B = trigramSet(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = new Set([...A, ...B]).size;
  return union === 0 ? 0 : inter / union;
}

function first5Words(s: string): string {
  return words(s).slice(0, 5).join(' ');
}

const END_HINT_RE = /\b(goes?\s+to\s+bed|falls?\s+asleep|goes?\s+to\s+sleep|walks?\s+(away|off|out)|leaves?|heads?\s+(off|out|back|down|up)\s+to|goes?\s+(off|back)\s+to|storms?\s+off)\b/i;
const RADIO_RE = /\b(radio|shortwave|listens?\s+to\s+the\s+news)\b/i;

function detectEndHint(text: string): boolean {
  return END_HINT_RE.test(text);
}
function detectRadio(text: string): boolean {
  return RADIO_RE.test(text);
}
function isEmptyOrNothing(text: string): boolean {
  const t = (text || '').trim();
  return !t || /^nothing\.?$/i.test(t);
}

// ── Quality gate (spec §4 step 4) ──

interface GateResult {
  ok: boolean;
  reason?: string;
}

function gateCheck(parsed: ParsedTurn, recentSays: string[]): GateResult {
  if (!parsed.say.trim() && !parsed.do.trim()) return { ok: false, reason: 'empty' };
  const opener = first5Words(parsed.say);
  if (opener && recentSays.some((s) => first5Words(s) === opener)) {
    return { ok: false, reason: 'repeated_opener' };
  }
  for (const s of recentSays) {
    if (trigramJaccard(parsed.say, s) > 0.45) return { ok: false, reason: 'near_duplicate' };
  }
  if (blissHits(parsed.say) >= 3) return { ok: false, reason: 'bliss_lexicon' };
  return { ok: true };
}

/** Worse-of-two score for "accept the better of the two" (step 4): totally
 *  silent is worse than merely gate-flagged. */
function severityOf(parsed: ParsedTurn): number {
  return (!parsed.say.trim() && !parsed.do.trim()) ? 2 : 1;
}

interface Attempt {
  ok: boolean;
  text: string;
  modelId: string;
  /** Set when the WINNING model was a donation (SPEC4 §A3). */
  donationId?: number;
  tokens: number;
  gone: string[];
  /** Real HTTP attempts nvidiaChatChain made THIS call (it may have fallen through several dead/overloaded models before landing one) — never assume 1. */
  attempts: number;
  parsed?: ParsedTurn;
  gate?: GateResult;
}

async function attemptSpeak(
  env: IslandEnv,
  chain: NvidiaModelInfo[],
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  gone: Set<string>,
  tempOffset: number,
  agent: AgentId,
  recentSays: string[],
  db: D1Database
): Promise<Attempt> {
  const res = await nvidiaChatChain(env.NVIDIA_API_KEY!, chain, { messages, maxTokens: 700, tempOffset }, {
    timeoutMs: 30000,
    skip: gone,
  });

  // Lend-a-mind bookkeeping (SPEC4 §A3): every donated link THIS call tried
  // is billed to its own donor, win or lose.
  await recordChainDonations(env, res.attempts);

  if (!res.ok) return { ok: false, text: '', modelId: res.model.id, tokens: res.totalTokens, gone: res.gone, attempts: res.attempts.length };
  await bumpDailyUsage(db, res.totalTokens).catch(() => {});
  const parsed = parseTurn(res.text, agent);
  const gate = gateCheck(parsed, recentSays);
  return {
    ok: true, text: res.text, modelId: res.model.id, donationId: res.model.donationId,
    tokens: res.totalTokens, gone: res.gone, attempts: res.attempts.length, parsed, gate,
  };
}

export async function speak(
  env: IslandEnv,
  db: D1Database,
  w: World,
  agent: AgentId,
  gone: Set<string>,
  goneOut: string[],
  /** Real HTTP-attempt counts get pushed here, one entry per attemptSpeak call (1 or 2) — tick.ts sums it for the tick's true request count. */
  callsOut: number[]
): Promise<SpokenTurn | null> {
  if (!env.NVIDIA_API_KEY || !w.scene) return null;
  const scene = w.scene;
  const partner: AgentId = agent === 'kevin' ? 'jenny' : 'kevin';

  const [journal, islandStartedAt, sceneTurns, dayScenes] = await Promise.all([
    getJournal(db, agent),
    getIslandStartedAt(db),
    getSceneTurns(db, scene.id, 40),
    getScenesForDay(db, w.day),
  ]);

  const query = [scene.setup, w.agents[agent].plan.join(' '), w.agents[agent].want].join(' ').slice(0, 400);
  const [memoryRows, notebookRows] = await Promise.all([
    recallMemories(db, query, 5, islandStartedAt || undefined),
    searchNotebookRows(db, query, 6),
  ]);

  const earlierToday = dayScenes
    .filter((s) => s.status === 'closed' && s.summary)
    .slice(-5)
    .map((s) => s.summary as string);

  // Apart mode: this agent is on its own (part 2 spec §A). scene.apart is set
  // by tick.ts's open_scene ONLY when scene.mode === 'apart' — the `apart`
  // const below is that data, or undefined for an ordinary together scene.
  const apart = scene.mode === 'apart' ? scene.apart : undefined;
  const ownTurns = sceneTurns.filter((t) => t.speaker === agent);

  let bottleText: string | undefined;
  // Bottles are read together (they wash up at the beach/dock, not on
  // someone's own patch of the island alone) — an apart scene never gets one.
  if (!apart && scene.bottle_id && sceneTurns.length === 0) {
    bottleText = (await getInboxContent(db, scene.bottle_id)) || undefined;
  }

  const mySetup = apart ? apart[agent].setup : scene.setup;

  const system = agentSystemPrompt({
    world: w,
    agent,
    journal,
    memories: memoryRows.map((m) => m.content),
    notebook: notebookRows.map((n) => n.content),
    earlierToday,
    setup: mySetup,
    bottleText,
    alone: apart ? { partnerWhere: LOCATIONS[apart[partner].location].name } : undefined,
  });

  let merged: { role: 'user' | 'assistant'; content: string }[];

  if (apart) {
    // Solo history: ONLY this agent's own earlier turns in this scene, as
    // assistant messages, separated (and closed off) by SOLO_LATER user
    // messages — the partner's solo turns are elsewhere, and this agent never
    // sees them (spec §A step 4's "the messages are…").
    merged = [{ role: 'user', content: soloOpening(mySetup) }];
    for (const t of ownTurns) {
      merged.push({ role: 'assistant', content: ownTurn(t.thought, t.say, t.action) });
      merged.push({ role: 'user', content: SOLO_LATER });
    }
  } else {
    // Scene history: the opening is the first user message, then the partner's
    // turns arrive as `user`, the agent's own earlier turns as `assistant`,
    // consecutive same-role messages merged with "\n" (spec §4 step 2).
    const historyMsgs: { role: 'user' | 'assistant'; content: string }[] = [
      { role: 'user', content: sceneOpening(scene.setup, bottleText) },
    ];
    for (const t of sceneTurns) {
      if (t.speaker === agent) historyMsgs.push({ role: 'assistant', content: ownTurn(t.thought, t.say, t.action) });
      else historyMsgs.push({ role: 'user', content: heardTurn(t.speaker, t.say, t.action) });
    }
    merged = [];
    for (const m of historyMsgs) {
      const last = merged[merged.length - 1];
      if (last && last.role === m.role) last.content += `\n${m.content}`;
      else merged.push({ ...m });
    }
    if (merged.length && merged[merged.length - 1].role === 'assistant') {
      merged.push({ role: 'user', content: '(…)' });
    }
  }

  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: system },
    ...merged,
  ];

  // The quality gate compares a solo agent only against ITS OWN previous solo
  // turns — the partner isn't in this conversation to repeat or overlap with.
  const recentSays = (apart ? ownTurns : sceneTurns).slice(-6).map((t) => t.say);
  // Lend-a-mind (SPEC4 §A3): any active donation for THIS agent's role goes
  // in FRONT of the free chain, never replacing it — nvidiaChatChain's own
  // fall-through already lets it survive a donated key going bad mid-tick,
  // the exact mechanism that already lets Kevin survive nemotron-3-ultra
  // being down. `avoid` keeps Kevin and Jenny off the same model (ISLAND.md's
  // monoculture rule): never the partner's own primary, and never the model
  // that ACTUALLY answered the partner's last turn in this scene — what was
  // used, not a guess at what will be, so two adjacent turns can't share one.
  // Nothing here can block both sides: each can always fall back to its own
  // free chain.
  const lastPartnerModel = sceneTurns.filter((t) => t.speaker === partner).slice(-1)[0]?.model;
  const avoid = [chainFor(partner)[0].id, ...(lastPartnerModel ? [lastPartnerModel] : [])];
  const donated = await donatedChain(env, agent, avoid).catch(() => []);
  const chain = donated.length ? [...donated, ...chainFor(agent)] : chainFor(agent);

  const first = await attemptSpeak(env, chain, messages, gone, 0, agent, recentSays, db);
  goneOut.push(...first.gone);
  callsOut.push(first.attempts);
  if (!first.ok) return null; // whole chain unreachable this call — tick.ts stops the loop

  let chosen = first;
  let retries = 0;
  let retryReason: string | undefined;

  if (!first.gate!.ok) {
    const retryMessages = [...messages, { role: 'user' as const, content: RETRY_NOTE }];
    const second = await attemptSpeak(env, chain, retryMessages, gone, -0.15, agent, recentSays, db);
    goneOut.push(...second.gone);
    callsOut.push(second.attempts);
    retries = 1;
    if (second.ok && second.gate!.ok) {
      chosen = second;
    } else if (second.ok) {
      // Both failed the gate — accept the better of the two rather than post
      // nothing (spec §4 step 4).
      chosen = severityOf(second.parsed!) <= severityOf(first.parsed!) ? second : first;
      retryReason = chosen.gate!.reason;
    } else {
      chosen = first;
      retryReason = first.gate!.reason;
    }
  }

  const p = chosen.parsed!;

  const memoryIds: number[] = [];
  for (const note of p.remember) {
    const saved = await saveMemory(db, agent, note, { kind: 'deliberate', importance: 0.7, group: scene.id });
    if (saved) {
      const trimmed = note.trim().slice(0, 300);
      const row = await db.prepare(
        `SELECT id FROM agent_memories WHERE agent = ? AND content = ? ORDER BY id DESC LIMIT 1`
      ).bind(agent, trimmed).first<{ id: number }>();
      if (row) memoryIds.push(row.id);
    }
  }

  const doEmpty = isEmptyOrNothing(p.do);
  const partnerTurns = sceneTurns.filter((t) => t.speaker === partner);
  const lastPartnerSay = partnerTurns.length ? partnerTurns[partnerTurns.length - 1].say : '';
  // "Stalled against the partner's last line" makes no sense when apart —
  // there's nobody there to have stalled against.
  const staleByOverlap = !apart && doEmpty && lastPartnerSay ? trigramJaccard(p.say, lastPartnerSay) > 0.3 : false;
  const stale = retries > 0 || staleByOverlap;

  return {
    thought: p.thought,
    say: p.say,
    do: p.do,
    remember: p.remember,
    make: p.make,
    model: chosen.modelId,
    donationId: chosen.donationId,
    donatedModel: chosen.donationId !== undefined ? chosen.modelId : undefined,
    tokens: chosen.tokens,
    retries,
    retry_reason: retryReason,
    memoryIds,
    notebookIds: notebookRows.map((n) => n.id),
    endHint: detectEndHint(`${p.say} ${p.do}`),
    radio: detectRadio(p.do),
    stale,
    recalledMemoryRefs: memoryRows.map((m) => `mem:${m.id}`),
  };
}

// ── Private morning plan (dawn, one call per agent) ──

const VALID_FORECASTS = new Set(['clear', 'cloudy', 'windy', 'rain', 'storm', 'fog', 'heat']);

export async function planDay(
  env: IslandEnv,
  db: D1Database,
  w: World,
  agent: AgentId,
  gone: Set<string>,
  goneOut: string[],
  callsOut: number[]
): Promise<boolean> {
  if (!env.NVIDIA_API_KEY) return false;

  const journal = await getJournal(db, agent);
  let yesterday = '';
  if (w.day > 1) {
    const chapter = await getChapter(db, w.day - 1);
    if (chapter?.body) yesterday = chapter.body.slice(0, 800);
  }

  const { system, user } = planPrompt({ world: w, agent, journal, yesterday });
  const res = await nvidiaChatChain(env.NVIDIA_API_KEY, chainFor(agent), {
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    maxTokens: 400,
  }, { timeoutMs: 25000, skip: gone });
  goneOut.push(...res.gone);
  callsOut.push(res.attempts.length);
  if (!res.ok) return false;
  await bumpDailyUsage(db, res.totalTokens).catch(() => {});

  const text = res.text;
  const planMatch = /PLAN:\s*([\s\S]*?)(?=\n\s*FEELING:|\n\s*FORECAST:|$)/i.exec(text);
  const forecastMatch = /FORECAST:\s*([a-z]+)/i.exec(text);

  const planItems = planMatch
    ? planMatch[1].split(';').map((s) => s.trim()).filter(Boolean).slice(0, 3).map((s) => s.slice(0, 120))
    : [];
  w.agents[agent].plan = planItems;

  const forecast = (forecastMatch ? forecastMatch[1].toLowerCase().trim() : '');
  if (VALID_FORECASTS.has(forecast)) {
    await addForecast(db, { day: w.day + 1, agent, predicted: forecast as any });
  }

  await logEvent(db, {
    day: w.day, slot: w.slot, kind: 'plan', who: agent,
    detail: `${planItems.length} intention${planItems.length === 1 ? '' : 's'} for today.`,
  });

  return true;
}

// ── Night: private reflection (one call per agent) ──

function dedupeChain(...chains: NvidiaModelInfo[][]): NvidiaModelInfo[] {
  const seen = new Set<string>();
  const out: NvidiaModelInfo[] = [];
  for (const c of chains) for (const m of c) {
    if (!seen.has(m.id)) { seen.add(m.id); out.push(m); }
  }
  return out;
}

function parseReflectJson(text: string): { memories?: any[]; journal?: string; lessons?: any[]; want?: string; mood?: number } | null {
  if (!text) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const slice = body.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    try {
      return JSON.parse(slice.replace(/[\u0000-\u001F]+/g, ' '));
    } catch {
      return null;
    }
  }
}

export async function reflect(
  env: IslandEnv,
  db: D1Database,
  w: World,
  agent: AgentId,
  todayMaterial: string,
  gone: Set<string>,
  goneOut: string[],
  callsOut: number[]
): Promise<boolean> {
  if (!env.NVIDIA_API_KEY) return false;

  const journal = await getJournal(db, agent);
  const { system, user } = reflectionPrompt({ world: w, agent, journal, today: todayMaterial });
  // The agent's own voice leads; the narrator chain is added ONLY so a chain
  // that needs to return JSON still can, the same reason reflectOnConversation
  // (src/core/mind.ts, the talking-era equivalent) falls through past Jenny's
  // own model.
  const chain = dedupeChain(chainFor(agent), NARRATOR_CHAIN);

  const res = await nvidiaChatChain(env.NVIDIA_API_KEY, chain, {
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    maxTokens: 800,
  }, {
    timeoutMs: 25000,
    skip: gone,
    accept: (text) => parseReflectJson(text) !== null,
  });
  goneOut.push(...res.gone);
  callsOut.push(res.attempts.length);
  if (!res.ok) return false;
  await bumpDailyUsage(db, res.totalTokens).catch(() => {});

  const parsed = parseReflectJson(res.text);
  if (!parsed) return false;

  const memories = Array.isArray(parsed.memories) ? parsed.memories.slice(0, 3) : [];
  for (const m of memories) {
    await saveMemory(db, agent, String(m?.content || ''), {
      kind: 'reflection',
      importance: typeof m?.importance === 'number' ? m.importance : 0.5,
      group: `day-${w.day}`,
    });
  }

  if (typeof parsed.journal === 'string') {
    await setJournal(db, agent, parsed.journal, `day-${w.day}`);
  }

  const lessons = Array.isArray(parsed.lessons) ? parsed.lessons.slice(0, 2) : [];
  for (const lesson of lessons) {
    if (typeof lesson === 'string' && lesson.trim()) {
      await addNotebook(db, { day: w.day, author: agent, kind: 'lesson', content: lesson });
    }
  }

  if (typeof parsed.want === 'string' && parsed.want.trim()) {
    w.agents[agent].want = parsed.want.trim().slice(0, 200);
  }
  if (typeof parsed.mood === 'number' && Number.isFinite(parsed.mood)) {
    w.agents[agent].mood = Math.max(-5, Math.min(5, parsed.mood));
  }

  return true;
}

// ── parseTurn — pure, fully implemented ──

const LABEL_RE = /(^|\n)[ \t]*[-*]{0,2}\s*\*{0,2}(THOUGHT|SAY|DO)\*{0,2}\s*:?/gi;

function cleanField(raw: string, selfName: string): string {
  let s = (raw || '').trim();
  if (!s) return s;
  // A leading own-name prefix ("Jenny: …", "Jenny - …").
  s = s.replace(new RegExp(`^${selfName}\\s*[:\\-]\\s*`, 'i'), '').trim();
  // Wrapping quotes around the WHOLE field.
  const quoted = /^["'“‘]([\s\S]*)["'”’]$/.exec(s);
  if (quoted) s = quoted[1].trim();
  // Whole-field italics/bold ("*like this*", "**like this**").
  const starred = /^\*{1,2}([\s\S]*)\*{1,2}$/.exec(s);
  if (starred) s = starred[1].trim();
  return s;
}

/** Cuts a field the moment it starts writing the partner's line — never the model's to write. */
function cutAtPartnerLine(text: string, partnerName: string): string {
  if (!text) return text;
  const partnerLineStart = new RegExp(`^\\s*${partnerName}\\s*:`, 'i');
  const attributed = new RegExp(`\\b${partnerName}\\s+(says?|said|whispers?|shouts?|murmurs?|replies?|answers?)\\b`, 'i');
  const lines = text.split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    if (partnerLineStart.test(line) || attributed.test(line)) break;
    kept.push(line);
  }
  return kept.join('\n').trim();
}

const MAKE_PATTERNS: RegExp[] = [
  /\bmakes?\s+(?:an?\s+)?([a-z][\w -]{1,30}?)\s*:\s*([^.\n]{2,90})/i,
  /\bwrites?\s+(?:an?\s+)?([a-z][\w -]{1,30}?)\s+(?:called|titled)\s+["“]?([^."”\n]{2,90})["”]?/i,
  /\bdraws?\s+(?:an?\s+)?([a-z][\w -]{1,30}?)\s+of\s+([^.\n]{2,90})/i,
  /\bsketch(?:es)?\s+(?:an?\s+)?([a-z][\w -]{1,30}?)\s+of\s+([^.\n]{2,90})/i,
];

/*
  Natural phrasings of making something, beyond the explicit "make <kind>:"
  form the prompt teaches. The first local day ran 46 turns with Jenny
  sketching the dinghy and Kevin listing parts, and NOTHING was made, because
  models write "sketch the transom damage", not "make sketch: transom damage".
  The verb decides the kind; the object becomes the title. Deliberately narrow
  on the object side: "make a fire", "draw water" and "write it down" must not
  turn into artifacts, so each pattern needs an artifact noun or a real object.
*/
const NATURAL_MAKE: { re: RegExp; kind: (m: RegExpExecArray) => string; title: (m: RegExpExecArray) => string }[] = [
  // "writes a poem about the tide", "write a letter to Tom", "start a song for Jenny"
  {
    re: /\b(?:writes?|writing|starts?|starting|composes?|composing|scribbles?|jots?(?:\s+down)?)\s+(?:a|an|the|another|her|his|their)?\s*(?:short\s+|quick\s+|little\s+|new\s+)?(poem|song|letter|story|recipe|list|note|report|plan|entry|verse|lullaby|shanty|log entry)\b\s*(?:about|for|to|on|called|titled|of)?\s*([^.;\n]{0,80})/i,
    kind: m => m[1].toLowerCase() === 'verse' || m[1].toLowerCase() === 'lullaby' ? 'poem' : m[1].toLowerCase() === 'shanty' ? 'song' : m[1].toLowerCase(),
    title: m => m[2],
  },
  // "sketches the transom", "sketching a noddy chick", "draws a map of the west shore"
  {
    // Verb forms only: "drawing"/"chart"/"map" as NOUNS ("tapes the drawing up",
    // "checks the chart") must not mint an artifact.
    re: /\b(?:sketch(?:es|ing)?|draws?|drafts?|drafting|maps out|charts out)\s+(?:a|an|the|another|her|his)?\s*((?:quick\s+|rough\s+)?(?:map|diagram|plan|chart|blueprint|picture|drawing|sketch)\s+of\s+)?([a-z][^.;\n]{2,80})/i,
    kind: m => {
      const lead = m[0].toLowerCase();
      const noun = (m[1] || '').toLowerCase();
      if (/map|chart/.test(noun) || /\b(?:maps|charts) out\b/.test(lead)) return 'map';
      if (/diagram|blueprint|plan/.test(noun) || /draft/.test(lead)) return 'diagram';
      return 'sketch';
    },
    title: m => m[2],
  },
];

/** Objects that look like artifacts but are not (drawing water, charting a course by eye). */
const NOT_AN_ARTIFACT = /^(?:(?:her|his) knees|a deep|water|breath|a breath|a line under|blood|lots|straws?|near|closer|attention|conclusions?|a blank|the curtains?|a bath|back|up|out|in)\b/i;

const KNOWN_KINDS = new Set(['poem', 'song', 'letter', 'story', 'recipe', 'list', 'note', 'report', 'plan', 'entry', 'log entry',
  'sketch', 'drawing', 'map', 'diagram', 'painting', 'chart', 'blueprint', 'design', 'journal page']);

function extractMake(doText: string): { kind: string; title: string } | null {
  for (const re of MAKE_PATTERNS) {
    const m = re.exec(doText);
    if (m) {
      const kind = m[1].trim().toLowerCase();
      // "make coffee: strong" / "makes tea: ..." are not artifacts — only known kinds count.
      if (!KNOWN_KINDS.has(kind)) continue;
      return { kind, title: m[2].trim().replace(/["“”]+$/g, '').trim() };
    }
  }
  for (const p of NATURAL_MAKE) {
    const m = p.re.exec(doText);
    if (!m) continue;
    const title = (p.title(m) || '').trim().replace(/^(?:about|for|to|on|of)\s+/i, '').replace(/["“”]+$/g, '').replace(/\s+(?:and|while|then|before|as)\s.*$/i, '').trim();
    if (NOT_AN_ARTIFACT.test(title)) continue;
    const kind = p.kind(m);
    return { kind, title: title ? title.charAt(0).toUpperCase() + title.slice(1, 80) : kind };
  }
  return null;
}

/** Cuts at the nearest sentence boundary before `max`, so a cap never lands mid-word. */
function capAtSentence(s: string, max: number): string {
  const t = (s || '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return (lastStop > max * 0.5 ? cut.slice(0, lastStop + 1) : cut).trim();
}

/**
 * Parses a raw `THOUGHT: … SAY: … DO: …` reply. Tolerates missing labels
 * (case-insensitively, with `**bold**`, a leading `-`, or a missing colon),
 * strips wrapping quotes/asterisks and a leading own-name prefix, cuts off
 * the moment either SAY or DO starts writing the partner's line, extracts
 * `[remember: …]` tags from every field, and finds a `make <kind>: <title>`
 * request in DO. Caps: thought ≤800, say ≤700, do ≤240 (sentence-boundary
 * aware). Pure — never touches the DB or a model.
 */
export function parseTurn(text: string, agent: AgentId): ParsedTurn {
  const partner: AgentId = agent === 'kevin' ? 'jenny' : 'kevin';
  const partnerName = BIOGRAPHIES[partner].name;
  const selfName = BIOGRAPHIES[agent].name;
  const cleaned = (text || '').replace(/\r\n/g, '\n');

  const positions: { label: 'THOUGHT' | 'SAY' | 'DO'; index: number; contentStart: number }[] = [];
  LABEL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LABEL_RE.exec(cleaned))) {
    const leading = m[1] ? m[1].length : 0;
    positions.push({ label: m[2].toUpperCase() as 'THOUGHT' | 'SAY' | 'DO', index: m.index + leading, contentStart: m.index + m[0].length });
  }

  const fields: Record<'THOUGHT' | 'SAY' | 'DO', string> = { THOUGHT: '', SAY: '', DO: '' };
  if (positions.length === 0) {
    // No labels at all — treat the whole reply as SAY (missing SAY → everything not in THOUGHT/DO is SAY).
    fields.SAY = cleaned.trim();
  } else {
    for (let i = 0; i < positions.length; i++) {
      const start = positions[i].contentStart;
      const end = i + 1 < positions.length ? positions[i + 1].index : cleaned.length;
      const value = cleaned.slice(start, end).trim();
      fields[positions[i].label] = fields[positions[i].label] ? `${fields[positions[i].label]}\n${value}` : value;
    }
    const hasSay = positions.some((p) => p.label === 'SAY');
    if (!hasSay) {
      const before = cleaned.slice(0, positions[0].index).trim();
      if (before) fields.SAY = before;
    }
  }

  let thought = cleanField(fields.THOUGHT, selfName);
  let say = cutAtPartnerLine(cleanField(fields.SAY, selfName), partnerName);
  let doText = cutAtPartnerLine(cleanField(fields.DO, selfName), partnerName);

  const t1 = extractRememberTags(thought);
  const t2 = extractRememberTags(say);
  const t3 = extractRememberTags(doText);
  thought = t1.cleaned;
  say = t2.cleaned;
  doText = t3.cleaned;
  const remember = [...t1.saved, ...t2.saved, ...t3.saved].slice(0, 3);

  const make = extractMake(doText) || undefined;

  return {
    thought: capAtSentence(thought, 800),
    say: capAtSentence(say, 700),
    do: capAtSentence(doText, 240),
    remember,
    make,
  };
}
