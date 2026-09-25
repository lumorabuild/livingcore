// ─────────────────────────────────────────────────────────────────────────────
// THE NARRATOR — the world's answer to a scene, never a character (spec §5).
//
// Every function here takes the tick's `gone` skip set and a `goneOut`
// accumulator (newly-404/410'd model ids), same convention as agent.ts —
// tick.ts marks them all gone once, at the end of the tick.
// ─────────────────────────────────────────────────────────────────────────────

import { BIOGRAPHIES, LOCATIONS, LOCATION_IDS } from './bio';
import type { Job, LocationId, NextScene, Slot, Transition, World } from './types';
import { SLOTS } from './types';
import type { IslandEnv } from './tick';
import { CHAPTER_CHAIN, NARRATOR_CHAIN, chainFor } from './models';
import { NvidiaModelInfo, nvidiaChatChain } from '../core/nvidia';
import {
  CHAPTER_SYSTEM, NARRATOR_SYSTEM, TransitionPromptInput, chapterUserPrompt, makePrompt, morningUserPrompt,
  transitionUserPrompt,
} from './prompts';
import {
  assignApartPlaces, barometerLine, clampTransition, conditionsText, decideMode, pickEvent, resolveLocation, rolls,
} from './sim';
import {
  bumpDailyUsage, getBottleTextsForScenes, getEventsForDay, getRadioCache, getScenesForDay, getSceneTurns,
  insertArtifact, listArtifacts, logEvent, nextBottleAtSea, putDayMetrics, searchNotebook, setBottle, setSystemState, upsertChapter,
} from './store';
import { updateInboxStatus } from '../db/dialogue';
import { computeDayMetrics } from './metrics';
import { sanitizeSvg } from './svg';

/*
  ⚠️ REAL BUG, FOUND + FIXED LIVE 2026-09-25 (a tick-firing verification run
  got stuck for 5+ minutes across 4 consecutive ticks, then recurred a
  second time later in the same run): when every model in NARRATOR_CHAIN
  fails a scene-close call, transition() returned null, and the OUTER
  job-retry system (tick.ts) retried the identical call up to 3 more times
  before giving up and dropping the job — but `w.scene` (still sitting at
  its own target_turns) was never touched, so the VERY NEXT tick just
  re-queued close_scene and repeated the same doomed cycle FOREVER, each
  pass burning most of a tick's wall budget for zero progress.

  Root cause, confirmed with a temporary system_state('last_error')
  diagnostic (since job_dropped's own event text carried no reason — now
  logged permanently below, so a future occurrence needs no such diagnostic
  ever again): NVIDIA's API was degraded for stretches of this session.
  First occurrence — `diffusiongemma-26b` (the chain's primary) answered
  HTTP 200 but its text was rejected by accept() (not valid transition
  JSON), and the next two links, `gpt-oss-20b` and `gemma-4-31b`, both
  hard-timed-out at 45s. Second occurrence, ~50 minutes later: the SAME
  three failed the SAME way, and this time `nemotron-3-super` (a link that
  had been working) timed out too — all four attempted links dead in one
  call. Both times this fallback path is what actually closed the scene and
  kept the day moving (confirmed live via the `last_fallback` write below).

  "The model is fully unavailable" was never hypothetical on this island —
  HomePage.tsx already has a whole "the island is quiet" concept for
  exactly this — but the scene-close path had no equivalent: no amount of
  retrying gets you out of a truly-down API. fallbackTransition() below is
  that equivalent — a deterministic, model-free "quiet stretch" transition,
  used only once transition()'s own two real attempts (see below) have both
  failed. Every delta in it is a genuine no-op (0, or each agent's OWN
  current location) so a scene nobody actually narrated never silently
  gains, loses or moves anything; the narrator picks the real story back up
  the moment a model answers again.
*/
function fallbackTransition(w: World, nextSlot: Slot): Transition {
  return {
    // Honest mechanism text, not story: code never writes narration (see the file header).
    summary: 'No narrator was available, so nothing about this stretch was recorded.',
    outcomes: [],
    resources: { water_l: 0, food_days: 0, firewood: 0 },
    agents: {
      kevin: { energy: 0, hunger: 0, mood: 0, location: w.agents.kevin.location },
      jenny: { energy: 0, hunger: 0, mood: 0, location: w.agents.jenny.location },
    },
    xp: [],
    projects: [],
    items: [],
    discoveries: [],
    newly_discovered: [],
    interludes: { kevin: '', jenny: '' },
    next: {
      slot: nextSlot,
      location: 'cottage',
      title: 'A Quiet Stretch',
      setup: 'Back at the cottage.',
      together: true,
    },
  };
}

