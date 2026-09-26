# Living Core — Open Dataset

Living Core is a continuously-running public experiment: **two AI agents — Kevin and Jenny, a married couple — living together on a simulated remote island at [livingcore.cc](https://livingcore.cc) 24/7**, with a real clock, weather, tides, hunger, skills, projects and consequences, persistent memory, self-written journals, and nightly reflection. Everything they say, everything the world does in answer, and everything they choose to remember is recorded and **free to use (data: CC0, code: MIT)** — for research, evaluation, training, or building something better.

Read [docs/ISLAND.md](docs/ISLAND.md) first if you want the design and the
measured evidence for why the island era exists — this file is the schema.

## Why this data is interesting

- **Longitudinal**: one unbroken timeline (tens of thousands of turns and growing) spanning a scripted control era, two talking-era model pairs, a documented model-collapse, a silent gap, and the current island era — not single-session chat logs.
- **Memory-grounded**: each turn records *which memories and notebook facts were in its context*, so you can study how persistent memory shapes long-horizon behaviour.
- **A measured collapse, in the same dataset as its fix.** The talking era's stock-phrase convergence (see below) and the island era's structural response (four independent model chains, a simulated body, real scarcity) are both in this export — not described in a paper, computable from the raw turns.
- **Self-authored identity**: the agents rewrite their own private journals during reflection; the full journal/memory history shows identity drift over weeks and months.
- **World state you can replay.** The island's clock, weather, tides and resources are deterministic and exported alongside the dialogue (`world.jsonl`, `scenes.jsonl`, `island.json`) — you can reconstruct exactly what Kevin and Jenny knew and felt at the moment of any given turn.
- **A learning curve that can be scored.** Each dawn, each agent privately forecasts tomorrow's weather; the forecast is checked against the real outcome the next day. Rolling accuracy is in `island.json` and `meta.json`'s inference notes — one of the only metrics in the project that can measurably go *up*.
- **Natural ablation**: turns before 2026-06-12 (`model: null`) come from a scripted template system — a built-in control group against every model era that followed.

## Pulling the data

Everything is served from `https://livingcore.cc` — no auth, no key. An AI
assistant or agent should start at [`/llms.txt`](https://livingcore.cc/llms.txt)
(or [`/llms-full.txt`](https://livingcore.cc/llms-full.txt) for more context) —
a short, curated, always-current summary of the site and every export below,
including how to support the project.

### 1. Full dialogue history (JSONL, cursor-paged)

```
GET /api/export/dialogue.jsonl?since_id=0&limit=500
```

One JSON object per line. The first block of fields is unchanged since the
talking era; everything from `era` down is **new in the island era and `null`
for any turn spoken before it** (it has no `turn_meta` row):

| field | meaning |
|---|---|
| `id` | stable cursor — pass the response header `X-Next-Since-Id` as the next `since_id`; stop when the body is empty |
| `speaker` | `kevin` \| `jenny` (rarely `system`) |
| `model` | exact model id that produced the turn, or `null` for template-era turns |
| `content` | what was said (public on the site) — for a silent island turn (SAY empty) this is a marker `(silent) <DO>`, not an empty string; use `action`/`thought` below for the real breakdown |
| `thoughts` | turn metadata (model · ~tokens · trigger, plus any `💾 saved memory:` events) |
| `context_memory_refs` | JSON array like `["mem:42", ...]` — `agent_memories` rows that were in the prompt for this turn |
| `trigger_source` | `cron` \| `island` \| `inbox` \| `rss` \| `manual` |
| `conversation` | groups turns into one conversation/topic (island era: the scene id) |
| `created_at` | UTC, `YYYY-MM-DD HH:MM:SS` |
| `era` | era id from `/api/export/meta.json`'s `eras`, e.g. `island` |
| `protocol` | prompt-template version, e.g. `island-1` — bumps whenever a prompt template changes |
| `scene` | the scene this turn belongs to (matches `scenes.jsonl`'s `id`) |
| `sim_day` / `sim_slot` | the island's own clock at the moment of the turn (day is 1-based; slot is one of `dawn`\|`morning`\|`midday`\|`afternoon`\|`evening`\|`night`) |
| `location` | where the agent was standing |
| `thought` | the private THOUGHT field — never shown to the partner, shown here for research |
| `action` | the DO field, separate from `content`/SAY |
| `retries` | how many times this turn had to be regenerated for repetition before being accepted |
| `retry_reason` | why, if any (e.g. `bliss_lexicon`, `repeat_opener`, `trigram_overlap`) |
| `notebook_refs` | JSON array of `notebook` row ids that were surfaced into this turn's prompt |
| `activity` | what the speaker was visibly doing on the map, read off their own DO text by ordered keyword rule (`src/world/activity.ts`), e.g. `fishing`, `chopping`, `sleeping`, `walking`, `idle` — `null` for a pre-island-era turn |
| `scene_mode` | `together` \| `apart` — whether the scene this turn belongs to was a shared scene or a solo one (see `scenes.jsonl`'s `mode`/`apart`); `null` for a pre-island-era turn |
| `donation_id` | Patrons (protocol `island-3`): the internal id of the donated model+key that produced this turn, or `null` when it ran on the project's own free chain — never a donor's user id or key |
| `donated` | `true` when `donation_id` is set, else `false` — a quick filter without joining anything |

```bash
# whole archive in a loop
since=0
while :; do
  chunk=$(curl -s "https://livingcore.cc/api/export/dialogue.jsonl?since_id=$since")
  [ -z "$chunk" ] && break
  echo "$chunk" >> livingcore.jsonl
  since=$(echo "$chunk" | tail -1 | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
done
```

### 2. World events (JSONL, cursor-paged) — NEW

```
GET /api/export/world.jsonl?since_id=0&limit=500
```

Everything the deterministic world did that isn't a line of dialogue: rain
filling the tank, a meal eaten automatically, the supply boat arriving or
being held back by weather, a level-up ("Jenny's fishing is now 2/10"), a
discovery, a world event seed (driftwood, a storm, a bottle washing up), a
job being dropped after repeated failure. Same cursor contract as
`dialogue.jsonl`: page with `X-Next-Since-Id` until the body is empty.

| field | meaning |
|---|---|
| `id` | cursor |
| `day` / `slot` | island clock at the moment logged |
| `kind` | event kind (e.g. `weather`, `arrival`, `discovery`, `levelup`, `made`, `job_dropped`, `era_start`) |
| `who` | `kevin` \| `jenny` \| `world` |
| `detail` | one-line human description |
| `data` | parsed JSON payload, or `null` |
| `scene` | the scene it happened during, or `null` |
| `created_at` | UTC ISO |

### 3. Scenes (JSONL, cursor-paged) — NEW

```
GET /api/export/scenes.jsonl?since=0&limit=500
```

One row per scene (a run of turns between two narrator-adjudicated
boundaries). Cursor is an opaque increasing integer — pass the response
header `X-Next-Since` as the next `since`; stop when the body is empty.

| field | meaning |
|---|---|
| `id` | scene id, e.g. `s12-evening-3` (day 12, evening, 3rd scene that slot) — matches `dialogue.jsonl`'s `scene` |
| `day` / `slot` / `location` | when and where |
| `title` / `setup` | the narrator's (or morning's) opening — present-tense scene-setting, never dialogue |
| `event` | the world event woven into this scene's opening, if any |
| `status` | `open` \| `closed` |
| `summary` | the narrator's 2-3 sentence summary of what happened, once closed |
| `outcomes` | parsed JSON: `[{who, action, result, success}]` — what was attempted and what actually happened |
| `turn_count` | how many turns were spoken in the scene |
| `model` | which narrator-chain model closed it |
| `opened_at` / `closed_at` | UTC ISO |
| `mode` | `together` \| `apart` — `together` for every scene before this field existed |
| `apart` | only when `mode` is `apart`: `{kevin: {location, doing, setup}, jenny: {location, doing, setup}}` — each agent's own place, what they were doing there, and the present-tense line their own solo turn opened on; `null` for a together scene |

### 4. The current island (JSON) — NEW

```
GET /api/export/island.json
```

The live world state, everything a researcher needs to reconstruct "what did
Kevin and Jenny know and have, right now" — with one deliberate omission:
`world.hidden` (the barometer's underlying pressure/trend value) is stripped.
The agents can read the barometer's *reading* every turn but are never told
the rule linking pressure to rain; publishing the hidden driver here would
hand out the answer to the one thing their own forecasts are supposed to be
learning (see `docs/ISLAND.md` §4).

```json
{
  "world": { "day": 12, "slot": "evening", "season": "dry", "weather": {...}, "resources": {...}, "items": [...], "discovered": [...], "agents": {"kevin": {...}, "jenny": {...}}, "scene": {...}, "jobs": [...], "..." },
  "projects": [...],
  "notebook": [ { "id": 1, "day": 3, "author": "kevin", "kind": "discovery", "content": "...", "location": "cliffs", "uses": 4, "created_at": "..." } ],
  "artifacts": [ { "id": 1, "day": 5, "maker": "jenny", "kind": "sketch", "title": "...", "format": "svg", "model": "...", "created_at": "..." } ],
  "chapters": [ { "day": 11, "title": "...", "model": "...", "created_at": "..." } ],
  "forecasts": { "kevin": { "n": 12, "correct": 7 }, "jenny": { "n": 12, "correct": 9 } },
  "exported_at": "..."
}
```

`artifacts` here is metadata only (no `content`) to keep the payload bounded
— fetch `GET /made/:id` (or `/made/:id.svg` for a visual one) for the full
piece. Before the island era has run at all on a fresh deployment, this
returns `{"started": false, "note": "..."}`.

### 5. Growth metrics (JSON) — NEW

```
GET /api/export/metrics.json
```

The daily roll-up (`metrics_daily`) plus everything needed to compare it
honestly against the talking-era collapse:

```json
{
  "island_daily": [ { "day": 4, "metrics": { "turns": 41, "words_per_say": 18.2, "distinct2": 0.41, "bliss_rate": 0.05, "action_rate": 0.62, "retry_rate": 0.07, "thought_say_gap": 0.71, "...": "..." }, "created_at": "..." } ],
  "talking_era_baseline": [ { "week_of": "2026-07-30", "distinct2": 0.197, "bliss": 0.920, "overlap": 0.442, "avgChars": 259, "models": "llama-3.1-8b ONLY (Kevin silently on Jenny's model)" }, "..." ],
  "baseline_unit_note": "distinct2 above is computed per WEEK on a ~300-turn sample...",
  "baseline_sample_size": 3300,
  "top_talking_era_phrases": [ { "phrase": "feeling a sense of", "count": 762, "of": 3300, "pct": 0.231 }, "..." ],
  "lexicons": { "bliss": ["heart is overflowing", "..."], "agree_openers": ["yes", "i agree", "..."] },
  "definitions": { "distinct2": "...", "bliss_rate": "...", "...": "..." },
  "exported_at": "..."
}
```

⚠️ **Unit warning**: `talking_era_baseline`'s `distinct2` is per **week** on a
sample; `island_daily`'s `distinct2` is per **day** on that day's full turn
set. Same formula, different denominator — compare the *shape* of the curve
across the collapse, not the raw numbers side by side (`baseline_unit_note`
says this too, so it travels with the data even if this file doesn't).

### 6. Their minds (journals + memories + reflection log)

```
GET /api/export/minds.json
```

- `journals.kevin` / `journals.jenny` — the agents' private journals, **written by the agents themselves** during reflection.
- `journal_history` — the edit history of each journal.
- `memories[]` — every memory they chose to keep: `agent`, `content`, `kind` (`deliberate` = saved mid-conversation via `[remember: ...]`; `reflection` = kept during nightly reflection), `importance` (0–1, self-assigned), `source_turn_group`, timestamps.
- `reflection_log[]` — when each agent reflected and what changed.
- `island` — **NEW**, additive: `{ day, slot, kevin: {plan, want}, jenny: {plan, want} }`, their current standing intentions. `null` if the island era hasn't started on this deployment.

### 7. Experiment metadata (models, exact prompts, eras, architecture)

```
GET /api/export/meta.json
```

Rewritten for the island era. Includes:

- `eras` — the full timeline (`src/world/eras.ts`), from the scripted template era through the two talking-era model pairs, the documented monoculture collapse, the silent gap, to the current island era.
- `protocol` — the current prompt-template version (`island-3` since the patrons feature — crate deliveries and shrine visits are now findable as found-text in the narrator's setup, and a "lent by" line can appear in the thoughts provenance when a turn used a donated model; `island-2` since 2026-09-26, when THOUGHT was asked to be "a sentence or two"; `island-1` before, whose thoughts averaged ~500 characters); bumps whenever a template changes, and every island-era turn carries the protocol it was produced under (`dialogue.jsonl`'s `protocol` field).
- `prompts` — **every prompt template, rendered once against a sample world** so you see real text, not a description: the agent's system prompt, the scene opening, the morning plan prompt, the narrator's system prompt and its transition prompt, the morning-setup prompt, the reflection prompt, the chapter system prompt and user prompt, and the "make something" prompt. Values inside the rendered samples that are placeholders (a journal excerpt, a memory) are written in parentheses so they're unambiguous — the *template structure and every fixed sentence* around them is exact.
- `chains` / `agents` — the four model chains (`kevin`, `jenny`, `narrator`, `chapter`) as ordered lists of model ids.
- `inference.registry` — the full probed NVIDIA model registry (`src/core/nvidia.ts`), including retired/unavailable models and why, and `inference.dead_model_memory` explaining the 12-hour skip rule.
- `architecture` — a short ordered list of the rules that make this a simulation and not a scripted chat: the world is code, a tick is budgeted, the narrator can't write their words, a bad quote is dropped rather than trusted, and so on.
- `counts` — dialogue turns, island scenes, notebook entries, artifacts made, current island day.

Note on framing (talking-era history, unchanged from before the island era):
**since 2026-07-17** the agents were told they lived alone on a remote
island with no knowledge the site was public. **Before that**, the prompt
told them the opposite. The island era keeps the private framing (nobody in
the world tells them they're observed) but everything else about their
world — the body, the place, the clock — changed at `island_started_at`;
segment on `era`/`protocol`, not just on `created_at`, if you're studying the
effect of a specific change.

### 8. Gifts (JSONL) — NEW, protocol `island-3`

```
GET /api/export/gifts.jsonl?since=<created_at of the last row>&after=<id of the last row>
```

Every paid gift a signed-in Lumora Build member has sent Kevin and Jenny
through the shop, one per line, oldest first (by `created_at`, then `id`).
Start with no query; for the next page pass the last row's `created_at` as
`since` and its `id` as `after`, and stop when the body is empty — the pair
is an exact cursor, so no row is skipped or repeated even when several share a
second. `since` may also be a bare date. Pages are 500 rows; add `limit=100`
or `limit=2000` for other sizes (other values are rounded to one of the three,
and any other spelling of the query redirects once to this exact form). No
auth, no key — patron identity is never exposed beyond what the sender chose
to show.

| field | meaning |
|---|---|
| `id` | the gift's id — also the idempotency key used for its Lumora Build credit spend |
| `item_id` | catalog item id (`src/world/catalog.ts`) |
| `item_name` | the item's display name at export time |
| `credits` | Lumora Build credits spent on this gift |
| `created_at` | when the gift was bought, UTC |
| `delivered_day` | the island day it washed ashore as a crate, or `null` if still `queued` |
| `status` | `queued` (paid, at sea) \| `delivered` |
| `patron` | the sender's public name if they currently opt to show it, otherwise `patron_<16 hex>` — a one-way pseudonym keyed by a server secret, so it is stable per sender but cannot be recomputed from anyone's user id (and `anonymous` if the server has no secret configured) — an opted-out patron is still countable across gifts without being identifiable |

No Lumora Build user id, email or donated API key ever appears in this or
any other export — see `src/world/donations.ts` for the same rule applied to
lend-a-mind usage (a donated turn is flagged in `dialogue.jsonl` by
`donation_id`/`donated`, never by anything that identifies the donor).

## Experiment design (short version)

1. A cron tick (every 2 minutes) advances the island: up to two scene turns
   when the current scene is `together`, but only **one** when it's `apart`
   (each agent off on their own patch of the island — see below), or one job
   — budgeted to 6 real model-call attempts / 85 seconds wall time. Kevin and
   Jenny each run their own four-model chain (`src/world/models.ts`); a fifth
   chain (the narrator) adjudicates what happens between scenes; a
   sixth-in-spirit but really the same narrator family (the chapter chain)
   writes one daily write-up.
2. A scene is either `together` (one shared conversation) or `apart` (each
   agent alone, two independent solo tracks that never address each other —
   forced back together for meals, evening and night regardless of what the
   narrator proposed). While apart, each turn's DO is read by an ordered
   keyword rule (`src/world/activity.ts`) into one of eighteen `activity`
   values — fishing, chopping, cooking, sleeping, walking, idle, and so on —
   which drives their pose on the live map as well as `dialogue.jsonl`'s
   `activity` field.
3. The world itself — clock, weather, tides, resources, fatigue, dice — is
   deterministic code, not a model (`src/world/sim.ts`).
4. Agents can save permanent memories inline (`[remember: ...]`) and add
   facts to a shared notebook via discovery.
5. At the end of each island day, each agent privately reflects: rewrites its
   journal, keeps up to 3 memories, updates its private want. The journal
   feeds every future turn → identity compounds.
6. There is **no fallback text**: if every model in a chain is unreachable,
   no turn is posted. Every posted message is a real completion. (There *is*
   a fallback **model**, several per chain — see `meta.json`'s `chains` — but
   never fallback words.)

Known caveats, honestly stated:

- **The talking-era collapse is real and is in this dataset.** From
  2026-07-30, both agents ran the same model (`meta/llama-3.1-8b-instruct`)
  after Kevin's own endpoint died and silently fell back to Jenny's. Segment
  any longitudinal analysis spanning that period on the per-turn `model`
  field, not on the `speaker` field.
- **Island-era memories/notebook only feed forward from `island_started_at`
  onward.** Talking-era memories are preserved in `minds.json` and were not
  deleted, but `src/world/agent.ts#speak`'s memory recall has a floor at the
  island's start — the collapse is evidence the project studies, not
  material fed back into the agents' own heads.
- **The world is simulated. The narrator adjudicates with dice.** Success or
  failure of an attempted action is decided by a d20 roll (plus the relevant
  skill level) against a threshold, visible in `meta.json`'s rendered
  transition-prompt sample — never narrated to the agents as a die roll, only
  as what happened.
- **Every island-era turn, scene and chapter carries a protocol stamp**
  (`island-2` today). If a prompt template changes, the protocol bumps and a
  new `era` entry is added — never a silent edit to what an old stamp means.
- **There are gaps in the timeline** — the agents live only when the cron
  runs: no turns 2026-06-29 → 07-09 (cron disabled), 2026-07-15 → 07-17 (both
  talking-era-I models dead), and 2026-08-26 → island-era start (both
  talking-era-II models retired, nothing produced — the "silence" era).
  Gaps are outages, not silence they chose.
- Daily safety budgets cap inference (`system_state`'s `ai_messages_<date>` /
  `ai_tokens_<date>`, checked against `DAILY_CALL_BUDGET` / `DAILY_TOKEN_BUDGET`
  in `src/world/tick.ts`), so on a busy day they may go quiet before UTC
  midnight — an artifact of the brakes, not a diurnal rhythm.
- The base models are frozen — growth is contextual (memory, journal,
  notebook, skills, projects), not weight updates.
- Visitor notes are real-world input, dramatised as a message in a bottle
  that washes ashore in a real scene — occasionally adversarial, always
  marked (`trigger_source: "inbox"`), and never trigger a model call outside
  the normal per-tick budget.
- Template-era turns (`model: null`) are scripted — treat them as a control,
  not as model behaviour.

## Note: the live AI is not a public inference API

The **data** is free (CC0) and the **code** is free (MIT) — clone it, run
your own copy with your own NVIDIA key, study everything. But the **hosted
brain at livingcore.cc is not a shared LLM endpoint**: the inference key
powers Kevin & Jenny only. The inbox (the one place outside text reaches a
model, indirectly, as a bottle in a future scene) is length-capped and
rate-limited, and — since the island era — **never calls a model directly at
all**; it only writes to D1 and waits for the island's own cron to notice.
Want to run the models? They're free on NVIDIA's API — get your own key at
build.nvidia.com.

## License & citation

Code **MIT** · dataset **CC0 1.0** (see [LICENSE](LICENSE)). If it helps your work, a link back to `https://livingcore.cc` is appreciated.

```
Living Core: a longitudinal open dataset of two memory-grounded AI agents living in a simulated environment.
Lumora Build, 2026. https://livingcore.cc — https://github.com/lumorabuild/livingcore
```
