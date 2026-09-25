// ─────────────────────────────────────────────────────────────────────────────
// ACTIVITY FROM DO — a pure, ordered keyword read of what a figure on the
// island map is visibly doing right now (part 2 spec §A).
//
// PURE and SHARED: no DB, no model call, no World mutation. The server calls
// it from tick.ts to stamp `turn_meta.activity` and update
// `w.agents[x].activity`; the client mirrors the same rules in script.js so
// the map can guess a pose instantly rather than waiting on a poll (that
// mirror is the other half of this spec — see part B). Keep the two in sync
// if either changes: ACTIVITY_RULES is exported specifically so a diff is
// easy to eyeball, and `keywords` on each rule is meant to be read, not just
// matched.
//
// ORDER MATTERS. Rules are tried top to bottom and the first match wins — the
// spec's own examples ("nets a crab" landing on foraging, not fishing,
// because "net" is deliberately NOT a match for the plural "nets") depend on
// that order and on matching exact words, never substrings. Every pattern
// below is `\b`-bounded for exactly that reason: `\bnet\b` cannot match
// inside "internet" (there is no word boundary between the "r" of "inte-r"
// and the "n" of "net"), and `\bnet\b` does not match "nets" either (no
// boundary between the "t" and the "s") — the second half of that is
// deliberate too, not a bug: "net" (the tool, singular) reads as fishing,
// "nets" (the verb, "nets a crab") does not, and falls through to foraging's
// "crab" instead.
// ─────────────────────────────────────────────────────────────────────────────

import type { Activity, LocationId, Slot } from './types';

export interface ActivityRule {
  activity: Activity;
  /** Human-readable summary of the keywords below — for docs/tests, never itself used to match. */
  keywords: string;
  /** Tested against the DO text, already lower-cased by activityFromDo. */
  test: (doLower: string) => boolean;
}

/** True if any whole word/phrase in `patterns` occurs in `t` (case handled by the caller — always lower-cased already). */
function anyWord(t: string, ...patterns: string[]): boolean {
  return patterns.some((p) => new RegExp(`\\b${p}\\b`).test(t));
}

/**
 * Ordered exactly as the spec lists them. A later rule never gets a chance to
 * fire once an earlier one matches — see the file header for why that's load-
 * bearing, not incidental.
 */
