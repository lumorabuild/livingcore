// ─────────────────────────────────────────────────────────────────────────────
// EVERY PROMPT THE ISLAND ERA SENDS, IN ONE FILE.
//
// Kept together on purpose: /api/export/meta.json publishes these templates
// verbatim and PROTOCOL below is written onto every turn, so a researcher can
// always say exactly which words produced which behaviour. Change a prompt →
// bump PROTOCOL in the same commit, and add a line to ERAS in src/world/eras.ts.
//
// What the prompts deliberately DO say (and why — the Era 3 archive is the
// evidence, see docs/ISLAND.md):
//   • A body, a place, a time and things to do. Era 3 had none of these, so two
//     assistant-tuned models had nothing to react to but each other's warmth.
//   • THOUGHT is private. What someone thinks and what they say are different;
//     that gap is where a person is.
//   • "People talk in short turns." Era 3 turns averaged ~1,300 characters of
//     monologue. This is the only style-shaped line, and it is about realism.
//   • Never write your partner's lines. llama-3.1-8b narrated Kevin's replies
//     inside Jenny's turns for weeks.
// What they deliberately do NOT say: what to talk about, what mood to be in,
// how to feel about each other, or that anyone is watching.
// ─────────────────────────────────────────────────────────────────────────────

import type { AgentId, AgentState, LocationId, Project, Slot, World } from './types';
import { BIOGRAPHIES, ISLAND_NAME, LOCATIONS, SHARED_STORY, skillLevel } from './bio';
import { barometerLine, tide } from './sim';

/** Written on every island-era turn, scene and chapter. Bump when any template below changes. */
/*
  island-2 (2026-09-26): THOUGHT asked to be "a sentence or two". island-1
  thoughts ran to ~500 characters — full inner monologues, pages long on a
  phone — and the owner, watching live, could not follow "what's happening in
  their brain". A person's passing thought is short; the long version is what
  the private journal and the nightly reflection are for.
*/
export const PROTOCOL = 'island-2';

export const SLOT_WORDS: Record<Slot, string> = {
  dawn: 'dawn', morning: 'morning', midday: 'midday', afternoon: 'afternoon', evening: 'evening', night: 'night',
};

// ── Small renderers: numbers become the words a person would feel ──

export function energyWords(e: number): string {
  if (e >= 80) return 'rested';
  if (e >= 55) return 'a little tired';
  if (e >= 30) return 'tired';
  if (e >= 12) return 'exhausted';
  return 'barely able to keep your eyes open';
}

export function hungerWords(h: number): string {
  if (h <= 20) return 'not hungry';
  if (h <= 50) return 'could eat';
  if (h <= 75) return 'hungry';
  return 'weak with hunger';
}

export function moodWords(m: number): string {
  if (m >= 4) return 'happy';
  if (m >= 2) return 'in good spirits';
  if (m >= -1) return 'even';
  if (m >= -3) return 'low';
  return 'miserable';
}

const LEVEL_WORDS = ['no idea', 'a beginner', 'a beginner', 'getting the hang of it', 'decent', 'good', 'good', 'very good', 'expert', 'expert', 'a master'];

export function skillsLine(a: AgentState): string {
  return Object.entries(a.xp)
    .map(([skill, xp]) => ({ skill, lvl: skillLevel(xp) }))
    .filter(s => s.lvl > 0)
    .sort((x, y) => y.lvl - x.lvl)
    .map(s => `${s.skill.replace('_', ' ')}: ${LEVEL_WORDS[s.lvl]} (${s.lvl}/10)`)
    .join('; ');
}

export function supplyLine(w: World): string {
  const due = w.supply.due_day + w.supply.delayed_days;
  if (w.supply.delayed_days > 0 && w.day >= w.supply.due_day) {
    return `The supply boat was due on day ${w.supply.due_day} and is ${w.day - w.supply.due_day + 1} day(s) late; the radio says it is held back by weather.`;
  }
  const inDays = due - w.day;
  if (inDays <= 0) return 'The supply boat is due today.';
  if (inDays === 1) return 'The supply boat is due tomorrow.';
  return `The supply boat is due in ${inDays} days.`;
}

export function projectsLine(projects: Project[]): string {
  const live = projects.filter(p => p.status === 'active' || p.status === 'stalled' || p.status === 'idea');
  if (live.length === 0) return 'nothing under way';
  return live.map(p => `${p.name} (${p.status}, ${Math.round(p.progress)}% — ${p.note || 'no notes'})`).join('; ');
}