function nextSlotOf(slot: Slot): Slot {
  const idx = SLOTS.indexOf(slot);
  return SLOTS[(idx + 1) % SLOTS.length];
}

function dedupeChain(...chains: NvidiaModelInfo[][]): NvidiaModelInfo[] {
  const seen = new Set<string>();
  const out: NvidiaModelInfo[] = [];
  for (const c of chains) for (const m of c) {
    if (!seen.has(m.id)) { seen.add(m.id); out.push(m); }
  }
  return out;
}

function clampLen(s: string, max: number): string {
  const t = (s || '').trim();
  return t.length <= max ? t : t.slice(0, max).trim();
}

function isDiscovered(id: string, w: World): id is LocationId {
  return (LOCATION_IDS as string[]).includes(id) && w.discovered.includes(id as LocationId);
}

/** Pulls the first JSON object out of a reply, tolerating a ```json fence and
 *  raw control characters inside string values (both models we run on do
 *  this — see src/core/mind.ts's parseReflectionJson for the same trick). */
function extractJson(text: string): any | null {
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

/** Picks the world event for the UPCOMING scene, resolving which pending
 *  bottle (if any) a 'bottle' pick refers to. Shared by transition() and
 *  morningSetup(), both of which need "what does the world do next". */
async function pickUpcomingEvent(
  db: D1Database,
  w: World,
  stale: boolean
): Promise<{ picked: ReturnType<typeof pickEvent>; bottle: { id: number; content: string } | null }> {
  const nextBottle = await nextBottleAtSea(db);
  let picked = pickEvent(w, { stale, bottlePending: false });
  if (!picked && nextBottle) picked = pickEvent(w, { stale, bottlePending: true });
  const bottle = picked?.kind === 'bottle' && nextBottle ? nextBottle : null;
  return { picked, bottle };
}

// ── transition() — one scene-boundary call ──

export interface TransitionEvent {
  kind: string;
  text: string;
  bottleInboxId?: number;
}

export async function transition(
  env: IslandEnv,
  db: D1Database,
  w: World,
  transcript: string,
  gone: Set<string>,
  goneOut: string[],
  callsOut: number[]
): Promise<{ t: Transition; model: string; event: TransitionEvent | null } | null> {
  if (!env.NVIDIA_API_KEY || !w.scene) return null;
  const scene = w.scene;
  const nextSlot = nextSlotOf(w.slot);
  const nextDay = nextSlot === 'dawn' ? w.day + 1 : w.day;

  const r = rolls();
  const stale = scene.stale >= 2;
  // Together or apart is decided by code (see decideMode in sim.ts for why).
  const mode = decideMode(w, nextSlot);
  const places = mode === 'apart' ? assignApartPlaces(w) : undefined;
  const { picked, bottle } = await pickUpcomingEvent(db, w, stale);

  let radioText: string | null = null;
  if (w.radio_requested) {
    const cache = await getRadioCache(db);
    if (cache && cache.titles.length) {
      const headline = cache.titles[Math.floor(Math.random() * cache.titles.length)];
      radioText = `"${headline}" — and ${barometerLine(w)}`;
    }
  }

  const notebookFacts = await searchNotebook(db, `${scene.location} ${scene.title}`, 5);
  const hiddenIds = LOCATION_IDS.filter((id) => !w.discovered.includes(id));
  const hiddenPlaces = hiddenIds.map((id) => `${LOCATIONS[id].name} (${LOCATIONS[id].hiddenHint || 'unknown'})`).join('; ');

  const input: TransitionPromptInput = {
    world: w,
    transcript,
    rolls: r,
    nextSlot,
    nextDay,
    event: picked?.text ?? null,
    radio: radioText,
    plans: { kevin: w.agents.kevin.plan.join('; '), jenny: w.agents.jenny.plan.join('; ') },
    hiddenPlaces,
    notebook: notebookFacts,
    // `scene` is still the SCENE THAT JUST CLOSED here — w.scene isn't nulled
    // until later in tick.ts's runCloseSceneJob, well after this call returns
    // — so its own mode says whether the transcript above is one shared
    // conversation or two solo tracks (part 2 spec §A).
    sceneWasApart: scene.mode === 'apart',
    mode,
    places,
  };
  const user = `${transitionUserPrompt(input)}\n\n${conditionsText(w, r)}`;
  const chain = NARRATOR_CHAIN;

  // The most recent answer a model gave that accept() refused — kept so a failed
  // transition can be diagnosed from the DB (system_state last_rejected_transition).
  let lastRejected = '';
  const attempt = async (u: string) => {
    const res = await nvidiaChatChain(env.NVIDIA_API_KEY!, chain, {
      messages: [{ role: 'system', content: NARRATOR_SYSTEM }, { role: 'user', content: u }],
      maxTokens: 1400,
      temperature: 0.6,
    }, {
      timeoutMs: 45000,
      skip: gone,
      accept: (text) => {
        const parsed = extractJson(text);
        if (!(parsed && typeof parsed.summary === 'string' && parsed.next_scene && typeof parsed.next_scene.setup === 'string')) { lastRejected = `[shape] ${text}`; return false; }
        if (mode === 'apart' && places) {
          // An answer that writes someone's solo setup somewhere OTHER than the
          // place code assigned would put the figure at the dock and the words at
          // the cottage (nemotron-3-ultra did exactly that, 2/2). Treat it like
          // bad JSON: the chain moves on to the next model.
          const ns = parsed.next_scene;
          const fits = (e: any, id: 'kevin' | 'jenny') =>
            !!e && typeof e.setup === 'string' && (!e.location || resolveLocation(e.location, w) === places[id]);
          const ok = fits(ns.kevin ?? ns.apart?.kevin, 'kevin') && fits(ns.jenny ?? ns.apart?.jenny, 'jenny');
          if (!ok) lastRejected = `[places ${JSON.stringify(places)}] ${text}`;
          return ok;
        }
        return true;
      },
    });
    goneOut.push(...res.gone);
    callsOut.push(res.attempts.length);
    return res;
  };

  let res = await attempt(user);
  let usedFallback = false;
  let t: Transition | null = null;
  let modelId = '';

  if (!res.ok) {
    await setSystemState(db, 'last_error', `transition: every model failed (attempt 1) — ${res.error || 'no error text'}`).catch(() => {});
    if (lastRejected) await setSystemState(db, 'last_rejected_transition', lastRejected.slice(0, 4000)).catch(() => {});
  } else {
    await bumpDailyUsage(db, res.totalTokens).catch(() => {});
    const raw = extractJson(res.text);
    t = raw ? clampTransition(raw, w, nextSlot, mode, places) : null;
    modelId = res.model.id;
  }

  if (!t) {
    const retryUser = `${user}\n\n[Your last reply could not be used — it must be ONE JSON object matching the schema exactly, with a non-empty next_scene.setup. Try again.]`;
    const res2 = await attempt(retryUser);
    if (res2.ok) {
      await bumpDailyUsage(db, res2.totalTokens).catch(() => {});
      const raw2 = extractJson(res2.text);
      t = raw2 ? clampTransition(raw2, w, nextSlot, mode, places) : null;
      if (t) modelId = res2.model.id;
    } else if (res.ok) {
      // Only the RETRY's transport failed; still worth a record, since the
      // one above only fires for the FIRST attempt.
      await setSystemState(db, 'last_error', `transition: every model failed (attempt 2) — ${res2.error || 'no error text'}`).catch(() => {});
    }
    if (!t) {
      // See fallbackTransition()'s header comment: every model in the chain
      // failed twice over (a real, reproduced failure mode — 2026-09-25),
      // so fall back to a deterministic, model-free "quiet stretch" rather
      // than returning null and leaving the CALLER stuck retrying the exact
      // same doomed call forever.
      t = fallbackTransition(w, nextSlot);
      modelId = 'fallback:models-unavailable';
      usedFallback = true;
      // `last_fallback` (src/index.ts's /health) was READ from day one but
      // never WRITTEN anywhere — this is that hook, finally wired up.
      await setSystemState(db, 'last_fallback', `close_scene at day ${w.day} ${w.slot}: every model failed twice, used the quiet-stretch fallback`).catch(() => {});
      await logEvent(db, {
        day: w.day, slot: w.slot, kind: 'quiet_transition', who: 'world',
        detail: 'No model answered — the scene closed quietly on its own.',
        data_json: null, scene_id: scene.id,
      });
    }
  }

  if (picked && !usedFallback) {
    await logEvent(db, {
      day: w.day, slot: w.slot, kind: picked.kind, who: 'world', detail: picked.text,
      data_json: picked.data ? JSON.stringify(picked.data) : null, scene_id: scene.id,
    });
  }

  return {
    t,
    model: modelId,
    event: picked && !usedFallback ? { kind: picked.kind, text: picked.text, bottleInboxId: bottle?.id } : null,
  };
}

// ── morningSetup() — the day's first scene when no transition precedes it ──

export async function morningSetup(
  env: IslandEnv,
  db: D1Database,
  w: World,
  yesterday: string,
  gone: Set<string>,
  goneOut: string[],
  callsOut: number[]
): Promise<NextScene | null> {
  if (!env.NVIDIA_API_KEY) return null;

  const { picked, bottle } = await pickUpcomingEvent(db, w, false);
  const user = morningUserPrompt(w, yesterday, picked?.text ?? null);
  const chain = NARRATOR_CHAIN;

  const res = await nvidiaChatChain(env.NVIDIA_API_KEY, chain, {
    messages: [{ role: 'system', content: NARRATOR_SYSTEM }, { role: 'user', content: user }],
    maxTokens: 500,
    temperature: 0.6,
  }, { timeoutMs: 40000, skip: gone, accept: (text) => !!extractJson(text) });
  goneOut.push(...res.gone);
  callsOut.push(res.attempts.length);
  if (!res.ok) return null;
  await bumpDailyUsage(db, res.totalTokens).catch(() => {});

  const raw = extractJson(res.text);
  if (!raw) return null;

  const location = resolveLocation(raw.location, w) ?? ('cottage' as LocationId);
  const title = clampLen(String(raw.title || ''), 70) || 'A new day';
  const setup = clampLen(String(raw.setup || ''), 600);
  if (!setup) return null;

  if (picked) {
    await logEvent(db, {
      day: w.day, slot: w.slot, kind: picked.kind, who: 'world', detail: picked.text,
      data_json: picked.data ? JSON.stringify(picked.data) : null, scene_id: null,
    });
  }

  return {
    slot: w.slot,
    location,
    title,
    setup,
    event: picked?.kind,
    bottle_id: bottle?.id,
  };
}

// ── writeChapter() — the end-of-day chapter, quote-checked ──

function normalizeQuote(s: string): string {
  return s.toLowerCase().replace(/[.,!?;:"'""''—–-]/g, '').replace(/\s+/g, ' ').trim();
}

function extractQuotedSpans(text: string): string[] {
  const out: string[] = [];
  const re = /[""]([^""]{12,})[""]|"([^"]{12,})"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const span = (m[1] || m[2] || '').trim();
    if (span.length >= 12) out.push(span);
  }
  return out;
}

