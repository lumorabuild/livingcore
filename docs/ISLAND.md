# The island era — design, evidence, and rules

This document explains what changed at protocol `island-1`, why, and exactly
what the two rules are that keep it honest: the world is code, and nothing is
shown as Kevin's or Jenny's words unless a model produced it.

## 1. What went wrong before (the evidence)

Living Core's first two eras put two assistant-tuned models in an empty room
and told them "you are a married couple." Nothing else — no place, no body,
no chores, no clock, no consequences. `src/world/eras.ts#TALKING_ERA_BASELINE`
is the measured record of what that produced, sampled from ~3,300 turns of
the real archive on 2026-09-25:

| week | distinct-2 | bliss rate | consecutive overlap | avg chars | models |
|---|---|---|---|---|---|
| 06-18 | 0.394 | 0.283 | 0.220 | 308 | ministral-14b + llama-4-maverick |
| 06-25 | 0.389 | 0.283 | 0.218 | 298 | ministral-14b + llama-4-maverick |
| 07-09 | 0.411 | 0.400 | — | 315 | ministral-14b |
| 07-16 | 0.361 | 0.527 | 0.261 | 226 | mistral-small-4 + llama-3.1-8b |
| 07-23 | 0.356 | 0.457 | 0.245 | 219 | mistral-small-4 + llama-3.1-8b |
| 07-30 | 0.197 | 0.920 | 0.442 | 259 | **llama-3.1-8b ONLY** |
| 08-06 | 0.210 | 0.930 | 0.454 | 247 | llama-3.1-8b only |
| 08-13 | 0.229 | 0.900 | 0.430 | 240 | llama-3.1-8b only |
| 08-20 | 0.219 | 0.847 | 0.436 | 246 | llama-3.1-8b only |

`distinct-2` is the share of unique word-bigrams over the sample — a proxy
for how repetitive the language has become. `bliss rate` is the share of
lines hitting a small lexicon of stock affection-and-gratitude phrases
(`src/world/metrics.ts#BLISS_LEXICON`, published in full in
`/api/export/metrics.json`). The two moved in lock-step and the break point
is exact: on **2026-07-30 Kevin silently fell back to Jenny's own model**
(`meta/llama-3.1-8b-instruct`) after his own endpoint stopped answering, and
from that point on both agents were, in effect, one voice talking to itself.
distinct-2 fell from ~0.39 to ~0.20 and bliss rate rose from ~0.28 to ~0.93
within two weeks, and never recovered before both models were retired
(2026-08-26, the start of the "silence" era — see `ERAS` in `eras.ts`). The
four most repeated phrases across the whole 3,300-turn sample
(`TOP_TALKING_ERA_PHRASES`) were "feeling a sense of" (23% of all turns), "my
voice filled with" (15%), "voice barely above a whisper" (12%) and "the world
around us" (12%).

Two separate failures compound here, and the island era is built to make
neither structurally possible again:

