// ─────────────────────────────────────────────────────────────────────────────
// THE SHOP CATALOG — patrons, spec §A2.
//
// Every item here is a GIFT, never a purchase of a guaranteed story outcome:
// what it buys is a bounded, code-applied nudge to the world (a resource, an
// item, a little progress on a project) — never a narrative beat, never
// dialogue, never a fact the model is told to invent. What Kevin and Jenny DO
// with a crate once it washes ashore is entirely their own turn to decide
// (docs/ISLAND.md's core rule, unchanged by any of this).
//
// PRICING RULER (scratchpad/patrons/catalog.md §1, from CLAUDE.md's RULE 4
// coin plans): roughly 20 LB credits ≈ $1 (the Pro-tier rate, ~$0.05/credit)
// for pantry → feasts. That ruler is EXPLICITLY ABANDONED for the Big Gifts —
// a real outboard engine or a sail costs thousands of dollars, which would
// need tens of thousands of credits at this rate, far past the 5,000-credit
// cap the owner set. Big Gifts are priced by relative extravagance against
// EACH OTHER (correctly ordered vs. real-world cost) but compressed under the
// cap — a stated design choice, not a hidden one.
//
// BOUNDING RULE (catalog.md §2, checked against src/world/sim.ts /
// src/world/types.ts): no single gift may equal or exceed what the FREE
// supply boat already gives (+10 food_days / +6 firewood every ~10 days,
// sim.ts#newDay), and no gift may spend more than ~40% of mood's whole
// -5..+5 range even at its most extravagant. Caps enforced, item by item
// below: food_days <= 1.0 (only "The Feast"), water_l <= 60 (one item <= 90),
// firewood <= 8, mood <= +2 (+4 only "The Feast", both agents), a project
// bump never exceeds +40 progress and NEVER completes a project outright
// (world/gifts.ts#deliverGift clamps every project to <= 99 from a gift).
// ─────────────────────────────────────────────────────────────────────────────

export type GiftCategory = 'pantry' | 'treats' | 'feasts' | 'survival' | 'tools' | 'big';

export const CATEGORY_LABEL: Record<GiftCategory, string> = {
  pantry: 'Pantry — cheap staples',
  treats: 'Fresh & treats',
  feasts: 'Feasts',
  survival: 'Survival',
  tools: 'Tools & garden',
  big: 'Big gifts',
};

export const CATEGORY_ORDER: GiftCategory[] = ['pantry', 'treats', 'feasts', 'survival', 'tools', 'big'];

/**
 * The mechanical effect a gift has, ALWAYS applied by code
 * (world/gifts.ts#deliverGift) and never invented or sized by a model — the
 * same boundary sim.ts#applyTransition already enforces for everything else.
 * Every field here is a DELTA (added onto the world's current values), same
 * convention as Transition.resources/agents in sim.ts.
 */
export interface GiftEffect {
  water_l?: number;
  food_days?: number;
  firewood?: number;
  /** Applied to BOTH agents equally — a gift arrives at the cottage, not to one of them. */
  mood?: number;
  energy?: number;
  /** Negative = less hungry. */
  hunger?: number;
  /** An ordinary item, added to the world (world.items) if not already owned. */
  item?: { name: string; note: string };
  /**
   * Bumps the FIRST project whose name matches `match` (case-insensitive
   * substring/regex test against Project.name) by `amount` — clamped to never
   * reach 100 from a gift alone (world/gifts.ts). When no project matches,
   * the gift falls back to `item` (or a generic materials note) instead of
   * silently doing nothing.
   */
  projectBump?: { match: RegExp; amount: number };
  /** Cures 'hurt'/'sick' if either agent currently is; else banked as an item. */
  cureSick?: boolean;
}

export interface CatalogItem {
  id: string;
  name: string;
  emoji: string;
  category: GiftCategory;
  /** Price in LB credits (RULE 4: never a dollar figure anywhere in the app). */
  credits: number;
  /** One line, shown on the item's card. */
  blurb: string;
  /** "In their world: …" — the plain-language version of `effect`, shown on the card. */
  effectLine: string;
  effect: GiftEffect;
  /** Per-item cooldown, in ISLAND days (world/gifts.ts checks delivered+queued gifts within this window). */
  cooldownDays?: number;
  /** A cooldown shared across several items (e.g. all Big Gifts share one 14-day window). */
  cooldownGroup?: string;
}

const BOAT_RE = /\b(boat|dinghy|sail|engine|outboard)\b/i;
const GARDEN_RE = /\b(garden|greenhouse)\b/i;
const REPAIR_RE = /\b(repair|fix|build|mend)\b/i;