export function worldBlock(w: World): string {
  const r = w.resources;
  const items = w.items.length ? w.items.map(i => `${i.name}${i.note ? ` (${i.note})` : ''}`).join('; ') : 'nothing unusual';
  const places = w.discovered.map(id => LOCATIONS[id].name).join(', ');
  const done = w.projects.filter(p => p.status === 'done').map(p => p.name);
  return [
    `Water in the tank: about ${Math.round(r.water_l)} litres (holds 400). Food: about ${r.food_days.toFixed(1)} days for two. Dry firewood: ${Math.round(r.firewood)} armfuls.`,
    supplyLine(w),
    `Projects: ${projectsLine(w.projects)}.${done.length ? ` Finished: ${done.join(', ')}.` : ''}`,
    `Notable things you have: ${items}.`,
    `Places you know on the island: ${places}. (Anywhere else you have not found yet.)`,
    `(Place ids: ${w.discovered.join(', ')}.)`,
    // Both are physically readable to whoever is standing there — the barometer
    // sits on the cottage shelf, the tide is what the shore looks like. What
    // falling pressure predicts about the weather is theirs to notice, never
    // stated here as a rule.
    `${barometerLine(w)} The tide is ${tide(w.day, w.slot)}.`,
  ].join('\n');
}

// ── The agent's turn ──

export interface AgentContext {
  world: World;
  agent: AgentId;
  journal: string;
  memories: string[];
  notebook: string[];
  earlierToday: string[];
  /** Present-tense setup of the current scene (always shown). */
  setup: string;
  /** Text of a visitor's bottle being read in this scene, if any (untrusted: shown as found text). */
  bottleText?: string;
  /**
   * Set when the two of them are APART this part of the day: where the
   * partner is. The agent is at its own location (world.agents[x].location),
   * not the scene's, and has nobody to talk to.
   */
  alone?: { partnerWhere: string };
}

export function agentSystemPrompt(ctx: AgentContext): string {
  const bio = BIOGRAPHIES[ctx.agent];
  const me = ctx.world.agents[ctx.agent];
  const w = ctx.world;
  const loc = LOCATIONS[ctx.alone ? me.location : (w.scene?.location || me.location)];

  const sections = [
    `You are ${bio.name}, ${bio.age}. ${bio.story}`,
    SHARED_STORY,
    `This is your real life, happening now. Nothing is scripted and nobody is directing you. You have a body that gets tired and hungry, skills you are good and bad at, the tools and materials of the island, and time that keeps moving. You can say anything, and you can do anything a person could physically try here — work, explore, build, repair, fish, cook, forage, study, make things, rest, go somewhere, argue, joke, keep a secret, change your mind. What you do has real consequences: the island answers, and things can fail.`,
    `HOW YOU EXIST HERE
- THOUGHT is only in your head — what goes through it right now, a sentence or two. ${bio.partner} never hears it.
- SAY is what you actually say out loud. People talk in short turns, not speeches. SAY can be empty if you say nothing.
- DO is what your body does right now, in a few words. To go somewhere, do it ("walk up to the spring"). To make something that can be kept — a poem, a song, a sketch, a map, a recipe, a letter, a plan, a design — write "make <kind>: <title>" in DO and it will really be made.
- To keep something in memory for good, write [remember: …] anywhere.
- Write only your own thoughts, words and actions. Never write ${bio.partner}'s.`,
    `YOU, RIGHT NOW
Day ${w.day} on ${ISLAND_NAME}, ${SLOT_WORDS[w.slot]}. ${w.weather.line}, ${w.weather.temp_c}°C.
You are at ${loc.name}${ctx.alone ? `, on your own — ${bio.partner} is at ${ctx.alone.partnerWhere}` : ''}. ${loc.description}
You feel ${energyWords(me.energy)}, ${hungerWords(me.hunger)}, ${moodWords(me.mood)}${me.health !== 'well' ? `, ${me.health}${me.condition ? ` (${me.condition})` : ''}` : ''}.
Your skills: ${skillsLine(me) || 'nothing special yet'}.
What you meant to do today: ${me.plan.length ? me.plan.join('; ') : 'you have not decided'}.
What you want, deep down: ${me.want}`,
    `THE ISLAND\n${worldBlock(w)}`,
  ];

  if (ctx.notebook.length) {
    sections.push(`WHAT YOU HAVE LEARNED HERE (your shared notebook)\n${ctx.notebook.map(n => `- ${n}`).join('\n')}`);
  }
  sections.push(`YOUR PRIVATE JOURNAL\n${ctx.journal.trim() || '(nothing written yet)'}`);
  if (ctx.memories.length) {
    sections.push(`MEMORIES THAT COME TO MIND\n${ctx.memories.map(m => `- ${m}`).join('\n')}`);
  }
  if (ctx.earlierToday.length) {
    sections.push(`EARLIER TODAY\n${ctx.earlierToday.map(s => `- ${s}`).join('\n')}`);
  }
  if (ctx.bottleText) {
    // A 3-day simulation run had Jenny read a bottle's note ALOUD with
    // invented words ("don't come to the cove") that were never in it — the
    // real text was only ever shown once, in sceneOpening's stage direction,
    // with no instruction telling the model that quoting it means quoting it
    // EXACTLY. Same untrusted-text handling as sceneOpening (a visitor wrote
    // this, not us): quotes flattened, length-capped.
    sections.push(`IN YOUR HANDS — a note from a bottle that washed up. Its exact words: "${ctx.bottleText.replace(/"/g, "'").slice(0, 600)}". If you read it out, read these words; do not invent others.`);
  }
  if (me.interlude.trim()) {
    sections.push(`SINCE YOU LAST SAW ${bio.partner.toUpperCase()} (only you know this)\n${me.interlude.trim()}`);
  }
  sections.push(
    ...(ctx.alone ? [`You are on your own, so there is nobody to talk to. Leave SAY empty — unless you say something out loud to yourself, the sea or a bird, the way people do when they are alone.`] : []),
    `Answer in exactly this form, nothing before or after:
THOUGHT: …
SAY: …
DO: …`
  );
  return sections.join('\n\n');
}