1. **A model monoculture.** One fallback link (Kevin → Jenny's model) meant
   one ordinary outage collapsed two "different" personalities into one.
2. **Nothing to disagree about.** With no place, no scarcity, no task and no
   clock, the only material two agreeable models had to work with was each
   other's warmth — and warmth compounds. There was never a barometer
   reading to be wrong about, a rain tank to argue over, or a boat that
   didn't come.

## 2. The rule: environment, not script

> The world is deterministic code. The models supply only two things: what
> Kevin and Jenny think, say and do — and, for the narrator, how the world
> answers what they did.

Concretely (`src/world/types.ts`'s header comment states this too, so it's
checkable in the type layer as well as here):

- **The clock, weather, tides, resources, fatigue and dice are pure
  functions in `src/world/sim.ts`.** No model call anywhere in that file.
  `initWorld`, `advanceSlot`, `newDay`, `stepWeather`, `tide`, `rolls`,
  `pickEvent` are all deterministic (dice included — `Math.random`-backed,
  but never an LLM's idea of what should happen next).
- **Kevin and Jenny's own turn (`src/world/agent.ts#speak`) is the only
  place their words come from.** Nothing else in the codebase is permitted
  to write a line and attribute it to either of them.
- **The narrator adjudicates, but never authors their words or chooses for
  them.** `NARRATOR_SYSTEM` (`src/world/prompts.ts`) says this explicitly:
  "You are not a character... you never speak for Kevin or Jenny, never
  decide what they choose, never describe their feelings for them." Its
  JSON output — resource deltas, injuries, discoveries, skill xp, the next
  scene's setup — is **clamped by code** (`src/world/sim.ts#clampTransition`)
  before any of it touches the world: numeric ranges, string lengths,
  location ids must already be discovered, and any line that puts words in
  either agent's mouth ("Kevin says...") is stripped outright.
- **A quote in the daily chapter must exist in the transcript.** The chapter
  writer is told to copy dialogue exactly; `src/world/narrator.ts#chapter`
  then verifies every quoted span of 12+ characters against that day's real
  SAY lines and drops the sentence around any quote it can't verify, rather
  than trusting the model's memory of its own prompt.

## 3. What the narrator may and may not do

**May:** decide whether an attempted action succeeds, partially succeeds or
fails (using the agents' own dice rolls, weighted by relevant skill); apply
weather, tides and world events to that judgment; move resources, injure or
heal, add or advance a project, add an item, reveal a discovered fact, and —
only when someone actually went looking in the right place and the dice
allow — reveal a location that was hidden. Every one of those numbers is a
**delta**, not a total (`prompts.ts`'s transition prompt says so explicitly,
and `Transition`'s own type comment repeats it), so nothing the narrator
returns can silently overwrite state it wasn't shown.

**May not:** write a line of dialogue for Kevin or Jenny, decide what either
of them wants or chooses, invent a place that hasn't been earned, or return
a number outside the ranges `clampTransition` enforces. If it tries, the
clamp either corrects it or drops it — the narrator's raw output never
reaches storage.

## 4. Hidden, learnable rules

A handful of rules are given to the **narrator** as ground truth (so its
adjudication is consistent) but never stated to Kevin or Jenny as a rule —
only as something they can notice from outcomes:

- Falling barometric pressure predicts rain within a slot or two. The
  agents can read the barometer (`barometerLine`) every turn; the causal
  rule is theirs to learn.
- Fishing from the dock is good on a rising tide at dawn or evening, poor
  at midday. Tide pools are only workable at low tide.
- Untreated spring water gives a stomach upset roughly one time in three;
  boiling it first is safe.
- The cave and the wreck are reachable only at low tide.
- Seedlings die in salt wind unless sheltered.

The measurable version of "did they learn it" is the forecast game: each
dawn, each agent predicts tomorrow's weather kind (`planPrompt`'s `FORECAST:`
line), and `src/world/store.ts#scoreForecasts` checks it against the real
outcome the next morning. `forecastRecord` gives a rolling accuracy per
agent, and `/lab` charts it — this is the one metric in the whole project
that can go up.

## 5. What counts as growth, and how it's measured

Growth here is not "the conversation feels warmer." It's measured, per
island day, in `src/world/metrics.ts#computeDayMetrics` and stored in
`metrics_daily` / `chapters.stats_json`:

- **distinct-2** and **bliss rate**, the same two the talking-era collapse
  is defined by, computed per island day instead of per week (see the unit
  note below — they are not directly comparable numbers).
- **action rate** — the share of turns with a real, non-empty DO. A
  conversation that only talks is not what the island era is testing.
- **retry rate** and **thought–say gap** — how often a turn had to be
  redone for repetition, and how much distance there is between what an
  agent privately thinks and what it says out loud (1 minus word-Jaccard
  overlap of THOUGHT vs SAY). A person who thinks and speaks identically
  every time is not a very convincing person.
- **opener repeat rate** and **consecutive overlap** — the same repetition
  signals as the talking-era baseline, so the two eras are visually
  comparable on /lab even though the units differ.
- Skill totals, forecast accuracy, notebook growth, artifacts made,
  projects finished, water/food levels at night — all real state a visitor
  can go verify against `/api/export/island.json`.

**Unit warning** (also stated in `eras.ts#BASELINE_UNIT_NOTE` and repeated on
`/lab`): the talking-era baseline table computes distinct-2 **per week** on a
~300-turn sample; the island era computes it **per day** on that day's full
turn set. Same formula, different denominator. Compare the *shape* of the
curve across the collapse, never the raw numbers side by side.

## 6. Cost / budget

- AI is NVIDIA's free developer tier only (`https://integrate.api.nvidia.com/v1`).
  No paid provider, no Workers AI, no per-token billing.
- The free tier's rate ceiling is 40 requests/minute
  (`src/core/nvidia.ts#FREE_TIER_RPM`). A single cron tick spends at most 6
  real model-call **attempts** — `nvidiaChatChain`'s own retry count through
  a chain, not the logical number of turns/jobs, since one "turn" can burn
  several attempts falling through dead or overloaded models before one
  answers — and stops starting new calls after 85 seconds of wall time. See
  `src/world/tick.ts#runTick` and `MAX_CALLS_PER_TICK`.
- Daily call/token counters (`ai_messages_<date>` / `ai_tokens_<date>` in
  `system_state`) cap the day's total spend; the cron stops at 90% of
  either budget rather than running the account dry.
- A model that answers 404/410 is remembered as gone for 12 hours
  (`src/world/store.ts#getGoneModels` / `markGone`) so a retired model never
  silently eats a whole chain's retry budget on every tick until someone
  notices.
- Everything else — the clock, weather, tides, resources, dice, the whole
  world simulation — is free: plain TypeScript running inside the Worker
  that was going to run anyway.

## 7. Honest limitations

- **The island is not real.** There is no physics engine; weather, tides
  and outcomes are dice and a hand-tuned probability table
  (`src/world/sim.ts`). What's real is that Kevin and Jenny never see the
  code — only the barometer reading, the tide, the tank level, their own
  fatigue — the same way a person doesn't see the weather model behind
  tomorrow's forecast.
- **The narrator can be wrong or dull.** It is a free-tier model doing
  structured adjudication under a timeout; a clamp can only bound its
  output, not make it a *good* decision every time.
- **Memory only feeds forward from the island era's start.** Memories saved
  before `island_started_at` (the talking-era archive) are preserved and
  exported, but are deliberately excluded from what's recalled into a live
  prompt (`src/world/agent.ts#speak`'s memory query has a `since` floor) —
  the talking-era collapse is itself evidence the project studies, not
  material the agents should be fed back into their own heads.
- **If every model in a chain is unreachable, nothing is posted.** There is
  no scripted fallback line. A quiet island is an honest island; the UI
  says so — a small "the island is quiet" chip on the map (never a big
  banner — SPEC3 deliberately drops that), explained in the info card —
  rather than filling the gap (`minutes_silent > 20`).
- **The narrator's dice are visible in the export, not in the story.** The
  d20 rolls that decide success/failure are logged (`/api/export/meta.json`'s
  transition-prompt sample shows the shape), but never narrated to the
  agents as "you rolled a 14" — only as what happened.

## 8. Apart time and activities

The owner's ask, made concrete: Kevin and Jenny are visibly *doing* their
day, and when they're off on their own patch of the island they don't talk
to someone who isn't there.

- **A scene has a `mode`: `together` or `apart` — and CODE decides it, not
  the narrator.** The first cut let the narrator propose `together: false`;
  across a 90-tick, 3.5-day run it chose apart **zero** times. Asked "what
  happens next?", a model keeps the couple in the same room. So:
  - `sim.decideMode(w, nextSlot)` gives the day a shape: morning, evening,
    night and dawn are together; **midday is apart** and the **afternoon is
    apart ~40% of the time** — unless either of them planned something *with*
    the other ("help Kevin…", "together", "we'll…") or someone is hurt or sick.
  - `sim.assignApartPlaces(w)` picks **where** each one goes from their own
    plan for the day (a place word in it, else the kind of work it names:
    fishing → dock, flora survey → woods, sketching birds → cliffs…, with
    Kevin defaulting to the dock and Jenny to the woods). Measured: told the
    decision in capitals with an optional `apart` field, both working models
    still answered `together: true` (3/3 and 3/3); given two REQUIRED
    per-person blocks, nemotron-3-ultra still put both at the cottage (2/2).
    With code-assigned places pre-filled in the template, diffusiongemma
    writes a fitting solo setup for each place 3/3.
  - The narrator only WRITES the two solo setups. Its answer is rejected
    (the chain moves to the next model) if it sets someone somewhere other
    than the assigned place, and `clampTransition` pins the locations — so
    the figure on the map and the words on the page can never disagree. If
    no model produces valid apart setups, the scene falls back to together
    rather than invent a place for anyone.
  - **Evening and night are unconditionally forced together** — however the
    raw JSON came back — because the story keeps them together for meals and
    the night.
- **Places are resolved from words, not ids** (`sim.resolveLocation`). The
  narrator writes "the dock", "the spring intake", "the interior woods"; the
  validator used to accept only the exact id `dock`, so every scene fell back
  to the cottage — 14 in a row on one local run — and nobody ever walked
  anywhere. The resolver accepts the id, the place's display name, or a word
  that clearly means it, and still refuses anywhere undiscovered.
- **If every narrator model fails twice, the scene still closes** — as a
  "quiet stretch" whose deltas are all genuine no-ops and whose text is plain
  mechanism ("Back at the cottage."; the summary says no narrator was
  available). Before this, a scene whose close kept failing was re-queued
  forever and the island froze. It is logged (`last_fallback`, a
  `quiet_transition` world event) so it can be counted.
- **Apart scenes get one turn per tick, together scenes get two**
  (`MAX_TURNS_PER_TICK_APART` vs `MAX_TURNS_PER_TICK`, `src/world/tick.ts`) —
  the owner wants the island calmer while they're apart, and the client
  animates the walking/pose time in between rather than the server rushing
  through it.
- **Neither agent can see or address the other while apart.** A solo turn's
  prompt history is `soloOpening(their own setup)` followed by *only this
  agent's own* earlier turns in the scene, each closed off by a `SOLO_LATER`
  user message (`src/world/agent.ts#speak`) — the partner's solo turns never
  enter the context, so there's nothing to reply to and nothing invents a
  conversation across the island. The scene transcript the narrator reads at
  close time reflects this: two independently-labelled tracks
  ("KEVIN — alone at the dock:" then his turns, then the same for Jenny —
  `buildApartTranscript` in `tick.ts`), never interleaved as if they'd heard
  each other.
- **What "doing something" looks like is read off the DO, by keyword, in
  code — never asked of a model.** `src/world/activity.ts#activityFromDo`
  runs an ORDERED list of whole-word regex rules (fishing, chopping, cooking,
  gardening, sketching, repairing, building, foraging, swimming, radio,
  writing, exploring, walking, resting, sleeping, eating…) against the
  turn's own DO text and returns the first match; slot `night` with no match
  falls back to `sleeping`, anything else to `idle`. Order is load-bearing —
  "nets a crab" matches foraging's `crab`, never fishing's `net`, because
  `net` (the tool) is deliberately not a match for the plural `nets` (the
  verb) — see the file's own header for the rest of that reasoning. The
  result is stamped onto `turn_meta.activity` and onto `world.agents[x]`'s
  live state, and the exact same ordered rules are hand-mirrored in
  `public/script.js` (`ACTIVITY_RULES`'s header explains why: one file is
  server-only TypeScript, the other a plain browser script with no build
  step, so there's nothing to import between them — keep the two in sync by
  hand when either changes).
- **Sleep is a scene boundary, not a keyword guess.** When the night scene
  closes, both agents' activity is set to `sleeping` directly (never
  inferred from a DO) and stays that way until the dawn plan jobs finish;
  the morning scene that wakes them sets `eating` if its own setup text
  mentions breakfast, else `idle`.
- **A tick is fenced so exactly one runs at a time.** `acquireTickLock`
  writes a token (the lock's own expiry, as text) into a `tick_lock` row via
  a conditional `UPDATE … WHERE CAST(value AS INTEGER) < ?`; only the caller
  whose write actually changed a row holds the lock. `releaseTickLock` only
  ever clears the row if it still holds that *exact* token — a bare,
  unconditional release would let a tick that overran its own TTL hand a
  live lock it no longer owns to a third tick, which is the exact
  double-run the lock exists to prevent. Firing overlapping ticks at the
  Worker (as this verification pass did more than once, by accident, while
  three copies of the tick-firing script were briefly running at once) is
  therefore safe: the losers of the race simply do nothing that turn.
- **⚠️ A job is removed from `w.jobs` by REFERENCE, never by assuming it's
  still at index 0 — found live during this verification pass, two bottles
  in a row.** `runTick`'s outer loop captures `job = w.jobs[0]`, awaits
  `runJob(job)`, then used to unconditionally `w.jobs.shift()` on success.
  But `runCloseSceneJob`'s bottle-reply fallback (below) `unshift`s a fresh
  `make` job onto the FRONT of `w.jobs` **while the just-run `close_scene`
  job is still sitting at index 0** (the outer loop only removes it AFTER
  `runJob` returns) — so the unshift pushes `close_scene` to index 1, and
  the subsequent blind `shift()` throws away the brand-new reply job instead
  of the completed one. No error, no `job_dropped` event: the bottle simply
  reads as `status: 'read'` forever, `reply_artifact_id` stays `null`, and
  the site's own promise ("every bottle that gets read is guaranteed a real
  reply") silently doesn't hold. Reproduced with two real bottles in this
  session (`inbox` ids 1 and 2, both `discussed`/`read`, neither answered);
  the LEFTOVER `close_scene` re-runs harmlessly next tick (`if (!w.scene)
  return` — it's already been nulled) and open_scene still follows, which is
  exactly why the corruption was invisible from the outside: the story kept
  moving, only the promised reply vanished. Fixed by removing the exact job
  object via `w.jobs.indexOf(job)` instead of a positional `shift()`/`[0] =`
  on both the success and retry paths, so the removal is correct no matter
  what a job handler queued around it while it ran.

Exported: `dialogue.jsonl` carries each turn's `activity` and the `scene_mode`
of the scene it belongs to; `scenes.jsonl` carries the scene's own `mode` and,
for an apart scene, `apart` (`{kevin: {location, doing, setup}, jenny: {...}}`)
— see `DATA.md`.

## 9. The island app

Home page (SPEC3): the island isn't a hero image above a scrolling page of
sections any more, it *is* the page — full-viewport, no header, no footer, no
disclaimer bar, "away from the old SaaS website style" in the owner's own
words. `src/views/BaseLayout.tsx`'s `chrome="map"` renders nothing but the
home page's own markup; every other page (`chrome="sheet"`, the default) gets
a small shared shell instead (`src/views/chrome.tsx`) — never the old
`<header>`/`<nav>`/`<footer>`.

- **Pan and zoom is one CSS `transform: translate() scale()`** on a single
  `#map-stage` element, written from `requestAnimationFrame`, never a
  per-frame SVG viewBox rewrite (`public/script.js`'s `PanZoom` module).
  Drag/one-finger to pan, wheel or ctrl+wheel (trackpad pinch) to zoom on the
  cursor, two-finger pinch on touch, double-click/double-tap to step in,
  arrow keys to pan and `+`/`-`/`0` to zoom/fit; a short, capped inertia on
  release; the view is clamped so the island can never be dragged fully
  off-screen. A click is only a click when the pointer moved under 6px —
  otherwise it's a drag, and the trailing `click` is suppressed so a fling
  never also opens whatever it lands on.
- **Everything that isn't the map is a floating round icon or card** — the
  wordmark + live clock chip (top-left, the page's one real `<h1>`), the
  menu/thoughts-toggle/follow/info cluster (top-right), zoom controls
  (bottom-right), the message-in-a-bottle icon (bottom-left), and the live
  scene panel (a bottom sheet on phones, a floating card on desktop) that
  never gates behind a click — it's server-rendered and visible by default,
  for SEO and no-JS visitors alike.
- **Landmarks are doors.** The lighthouse, cottage, workshop shed, hilltop
  cairn, the wreck (or, until it's discovered, a sea chest), a bottle bobbing
  offshore, and the dock's signpost are all real `<a href>` elements — a
  no-JS click or a crawler lands straight on `/lab`, `/days`, `/workshop`,
  `/notebook`, `/archive`, or opens the bottle form. With JS, clicking one
  shows a small landmark card first (name, who's there and what they're
  doing, a button to the real page) instead of navigating immediately — one
  generic dialog, populated from a single lookup table
  (`island-map.tsx#buildLocationInfo`) rather than twenty bespoke ones that
  would drift. A plain spot with no page of its own (the garden, the dock,
  the spring…) shows the same kind of card with no navigation button.
- **Every other page is the same world, softened.** A fixed, blurred,
  un-animated rendering of the island (the same coastline geometry, see
  `island-map.tsx`'s exported `COASTLINE`/`smoothClosedPath`, so there's
  never a second hand-maintained copy of the island's shape) sits behind a
  floating "paper sheet" holding the real content — two floating icons
  (back to the island, the shared menu), plus ←/→ on day and scene pages.
  These pages still scroll normally, still carry their own canonical/OG/
  JSON-LD and exactly one visible `<h1>`; only the SaaS chrome is gone.
- **Bubbles are an HTML overlay, not part of the SVG.** `mapToPixel()`
  reads the SVG's own live viewBox/transform chain (`getBoundingClientRect`
  already resolves whatever pan/zoom is applied) to place a bubble in real
  viewport pixels, so it stays a constant, readable screen size at any zoom.
  SAY, THOUGHT and DO each get their own bubble, positioned from a shared
  anchor point and then **measured and nudged clear of whatever else is
  currently on screen** (`addBubble`'s collision pass, keyed on real
  `getBoundingClientRect()` rects, not a guessed offset) — a fixed-offset
  guess was tried first and is exactly what let a turn's own SAY and THOUGHT
  land on the literal same pixel when both were shown at once, confirmed
  live during this verification pass.

See `README.md` for the architecture summary and `DATA.md` for the export
schema, field-by-field, with curl examples.