export const CATALOG: CatalogItem[] = [
  // ── Pantry: cheap staples, no cooldowns ──
  { id: 'tin_beans', name: 'Tinned beans', emoji: '🥫', category: 'pantry', credits: 12,
    blurb: 'A case of tinned beans, the boring kind that never runs out.',
    effectLine: 'In their world: a little more food in the pantry.',
    effect: { food_days: 0.15 } },
  { id: 'rice_sack', name: 'A sack of rice', emoji: '🍚', category: 'pantry', credits: 15,
    blurb: 'Ten kilos, sealed against the damp.',
    effectLine: 'In their world: a little more food in the pantry.',
    effect: { food_days: 0.2 } },
  { id: 'spice_tin', name: 'Salt & spice tin', emoji: '🧂', category: 'pantry', credits: 10,
    blurb: 'Salt, pepper, a few dried herbs — small, but it changes everything you cook.',
    effectLine: "In their world: a better meal tonight — a small lift in spirits.",
    effect: { mood: 1 } },
  { id: 'peanut_butter', name: 'Peanut butter jar', emoji: '🥜', category: 'pantry', credits: 18,
    blurb: 'A big jar, the kind that lasts weeks.',
    effectLine: 'In their world: food, and a little energy.',
    effect: { food_days: 0.3, energy: 5 } },
  { id: 'dark_chocolate', name: "Jenny's favourite dark chocolate", emoji: '🍫', category: 'pantry', credits: 20,
    blurb: 'The good kind, 85%, wrapped against the heat.',
    effectLine: 'In their world: a small treat, a lift in spirits.',
    effect: { mood: 1, hunger: -10 } },
  { id: 'coffee_tin', name: 'Coffee & tea tin', emoji: '☕', category: 'pantry', credits: 15,
    blurb: 'Real coffee and loose tea, worth more than gold on a quiet island.',
    effectLine: 'In their world: a burst of energy.',
    effect: { energy: 8 } },

  // ── Fresh & treats ──
  { id: 'fruit_basket', name: 'Fresh fruit basket', emoji: '🍍', category: 'treats', credits: 45,
    blurb: 'Mango, pineapple, whatever travelled well — a taste of somewhere else.',
    effectLine: 'In their world: fresh food, a lift in spirits.',
    effect: { mood: 1, hunger: -15 } },
  { id: 'fresh_bread', name: 'A loaf of fresh bread', emoji: '🍞', category: 'treats', credits: 40,
    blurb: "Still warm when it's packed — it won't stay that way, but it'll still be good.",
    effectLine: 'In their world: a real meal, a little food banked.',
    effect: { hunger: -15, food_days: 0.1 } },
  { id: 'cheese_wedge', name: 'A wedge of good cheese', emoji: '🧀', category: 'treats', credits: 55,
    blurb: 'Sharp, aged, nothing like the tinned stuff.',
    effectLine: 'In their world: a small lift in spirits.',
    effect: { mood: 1 } },
  { id: 'honey_jar', name: 'A jar of wild honey', emoji: '🍯', category: 'treats', credits: 60,
    blurb: 'Dark and strong, the kind that keeps forever.',
    effectLine: 'In their world: food, and a small lift in spirits.',
    effect: { food_days: 0.15, mood: 1 } },
  { id: 'island_rum', name: 'A bottle of island rum', emoji: '🥃', category: 'treats', credits: 90,
    blurb: 'Dark rum, the kind meant for sharing at the end of a long day.',
    effectLine: 'In their world: a shared drink, a real lift in spirits.',
    effect: { mood: 2 }, cooldownDays: 1 },
  { id: 'small_cake', name: 'A small cake', emoji: '🎂', category: 'treats', credits: 120,
    blurb: "Nothing fancy — just a cake, for no reason at all, which is exactly the point.",
    effectLine: 'In their world: a real treat, a real lift in spirits.',
    effect: { mood: 2, hunger: -25 }, cooldownDays: 1 },

  // ── Feasts ──
  { id: 'lobster_dinner', name: 'Lobster dinner for two', emoji: '🦞', category: 'feasts', credits: 450,
    blurb: 'Two whole lobsters, packed in ice, with everything that goes with them.',
    effectLine: 'In their world: a real dinner, a lift in spirits, food banked.',
    effect: { mood: 2, hunger: -30, food_days: 0.3 } },
  { id: 'champagne', name: 'A bottle of real champagne', emoji: '🍾', category: 'feasts', credits: 500,
    blurb: 'Cold, if the ice holds — worth the trouble either way.',
    effectLine: 'In their world: a real occasion, a lift in spirits.',
    effect: { mood: 2 }, cooldownDays: 3 },
  { id: 'caviar_tin', name: 'A tin of caviar', emoji: '🐟', category: 'feasts', credits: 650,
    blurb: 'Absurd, on an island with a working reef full of actual fish — that\'s rather the point.',
    effectLine: 'In their world: a strange little luxury, a lift in spirits.',
    effect: { mood: 2 } },
  { id: 'wagyu_steaks', name: 'Wagyu steaks for two', emoji: '🥩', category: 'feasts', credits: 900,
    blurb: 'The good stuff, marbled and absurd, flown further than either of them has been in a year.',
    effectLine: 'In their world: a real feast, a real lift in spirits.',
    effect: { mood: 3, hunger: -30, energy: 10 } },
  { id: 'the_feast', name: '"The Feast" — a full spread for two', emoji: '🎉', category: 'feasts', credits: 2000,
    blurb: 'Everything at once: the lobster, the wine, the cake, the whole table. The single biggest gift the shop sells.',
    effectLine: 'In their world: the biggest lift in spirits the shop can give, a real dinner, food banked — for both of them.',
    effect: { mood: 4, hunger: -40, food_days: 1.0 }, cooldownDays: 5, cooldownGroup: 'feast' },

  // ── Survival ──
  { id: 'purification_tabs', name: 'Purification tablets', emoji: '💊', category: 'survival', credits: 30,
    blurb: 'A strip of iodine tablets — the boring, unglamorous kind of safety.',
    effectLine: 'In their world: a stocked item; safer drinking water while it lasts.',
    effect: { item: { name: 'water purification tablets', note: 'a strip, for when boiling isn\'t possible' } } },
  { id: 'water_filter', name: 'A portable water filter', emoji: '🧴', category: 'survival', credits: 120,
    blurb: 'A hand-pump filter — one less reason to gamble on the spring.',
    effectLine: 'In their world: a stocked item; safer drinking water.',
    effect: { item: { name: 'a portable water filter', note: 'pumps a litre a minute, no boiling needed' } } },
  { id: 'limes_crate', name: 'A crate of limes, against scurvy', emoji: '🍋', category: 'survival', credits: 60,
    blurb: 'A whole crate, sharp and green — an old sailor\'s answer to a real risk.',
    effectLine: 'In their world: fresh food banked.',
    effect: { food_days: 0.2, item: { name: 'a crate of limes', note: 'against scurvy, half-joked about, half not' } } },
  { id: 'first_aid_kit', name: 'First-aid kit', emoji: '🩹', category: 'survival', credits: 150,
    blurb: 'Bandages, antiseptic, the basics — restocked properly this time.',
    effectLine: "In their world: heals a real injury if either of them has one; otherwise a stocked kit.",
    effect: { cureSick: true, item: { name: 'a first-aid kit', note: 'freshly stocked' } } },
  { id: 'medicine_chest', name: 'A medicine chest', emoji: '💉', category: 'survival', credits: 350,
    blurb: 'A proper chest, not just a kit — the kind a small clinic would keep.',
    effectLine: "In their world: heals a real illness or injury if either of them has one; otherwise a stocked chest, banked for later.",
    effect: { cureSick: true, item: { name: 'a medicine chest', note: 'stocked for whatever comes next' } } },
  { id: 'tarp_rope', name: 'Tarp & rope', emoji: '🪢', category: 'survival', credits: 45,
    blurb: 'A heavy tarp and a coil of good rope — unglamorous, always useful.',
    effectLine: 'In their world: a stocked item.',
    effect: { item: { name: 'a tarp and coil of rope', note: 'heavy-duty' } } },
  { id: 'rain_barrel_liner', name: 'Rain barrel liner', emoji: '🛢️', category: 'survival', credits: 200,
    blurb: 'A liner for the rain tank, patching the one leak they never quite fixed.',
    effectLine: 'In their world: water in the tank, right away.',
    effect: { water_l: 40 } },
  { id: 'firewood_bundle', name: 'A big bundle of dry firewood', emoji: '🪵', category: 'survival', credits: 35,
    blurb: 'Already split and dried — no chopping needed.',
    effectLine: 'In their world: dry firewood, right away.',
    effect: { firewood: 6 } },
  { id: 'solar_lantern', name: 'A solar lantern', emoji: '🔦', category: 'survival', credits: 140,
    blurb: 'Charges all day on the porch rail, gives real light after dark.',
    effectLine: 'In their world: a stocked item, a little energy saved on dark evenings.',
    effect: { energy: 5, item: { name: 'a solar lantern', note: 'charges on the porch rail' } } },

  // ── Tools & garden ──
  { id: 'seed_packets', name: 'Heirloom seed packets', emoji: '🌱', category: 'tools', credits: 50,
    blurb: 'A proper mixed set, chosen for a climate like theirs.',
    effectLine: "In their world: progress on the garden if it's under way, otherwise a stocked item.",
    effect: { projectBump: { match: GARDEN_RE, amount: 8 }, item: { name: 'heirloom seed packets', note: 'a mixed set' } } },
  { id: 'fishing_tackle', name: 'Fishing tackle box', emoji: '🎣', category: 'tools', credits: 70,
    blurb: 'Hooks, line, lures — everything the dock never had enough of.',
    effectLine: 'In their world: a stocked item.',
    effect: { item: { name: 'a fishing tackle box', note: 'hooks, line, lures' } } },
  { id: 'hand_axe', name: 'A good hand axe', emoji: '🪓', category: 'tools', credits: 90,
    blurb: 'Properly balanced, properly sharp — a real tool, not the dull one from the shed.',
    effectLine: 'In their world: a stocked item, a little firewood cut easier.',
    effect: { firewood: 2, item: { name: 'a good hand axe', note: 'properly balanced' } } },
  { id: 'repair_kit', name: 'Repair tool kit', emoji: '🔧', category: 'tools', credits: 130,
    blurb: 'Wrenches, epoxy, spare fittings — the kind of kit that finishes a stalled job.',
    effectLine: "In their world: progress on a repair or building project if one is under way, otherwise a stocked item.",
    effect: { projectBump: { match: REPAIR_RE, amount: 10 }, item: { name: 'a repair tool kit', note: 'wrenches, epoxy, spare fittings' } } },
  { id: 'crab_traps', name: 'A pair of crab traps', emoji: '🦀', category: 'tools', credits: 60,
    blurb: 'Wire traps, ready to set off the tide pools.',
    effectLine: 'In their world: a stocked item.',
    effect: { item: { name: 'a pair of crab traps', note: 'wire, ready to set' } } },
  { id: 'citrus_saplings', name: 'Herb & citrus saplings', emoji: '🌿', category: 'tools', credits: 45,
    blurb: 'Young lime and lemongrass saplings, already rooted.',
    effectLine: "In their world: progress on the garden if it's under way, otherwise a stocked item.",
    effect: { projectBump: { match: GARDEN_RE, amount: 5 }, item: { name: 'herb and citrus saplings', note: 'already rooted' } } },

  // ── Big gifts — 1,800–5,000 credits, deliberately rare ──
  { id: 'radio_parts', name: 'Radio antenna parts', emoji: '📻', category: 'big', credits: 1800,
    blurb: "New antenna wire and a better ground — flavour only: it doesn't change what the shortwave picks up, only what they have to work with.",
    effectLine: 'In their world: a stocked item.',
    effect: { item: { name: 'radio antenna parts', note: 'new wire, a better ground' } },
    cooldownDays: 14, cooldownGroup: 'big' },
  { id: 'mainsail', name: 'A patched mainsail', emoji: '⛵', category: 'big', credits: 2200,
    blurb: 'A real sail, cut and patched for a boat their size.',
    effectLine: 'In their world: real progress on a sailing or boat project if one is under way, otherwise a stocked item.',
    effect: { projectBump: { match: BOAT_RE, amount: 20 }, item: { name: 'a patched mainsail', note: 'cut for a boat their size' } },
    cooldownDays: 14, cooldownGroup: 'big' },
  { id: 'engine_parts', name: 'Outboard engine parts', emoji: '⚙️', category: 'big', credits: 2800,
    blurb: 'The parts to actually put an engine on the dinghy, at last.',
    effectLine: 'In their world: real progress on a boat or engine project if one is under way, otherwise a stocked item.',
    effect: { projectBump: { match: BOAT_RE, amount: 25 }, item: { name: 'outboard engine parts', note: 'enough to fit a small engine' } },
    cooldownDays: 14, cooldownGroup: 'big' },
  { id: 'greenhouse_kit', name: 'A small greenhouse kit', emoji: '🏡', category: 'big', credits: 3200,
    blurb: 'Frame, panels and proper beds — a real greenhouse, not just a patch of dirt.',
    effectLine: "In their world: real progress on the garden if it's under way, otherwise a stocked item.",
    effect: { projectBump: { match: GARDEN_RE, amount: 30 }, item: { name: 'a small greenhouse kit', note: 'frame, panels, proper beds' } },
    cooldownDays: 14, cooldownGroup: 'big' },
  { id: 'proper_boat', name: 'A proper little boat', emoji: '🚤', category: 'big', credits: 5000,
    blurb: 'The rarest thing the shop sells: not parts this time — an actual small boat, seaworthy, towed in on the next tide.',
    effectLine: 'In their world: real progress on a boat project (never enough, on its own, to finish one), otherwise it simply arrives as an item and a story to notice.',
    effect: { projectBump: { match: BOAT_RE, amount: 40 }, item: { name: 'a small seaworthy boat', note: 'towed in on the tide' } },
    cooldownDays: 30, cooldownGroup: 'boat' },
];

export function findItem(id: string): CatalogItem | undefined {
  return CATALOG.find((i) => i.id === id);
}

export function itemsByCategory(category: GiftCategory): CatalogItem[] {
  return CATALOG.filter((i) => i.category === category);
}