export const ACTIVITY_RULES: ActivityRule[] = [
  {
    activity: 'sleeping',
    keywords: 'sleep, bed, lie down, doze, nap',
    test: (t) => anyWord(t, 'sleeps?', 'sleeping', 'asleep', 'bed', 'dozes?', 'dozing', 'naps?', 'napping')
      || anyWord(t, 'l(?:ie|ies|ying)\\s+down'),
  },
  {
    // Heavy carrying work, BEFORE fishing on purpose. Seen live (2026-09-25):
    // "heave the first net bag of lighthouse rubble up the davit" and "hook the
    // second net bag … row back to the rubble field" both read as FISHING,
    // because of "net" and "line" — so Kevin was drawn with a rod while hauling
    // concrete. A haul/heave/lift verb wins unless the sentence is plainly about
    // fish ("haul in the net full of fish", "cast the line").
    activity: 'building',
    keywords: 'heave, haul, hoist, lift, carry, load, wheel, drag, stack, shovel (unless about fish/bait/casting)',
    test: (t) =>
      anyWord(t, 'heaves?', 'heaving', 'hauls?', 'hauling', 'hoists?', 'hoisting', 'lifts?', 'lifting', 'carr(?:y|ies|ying)',
        'loads?', 'loading', 'wheels?', 'wheeling', 'drags?', 'dragging', 'stacks?', 'stacking', 'shovels?', 'shovelling', 'shoveling')
      && !anyWord(t, 'fish(?:es|ing)?', 'baits?', 'baiting', 'casts?', 'casting', 'catch(?:es|ing)?'),
  },
  {
    activity: 'fishing',
    // "net" only (not "nets") on purpose — see the file header: "nets a crab" is foraging.
    keywords: 'fish, rod, line, bait, cast, net (not "internet", not "nets")',
    test: (t) => anyWord(t, 'fish(?:es|ing)?', 'rod', 'line', 'baits?', 'baiting', 'casts?', 'casting', 'net'),
  },
  {
    activity: 'chopping',
    keywords: 'chop, axe, billhook, saw, split wood/log, cut wood/branch/tree, firewood',
    test: (t) =>
      anyWord(t, 'chops?', 'chopping', 'axe', 'axes', 'billhook', 'saws?', 'sawing', 'firewood')
      || (anyWord(t, 'splits?', 'splitting') && anyWord(t, 'wood', 'logs?'))
      || (anyWord(t, 'cuts?', 'cutting') && anyWord(t, 'wood', 'branch(?:es)?', 'trees?')),
  },
  {
    activity: 'cooking',
    keywords: 'cook, stove, kettle, boil, fry, stir, bake',
    test: (t) => anyWord(t, 'cooks?', 'cooking', 'stove', 'kettle', 'boils?', 'boiling', 'fr(?:y|ies|ying)', 'stirs?', 'stirring', 'bakes?', 'baking'),
  },
  {
    activity: 'eating',
    keywords: 'eat, breakfast, lunch, dinner, supper, chew',
    test: (t) => anyWord(t, 'eats?', 'eating', 'breakfast', 'lunch', 'dinner', 'supper', 'chews?', 'chewing'),
  },
  {
    activity: 'gardening',
    // "water the" specifically — bare "water" (carrying water, drinking water) is not gardening.
    keywords: 'plant, seed, weed, hoe, dig, garden, water the, compost, transplant',
    test: (t) =>
      anyWord(t, 'plants?', 'planting', 'seeds?', 'seeding', 'weeds?', 'weeding', 'hoe', 'hoes', 'hoeing',
        'digs?', 'digging', 'gardens?', 'gardening', 'composts?', 'composting', 'transplants?', 'transplanting')
      || anyWord(t, 'waters?\\s+the'),
  },
  {
    activity: 'sketching',
    keywords: 'sketch, draw, charcoal, paint, pencil',
    test: (t) => anyWord(t, 'sketch(?:es|ing)?', 'draws?', 'drawing', 'charcoal', 'paints?', 'painting', 'pencil'),
  },
  {
    activity: 'repairing',
    keywords: 'fix, repair, epoxy, bolt, engine, transom, patch, sand(ing) down, seal, caulk, screw',
    test: (t) =>
      anyWord(t, 'fix(?:es|ing)?', 'repairs?', 'repairing', 'epoxy', 'bolts?', 'bolting', 'engine', 'transom',
        'patch(?:es|ing)?', 'seals?', 'sealing', 'caulks?', 'caulking', 'screws?', 'screwing')
      // "sand(ing) down" — allow an object in between ("sands the hull down"
      // reads just as naturally as "sanding down the hull"; bare "sand"
      // with no "down" nearby, e.g. "walks on the sand", must not match).
      || /\bsand(?:s|ing)\b[\s\S]{0,24}?\bdown\b/.test(t),
  },
  {
    activity: 'building',
    keywords: 'build, hammer, nail, plank, frame, lash, rig',
    test: (t) => anyWord(t, 'builds?', 'building', 'hammers?', 'hammering', 'nails?', 'nailing', 'planks?', 'frames?', 'framing', 'lash(?:es|ing)?', 'rigs?', 'rigging'),
  },
  {
    activity: 'foraging',
    keywords: 'forage, gather, pick, collect, coconut, limpet, crab, shell',
    test: (t) => anyWord(t, 'forages?', 'foraging', 'gathers?', 'gathering', 'picks?', 'picking',
      'collects?', 'collecting', 'coconuts?', 'limpets?', 'crabs?', 'shells?'),
  },
  {
    activity: 'swimming',
    keywords: 'swim, wade, dive, snorkel',
    test: (t) => anyWord(t, 'swims?', 'swimming', 'wades?', 'wading', 'dives?', 'diving', 'snorkels?', 'snorkelling', 'snorkeling'),
  },
  {
    activity: 'radio',
    keywords: 'radio, shortwave, frequency, dial',
    test: (t) => anyWord(t, 'radio', 'shortwave', 'frequency', 'dial'),
  },
  {
    activity: 'writing',
    keywords: 'write, notebook, journal, letter, log entry, list',
    test: (t) => anyWord(t, 'writes?', 'writing', 'notebook', 'journal', 'letters?', 'lists?') || anyWord(t, 'log\\s+entry'),
  },
  {
    activity: 'exploring',
    keywords: 'explore, search, climb, scout, survey, look for, follow the',
    test: (t) => anyWord(t, 'explores?', 'exploring', 'search(?:es|ing)?', 'climbs?', 'climbing', 'scouts?', 'scouting', 'surveys?', 'surveying')
      || anyWord(t, 'looks?\\s+for') || anyWord(t, 'follows?\\s+the'),
  },
  {
    activity: 'walking',
    keywords: 'walk, head, hike, go to, go down, go up, return, cross',
    test: (t) => anyWord(t, 'walks?', 'walking', 'heads?', 'heading', 'hikes?', 'hiking', 'returns?', 'returning', 'crosses?', 'crossing')
      || anyWord(t, 'goes?\\s+(?:to|down|up)'),
  },
  {
    activity: 'resting',
    keywords: 'sit, rest, lean, watch, lie on, stretch',
    test: (t) => anyWord(t, 'sits?', 'sitting', 'rests?', 'resting', 'leans?', 'leaning', 'watch(?:es|ing)?', 'stretch(?:es|ing)?')
      || anyWord(t, 'l(?:ie|ies|ying)\\s+on'),
  },
];

/**
 * Ordered keyword read of a spoken DO. `location`/`slot` are part of the
 * signature (tick.ts calls this as `activityFromDo(do, location, slot)`) so
 * the same call shape works if a rule ever needs them; today none of the
 * ordered rules do — `location` is currently unused. The two fallbacks that
 * DO need context beyond the DO text itself (night → sleeping is the one
 * that lives here; "SAY non-empty in a together scene → talking" needs to
 * know the SAY and the scene's mode, neither of which this function sees, so
 * that one is applied by the caller, tick.ts, right after calling this).
 */
export function activityFromDo(doText: string, _location: LocationId, slot: Slot): Activity {
  const t = (doText || '').toLowerCase();
  for (const rule of ACTIVITY_RULES) {
    if (rule.test(t)) return rule.activity;
  }
  if (slot === 'night') return 'sleeping';
  return 'idle';
}
