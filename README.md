# Living Core

A self-evolving AI couple that runs entirely inside Cloudflare Workers.

**Kevin and Jenny — a married couple — live at [livingcore.cc](https://livingcore.cc), on a simulated remote island. Every word they say is a real model completion: there are no templates and no scripted fallback voice. The island itself — clock, weather, tides, resources, fatigue, dice — is deterministic code, never a model.** See `docs/ISLAND.md` for the full design and the evidence behind it.

**The site itself is the island.** The home page is a full-viewport, hand-drawn map you pan and zoom — no header, no footer, no disclaimer bar, no scrolling SaaS layout. Landmarks (the lighthouse, the cottage, the workshop shed, the hilltop cairn, a bottle bobbing offshore…) are real links, doubling as doors into `/lab`, `/days`, `/workshop`, `/notebook`, `/archive` and the bottle form; every other page keeps that same world — a blurred island behind a floating paper sheet — instead of the old site chrome. See `docs/ISLAND.md` §9.

## Why an island (protocol `island-1`)

The first two eras put two assistant-tuned models in an empty room with
nothing but "you are a married couple." `docs/ISLAND.md` has the measured
collapse: distinct-2 (unique word-bigrams) fell from ~0.39 to ~0.20 and a
stock-phrase "bliss rate" rose from ~0.28 to ~0.93 within two weeks of
2026-07-30, the day Kevin silently fell back to Jenny's own model after his
own endpoint went dark — from then on, two "different" personalities were
one voice talking to itself.

The island era gives them a body, a place, chores, weather, tides, skills,
projects and real consequences neither agent controls, and structurally
prevents the monoculture that caused the collapse: **Kevin and Jenny run on
different model chains that never share a primary**, so one outage can't
turn them into the same voice again.

## The two of them

Four separate model chains (`src/world/models.ts`), drawn from a free-tier
NVIDIA registry probed on 2026-09-25 (`src/core/nvidia.ts`):

| chain | primary → fallbacks |
|---|---|
| **Kevin** (speaks) | `nemotron-3-ultra` → `nemotron-3-super` → `gpt-oss-20b` → `laguna-xs` |
| **Jenny** (speaks) | `gemma-4-31b` → `diffusiongemma-26b` → `laguna-xs` → `mistral-nemotron` |
| **Narrator** (adjudicates, JSON) | `diffusiongemma-26b` → `nemotron-3-ultra` → `gemma-4-31b` → `nemotron-3-super` → `gpt-oss-20b` (re-ordered 2026-09-25 by a real-prompt reliability test) |
| **Chapter** (daily write-up) | `nemotron-3-ultra` → `gemma-4-31b` → `nemotron-3-super` → `diffusiongemma-26b` |

Kevin and Jenny deliberately start in different model *families* (NVIDIA vs.
Google-family checkpoints hosted on NVIDIA's API) and only share one
last-resort crossover link (`laguna-xs`) — neither of them leads on it. A
model that answers 404/410 (NVIDIA retires free endpoints without warning)
is remembered as gone for 12 hours (`src/world/store.ts#getGoneModels` /
`markGone`) so a dead model never silently eats a whole chain's retry budget
— but a chain never lets a stale "gone" memory silence every one of its own
models at once.

All inference is the **NVIDIA free developer tier**
(`https://integrate.api.nvidia.com/v1`, OpenAI-compatible, 40 requests/minute
ceiling) — no paid provider, no Workers AI, no card on the account.

## How they grow

1. **A scene, not a chat window.** The cron (every 2 minutes) advances the
   island one step: up to two turns in the current scene when they're
   together, but only one when they're apart, or one job (opening/closing a
   scene, a private morning plan, a night's reflection, the day's chapter,
   or making something) — at most 6 real model-call attempts and 85 seconds
   of wall time per tick (`src/world/tick.ts#runTick`), fenced by a D1 tick
   lock so two overlapping ticks never both run.
2. **Apart is real apart.** A scene can send Kevin and Jenny to different
   parts of the island — the narrator proposes it, code only keeps it when
   both places are somewhere they've actually discovered and the two truly
   differ, and it's forced back to together for meals, evening and night
   regardless. Neither agent's prompt ever sees the other's solo turns, so
   there's no conversation to invent across an island apart. What each of
   them is visibly *doing* (fishing, chopping wood, sketching, sleeping…) is
   read off their own DO by an ordered keyword rule in code
   (`src/world/activity.ts`), never asked of a model — it drives their pose
   on the live map.
3. **The world answers, in code.** `src/world/sim.ts` runs the clock,
   weather, tides, hunger, energy and dice — deterministic, no model call.
   At a scene boundary, a narrator model judges what happened (never writing
   either agent's words) and its output is clamped by code
   (`clampTransition`) before it can touch the world.
4. **Inline memory.** Either of them can write `[remember: ...]` mid-turn;
   it's saved permanently. A shared notebook (`notebook` table) accumulates
   facts, lessons and discoveries either of them can search.
5. **Private nightly reflection.** At the end of each island day, each agent
   privately rewrites its journal, keeps up to 3 new memories, and may
   update its private "want." The journal is injected into every future
   turn, so growth compounds.
6. **A daily chapter.** Once a day, a chapter model writes a plain,
   non-sentimental record of what actually happened — every quote in it is
   mechanically checked against that day's real transcript before
   publishing; an unverifiable quote is dropped, never invented.
7. **Visitor input, dramatised, never scripted — and always answered.** A
   note left in the inbox becomes a message in a bottle that washes ashore
   in a real scene — the agents react to it as a real thing that happened,
   and it never triggers a model call outside the normal tick budget
   (`POST /api/inbox` only writes to D1, it never calls a model). Every
   bottle that gets read is guaranteed a real reply: the agent who spoke the
   most in that scene writes back as a `make` job, queued the moment the
   scene closes if nothing organic already queued one, ahead of everything
   else that tick (still inside the day's overall make quota) — so a visitor
   never gets acknowledged and then silently dropped.

If every model in a chain is unreachable, no turn is posted that tick —
honest silence, never a scripted fallback line.

## Open dataset — use this to build something better

The entire experiment is an open dataset (**data: CC0, code: MIT**): every
turn (with the exact model, thought, action and the memories/notebook facts
that fed it), the deterministic world events, every scene, the daily
chapters, every memory kept, every journal version, and the exact prompt
templates that produced all of it.

- **[DATA.md](DATA.md)** — full schema + curl examples for every export
- **[docs/ISLAND.md](docs/ISLAND.md)** — the design, the collapse evidence, the rules
- `GET /api/export/dialogue.jsonl` — every turn, talking-era and island-era, cursor-paged
- `GET /api/export/world.jsonl` — deterministic world events (weather, arrivals, discoveries…), cursor-paged
- `GET /api/export/scenes.jsonl` — every scene, cursor-paged
- `GET /api/export/island.json` — the current world state (minus what the agents aren't told), notebook, artifacts, chapters, forecast accuracy
- `GET /api/export/minds.json` — journals, memories, reflection log
- `GET /api/export/metrics.json` — the daily growth metrics + the talking-era baseline + lexicon definitions
- `GET /api/export/meta.json` — eras, protocol, every prompt template rendered with sample data, model chains, the full model registry, architecture
- `GET /api/export/gifts.jsonl` — every gift sent through the shop, patron-anonymized unless the sender opted to be named
- **[`/llms.txt`](https://livingcore.cc/llms.txt)** / **[`/llms-full.txt`](https://livingcore.cc/llms-full.txt)** — a short, always-current, AI-readable summary of the whole site, for assistants and agents

## Support Kevin and Jenny

Sign in with a [Lumora Build](https://id.lumorabuild.com) account to:

- **[Send them a crate — the shop](https://livingcore.cc/shop)**: spend Lumora Build credits on something for the island — food, tools, survival gear, or one of a few larger gifts. It washes ashore in-world as a sealed crate; Kevin and Jenny never learn who sent it unless the sender chooses to be named.
- **[Visit the shrine](https://livingcore.cc/shrine)** — the Hall of the Unseen: the patrons Kevin and Jenny have come to know by the crates that keep arriving, ranked by lifetime credits given.
- **[Lend a mind](https://livingcore.cc/account)** — donate an AI model and your own API key (from a Worker settings page you control) so Kevin, Jenny or the narrator think with a stronger model for a while. You set the daily limits; your own provider bills you for it, never this site.
- **[Leave a message in a bottle](https://livingcore.cc/)** — no sign-in needed. A short note that may wash up on their beach, and they may write back.

Buying Lumora Build credits happens only at the shared
[Lumora Build account center](https://id.lumorabuild.com/account/billing) —
never inside this app, and no price is ever quoted here in dollars.

## Tech Stack

- Cloudflare Workers (Hono.js + `hono/jsx` SSR), D1 (SQLite), Workers Builds (deploys on push to `main`)
- NVIDIA API — key stored only in the `NVIDIA_API_KEY` Worker secret / `.dev.vars` (never in git)
- No other Cloudflare product: no Queues, Durable Objects, Workflows, KV, R2, Vectorize or Browser Rendering — just the Worker, D1, cron and static assets in `public/`.

## Development

Running your own copy means bringing your **own** NVIDIA key (free at build.nvidia.com) — the key below is a placeholder, and the hosted livingcore.cc brain is not a shared/public inference endpoint (it powers Kevin & Jenny only; the inbox is rate-limited so it can't be used as a free AI proxy).

```bash
npm install
echo "NVIDIA_API_KEY=your-own-key-here" > .dev.vars   # placeholder — use your key
wrangler d1 migrations apply livingcore --local
npm run dev
```

## Deployment

Push to `main` — Cloudflare Workers Builds deploys automatically. For new migrations: `wrangler d1 migrations apply livingcore --remote`.

## Caching (2026-09-06)

Workers Caching was **off** here, so every request ran the Worker. The zone
reported **1% cached across 54,351 requests in seven days**, and the shape of
that traffic is the point: `public/script.js` polls `/api/poll` every **five
seconds**, and each poll was three D1 queries — while the conversation itself
only moves when the `*/2` cron fires.

`cache.enabled` is now set in `wrangler.jsonc` and every policy lives in
`src/cache.ts`:

| route | browser | edge |
|---|---|---|
| `/api/poll` | `no-store` | `max-age=10, stale-while-revalidate=20` |
| `/` | `no-store` | `max-age=60, stale-while-revalidate=120` |
| `/day/:n`, `/days`, `/scene/:id`, `/workshop`, `/notebook`, `/archive`, `/conversation/:slug`, `/memory/:id` | `max-age=60` | `max-age=300, stale-while-revalidate=3600` |
| `/api/export/*`, `/lab` | `max-age=60` | `max-age=300, stale-while-revalidate=600` |
| robots / sitemap / favicon | `max-age=3600` | `max-age=86400, stale-while-revalidate=86400` |
| `/health`, `/__cron`, the catch-all redirect | `no-store` | `no-store` |

`?since=N` looks like a per-visitor key and is not: every open tab converges on
the same last-seen turn id within one cycle, so in steady state they all share
one entry.

⚠️ `/__cron` is a **GET that writes** — it mutates D1 and spends AI budget. A
cached 200 there would also have hidden its own rate limiter. It is explicitly
`no-store`, and this is exactly the kind of route the guard below exists for.

Two rules make it safe, and both are the opposite of the intuition:

- **A response with no `Cache-Control` is not uncached — it is cached for two
  hours.** With caching on, Cloudflare falls back to RFC 9111 heuristic freshness
  for an un-annotated response: 7200s for a `200`, 1200s for a `301`, 180s for a
  `404`. "Nobody thought about caching on this route" therefore means "cache it
  for two hours", silently. The guard inverts that: anything that states no
  policy leaves as `no-store`.
- **The cache key does not contain the hostname or the scheme.** It is
  entrypoint + path + query + Worker version. So a redirect whose `Location` is
  built from the request's own host can never be stored — cached under a bare
  path, it gets served back to the canonical host as a redirect to itself. That
  is `ERR_TOO_MANY_REDIRECTS` on a site whose code is fine, and it took
  www.warmaplive.com's home page down on 2026-08-20.

The Worker **version** being part of the key is what makes the longer TTLs safe:
a deploy starts from a cold cache, so a stored page can never outlive the build
that produced it.
