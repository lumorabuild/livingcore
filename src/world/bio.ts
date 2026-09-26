// ─────────────────────────────────────────────────────────────────────────────
// WHO THEY ARE AND WHERE THEY LIVE.
//
// Until the island era, Kevin and Jenny were told only "you are a married
// couple on a remote island" — no past, no skills, no wants, nothing to do.
// Two assistant-tuned models given nothing converge on the one thing they
// share: agreeable warmth. 72,000 turns of it ended in "my heart is
// overflowing with love and gratitude" on repeat.
//
// These are FACTS about their lives, not instructions for how to talk. Nothing
// here sets a tone, a length or a topic. It gives each of them a history to
// draw on, things they are good and bad at, and a want that is not the same as
// the other's — which is what makes two people two people.
// ─────────────────────────────────────────────────────────────────────────────

import type { AgentId, Location, LocationId } from './types';

export const ISLAND_NAME = 'Sorrel Island';

export const LOCATIONS: Record<LocationId, Location> = {
  cottage: {
    id: 'cottage', name: "the keeper's cottage", x: 520, y: 360, discoveredAtStart: true,
    description: 'Two rooms of whitewashed stone: a kitchen with a wood stove and the shortwave radio on the shelf, a bedroom, a porch facing south. A 400-litre rain tank sits against the back wall.',
  },
  garden: {
    id: 'garden', name: 'the garden', x: 585, y: 395, discoveredAtStart: true,
    description: 'A walled patch behind the cottage, half reclaimed by weeds. Salt wind burns anything unprotected. Jenny\'s seed tin lives on the shelf inside.',
  },
  dock: {
    id: 'dock', name: 'the dock', x: 470, y: 520, discoveredAtStart: true,
    description: 'A short timber jetty where the supply boat ties up every ten days. Two planks are rotten. A dinghy with no engine is tied to the end.',
  },
  beach: {
    id: 'beach', name: 'the south beach', x: 610, y: 545, discoveredAtStart: true,
    description: 'A long arc of pale sand. Whatever the sea gives up — driftwood, floats, rope, bottles — ends up here.',
  },
  tidepools: {
    id: 'tidepools', name: 'the tide pools', x: 760, y: 500, discoveredAtStart: true,
    description: 'Black rock shelves east of the beach. At low tide: crabs, limpets, octopus, urchins. At high tide the shelf floods fast.',
  },
  woods: {
    id: 'woods', name: 'the woods', x: 420, y: 300, discoveredAtStart: true,
    description: 'Screw pines, a few coconut palms and dense scrub in the island\'s middle. Good firewood, bad paths, loud birds.',
  },
  spring: {
    id: 'spring', name: 'the spring', x: 355, y: 245, discoveredAtStart: true,
    description: 'A trickle of fresh water from a crack in the rock, pooling in a stone basin. Nobody has tested it.',
  },
  hilltop: {
    id: 'hilltop', name: 'the hilltop', x: 470, y: 180, discoveredAtStart: true,
    description: 'The island\'s high point, bare grass and a cairn. You can see weather coming from forty kilometres off, and on a clear day a smudge of land to the north-east.',
  },
  cliffs: {
    id: 'cliffs', name: 'the north cliffs', x: 640, y: 120, discoveredAtStart: true,
    description: 'Thirty-metre cliffs with a colony of noddies and boobies. The ledges are slick with guano; the view is enormous.',
  },
  lighthouse: {
    id: 'lighthouse', name: 'the old lighthouse', x: 760, y: 150, discoveredAtStart: true,
    description: 'A decommissioned lighthouse on the north-east point. The door is rusted shut and padlocked; the lamp room windows are intact. The trust never gave them a key.',
  },
  cave: {
    id: 'cave', name: 'the sea cave', x: 215, y: 360, discoveredAtStart: false,
    description: 'A cave on the west shore reachable only at low tide, dry at the back, smelling of salt and something older.',
    hiddenHint: 'On the west shore, only reachable at a low tide; someone exploring the west side on foot could find it.',
  },
  wreck: {
    id: 'wreck', name: 'the wreck on the reef', x: 170, y: 520, discoveredAtStart: false,
    description: 'The ribs of an old wooden fishing boat wedged on the south-west reef, exposed at low tide.',
    hiddenHint: 'Visible from the hilltop or the west shore at a very low tide; reaching it means wading or rowing.',
  },
  cove: {
    id: 'cove', name: 'the hidden cove', x: 850, y: 330, discoveredAtStart: false,
    description: 'A tiny sheltered cove on the east side with clear water and a strip of sand, invisible from the land until you are above it.',
    hiddenHint: 'Only visible from the cliffs path or from the water on the east side.',
  },
  // Patrons (spec §A2, protocol island-3): undiscovered until the first gift
  // crate is delivered (world/gifts.ts#deliverGift reveals it) — never found
  // by ordinary exploration, the way cave/wreck/cove are.
  shrine: {
    id: 'shrine', name: 'the old shrine', x: 565, y: 200, discoveredAtStart: false,
    description: 'A ring of weathered stones on the ridge between the hilltop and the cliffs, older than the lighthouse. Names are carved into some of them, worn soft by weather.',
    hiddenHint: 'Never found by looking — only ever revealed alongside a gift that washes ashore.',
  },
};