function quotesVerify(body: string, sayLines: string[]): boolean {
  const spans = extractQuotedSpans(body);
  if (!spans.length) return true;
  const haystack = sayLines.map(normalizeQuote).join(' | ');
  return spans.every((s) => haystack.includes(normalizeQuote(s)));
}

function stripUnverifiedQuoteSentences(body: string, sayLines: string[]): string {
  const spans = extractQuotedSpans(body);
  const haystack = sayLines.map(normalizeQuote).join(' | ');
  const badSpans = spans.filter((s) => !haystack.includes(normalizeQuote(s)));
  if (!badSpans.length) return body;
  const sentences = body.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((sentence) => !badSpans.some((bad) => sentence.includes(bad)));
  const out = kept.join(' ').trim();
  return out || body; // never return an empty chapter — an unverifiable chapter with the bad lines removed beats nothing
}

export async function writeChapter(
  env: IslandEnv,
  db: D1Database,
  day: number,
  gone: Set<string>,
  goneOut: string[],
  callsOut: number[]
): Promise<boolean> {
  if (!env.NVIDIA_API_KEY) return false;

  const [scenes, events, artifactsPage] = await Promise.all([
    getScenesForDay(db, day),
    getEventsForDay(db, day),
    listArtifacts(db, 50, 0),
  ]);
  const dayArtifacts = artifactsPage.filter((a) => a.day === day);
  const closedScenes = scenes.filter((s) => s.status === 'closed');

  // A scene's bottle note (if it had one) is a SECOND verified quote source,
  // alongside the day's actual SAY lines — without this, a chapter that
  // quotes the note's real words (rather than inventing "don't come to the
  // cove") gets its own honest quote stripped by quotesVerify below, which
  // only ever knew about spoken lines.
  const bottleTexts = await getBottleTextsForScenes(db, closedScenes.map((s) => s.id));

  const sayLines: string[] = [];
  for (const s of closedScenes) {
    if (sayLines.length >= 60) break;
    const turns = await getSceneTurns(db, s.id, 40);
    for (const t of turns) {
      if (t.say.trim()) sayLines.push(`${BIOGRAPHIES[t.speaker].name}: "${t.say.trim()}"`);
      if (sayLines.length >= 60) break;
    }
  }
  const quoteSources = [...sayLines, ...Object.values(bottleTexts)];

  const sceneMaterial = closedScenes
    .map((s) => `SCENE: ${s.title} (${s.slot})\nSetup: ${s.setup}\nSummary: ${s.summary || '(none)'}`)
    .join('\n\n') || '(no scenes recorded)';
  const eventMaterial = events.length ? events.map((e) => `- ${e.detail}`).join('\n') : '(none)';
  const artifactMaterial = dayArtifacts.length
    ? dayArtifacts.map((a) => `- ${BIOGRAPHIES[a.maker].name} made a ${a.kind}: "${a.title}"`).join('\n')
    : '(none)';
  const bottleMaterial = Object.keys(bottleTexts).length
    ? Object.values(bottleTexts).map((text) => `BOTTLE NOTE (exact text): "${text.replace(/"/g, "'")}"`).join('\n')
    : '';

  const material = [
    sceneMaterial,
    `EVENTS\n${eventMaterial}`,
    `THINGS MADE\n${artifactMaterial}`,
    bottleMaterial,
    `EXACT LINES SPOKEN (quote only from here, word for word)\n${sayLines.join('\n') || '(nothing spoken)'}`,
  ].filter(Boolean).join('\n\n');

  const user = chapterUserPrompt(day, material);
  const chain = CHAPTER_CHAIN;

  const attempt = async (u: string) => {
    const res = await nvidiaChatChain(env.NVIDIA_API_KEY!, chain, {
      messages: [{ role: 'system', content: CHAPTER_SYSTEM }, { role: 'user', content: u }],
      maxTokens: 900,
    }, { timeoutMs: 60000, skip: gone, accept: (text) => !!extractJson(text) });
    goneOut.push(...res.gone);
    callsOut.push(res.attempts.length);
    return res;
  };

  const res = await attempt(user);
  if (!res.ok) return false;
  await bumpDailyUsage(db, res.totalTokens).catch(() => {});

  let parsed = extractJson(res.text);
  if (!parsed) return false;

  let winnerModel = res.model.id;
  let title = clampLen(String(parsed.title || ''), 80);
  let body = String(parsed.body || '').trim();

  if (!quotesVerify(body, quoteSources)) {
    const res2 = await attempt(`${user}\n\n[Some quotes were not exact. Only quote words that appear in the transcript.]`);
    if (res2.ok) {
      await bumpDailyUsage(db, res2.totalTokens).catch(() => {});
      const p2 = extractJson(res2.text);
      if (p2) {
        title = clampLen(String(p2.title || title), 80) || title;
        body = String(p2.body || body).trim();
        winnerModel = res2.model.id;
      }
    }
    if (!quotesVerify(body, quoteSources)) {
      body = stripUnverifiedQuoteSentences(body, quoteSources);
    }
  }

  if (!title) title = `Day ${day}`;
  body = clampLen(body, 2400);
  if (body.length < 80) return false;

  const stats = await computeDayMetrics(db, day);
  const statsJson = JSON.stringify(stats);
  // Stored in BOTH places (spec §7): chapters.stats_json rides along with the
  // prose for the /day/:n page, and metrics_daily is the independent,
  // day-keyed series /lab charts across every day without joining chapters
  // (and outlives a chapter row if one is ever hand-edited or regenerated).
  await Promise.all([
    upsertChapter(db, { day, title, body, model: winnerModel, stats_json: statsJson }),
    putDayMetrics(db, day, statsJson),
  ]);
  return true;
}