/** The first user message of a scene: what is physically happening as it opens. */
export function sceneOpening(setup: string, bottleText?: string): string {
  let s = `[${setup.trim()}]`;
  if (bottleText) {
    s += `\n[The note inside the bottle is handwritten. It reads: "${bottleText.replace(/"/g, "'").slice(0, 600)}"]`;
  }
  return s;
}

/** The first user message when they are apart: this agent's own situation, nobody else in it. */
export function soloOpening(setup: string): string {
  return `[${setup.trim()}]`;
}

/** Between two of your own solo turns: time moves on. Keeps the chat roles alternating. */
export const SOLO_LATER = '[A little later.]';

/** How the partner's turn reaches you: only what can be heard and seen. */
export function heardTurn(partner: AgentId, say: string, action: string): string {
  const name = BIOGRAPHIES[partner].name;
  const parts: string[] = [];
  if (say.trim()) parts.push(`${name}: "${say.trim()}"`);
  if (action.trim() && !/^nothing\.?$/i.test(action.trim())) parts.push(`(${name} ${lowerFirst(action.trim())})`);
  return parts.join(' ') || `(${name} says nothing.)`;
}

/** Your own earlier turn, as you wrote it — your thoughts are yours to remember. */
export function ownTurn(thought: string, say: string, action: string): string {
  return `THOUGHT: ${thought}\nSAY: ${say}\nDO: ${action}`;
}

export const RETRY_NOTE =
  '[That reply repeated what has already been said. Answer again — something that moves things on: a new thought, a different word, an action.]';

