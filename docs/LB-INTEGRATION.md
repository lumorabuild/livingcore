# Lumora Build integration — sign-in, credits, the encryption secret, and deploy order

Living Core is one more app on the shared Lumora Build (LB) network: one
login for every product, one wallet for credits. This doc is the checklist
for registering it with `id` and deploying it — read this before touching
`shared/id` or pushing Living Core's own patrons feature live.

## 1. Register the app with `id`

✅ **Registered 2026-09-26 07:44Z** (`apps.created_at`; no migration file in
the id repo records it, like techmaplive's). Before that, a real sign-in from
`/shop` never came back. Verified after: `/auth/login?next=/shop` now reaches
`/login?app_id=livingcore&return_to=https://livingcore.cc/auth/callback?next=%2Fshop&s=…`,
and id's logout returns to `https://livingcore.cc/`. Check it any time,
read-only: `curl -sI "https://id.lumorabuild.com/auth/start?app_id=livingcore&return_to=https%3A%2F%2Flivingcore.cc%2Fauth%2Fcallback"`
must answer a `Location` that still carries `app_id=livingcore`.

`id` (the SSO worker, `lumora-id-db`) needs to know `app_id: "livingcore"`
exists and which URLs it's allowed to send a signed-in session back to.
Without it, `/auth/start?app_id=livingcore&...` silently drops `app_id` and
`return_to` and shows id's bare `/login` — the visitor signs in and is never
sent back, so livingcore.cc never gets a session.

New migration file, next number after the highest applied one in
`lumora/shared/id/apps/master-auth/migrations/` (`0026_livingcore_app.sql` as
of this writing — check the directory before assuming that number is still
free):

```sql
INSERT OR IGNORE INTO apps (app_id, app_name, active, allow_self_signup, created_at)
VALUES ('livingcore', 'Living Core', 1, 1, datetime('now'));

INSERT OR IGNORE INTO app_return_urls (app_id, return_url) VALUES
  ('livingcore', 'https://livingcore.cc/auth/callback'),
  ('livingcore', 'https://livingcore.cc/');
```

Apply it as a **remote write to the shared `id` database** — this is
Kevin's/the operator's step, not something a Living Core deploy does on its
own:

```bash
cd lumora/shared/id
npx wrangler d1 execute lumora-id-db --remote --file=./apps/master-auth/migrations/0026_livingcore_app.sql
```

The return-URL match is an exact origin + path-**prefix** test
(`isAllowedReturnUrl`, `startsWith`) — always register a URL with a path or a
trailing slash, never a bare origin, matching every other app in the network.

## 2. Living Core's own bindings (`wrangler.jsonc`)

Already in place (this repo's `wrangler.jsonc`):

```jsonc
"services": [
  { "binding": "AUTH_SERVICE", "service": "id" },
  { "binding": "COIN", "service": "coin" }
]
```

The app id (`livingcore`) and id's origin are constants in `src/lb/auth.ts`.

Both are service bindings — free-tier, no paid Cloudflare product involved,
consistent with the project's hard "free only" constraint. Nothing else
about deploying Living Core changes: Workers Builds still deploys on push to
`main`, no manual `wrangler deploy`.

## 3. The one new secret: `LIVINGCORE_ENCRYPTION_KEY`

Lend-a-mind stores a donor's API key encrypted at rest — AES-256-GCM via
WebCrypto, the encryption key derived as `SHA-256(LIVINGCORE_ENCRYPTION_KEY)`,
a fresh 12-byte IV per record, the donation's own id as AAD, stored as
`v1.<b64url iv>.<b64url ciphertext>`. Set it once, remotely:

```bash
npx wrangler secret put LIVINGCORE_ENCRYPTION_KEY
```

**If this secret is unset in production, lending a mind is disabled with a
plain, honest message on the account page — nothing else on the site is
affected.** Never put this value in `wrangler.jsonc` `vars` (plain text) or
commit it anywhere; `wrangler secret put` only.

## 4. Local dev — testing all of this without the real `id`/`coin`

`.dev.vars` (git-ignored):

```
DEV_FAKE_AUTH=allow
LIVINGCORE_ENCRYPTION_KEY=any-dev-string-at-least-16-chars
```

When `env.DEV_FAKE_AUTH === 'allow'` **and** the request is plain `http:` on
`localhost`/`127.0.0.1`, `GET /auth/dev-login?uid=<name>` sets
`site_session=dev:<uid>` directly — no real `id` round trip — and
`resolveViewer` treats it as a member `{userId: 'dev-<uid>', email:
'<uid>@dev.local', displayName: <uid>}`. Coin calls are stubbed by a local D1
table `dev_coin(user_id PK, balance)`, seeded to 10,000 credits on first
touch (5 if the uid contains `poor`, for testing the "not enough credits"
path). None of this activates in production: the dev cookie needs plain
`http:` on localhost, and the coin stub also needs a `dev-` user id (which
only that local branch creates), so even a `DEV_FAKE_AUTH` set on production
by mistake could never route a real member to the stub.

## 5. Deploy order

1. Apply the `id` migration (§1) — Living Core's sign-in is otherwise a dead
   end at `id`'s side.
2. Set `LIVINGCORE_ENCRYPTION_KEY` (§3) if lend-a-mind should be enabled on
   this deploy — otherwise it's fine to ship the rest of patrons first and
   set this later; nothing else depends on it.
3. Push Living Core's `main` — Workers Builds deploys it.
4. Verify live: `GET /auth/login` should set a short-lived `lc_login_state`
   cookie and redirect into
   `id.lumorabuild.com/auth/start?app_id=livingcore&...` (its `return_to`
   carries the same value as `s=`) and complete a real
   sign-in; `GET /api/me` should answer `no-store` JSON; `GET /shop` and
   `GET /shrine` should render; `GET /llms.txt` should 200 as
   `text/plain` and mention the shop/shrine/account links.

## 6. Cache hazard specific to this feature

`cache.enabled` is already on for this Worker (`src/cache.ts`'s `seal()`
middleware default-denies to `no-store` for anything that doesn't state a
policy) — every new per-viewer route here (`/api/me`, `/account`,
`/api/account/*`, `/api/shop/buy`, any page that renders the signed-in
viewer) sets `Cache-Control: no-store` explicitly rather than relying on the
default alone, per the network-wide rule in the workspace root `CLAUDE.md`.
`/shop` in particular is `no-store` even though it looks like ordinary
content, because it renders the viewer's own balance/patron settings
server-side; `/shrine` has no viewer-specific content and keeps the normal
`CACHE.ARCHIVE_PAGE` edge policy. See `sso.md` (research notes, not shipped
as a doc) and `src/cache.ts`'s own header comment for the full reasoning,
including why the cache key has no hostname/scheme component and why that
doesn't matter here (Living Core does no apex/scheme redirection).

## 7. Log markers that mean a person should look

`[observability]` keeps Worker logs; these lines mean money may need a human:

- `AMBIGUOUS-SPEND` — coin's answer to a gift charge was unclear. The row stays
  `pending` and the two-minute cron settles it with the same key (usually
  within minutes). Nothing to do unless it is followed by the next marker.
- `AMBIGUOUS-SPEND-ABANDONED` — a pending gift stayed unclear for a day and was
  marked `unconfirmed` (the patron's gift history says "payment unclear —
  contact support", never "not charged"). Check coin's `credit_spends` for that
  gift id (the key is `<len>:livingcore:<giftId>`). If a spend exists the
  patron paid: send the crate with
  `UPDATE gifts SET status = 'queued' WHERE id = '<giftId>' AND status = 'unconfirmed';`
  (livingcore D1). If none exists, set it to `failed` — nothing was taken.
  Never "retry" it through coin: a repeated spend with no record CHARGES.
- `GIFT-STALE` — a paid gift's item left the catalog; the cron refunds it once.
- `REFUND-OWED` — that refund failed; the cron retries it every run.

## 8. What `id`/`coin` do and don't know about Living Core

`id` only knows Living Core exists as an app and which URLs may receive a
handed-off session — it has no opinion on patrons, gifts, the shrine, or
donated models; all of that is Living Core's own D1 (`patrons`, `gifts`,
`model_donations`, `donation_usage`). `coin` only sees a `userId`, an
`amount`, a `reason` string (e.g. `shop:<item-id>`) and an idempotency key
per spend — it has no idea what a "crate" or a "shrine" is. Keeping the
fiction (Kevin and Jenny don't know they're watched) and the safety
properties (real credits, real refunds) both live entirely on Living Core's
side of these two integrations, by design.