export const LOCATION_IDS = Object.keys(LOCATIONS) as LocationId[];

/** Skills the dice understand. Anything else a model invents is folded into the closest one or dropped. */
export const SKILLS = [
  'mechanics', 'building', 'fishing', 'navigation', 'cooking', 'gardening',
  'botany', 'drawing', 'first_aid', 'foraging', 'swimming', 'radio', 'music', 'writing',
] as const;
export type Skill = typeof SKILLS[number];

export interface Biography {
  id: AgentId;
  name: string;
  partner: string;
  age: number;
  /** Second-person, so it reads as their own history when injected. */
  story: string;
  /** Private long-term want at the start of the era. */
  want: string;
  /** Starting skill XP (level = floor(sqrt(xp/2))). 50xp ≈ level 5, 98xp ≈ 7, 128xp ≈ 8. */
  xp: Partial<Record<Skill, number>>;
  /** Colours for the site — kept with the character so the UI never hardcodes a second copy. */
  color: string;
  emoji: string;
}

export const BIOGRAPHIES: Record<AgentId, Biography> = {
  kevin: {
    id: 'kevin', name: 'Kevin', partner: 'Jenny', age: 41, color: '#4ecdc4', emoji: '🔧',
    story:
      'You grew up in a port town and spent fifteen years as a marine diesel engineer on cargo ships. ' +
      'You can keep almost any engine alive with the wrong parts, and you are restless when your hands are idle. ' +
      'You say less than Jenny and mean most of it; your humour is dry. ' +
      'Years ago you went overboard in a storm in the Bay of Biscay and were in the water for forty minutes; you do not talk about it, and deep water still tightens your chest. ' +
      'You have not spoken to your younger brother Tom since an argument the week before you left, and it sits with you. ' +
      'You keep the old shortwave radio working, partly for the weather, partly because it is the only voice from outside.',
    want: 'Get the dinghy seaworthy with some kind of engine or sail, so that you are never again somewhere you cannot leave.',
    xp: { mechanics: 110, building: 60, navigation: 40, fishing: 22, radio: 60, swimming: 18, cooking: 8, gardening: 2 },
  },
  jenny: {
    id: 'jenny', name: 'Jenny', partner: 'Kevin', age: 38, color: '#ff6b9d', emoji: '🌿',
    story:
      'You are a botanist and scientific illustrator. You spent eight years cataloguing plants at a city herbarium until you burned out and stopped sleeping. ' +
      'You notice everything, you sketch everything, and you are impatient with vagueness. You laugh easily, but when you are hurt you go quiet instead of saying so. ' +
      'You brought a tin of seeds from your grandmother\'s garden and have not planted most of them yet, afraid of wasting them. ' +
      'Nobody has ever properly surveyed this island\'s plants, and you want to be the one who does.',
    want: 'Make the island feed you both, and stay — for good, not just for the contract.',
    xp: { botany: 128, drawing: 128, gardening: 50, foraging: 50, first_aid: 32, cooking: 32, writing: 32, fishing: 2, building: 8, swimming: 18 },
  },
};

/** Shared history — true for both of them, told to both. */
export const SHARED_STORY =
  `You have been married six years. Eleven months ago you took a two-year caretaker contract from a small conservation trust that owns ${ISLAND_NAME}: ` +
  'keep the old keeper\'s cottage standing, record the seabirds and plants, and report by radio once a week. ' +
  'Nobody else lives here. A supply boat from the mainland — two days\' sail away — is supposed to come every ten days, and sometimes does not. ' +
  'For most of those eleven months you mostly talked: about a sensory garden you would build, about the life you would make here. ' +
  'You never actually built it. The garden behind the cottage is still half weeds.';

export function skillLevel(xp: number): number {
  return Math.min(10, Math.floor(Math.sqrt(Math.max(0, xp) / 2)));
}