// ── makeArtifact() ──

export async function makeArtifact(
  env: IslandEnv,
  db: D1Database,
  w: World,
  job: Job,
  gone: Set<string>,
  goneOut: string[],
  callsOut: number[]
): Promise<boolean> {
  if (job.kind !== 'make') return false;
  if (!env.NVIDIA_API_KEY) return false;

  const { agent, artifactKind, title, sceneId, bottleId, context } = job;
  const { system, user, visual } = makePrompt({ agent, kind: artifactKind, title, world: w, context: context || '' });

  // Maker's own chain first (their voice); a visual (SVG) kind also falls
  // through to the narrator chain, since drawing quality isn't a persona
  // trait the way prose voice is (spec §5).
  const chain = visual ? dedupeChain(chainFor(agent), NARRATOR_CHAIN) : chainFor(agent);

  const accept = visual
    ? (text: string) => sanitizeSvg(text) !== null
    : (text: string) => {
        const t = text.trim();
        return t.length >= 20 && t.length <= 2000 && !/^<svg/i.test(t);
      };

  const res = await nvidiaChatChain(env.NVIDIA_API_KEY, chain, {
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    maxTokens: visual ? 1600 : 900,
  }, { timeoutMs: 30000, skip: gone, accept });
  goneOut.push(...res.gone);
  callsOut.push(res.attempts.length);
  if (!res.ok) return false;
  await bumpDailyUsage(db, res.totalTokens).catch(() => {});

  const content = visual ? sanitizeSvg(res.text) : res.text.trim().slice(0, 2000);
  if (!content) return false;

  const artifactId = await insertArtifact(db, {
    day: w.day,
    maker: agent,
    kind: artifactKind,
    title: clampLen(title, 100) || artifactKind,
    content,
    format: visual ? 'svg' : 'text',
    scene_id: sceneId,
    inbox_id: bottleId ?? null,
    model: res.model.id,
  });

  if (bottleId) {
    await setBottle(db, bottleId, { status: 'answered', reply_artifact_id: artifactId });
    await updateInboxStatus(db, bottleId, 'discussed');
  }

  await logEvent(db, {
    day: w.day, slot: w.slot, kind: 'made', who: agent,
    detail: `${BIOGRAPHIES[agent].name} made a ${artifactKind}: "${title}".`, scene_id: sceneId,
  });

  return true;
}
