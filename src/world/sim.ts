// ─────────────────────────────────────────────────────────────────────────────
// THE WORLD ITSELF — deterministic code, no model calls.
//
// Design rule (src/world/types.ts, docs/ISLAND.md): the WORLD is the clock,
// the weather, the water, the food, the fatigue, the dice. The MODELS only
// supply what Kevin and Jenny think/say/do (src/world/agent.ts) and how the
// world answers what they did (src/world/narrator.ts). Everything below is
// pure or DB-only (scoreForecasts) — nothing here ever calls NVIDIA.
//
// Two conventions worth knowing before reading clampTransition/applyTransition:
//   • `Transition.resources` and `Transition.agents[x].{energy,hunger,mood}`
//     hold CLAMPED DELTAS, not totals — the narrator prompt (prompts.ts)
//     explicitly asks for "numbers are CHANGES, not totals", and
//     applyTransition adds them onto the world's current values (clamping
//     again defensively). `Transition.agents[x].location/health/condition`
//     ARE absolute (a place, a state, a note), because "where you ended up"
//     and "how you are" are not deltas.
//   • `w.hidden` (pressure/trend) is the barometer's hidden driver. Falling
//     pressure predicting rain is a LEARNABLE rule: the agents see the
//     barometer reading (barometerLine) but never the word "pressure" tied
//     to a forecast — their own forecasts (agent.ts's plan()) are scored
//     against it via scoreForecasts, which is the real, measurable learning
//     curve the /lab page charts.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  AgentId, AgentState, Health, Item, LocationId, NotebookRow, Project, ProjectStatus,
  Season, Slot, Transition, Weather, WeatherKind, World,
} from './types';
import { AGENT_IDS, SLOTS } from './types';
import { BIOGRAPHIES, LOCATIONS, LOCATION_IDS, SKILLS, Skill, skillLevel } from './bio';
import { similarity } from '../core/mind';
import { scoreForecasts } from './store';
import { activityFromDo } from './activity';

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function clampNum(n: unknown, min: number, max: number): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return clamp(v, min, max);
}