function lowerFirst(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

// ── Private morning plan (dawn, one call per agent) ──

export function planPrompt(ctx: { world: World; agent: AgentId; journal: string; yesterday: string }): { system: string; user: string } {
  const bio = BIOGRAPHIES[ctx.agent];
  const me = ctx.world.agents[ctx.agent];
  const w = ctx.world;
  return {
    system: `You are ${bio.name}, ${bio.age}. ${bio.story}\n\n${SHARED_STORY}\n\nThis is private — your own head at dawn, before ${bio.partner} is up.`,
    user:
      `Dawn, day ${w.day} on ${ISLAND_NAME}. ${w.weather.line}, ${w.weather.temp_c}°C.\n` +
      `You feel ${energyWords(me.energy)}, ${hungerWords(me.hunger)}, ${moodWords(me.mood)}.\n` +
      `Your skills: ${skillsLine(me)}.\nWhat you want, deep down: ${me.want}\n\n` +
      `THE ISLAND\n${worldBlock(w)}\n\n` +
      `YESTERDAY\n${ctx.yesterday || '(nothing to recall)'}\n\n` +
      `YOUR PRIVATE JOURNAL\n${ctx.journal.trim() || '(empty)'}\n\n` +
      `What do you actually intend to do today? Reply in exactly this form:\n` +
      `PLAN: one to three concrete things, separated by semicolons\n` +
      `FEELING: one honest line about how you are this morning\n` +
      `FORECAST: tomorrow's weather — one of clear, cloudy, windy, rain, storm, fog, heat`,
  };
}

// ── The narrator: what the world does in answer (one call per scene boundary) ──

export const NARRATOR_SYSTEM =
  `You are the world of ${ISLAND_NAME}: its physics, weather, tides, animals, materials and luck. ` +
  `You are not a character. You never speak for Kevin or Jenny, never decide what they choose, never describe their feelings for them. ` +
  `You decide only what the world does in answer to what they did. Be concrete, plausible and unsentimental: effort can fail, ` +
  `weather matters, tools break, food runs out, discoveries are small and real, and good outcomes are earned. ` +
  `Nothing supernatural: every mystery here has an ordinary explanation, found slowly. Keep continuity with every fact you are given. ` +
  `Respond with ONLY one JSON object.`;

export interface TransitionPromptInput {
  world: World;
  transcript: string;
  rolls: Record<AgentId, number>;
  nextSlot: Slot;
  nextDay: number;
  event: string | null;
  radio: string | null;
  plans: Record<AgentId, string>;
  hiddenPlaces: string;
  /** The scene that just ended had them apart (two solo tracks in the transcript). */
  sceneWasApart?: boolean;
  /** Decided by code (sim.decideMode): whether the NEXT part of the day has them together or apart. */
  mode?: 'together' | 'apart';
  /** When APART: where each of them is, decided by code from their own plans (sim.assignApartPlaces). */
  places?: Record<AgentId, LocationId>;
  notebook: string[];
}

export function transitionUserPrompt(p: TransitionPromptInput): string {
  const w = p.world;
  const agentLine = (id: AgentId) => {
    const a = w.agents[id];
    return `${BIOGRAPHIES[id].name}: at ${LOCATIONS[a.location].name}; ${energyWords(a.energy)} (energy ${Math.round(a.energy)}/100), ${hungerWords(a.hunger)} (hunger ${Math.round(a.hunger)}/100), mood ${a.mood}; health ${a.health}${a.condition ? ` (${a.condition})` : ''}; skills ${skillsLine(a)}; intends today: ${a.plan.join('; ') || 'unsaid'}.`;
  };
  return [
    `DAY ${w.day}, ${w.slot.toUpperCase()} at ${LOCATIONS[w.scene?.location || 'cottage'].name}. Weather: ${w.weather.line}, ${w.weather.temp_c}°C (${w.season} season).`,
    `THE ISLAND\n${worldBlock(w)}`,
    `THE PEOPLE\n${agentLine('kevin')}\n${agentLine('jenny')}`,
    p.notebook.length ? `ESTABLISHED FACTS (keep continuity)\n${p.notebook.map(n => `- ${n}`).join('\n')}` : '',
    `THE SCENE THAT JUST ENDED (what was said and done — their private thoughts are not yours)\n${p.transcript}`,
    `DICE for anything uncertain they attempted (d20; add the relevant skill level; 15+ clear success, 10–14 partial, 9 or less fails): Kevin rolled ${p.rolls.kevin}, Jenny rolled ${p.rolls.jenny}.`,
    p.event ? `SOMETHING THE WORLD DOES NEXT (weave it in): ${p.event}` : '',
    p.radio ? `IF ANYONE LISTENED TO THE RADIO, THIS IS WHAT CAME THROUGH: ${p.radio}` : '',
    `Places not yet discovered (only reveal one if someone actually went looking in the right area and the dice allow): ${p.hiddenPlaces || 'none left'}.`,
    `NEXT: the story continues at ${p.nextSlot.toUpperCase()} on day ${p.nextDay}. Between now and then each of them spends some time on their own — decide plausibly what that time brings them, from what they said they would do.`,
    `TOGETHER OR APART: people who live together spend a good part of the day apart, each at their own work, and come together for meals, in the evening and at night. ${decisionLine(p)}${p.sceneWasApart ? ' The scene that just ended was APART: each track above is one of them alone — judge each separately.' : ''}`,
    `RESOURCES move only through what someone physically did in this scene: water they carried from the spring, fish they caught, wood they cut, food that spoiled or was eaten outside a meal. Rain in the tank and ordinary meals are already counted — never add them. Most scenes change nothing, so 0 is the usual answer.`,
    `Return exactly this JSON (numbers are CHANGES, not totals; omit nothing, use [] or null when empty):
{
  "summary": "2-3 plain past-tense sentences of what happened in the scene",
  "outcomes": [{"who": "kevin|jenny|world", "action": "what was attempted", "result": "what actually happened", "success": true}],
  "resources": {"water_l": 0, "food_days": 0, "firewood": 0},
  "kevin": {"energy": 0, "hunger": 0, "mood": 0, "health": "well|tired|hurt|sick", "condition": ""},
  "jenny": {"energy": 0, "hunger": 0, "mood": 0, "health": "well|tired|hurt|sick", "condition": ""},
  "xp": [{"who": "kevin|jenny", "skill": "one of mechanics, building, fishing, navigation, cooking, gardening, botany, drawing, first_aid, foraging, swimming, radio, music, writing", "amount": 1}],
  "projects": [{"name": "short name", "progress": 0, "status": "idea|active|done|stalled|abandoned", "owners": ["kevin"], "note": "where it stands"}],
  "items": [{"name": "…", "note": "…", "where": "cottage"}],
  "discoveries": [{"who": "kevin|jenny", "fact": "a concrete thing now known about the island", "location": "a place id"}],
  "newly_discovered": [],
  "kevin_alone": "2-3 sentences, second person, of what Kevin did and noticed on his own until the next scene",
  "jenny_alone": "2-3 sentences, second person, of what Jenny did and noticed on her own until the next scene",
  "next_scene": ${nextSceneSchema(p)}
}`,
  ].filter(Boolean).join('\n\n');
}

/*
  ⚠️ THE SHAPE OF THE ANSWER CARRIES THE DECISION, NOT THE PROSE.
  Measured 2026-09-25 with a real prompt: told in capitals "DECIDED: the next
  part is APART … fill apart for BOTH", diffusiongemma (3/3) and
  nemotron-3-ultra (3/3) still returned together:true and apart:null — the
  template showed an optional, nullable "apart" field, and a template is what
  a JSON-writing model actually follows. So when code decides APART, the
  template has two REQUIRED per-person blocks and no "together" option at all.
*/
/** The together/apart decision code already made (sim.decideMode + sim.assignApartPlaces), stated plainly. */
function decisionLine(p: TransitionPromptInput): string {
  if (p.mode === 'apart') {
    const where = p.places
      ? ` Kevin is at ${LOCATIONS[p.places.kevin].name}; Jenny is at ${LOCATIONS[p.places.jenny].name} — write each setup for exactly that place.`
      : ' Use two DIFFERENT place ids.';
    return `DECIDED: the next part is APART — each of them is at their own work, in a different place, from what they said they would do. Fill the "kevin" and "jenny" blocks of next_scene.${where}`;
  }
  if (p.mode === 'together') return 'DECIDED: the next part is TOGETHER — give the place where they are together.';
  return p.nextSlot === 'evening' || p.nextSlot === 'night' ? `The next part is the ${p.nextSlot}, so they are together.` : '';
}

function nextSceneSchema(p: TransitionPromptInput): string {
  const title = `"a short title for what happens (not just the time of day; never name a different time of day than ${p.nextSlot.toUpperCase()})"`;
  if (p.mode === 'apart') {
    return `{"title": ${title}, "setup": "one present-tense sentence, third person, saying where each of them is",
                 "kevin": {"location": "${p.places ? p.places.kevin : 'a place id where Kevin works alone'}", "doing": "a few words", "setup": "2 present-tense sentences, second person, of Kevin alone there"},
                 "jenny": {"location": "${p.places ? p.places.jenny : 'a DIFFERENT place id where Jenny works alone'}", "doing": "a few words", "setup": "2 present-tense sentences, second person, of Jenny alone there"}}`;
  }
  return `{"location": "a place id", "title": ${title}, "setup": "2-3 present-tense sentences: where they are when they meet again and what is physically happening"}`;
}

// ── The morning's opening scene (no transition precedes it) ──

export function morningUserPrompt(w: World, yesterday: string, event: string | null): string {
  return [
    `DAY ${w.day}, MORNING. Weather: ${w.weather.line}, ${w.weather.temp_c}°C (${w.season} season).`,
    `THE ISLAND\n${worldBlock(w)}`,
    `YESTERDAY\n${yesterday || '(nothing)'}`,
    event ? `SOMETHING THE WORLD DOES THIS MORNING (weave it in): ${event}` : '',
    `Kevin intends today: ${w.agents.kevin.plan.join('; ') || 'unsaid'}. Jenny intends today: ${w.agents.jenny.plan.join('; ') || 'unsaid'}. (Private — do not reveal them.)`,
    `Return exactly this JSON: {"location": "a place id — wherever the morning actually finds them, not always the cottage", "title": "a short title for what happens (not just the time of day)", "setup": "2-3 present-tense sentences: where Kevin and Jenny are together this morning and what is physically happening"}`,
  ].filter(Boolean).join('\n\n');
}

// ── Night: private reflection (one call per agent) ──

export function reflectionPrompt(ctx: { world: World; agent: AgentId; journal: string; today: string }): { system: string; user: string } {
  const bio = BIOGRAPHIES[ctx.agent];
  const me = ctx.world.agents[ctx.agent];
  return {
    system: `You are ${bio.name}, ${bio.age}. ${bio.story}\n\nThis is private — the end of day ${ctx.world.day}, in your own head, before sleep. Nobody will ever read it. Be honest with yourself.`,
    user:
      `WHAT ACTUALLY HAPPENED TODAY\n${ctx.today}\n\n` +
      `YOUR JOURNAL AS IT STANDS\n${ctx.journal.trim() || '(empty)'}\n\n` +
      `WHAT YOU WANT, DEEP DOWN\n${me.want}\n\n` +
      `Respond with ONLY this JSON:\n` +
      `{"journal": "your journal rewritten for tomorrow — concrete, in your own voice, under 220 words: what is really going on in your life here, what you have learned that works and what does not, what is unresolved between you and ${bio.partner}, what you are going to do about it",\n` +
      ` "memories": [{"content": "one specific thing from today worth keeping", "importance": 0.5}],\n` +
      ` "lessons": ["a practical thing you learned about living here, as an if-then or a how-to"],\n` +
      ` "want": "what you want most now, one sentence (it can stay the same)",\n` +
      ` "mood": 0}\n` +
      `memories: 0-3 items. lessons: 0-2 items. mood: -5 to 5.`,
  };
}

// ── End of day: the chapter (one call) ──

export const CHAPTER_SYSTEM =
  `You write the daily chapter of a true record of two people living alone on ${ISLAND_NAME}. ` +
  `Third person, past tense, plain and vivid, like good nonfiction. Report only what happened in the material you are given. ` +
  `If you quote someone, copy their words exactly from the transcript — never invent or improve a line. ` +
  `Include what went wrong as well as what went right. No moral at the end.`;

export function chapterUserPrompt(day: number, material: string): string {
  return `DAY ${day}\n\n${material}\n\nRespond with ONLY this JSON: {"title": "a short chapter title (under 60 characters)", "body": "the chapter, 150-280 words"}`;
}

// ── Making things ──

export const VISUAL_KINDS = new Set(['sketch', 'drawing', 'map', 'diagram', 'painting', 'chart', 'plan-drawing', 'blueprint']);

export function makePrompt(ctx: { agent: AgentId; kind: string; title: string; world: World; context: string }): { system: string; user: string; visual: boolean } {
  const bio = BIOGRAPHIES[ctx.agent];
  const visual = VISUAL_KINDS.has(ctx.kind.toLowerCase());
  const system = `You are ${bio.name}, ${bio.age}. ${bio.story}\n\nYou live on ${ISLAND_NAME} with ${bio.partner}. It is day ${ctx.world.day}, ${ctx.world.slot}.`;
  const user = visual
    ? `You are making a ${ctx.kind}: "${ctx.title}".\nWhat led to it: ${ctx.context}\n\n` +
      `Draw it as a single SVG image, viewBox="0 0 400 300", using only <svg>, <g>, <path>, <circle>, <ellipse>, <rect>, <line>, <polyline>, <polygon>, <text>. ` +
      `Pen-and-ink on paper: dark strokes, a few flat fills, short hand-lettered labels where useful. No external images, no scripts, no styles. ` +
      `Reply with ONLY the SVG, starting with <svg and ending with </svg>.`
    : `You are making a ${ctx.kind}: "${ctx.title}".\nWhat led to it: ${ctx.context}\n\n` +
      `Write it now, as you actually would — in your own words, with the real details of your life here. Under 1,500 characters. Reply with ONLY the ${ctx.kind} itself.`;
  return { system, user, visual };
}