function clampStr(s: string, max: number): string {
  const t = (s || '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return (lastStop > max * 0.5 ? cut.slice(0, lastStop + 1) : cut).trim();
}

/**
 * The narrator may not write Kevin's or Jenny's dialogue (prompts.ts's
 * NARRATOR_SYSTEM says so), but a model can still slip a line like `Kevin
 * says, "…"` into a setup or an interlude. Strip any line that attributes
 * quoted speech to either of them.
 */
function stripAttributedSpeech(text: string): string {
  const lines = (text || '').split(/\n+/);
  const kept = lines.filter((line) => {
    const attributed = /\b(kevin|jenny)\s+(says?|said|whispers?|shouts?|murmurs?|replies?|answers?)\b/i.test(line);
    const quoted = /["“][^"”]*["”]/.test(line);
    return !(attributed && quoted);
  });
  return kept.join('\n').trim();
}

/** A world event before it has an id/day/slot/scene_id — the caller (narrator.ts / tick.ts) fills those in and calls store.logEvent(s). */
export interface EventSeed {
  kind: string;
  who?: string;
  detail: string;
  data_json?: string | null;
}

// ── initWorld ──

export function initWorld(nowIsoStr: string): World {
  let seq = 1;

  const discovered = LOCATION_IDS.filter((id) => LOCATIONS[id].discoveredAtStart);

  const agents = {} as Record<AgentId, AgentState>;
  for (const id of AGENT_IDS) {
    const bio = BIOGRAPHIES[id];
    agents[id] = {
      location: 'cottage',
      energy: 80,
      hunger: 20,
      mood: 1,
      health: 'well',
      condition: '',
      activity: 'resting',
      xp: { ...bio.xp },
      plan: [],
      want: bio.want,
      interlude: '',
    };
  }

  const items: Item[] = [
    { id: `item-${seq++}`, name: 'the shortwave radio', note: 'on the shelf in the cottage', where: 'cottage', found_day: 1 },
    { id: `item-${seq++}`, name: 'the barometer', note: 'old brass aneroid', where: 'cottage', found_day: 1 },
    { id: `item-${seq++}`, name: 'the dinghy', note: 'no engine', where: 'dock', found_day: 1 },
    { id: `item-${seq++}`, name: "Jenny's seed tin", note: "grandmother's seeds, mostly unplanted", where: 'garden', found_day: 1 },
    { id: `item-${seq++}`, name: 'basic tools', note: '', where: 'cottage', found_day: 1 },
    { id: `item-${seq++}`, name: 'a water test kit', note: 'six strips left', where: 'cottage', found_day: 1 },
  ];

  const projects: Project[] = [
    { id: `proj-${seq++}`, name: 'the garden', owners: ['jenny', 'kevin'], progress: 5, status: 'idea', started_day: 1, note: 'talked about for months; half weeds' },
  ];

  return {
    v: 1,
    day: 1,
    slot: 'dawn',
    season: 'dry',
    weather: { kind: 'clear', intensity: 0, temp_c: 27, line: 'Clear and warm, the trade wind steady' },
    resources: { water_l: 160, food_days: 6, firewood: 8 },
    items,
    discovered,
    agents,
    projects,
    supply: { due_day: 4, delayed_days: 0 },
    scene: null,
    jobs: [{ kind: 'plan', agent: 'kevin' }, { kind: 'plan', agent: 'jenny' }, { kind: 'open_scene' }],
    next: null,
    last_bottle_day: 0,
    hidden: { pressure: 1015, trend: 0 },
    recent_events: [],
    radio_requested: false,
    seq,
    updated_at: nowIsoStr,
  };
}

// ── Weather ──

const PRESSURE_MIN = 975;
const PRESSURE_MAX = 1038;

const WEATHER_LINES: Record<WeatherKind, string[]> = {
  clear: ['A clear sky, the trade wind steady.', 'Bright and calm, barely a cloud in it.', 'Clean light, a light onshore breeze.'],
  cloudy: ['Grey and still, the air heavy.', 'A flat sky, cloud cover thickening.', 'Overcast, nothing falling yet.'],
  windy: ['A hard wind out of the south-east, spray coming off the reef.', 'Gusty and loud in the palms all day.'],
  rain: ['Rain coming in hard from the west.', 'Steady rain, the tank filling.', 'Warm rain, on and off.'],
  storm: ['A squall building fast, the barometer dropping.', 'Real weight in the wind now — a storm is close.'],
  fog: ['Fog off the water, the lighthouse invisible.', 'A thick mist, sound carrying strangely.'],
  heat: ['Flat calm and brutal heat, the air shimmering over the sand.', 'No wind at all, the sun punishing.'],
};

function pickLine(kind: WeatherKind): string {
  const options = WEATHER_LINES[kind];
  // No trailing stop: every reader appends ", 28°C" (the first page read "nothing falling yet., 28°C").
  return options[Math.floor(Math.random() * options.length)].replace(/[.!]+$/, '');
}

function deriveWeatherKind(pressure: number, trend: number, season: Season, slot: Slot): WeatherKind {
  const roll = Math.random();
  if (slot === 'night' && pressure > 1008 && roll < 0.12) return 'fog';
  const fallingFast = trend <= -2.2;
  const rising = trend >= 1.5;
  if (fallingFast) {
    if (pressure < 995) return roll < 0.4 ? 'storm' : 'rain';
    return roll < 0.5 ? 'rain' : 'cloudy';
  }
  if (pressure < 1000) return roll < 0.35 ? 'rain' : 'cloudy';
  if (pressure > 1022 && season === 'dry') return roll < 0.4 ? 'heat' : 'clear';
  if (season === 'wet' && roll < 0.35) return roll < 0.15 ? 'rain' : 'cloudy';
  if (rising && roll < 0.5) return 'clear';
  if (roll < 0.15) return 'windy';
  return roll < 0.6 ? 'clear' : 'cloudy';
}

function deriveIntensity(kind: WeatherKind, pressure: number, trend: number): number {
  if (kind === 'storm') return pressure < 985 ? 3 : 2;
  if (kind === 'rain') return trend <= -3 ? 2 : 1;
  if (kind === 'heat' || kind === 'fog' || kind === 'windy') return 1;
  return 0;
}

function deriveTemp(kind: WeatherKind, season: Season, slot: Slot): number {
  const base = season === 'dry' ? 29 : 27;
  const slotAdj: Record<Slot, number> = { dawn: -4, morning: -1, midday: 3, afternoon: 2, evening: -1, night: -3 };
  let t = base + slotAdj[slot];
  if (kind === 'heat') t += 3;
  if (kind === 'rain' || kind === 'storm') t -= 2;
  if (kind === 'fog') t -= 1;
  return Math.round(t);
}

/**
 * One bounded random walk step on the hidden pressure, with momentum (so it
 * trends across several slots rather than jittering), then derives the kind
 * the agents actually feel. Mutates nothing — callers assign the result.
 */
export function stepWeather(w: World): { weather: Weather; hidden: { pressure: number; trend: number } } {
  const h = w.hidden;
  let trend = clamp(h.trend * 0.6 + (Math.random() - 0.5) * 3, -4, 4);
  let pressure = clamp(h.pressure + trend + (w.season === 'wet' ? -0.3 : 0.2), PRESSURE_MIN, PRESSURE_MAX);
  // A wall bounce: pressure pinned at either edge should start trending back.
  if (pressure <= PRESSURE_MIN + 1) trend = Math.abs(trend) || 1;
  if (pressure >= PRESSURE_MAX - 1) trend = -Math.abs(trend) || -1;

  const kind = deriveWeatherKind(pressure, trend, w.season, w.slot);
  const intensity = deriveIntensity(kind, pressure, trend);
  const temp_c = deriveTemp(kind, w.season, w.slot);

  return { weather: { kind, intensity, temp_c, line: pickLine(kind) }, hidden: { pressure, trend } };
}

/** Shown to the agents. The rule linking it to rain (falling → rain soon) is theirs to learn — never spelled out here. */
export function barometerLine(w: World): string {
  const { pressure, trend } = w.hidden;
  const dir = trend > 1 ? 'rising' : trend < -1 ? 'falling' : 'steady';
  return `The barometer reads ${Math.round(pressure)} hPa and ${dir}.`;
}

// ── Tide ──
// A ~12.4h semi-diurnal cycle mapped onto the six slots (approximate hours of
// day below), so the tide visibly shifts ~50 min/day the way a real one does.

const SLOT_HOUR: Record<Slot, number> = { dawn: 6, morning: 9, midday: 12, afternoon: 15, evening: 18, night: 21 };
const TIDE_PERIOD_H = 12.4;

export function tide(day: number, slot: Slot): 'low' | 'rising' | 'high' | 'falling' {
  const hours = (day - 1) * 24 + SLOT_HOUR[slot];
  const phase = ((hours % TIDE_PERIOD_H) / TIDE_PERIOD_H) * Math.PI * 2;
  const height = Math.cos(phase); // 1 = high, -1 = low
  const isRising = Math.sin(phase) < 0; // d(cos)/d(phase) = -sin
  if (height > 0.7) return 'high';
  if (height < -0.7) return 'low';
  return isRising ? 'rising' : 'falling';
}

/**
 * Hidden rules told ONLY to the narrator for adjudication, never to the
 * agents directly — they learn them from outcomes, not from being handed the
 * rulebook. See prompts.ts's transitionUserPrompt, which folds this in.
 */
export function conditionsText(w: World, rolls: Record<AgentId, number>): string {
  const t = tide(w.day, w.slot);
  return [
    `Tide: ${t}.`,
    'Hidden rules that should shape the RESULTS below (do not state these as rules — let the outcomes reflect them): ' +
      'fishing from the dock is good on a rising tide at dawn or evening, poor at midday; ' +
      'the tide pools are only workable at low tide, and flood fast as it turns; ' +
      'the spring is safe to drink once boiled, but untreated water gives a stomach upset roughly one time in three; ' +
      'seedlings die in salt wind unless sheltered; ' +
      'the rain tank gains roughly (rain intensity × 25 litres) per slot of rain or storm, capacity 400; ' +
      'coconuts need climbing (some risk of a fall) or a pole; ' +
      `the sea cave and the wreck on the reef are reachable only at low tide (right now: ${t}).`,
    `Dice: Kevin rolled ${rolls.kevin}, Jenny rolled ${rolls.jenny} (d20 + the relevant skill level; 15+ clear success, 10-14 partial, 9 or less fails).`,
    barometerLine(w),
  ].join('\n');
}

// ── advanceSlot ──

/** Moves the world one slot forward and applies the passive drains of that slot. Mutates `w`. Never changes `w.day` — that's newDay's job. */
export function advanceSlot(w: World): EventSeed[] {
  const events: EventSeed[] = [];
  const endingSlot = w.slot;
  const idx = SLOTS.indexOf(endingSlot);
  const nextSlot = SLOTS[(idx + 1) % SLOTS.length];

  const { weather, hidden } = stepWeather(w);
  w.weather = weather;
  w.hidden = hidden;

  const r = w.resources;
  const rainGain = (weather.kind === 'rain' || weather.kind === 'storm') ? weather.intensity * 25 : 0;
  r.water_l = clamp(r.water_l - 3 + rainGain, 0, 400);
  if (rainGain > 0) events.push({ kind: 'weather', detail: `The rain tank gained about ${rainGain} litres.` });
  r.food_days = Math.max(0, r.food_days - 0.17);

  const isHeat = weather.kind === 'heat';
  const mealTime = endingSlot === 'morning' || endingSlot === 'evening';
  // Verified (part 2 follow-up, alongside the clampAgentDelta tightening
  // above): this DOES lower hunger whenever food exists — checked against
  // food_days AFTER the passive drain a few lines up (so a meal never eats
  // food that already ran out this slot), and the -35 below runs strictly
  // after the +12 passive rise, netting -23 on a meal slot. The "hunger
  // pinned at 100" bug was the narrator's OWN oversized deltas swamping this,
  // not a defect here — see clampAgentDelta's comment.
  const ateMeal = mealTime && r.food_days >= 0.3;
  if (ateMeal) r.food_days = Math.max(0, r.food_days - 0.33);

  for (const id of AGENT_IDS) {
    const a = w.agents[id];
    a.hunger = clamp(a.hunger + 12, 0, 100);
    a.energy = clamp(a.energy - (isHeat ? 10 : 6), 0, 100);
    a.mood = a.mood + (0 - a.mood) * 0.2;
    if (ateMeal) a.hunger = clamp(a.hunger - 35, 0, 100);
  }
  if (ateMeal) events.push({ kind: 'meal', detail: 'Kevin and Jenny ate.' });
  if (r.water_l < 50) events.push({ kind: 'low_water', detail: 'The tank is below 50 litres.' });
  if (r.food_days < 1) events.push({ kind: 'low_food', detail: 'Under a day of food left in the pantry.' });

  w.slot = nextSlot;
  return events;
}

// ── newDay ──

const SUPPLY_EXTRAS = [
  'a crate of seed potatoes', 'a spare spark plug', 'a letter from the trust',
  'a box of fishing line and hooks', 'a bundle of old newspapers', 'a new water test kit',
];

/**
 * Advances the day, restores sleep, heals, flips the season on schedule, and
 * runs the supply boat. Scores yesterday's forecasts against the dawn weather
 * that has just arrived (needs the DB — this is the one non-pure function
 * here, and it never calls a model). Mutates `w`; returns event seeds.
 */
export async function newDay(db: D1Database, w: World): Promise<EventSeed[]> {
  const events: EventSeed[] = [];
  const newDayNumber = w.day + 1;

  await scoreForecasts(db, newDayNumber, w.weather.kind).catch(() => {});

  w.day = newDayNumber;
  w.slot = 'dawn';

  for (const id of AGENT_IDS) {
    const a = w.agents[id];
    let restore = 60;
    if (a.hunger > 75) restore -= 20;
    if (a.health === 'sick' || a.health === 'hurt') restore -= 15;
    a.energy = clamp(a.energy + restore, 0, 100);

    if (a.health === 'hurt' && Math.random() < 0.5) {
      a.health = 'well'; a.condition = '';
      events.push({ kind: 'healed', who: id, detail: `${BIOGRAPHIES[id].name}'s injury has healed.` });
    } else if (a.health === 'sick' && Math.random() < 0.6) {
      a.health = 'well'; a.condition = '';
      events.push({ kind: 'healed', who: id, detail: `${BIOGRAPHIES[id].name} is well again.` });
    }
  }

  if (w.day % 15 === 1) {
    w.season = w.season === 'dry' ? 'wet' : 'dry';
    events.push({ kind: 'season', detail: `The season has turned ${w.season}.` });
  }

  const dueToday = w.day >= w.supply.due_day + w.supply.delayed_days;
  if (dueToday) {
    const badWeather = (w.weather.kind === 'storm' || w.weather.kind === 'windy') && w.weather.intensity >= 2;
    if (badWeather) {
      const delay = 1 + Math.floor(Math.random() * 2);
      w.supply.delayed_days += delay;
      events.push({ kind: 'supply_delayed', detail: 'The supply boat is held back by weather.' });
    } else {
      w.resources.food_days += 10;
      w.resources.firewood += 6;
      if (Math.random() < 0.4) {
        const extra = SUPPLY_EXTRAS[Math.floor(Math.random() * SUPPLY_EXTRAS.length)];
        w.items.push({ id: `item-${w.seq++}`, name: extra, note: 'off the supply boat', where: 'dock', found_day: w.day });
      }
      w.supply = { due_day: w.day + 10, delayed_days: 0 };
      events.push({ kind: 'supply_arrived', detail: 'The supply boat came.' });
    }
  }

  return events;
}

// ── Dice ──

export function rolls(): Record<AgentId, number> {
  return { kevin: 1 + Math.floor(Math.random() * 20), jenny: 1 + Math.floor(Math.random() * 20) };
}

// ── World events ──

export interface PickedEvent {
  kind: string;
  text: string;
  data?: Record<string, unknown>;
}

const EVENT_TABLE: { kind: string; text: string; weight: (w: World) => number }[] = [
  { kind: 'squall', text: 'A sudden squall sweeps through — wind first, then a wall of rain.', weight: (w) => (w.weather.kind === 'storm' || w.weather.kind === 'rain') ? 3 : 0.3 },
  { kind: 'driftwood', text: 'A tangle of driftwood and flotsam has washed up on the beach.', weight: () => 1.5 },
  { kind: 'lost_crate', text: 'A wooden crate from some lost container ship rolls in the surf.', weight: () => 0.5 },
  { kind: 'fish_run', text: 'A fish run is moving through the shallows off the dock.', weight: (w) => tide(w.day, w.slot) === 'rising' ? 2 : 1 },
  { kind: 'dolphins', text: 'A pod of dolphins passes close off the point.', weight: () => 1 },
  { kind: 'jellyfish', text: 'A jellyfish bloom has drifted into the bay, pale and slow.', weight: () => 0.7 },
  { kind: 'turtle', text: 'A turtle has hauled out on the beach to nest, in the dark.', weight: (w) => w.slot === 'night' ? 1.5 : 0 },
  { kind: 'coconut_crab', text: 'A coconut crab has been at the garden overnight.', weight: () => 1 },
  { kind: 'rat', text: 'A rat has gotten into the pantry.', weight: () => 1 },
  { kind: 'fruit', text: 'Fruit is ripening in the woods — you can smell it before you see it.', weight: () => 1 },
  { kind: 'tree_down', text: 'A tree has come down across the path in the wind.', weight: (w) => w.weather.intensity >= 2 ? 1.5 : 0.2 },
  { kind: 'tool_break', text: 'A tool has broken from wear.', weight: () => 0.8 },
  { kind: 'radio_voice', text: 'The shortwave crackles with a voice, or static, at an odd hour.', weight: () => 0.6 },
  { kind: 'lighthouse_light', text: 'A light is seen at the old lighthouse, after dark — there is an ordinary explanation, found slowly, not yet this scene.', weight: (w) => w.slot === 'night' ? 0.3 : 0 },
  { kind: 'logbook', text: 'An old logbook page turns up, salt-stained and half legible.', weight: (w) => (w.discovered.includes('cave') || w.discovered.includes('wreck')) ? 1 : 0 },
  { kind: 'chick_fallen', text: 'A seabird chick has fallen from the cliff ledges.', weight: () => 0.6 },
  { kind: 'injury', text: 'Something goes wrong in the middle of the work — a slip, a cut, a wrenched ankle.', weight: () => 0.4 },
];

/**
 * Base chance 0.25 (+0.25 if the scene went stale). A pending bottle forces
 * itself at up to 0.6 once at least a day has passed since the last one. Keeps
 * `w.recent_events` (last 8 kinds) to bias away from repeats; mutates it when
 * it returns an event.
 *
 * `giftPending` (patrons, spec §A2) is the sibling of `bottlePending`, forcing
 * the EXISTING `lost_crate` flavour kind (never a second event kind) so a gift
 * crate reuses the same "something washed up" mechanism a bottle already
 * proves out — never more than one forced special delivery a day, and
 * BOTTLES HAVE FIRST CLAIM: the bottle check above runs first and returns
 * immediately when it fires, so a gift only ever gets a turn when no bottle
 * is due this scene. The caller supplies the crate's own flavour text
 * (world/gifts.ts#craftCrateEventText — different wording per item category)
 * and the ids the transition/tick pipeline needs to actually deliver it —
 * this function only decides WHETHER it fires, never what's inside it.
 */
export function pickEvent(
  w: World,
  opts: { stale: boolean; bottlePending: boolean; giftPending?: { text: string; giftId: string; itemId: string } }
): PickedEvent | null {
  if (opts.bottlePending && (w.day - w.last_bottle_day) >= 1 && Math.random() < 0.6) {
    const picked: PickedEvent = { kind: 'bottle', text: 'A bottle has washed up on the south beach, sealed with wax.' };
    pushRecent(w, picked.kind);
    return picked;
  }

  if (opts.giftPending && (w.day - (w.last_crate_day || 0)) >= 1 && Math.random() < 0.6) {
    const picked: PickedEvent = {
      kind: 'lost_crate',
      text: opts.giftPending.text,
      data: { giftId: opts.giftPending.giftId, itemId: opts.giftPending.itemId },
    };
    pushRecent(w, picked.kind);
    return picked;
  }

  let chance = 0.25;
  if (opts.stale) chance += 0.25;
  if (Math.random() >= chance) return null;

  const pool = EVENT_TABLE.filter((e) => e.weight(w) > 0);
  const preferred = pool.filter((e) => !w.recent_events.includes(e.kind));
  const candidates = preferred.length ? preferred : pool;
  if (!candidates.length) return null;

  const weighted = candidates.map((e) => ({ e, wt: Math.max(0.01, e.weight(w)) }));
  const total = weighted.reduce((s, x) => s + x.wt, 0);
  let r = Math.random() * total;
  let chosen = weighted[weighted.length - 1].e;
  for (const { e, wt } of weighted) {
    r -= wt;
    if (r <= 0) { chosen = e; break; }
  }

  pushRecent(w, chosen.kind);
  return { kind: chosen.kind, text: chosen.text };
}

function pushRecent(w: World, kind: string): void {
  w.recent_events.push(kind);
  if (w.recent_events.length > 8) w.recent_events = w.recent_events.slice(-8);
}

// ── clampTransition ──

const SKILL_ALIASES: Record<string, Skill> = {
  'first aid': 'first_aid', firstaid: 'first_aid', medicine: 'first_aid', medical: 'first_aid',
  engine: 'mechanics', engineering: 'mechanics', repair: 'mechanics', repairing: 'mechanics', mechanic: 'mechanics',
  carpentry: 'building', construction: 'building', boatbuilding: 'building',
  sailing: 'navigation', boating: 'navigation', seamanship: 'navigation', navigating: 'navigation',
  plants: 'botany', 'plant identification': 'botany',
  planting: 'gardening', farming: 'gardening',
  art: 'drawing', sketching: 'drawing', illustration: 'drawing',
  gathering: 'foraging', foodfinding: 'foraging',
  radios: 'radio', communications: 'radio',
  songwriting: 'music', singing: 'music',
  journaling: 'writing', storytelling: 'writing',
  'catching fish': 'fishing', angling: 'fishing',
};

function normalizeSkill(name: string): Skill | null {
  const n = (name || '').trim().toLowerCase();
  if (!n) return null;
  if ((SKILLS as readonly string[]).includes(n)) return n as Skill;
  if (SKILL_ALIASES[n]) return SKILL_ALIASES[n];
  for (const s of SKILLS) if (n.includes(s) || n.includes(s.replace('_', ' '))) return s;
  return null;
}

/*
  ⚠️ THE NARRATOR WRITES PLACES AS WORDS, NOT IDS. Measured on a local run
  (2026-09-25): 14 scenes in a row opened at the cottage, and every "apart"
  midday silently fell back to "together", because the model answered
  "the dock" / "the spring intake" / "the interior woods" and the validator
  only accepted the exact id ("dock"). Rejected → default → the cottage,
  forever — which also meant nobody ever walked anywhere to fish or chop.

  resolveLocation() maps what a person would write to a place id: the id
  itself, the place's display name, or a word that clearly means it. It
  still returns null for somewhere undiscovered — finding a place is earned.
*/
const PLACE_WORDS: [LocationId, RegExp][] = [
  ['cottage', /\b(cottage|kitchen|porch|house|home|stove|bedroom|indoors|inside)\b/],
  ['garden', /\bgarden|seedbed|vegetable bed|planting beds?\b/],
  ['dock', /\b(dock|jetty|pier|dinghy|mooring|landing)\b/],
  ['beach', /\b(south beach|beach|sand|shore(?:line)?|strand)\b/],
  ['tidepools', /\btide ?pools?|rock shel(?:f|ves)|rock pools?\b/],
  ['woods', /\b(woods?|forest|trees|interior|bracken|scrub|palms?|grove|undergrowth|tree ?line)\b/],
  ['spring', /\b(spring|stream|water source|intake|basin)\b/],
  ['hilltop', /\b(hill ?top|hill|summit|cairn|lookout|high point)\b/],
  ['cliffs', /\b(cliffs?|colony|ledges?|seabirds?|north point)\b/],
  ['lighthouse', /\blighthouse\b/],
  ['cave', /\b(sea )?cave\b/],
  ['wreck', /\b(wreck|reef|hulk)\b/],
  ['cove', /\b(hidden )?cove\b/],
  ['shrine', /\b(shrine|ring of stones|standing stones|weathered stones|the old stones)\b/],
];

export function resolveLocation(raw: unknown, w: World): LocationId | null {
  const text = String(raw ?? '').toLowerCase().trim();
  if (!text) return null;
  const known = (id: LocationId) => w.discovered.includes(id);
  if ((LOCATION_IDS as string[]).includes(text)) return known(text as LocationId) ? (text as LocationId) : null;
  for (const id of LOCATION_IDS) {
    const name = LOCATIONS[id].name.toLowerCase();
    if (text === name || text === name.replace(/^the /, '') || text.includes(name.replace(/^the /, ''))) return known(id) ? id : null;
  }
  for (const [id, re] of PLACE_WORDS) {
    if (re.test(text)) return known(id) ? id : null;
  }
  return null;
}

function isDiscoveredLocation(id: string, w: World): id is LocationId {
  return (LOCATION_IDS as string[]).includes(id) && w.discovered.includes(id as LocationId);
}

function isValidWhere(where: unknown): where is LocationId | 'carried' {
  return where === 'carried' || (typeof where === 'string' && (LOCATION_IDS as string[]).includes(where));
}

/** Lower-case, no articles or punctuation: "the old Barometer." and "barometer" are one thing. */
function normItemName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(?:the|a|an|old|small|little|my|our)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

function matchProject(name: string, projects: Project[]): Project | undefined {
  const norm = name.trim().toLowerCase();
  return projects.find((p) => p.name.trim().toLowerCase() === norm) || projects.find((p) => similarity(name, p.name) >= 0.5);
}

/*
  ⚠️ TIGHTENED 2026 (part 2 follow-up, from a 3-day simulation run): a
  3-day run pinned hunger at 100 for both agents while food_days kept
  climbing — the narrator's own ±40/±60 hunger swing per SCENE was landing on
  top of advanceSlot's already-correct per-SLOT drain (+12) and meal relief
  (-35 at morning/evening when food is available — see advanceSlot in this
  file), so a model reaching for a big number ("famished after the long
  climb": -60 or +60) could swamp six slots' worth of the code-side economy
  in one scene. Meals are entirely code-side (advanceSlot) on purpose —
  narrator hunger/energy deltas exist for what actually happened IN the
  scene (a hard climb, a missed meal, a nap), not for simulating metabolism,
  so the range only needs to cover one scene's worth of exertion.
*/
function clampAgentDelta(raw: any, w: World, id: AgentId): Transition['agents'][AgentId] {
  const me = w.agents[id];
  const health: Health | undefined = raw?.health && ['well', 'tired', 'hurt', 'sick'].includes(raw.health) ? raw.health : undefined;
  const location: LocationId = resolveLocation(raw?.location, w) ?? me.location;
  return {
    energy: clampNum(raw?.energy, -25, 20),
    hunger: clampNum(raw?.hunger, -40, 15),
    mood: clampNum(raw?.mood, -3, 3),
    location,
    health,
    condition: raw?.condition !== undefined ? clampStr(String(raw.condition), 120) : undefined,
  };
}

/**
 * Clamps one side of `next_scene.apart` (spec §A). Returns null when the
 * location isn't a place they've actually discovered, or `doing`/`setup`
 * come back empty after clamping — either way the caller falls back to
 * together rather than send an agent somewhere invalid or give them nothing
 * to open on.
 */
function clampApartEntry(raw: any, w: World): { location: LocationId; doing: string; setup: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const location = resolveLocation(raw.location, w);
  if (!location) return null;
  const doing = clampStr(String(raw.doing || ''), 80);
  const setup = clampStr(stripAttributedSpeech(String(raw.setup || '')), 400);
  if (!doing || !setup) return null;
  return { location, doing, setup };
}

/**
 * Validates and clamps everything the narrator returned. Returns null ONLY
 * when there is no usable next_scene.setup — the caller (narrator.ts's
 * transition()) should retry once or fall back rather than post nothing.
 */
/*
  WHO DECIDES WHETHER THEY ARE APART: CODE, NOT THE NARRATOR.

  The first cut let the narrator choose ("together": false) and asked it
  nicely. Across a 90-tick, 3.5-day verification run it chose apart ZERO
  times — asked "what happens next?", a model keeps the couple in the same
  room, because that is where the story it knows how to write lives. The
  owner asked for the opposite: people who live together spend a good part
  of the day apart at their own work, and don't talk while they're apart.

  So the day has a shape, decided here:
    morning (breakfast), evening (dinner), night, dawn → together
    midday   → apart, unless either of them planned something WITH the other
    afternoon → apart about 40% of the time (same exception)
    either of them hurt or sick → together (someone looks after them)
  The narrator then only WRITES the apart setups (where each is, what they
  are doing). If it fails to give two valid, different places, we fall back
  to together rather than invent a place for anyone.
*/
const JOINT_PLAN = /\b(?:together|with (?:kevin|jenny|him|her)|help(?:ing)? (?:kevin|jenny|him|her)|both of us|the two of us|we(?:'ll| will| can|'re)?)\b/i;

export function decideMode(w: World, nextSlot: Slot, rand: number = Math.random()): 'together' | 'apart' {
  if (nextSlot !== 'midday' && nextSlot !== 'afternoon') return 'together';
  const k = w.agents.kevin;
  const j = w.agents.jenny;
  if (k.health === 'hurt' || k.health === 'sick' || j.health === 'hurt' || j.health === 'sick') return 'together';
  const plans = [...k.plan, ...j.plan].join(' ; ');
  if (JOINT_PLAN.test(plans)) return 'together';
  if (nextSlot === 'midday') return 'apart';
  return rand < 0.4 ? 'apart' : 'together';
}

/*
  WHERE THEY GO WHEN APART: ALSO CODE. Given the decision and two required
  per-person blocks, nemotron-3-ultra still put BOTH of them at the cottage
  2 times out of 2 (measured 2026-09-25) — the model's pull toward the shared
  room is that strong. So each person's place comes from their OWN plan for
  the day (a place word in it, else the kind of work it names), the narrator
  is told the two places and writes only what happens there, and the clamp
  pins the locations to these even if the answer drifts.
*/
const ACTIVITY_PLACE: Partial<Record<string, LocationId[]>> = {
  fishing: ['dock', 'tidepools', 'beach'],
  chopping: ['woods'],
  foraging: ['tidepools', 'beach', 'woods'],
  gardening: ['garden'],
  sketching: ['cliffs', 'woods', 'hilltop'],
  exploring: ['hilltop', 'woods', 'cliffs'],
  swimming: ['cove', 'beach'],
  repairing: ['dock', 'cottage'],
  building: ['cottage', 'garden'],
  radio: ['cottage'],
  writing: ['cottage'],
  cooking: ['cottage'],
};
const DEFAULT_APART_PLACES: Record<AgentId, LocationId[]> = {
  kevin: ['dock', 'woods', 'beach', 'cottage'],   // the dinghy is his want
  jenny: ['woods', 'garden', 'cliffs', 'spring'], // the survey is hers
};

function placesFromPlan(plan: string[], w: World): LocationId[] {
  const out: LocationId[] = [];
  for (const item of plan) {
    const named = resolveLocation(item, w);
    if (named) out.push(named);
    const act = activityFromDo(item, 'cottage', w.slot);
    for (const id of ACTIVITY_PLACE[act] || []) if (w.discovered.includes(id)) out.push(id);
  }
  return out;
}

/*
  THE SHRINE VISIT IS ALSO CODE-DECIDED, NOT ASKED OF THE NARRATOR — same
  reasoning as decideMode()/assignApartPlaces() above: a model asked "where do
  they end up tonight?" has no reason to ever pick a stone circle over the
  cottage, so the decision has to be made here and simply HANDED to the
  narrator as a fact to write around (prompts.ts's transitionUserPrompt).
  `patronCount` is passed in rather than queried here because sim.ts is
  DELIBERATELY DB-free (this file's header) — narrator.ts fetches it from
  world/gifts.ts and passes the number in.
*/
export function shouldVisitShrine(w: World, nextSlot: Slot, patronCount: number): boolean {
  if (nextSlot !== 'evening') return false;
  if (!w.discovered.includes('shrine')) return false;
  if (patronCount < 1) return false;
  const lastVisit = w.last_shrine_visit_day || 0;
  return (w.day - lastVisit) >= 3;
}

export function assignApartPlaces(w: World): Record<AgentId, LocationId> {
  const k = [...placesFromPlan(w.agents.kevin.plan, w), ...DEFAULT_APART_PLACES.kevin.filter((id) => w.discovered.includes(id))];
  const j = [...placesFromPlan(w.agents.jenny.plan, w), ...DEFAULT_APART_PLACES.jenny.filter((id) => w.discovered.includes(id))];
  const kevin = k[0] || 'dock';
  const jenny = j.find((id) => id !== kevin) || (kevin === 'garden' ? 'cottage' : 'garden');
  return { kevin, jenny };
}

export function clampTransition(raw: any, w: World, nextSlot: Slot, mode?: 'together' | 'apart', places?: Record<AgentId, LocationId>): Transition | null {
  if (!raw || typeof raw !== 'object') return null;

  const nextRaw = raw.next_scene && typeof raw.next_scene === 'object' ? raw.next_scene : {};
  // The APART template (prompts.ts nextSceneSchema) puts the per-person blocks
  // directly on next_scene; older answers nest them under "apart". Accept both.
  const apartKevinRaw = nextRaw.kevin ?? nextRaw.apart?.kevin;
  const apartJennyRaw = nextRaw.jenny ?? nextRaw.apart?.jenny;
  let setup = clampStr(stripAttributedSpeech(String(nextRaw.setup || '')), 600);
  if (!setup && mode === 'apart' && apartKevinRaw?.setup && apartJennyRaw?.setup) {
    // No shared line, but both solo openings exist: a plain label of who is where
    // (mechanism text, like a caption) rather than dropping a valid apart answer.
    setup = clampStr(`Kevin: ${String(apartKevinRaw.doing || 'on his own')}. Jenny: ${String(apartJennyRaw.doing || 'on her own')}.`, 600);
  }
  if (!setup) return null;

  /*
    "together" defaults true (a model that omits the field, or a chain that
    falls back past the schema entirely, must never accidentally scatter
    them). Apart is only kept when BOTH sides clamp to something usable AND
    the two places actually differ — an "apart" scene at the same location
    is just together with extra steps, and the two solo tracks in the
    transcript (tick.ts) would make no sense.

    The evening/night force is last and unconditional: however the raw JSON
    and the per-agent clamping came out, the story keeps them together for
    meals, the evening and the night (prompts.ts's transitionUserPrompt
    already ASKS the model for this; this is the code enforcing it, never
    just trusted to the model).
  */
  // With a decided mode the model's own "together" flag is ignored; without one
  // (older callers) the previous behaviour stands.
  let together = mode ? mode === 'together' : nextRaw.together !== false;
  let apart: Record<AgentId, { location: LocationId; doing: string; setup: string }> | undefined;
  if (!together) {
    // With code-assigned places the location is pinned whatever the model wrote
    // (its setups were written FOR these places); the rest still has to validate.
    const pin = (r: any, id: AgentId) => {
      if (!places || !r || typeof r !== 'object') return r;
      // A setup written for a DIFFERENT place than the one assigned would leave
      // the figure and the words in two places: drop it (→ together) instead.
      const said = r.location ? resolveLocation(r.location, w) : null;
      if (r.location && said && said !== places[id]) return null;
      return { ...r, location: places[id] };
    };
    const kevinEntry = clampApartEntry(pin(apartKevinRaw, 'kevin'), w);
    const jennyEntry = clampApartEntry(pin(apartJennyRaw, 'jenny'), w);
    if (kevinEntry && jennyEntry && kevinEntry.location !== jennyEntry.location) {
      apart = { kevin: kevinEntry, jenny: jennyEntry };
    } else {
      together = true;
    }
  }
  if (nextSlot === 'evening' || nextSlot === 'night') {
    together = true;
    apart = undefined;
  }

  const next = {
    slot: nextSlot,
    location: resolveLocation(nextRaw.location, w) ?? ('cottage' as LocationId),
    title: clampStr(String(nextRaw.title || ''), 70) || 'Together again',
    setup,
    together,
    apart,
  };

  const summary = clampStr(String(raw.summary || ''), 500);

  const outcomes: Transition['outcomes'] = Array.isArray(raw.outcomes)
    ? raw.outcomes.slice(0, 8).map((o: any) => ({
        who: (o?.who === 'kevin' || o?.who === 'jenny') ? o.who : 'world',
        action: clampStr(String(o?.action || ''), 200),
        result: clampStr(String(o?.result || ''), 300),
        success: !!o?.success,
      })).filter((o: Transition['outcomes'][number]) => o.action || o.result)
    : [];

  const resRaw = raw.resources && typeof raw.resources === 'object' ? raw.resources : {};
  /*
    ⚠️ TIGHT ON PURPOSE. The first local run gave the narrator ±150 L / ±6 days
    and it used them: water 160 → 397 L and food 6 → 39 days inside ONE island
    day, because a model asked "what changed?" reaches for generous numbers.
    With no scarcity there is nothing to decide, and the stakes that keep them
    out of the talking era's loop disappear.

    Rain filling the tank and the meals they eat are already counted by code
    (advanceSlot), so a scene can only move a resource by what someone
    physically did in it: two jerrycans from the spring (≈40 L), a good catch
    (≈1 day of food), an armful or three of wood. A storm or a supply boat
    arrives through code, not through these deltas.
  */
  const resources = {
    water_l: clampNum(resRaw.water_l, -40, 40),
    food_days: clampNum(resRaw.food_days, -2, 1.5),
    firewood: clampNum(resRaw.firewood, -3, 4),
  };

  const agents: Transition['agents'] = { kevin: clampAgentDelta(raw.kevin, w, 'kevin'), jenny: clampAgentDelta(raw.jenny, w, 'jenny') };

  const xp: Transition['xp'] = [];
  for (const x of Array.isArray(raw.xp) ? raw.xp : []) {
    if (xp.length >= 3) break;
    const who = x?.who === 'kevin' || x?.who === 'jenny' ? x.who : null;
    const skill = normalizeSkill(String(x?.skill || ''));
    if (!who || !skill) continue;
    xp.push({ who, skill, amount: Math.round(clampNum(x?.amount ?? 1, 1, 3)) });
  }

  const activeCount = w.projects.filter((p) => p.status !== 'done').length;
  let newProjectBudget = Math.max(0, 8 - activeCount);
  const projects: Transition['projects'] = [];
  for (const p of Array.isArray(raw.projects) ? raw.projects : []) {
    if (projects.length >= 3) break;
    const name = clampStr(String(p?.name || ''), 60);
    if (!name) continue;
    const isNew = !matchProject(name, w.projects);
    if (isNew) {
      if (newProjectBudget <= 0) continue;
      newProjectBudget--;
    }
    const status: ProjectStatus | undefined = ['idea', 'active', 'done', 'stalled', 'abandoned'].includes(p?.status) ? p.status : undefined;
    const owners = Array.isArray(p?.owners) ? p.owners.filter((o: any) => o === 'kevin' || o === 'jenny').slice(0, 2) : undefined;
    projects.push({
      name,
      // +10 a scene at most: a garden or a boat is weeks of work, not four scenes.
      progress: clampNum(p?.progress ?? 0, -30, 10),
      status,
      owners: owners && owners.length ? owners : undefined,
      note: p?.note ? clampStr(String(p.note), 160) : undefined,
    });
  }

  const items: Transition['items'] = (Array.isArray(raw.items) ? raw.items : []).slice(0, 2)
    .map((i: any) => ({ name: clampStr(String(i?.name || ''), 60), note: clampStr(String(i?.note || ''), 120), where: isValidWhere(i?.where) ? i.where : ('cottage' as LocationId | 'carried') }))
    .filter((i: Transition['items'][number]) => i.name);

  const discoveries: Transition['discoveries'] = (Array.isArray(raw.discoveries) ? raw.discoveries : []).slice(0, 2)
    .map((d: any) => ({
      who: d?.who === 'kevin' || d?.who === 'jenny' ? d.who : ('kevin' as AgentId),
      fact: clampStr(String(d?.fact || ''), 240),
      location: resolveLocation(d?.location, w) ?? undefined,
    }))
    .filter((d: Transition['discoveries'][number]) => d.fact);

  const newly_discovered: LocationId[] = [];
  for (const id of Array.isArray(raw.newly_discovered) ? raw.newly_discovered : []) {
    if (newly_discovered.length >= 1) break;
    if ((LOCATION_IDS as string[]).includes(id) && !w.discovered.includes(id)) newly_discovered.push(id);
  }

  const interludes: Record<AgentId, string> = {
    kevin: clampStr(stripAttributedSpeech(String(raw.kevin_alone || '')), 600),
    jenny: clampStr(stripAttributedSpeech(String(raw.jenny_alone || '')), 600),
  };

  return { summary, outcomes, resources, agents, xp, projects, items, discoveries, newly_discovered, interludes, next };
}

// ── applyTransition ──

export interface NotebookSeed {
  author: AgentId | 'both';
  kind: NotebookRow['kind'];
  content: string;
  location?: LocationId;
  scene_id?: string;
}

/** Mutates `w` with a clamped Transition's effects. Returns event seeds + notebook entries for the caller to persist (store.logEvents / store.addNotebook). */
export function applyTransition(w: World, t: Transition, sceneId: string): { events: EventSeed[]; notebook: NotebookSeed[] } {
  const events: EventSeed[] = [];
  const notebook: NotebookSeed[] = [];

  // Captured before anything below moves them — this is "where they were
  // during the scene that just closed", compared at the very end against
  // "where they'll be next" to decide whether a walk happened.
  const prevLocation: Record<AgentId, LocationId> = { kevin: w.agents.kevin.location, jenny: w.agents.jenny.location };

  w.resources.water_l = clamp(w.resources.water_l + t.resources.water_l, 0, 400);
  w.resources.food_days = Math.max(0, w.resources.food_days + t.resources.food_days);
  w.resources.firewood = Math.max(0, w.resources.firewood + t.resources.firewood);

  for (const id of AGENT_IDS) {
    const a = w.agents[id];
    const d = t.agents[id];
    a.energy = clamp(a.energy + d.energy, 0, 100);
    a.hunger = clamp(a.hunger + d.hunger, 0, 100);
    a.mood = clamp(a.mood + d.mood, -5, 5);
    a.location = d.location;
    if (d.health) a.health = d.health;
    if (d.condition !== undefined) a.condition = d.condition;
  }

  for (const x of t.xp) {
    const a = w.agents[x.who];
    const before = skillLevel(a.xp[x.skill] || 0);
    a.xp[x.skill] = (a.xp[x.skill] || 0) + x.amount;
    const after = skillLevel(a.xp[x.skill]);
    if (after > before) {
      events.push({ kind: 'level_up', who: x.who, detail: `${BIOGRAPHIES[x.who].name}'s ${x.skill.replace('_', ' ')} is now ${after}/10.` });
    }
  }

  for (const p of t.projects) {
    const existing = matchProject(p.name, w.projects);
    if (existing) {
      if (existing.status === 'done') continue; // a finished project doesn't un-finish from a stray delta
      const before = existing.progress;
      const statusBefore = existing.status;
      existing.progress = clamp(existing.progress + p.progress, 0, 100);
      /*
        "done" is EARNED by progress, never declared. The first local run had
        the narrator mark "the garden" done at 90% on day 1 of a months-long
        job; a finished project that was never built is the talking era's
        "we'll make a list of goals" in a new costume.
      */
      if (p.status && p.status !== 'done') existing.status = p.status;
      if (existing.progress >= 100) existing.status = 'done';
      else if (existing.status === 'idea' && existing.progress > before) existing.status = 'active';
      if (p.owners?.length) existing.owners = p.owners;
      if (p.note) existing.note = p.note;
      if (existing.status === 'done' && existing.finished_day === undefined) {
        existing.finished_day = w.day;
        events.push({ kind: 'project_done', detail: `${existing.name} is finished.` });
      } else if (Math.round(existing.progress) !== Math.round(before) || existing.status !== statusBefore) {
        // Only when something moved — an unchanged project re-announced every scene was timeline noise.
        events.push({ kind: 'project', detail: `${existing.name}: ${Math.round(existing.progress)}%${existing.status !== statusBefore ? ` (${existing.status})` : ''}.` });
      }
    } else if (w.projects.filter((pr) => pr.status !== 'done').length < 8) {
      const proj: Project = {
        id: `proj-${w.seq++}`,
        name: p.name,
        owners: p.owners?.length ? p.owners : [...AGENT_IDS],
        progress: clamp(p.progress, 0, 100),
        status: p.status || 'idea',
        started_day: w.day,
        note: p.note || '',
      };
      w.projects.push(proj);
      events.push({ kind: 'project_started', detail: `A new project: ${proj.name}.` });
    }
  }

  for (const i of t.items) {
    // The narrator re-lists things they already own ("found: barometer" on
    // every scene of day 1). Same thing by name = already here, not a find.
    const key = normItemName(i.name);
    const have = w.items.find((x) => normItemName(x.name) === key || similarity(x.name, i.name) >= 0.6);
    if (have) {
      if (i.note && i.note !== have.note) have.note = i.note; // its state may have changed ("needle now sticks")
      continue;
    }
    w.items.push({ id: `item-${w.seq++}`, name: i.name, note: i.note, where: i.where, found_day: w.day });
    events.push({ kind: 'item', detail: `Found: ${i.name}.` });
  }

  for (const d of t.discoveries) {
    notebook.push({ author: d.who, kind: 'discovery', content: d.fact, location: d.location, scene_id: sceneId });
    events.push({ kind: 'discovery', who: d.who, detail: d.fact });
  }

  for (const id of t.newly_discovered) {
    if (!w.discovered.includes(id)) {
      w.discovered.push(id);
      events.push({ kind: 'discovered', detail: `They have found ${LOCATIONS[id].name}.` });
    }
  }

  w.agents.kevin.interlude = t.interludes.kevin;
  w.agents.jenny.interlude = t.interludes.jenny;

  if (t.next.together === false && t.next.apart) {
    // Apart: each of them goes to their OWN place — nothing here reconvenes them.
    w.agents.kevin.location = t.next.apart.kevin.location;
    w.agents.jenny.location = t.next.apart.jenny.location;
  } else {
    // Together: they reconvene at the next scene's location — wherever the
    // narrator moved them individually during the interlude is already
    // folded into the interlude text, not into where they physically end up.
    w.agents.kevin.location = t.next.location;
    w.agents.jenny.location = t.next.location;
  }

  // A figure that just moved is walking there — tick.ts's open_scene keeps
  // this until the new scene's first turn gives them a real activity, and the
  // map (part B) tweens the walk over that same window. An agent whose place
  // didn't change keeps whatever activity they already had ("else keep").
  for (const id of AGENT_IDS) {
    if (w.agents[id].location !== prevLocation[id]) w.agents[id].activity = 'walking';
  }

  return { events, notebook };
}
