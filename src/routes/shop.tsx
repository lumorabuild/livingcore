/** @jsxImportSource hono/jsx */
// ─────────────────────────────────────────────────────────────────────────────
// SHOP + SHRINE ROUTES — patrons, spec §A2.
//
// Money safety (spec's "Money safety" section): POST /api/shop/buy is
// same-origin-checked, member-only, rate-limited, and every 200/4xx branch is
// NO_STORE (a spend result is never something the edge may hand to a second
// visitor). GET /shop is ALSO no-store — not because it's expensive, but
// because it renders the signed-in viewer's balance/patron settings directly
// (the caching rule: a response that renders viewer state server-side must
// never be cached; see src/cache.ts). GET /shrine is a public leaderboard with
// no viewer-specific content at all, so it keeps the ordinary edge policy.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { CACHE, cacheHeaders } from '../cache';
import { rateLimit, hashId } from '../core/ratelimit';
import { loadTint } from '../views/chrome';
import { resolveViewer, isSameOriginRequest } from '../lb/auth';
import { getBalance } from '../lb/credits';
import { getPatron } from '../lb/patrons';
import type { PatronRow } from '../lb/patrons';
import { CATALOG, CATEGORY_LABEL, CATEGORY_ORDER, itemsByCategory } from '../world/catalog';
import { buyGift, exportGifts, recentDeliveries, topPatrons, type BuyResult } from '../world/gifts';
// "Minds lent" for /shrine (spec's ShrinePage bullet) is A3's OWN function —
// world/donations.ts#publicDonors already applies the same opt-in-only rule
// (lb/patrons.ts#patronLabel) every other patron-facing surface uses, over
// the exact model_donations/donation_usage tables it owns. A second, raw-SQL
// copy of the same query here would drift the moment either table's shape
// changes under it.
import { publicDonors } from '../world/donations';
import { ShopPage } from '../views/pages/ShopPage';
import { ShrinePage, type ShrineScene } from '../views/pages/ShrinePage';

function respondBuy(c: any, wantsJson: boolean, result: BuyResult, itemId: string, retryAfterSec?: number) {
  if (wantsJson) {
    const status = result.ok ? 200
      : result.reason === 'insufficient' ? 402
      : result.reason === 'signed_out' ? 401
      : result.reason === 'not_found' ? 404
      : result.reason === 'pending' ? 202
      : 400;
    const headers = retryAfterSec ? { 'Retry-After': String(retryAfterSec) } : {};
    return c.json(result, status, headers);
  }
  if (result.ok) return c.redirect(`/shop?bought=${encodeURIComponent(result.item.id)}`, 303);
  if (result.reason === 'needs_confirm') return c.redirect(`/shop?confirm=${encodeURIComponent(itemId)}`, 303);
  return c.redirect(`/shop?error=${encodeURIComponent(result.reason)}${itemId ? `&item=${encodeURIComponent(itemId)}` : ''}`, 303);
}

export function registerShopRoutes(app: Hono<any>): void {
  // ── GET /shop ──
  app.get('/shop', async (c) => {
    for (const [k, v] of Object.entries(cacheHeaders(CACHE.NO_STORE))) c.header(k, v);
    try {
      const [viewer, tint] = await Promise.all([resolveViewer(c as any), loadTint(c.env.DB)]);
      let balance: number | null = null;
      let patron: PatronRow | null = null;
      if (viewer.kind === 'member') {
        [balance, patron] = await Promise.all([
          getBalance(c.env, viewer.userId).catch(() => null),
          getPatron(c.env.DB, viewer.userId).catch(() => null),
        ]);
      }
      const html = (
        <ShopPage data={{
          viewer, tint, balance, patron,
          confirmItemId: c.req.query('confirm') || null,
          boughtItemId: c.req.query('bought') || null,
          errorReason: c.req.query('error') || null,
        }} />
      );
      return c.html(html, 200);
    } catch (err) {
      return c.html('<!doctype html><title>The shop</title><p>Something went wrong — try again. <a href="/">Back to the island</a></p>', 500);
    }
  });

  // ── GET /shrine — public, cacheable (no viewer-specific content) ──
  app.get('/shrine', async (c) => {
    try {
      const [tint, patrons, recent, donors, sceneRow] = await Promise.all([
        loadTint(c.env.DB),
        topPatrons(c.env.DB, 20).catch(() => []),
        recentDeliveries(c.env.DB, 8).catch(() => []),
        publicDonors(c.env.DB).catch(() => []),
        (c.env.DB as D1Database).prepare(
          `SELECT id, title, summary, setup, day, slot FROM scenes WHERE location = 'shrine' AND status = 'closed' ORDER BY day DESC, opened_at DESC LIMIT 1`
        ).first().catch(() => null) as Promise<ShrineScene | null>,
      ]);
      const html = <ShrinePage data={{ tint, patrons, recent, donors, latestScene: sceneRow || null }} />;
      return c.html(html, 200, cacheHeaders(CACHE.ARCHIVE_PAGE));
    } catch (err) {
      return c.html('<!doctype html><title>The shrine</title><p>Something went wrong — try again. <a href="/">Back to the island</a></p>', 500, cacheHeaders(CACHE.NO_STORE));
    }
  });

  // ── GET /api/shop/catalog — public JSON ──
  app.get('/api/shop/catalog', (c) => {
    const categories = CATEGORY_ORDER.map((cat) => ({
      id: cat,
      label: CATEGORY_LABEL[cat],
      items: itemsByCategory(cat).map((i) => ({
        id: i.id, name: i.name, emoji: i.emoji, category: i.category, credits: i.credits,
        blurb: i.blurb, effect_line: i.effectLine, needs_confirm: i.credits >= 500,
      })),
    }));
    return c.json({ categories, total: CATALOG.length }, 200, cacheHeaders(CACHE.DERIVED_JSON));
  });

  // ── POST /api/shop/buy — the one money-moving route in this file ──
  app.post('/api/shop/buy', async (c) => {
    for (const [k, v] of Object.entries(cacheHeaders(CACHE.NO_STORE))) c.header(k, v);
    const wantsJson = (c.req.header('accept') || '').includes('application/json');

    if (!isSameOriginRequest(c)) {
      return respondBuy(c, wantsJson, { ok: false, reason: 'error', message: 'Request blocked.' }, '');
    }

    let itemId = '';
    let confirm = false;
    let intent: string | null = null;
    try {
      const ct = c.req.header('content-type') || '';
      if (ct.includes('application/json')) {
        const body = await c.req.json<{ itemId?: string; confirm?: unknown; intent?: unknown }>();
        itemId = String(body.itemId || '');
        confirm = !!body.confirm;
        intent = typeof body.intent === 'string' ? body.intent : null;
      } else {
        const body = await c.req.parseBody();
        itemId = String(body['itemId'] || '');
        const raw = body['confirm'];
        confirm = raw === '1' || raw === 'true';
        intent = typeof body['intent'] === 'string' ? body['intent'] : null;
      }
    } catch {
      return respondBuy(c, wantsJson, { ok: false, reason: 'error', message: 'Bad request.' }, itemId);
    }

    const viewer = await resolveViewer(c as any);
    if (viewer.kind !== 'member') {
      return respondBuy(c, wantsJson, { ok: false, reason: 'signed_out', message: 'Sign in to send a gift.' }, itemId);
    }

    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
    const perUser = await rateLimit(c.env.DB, `shop:buy:${viewer.userId}`, 20, 60 * 60 * 1000);
    if (!perUser.ok) {
      return respondBuy(c, wantsJson, { ok: false, reason: 'error', message: "You're sending gifts too fast — try again in a bit." }, itemId, perUser.retryAfterSec);
    }
    const perIp = await rateLimit(c.env.DB, `shop:buy:ip:${hashId(ip)}`, 40, 60 * 60 * 1000);
    if (!perIp.ok) {
      return respondBuy(c, wantsJson, { ok: false, reason: 'error', message: 'Too many gifts from this connection right now — try again soon.' }, itemId, perIp.retryAfterSec);
    }

    const result = await buyGift(c.env, viewer, itemId, confirm, intent);
    return respondBuy(c, wantsJson, result, itemId);
  });

  // ── GET /api/export/gifts.jsonl — open dataset export (spec's "Research integrity") ──
  app.get('/api/export/gifts.jsonl', async (c) => {
    try {
      // The page cursor is the last row's `created_at` (`since`) plus its `id`
      // (`after`) — timestamps are per second, so the id breaks ties and no
      // row is ever skipped or repeated between pages. `limit` is one of three
      // sizes. Any other spelling of the query redirects to that one form: the
      // edge cache keys on the RAW query string, so every `?since=junk1`,
      // `?since=junk2`… would otherwise miss it and run the export again.
      const sinceRaw = c.req.query('since') || '';
      const m = /^(\d{4}-\d{2}-\d{2})(T\d{2}:\d{2}:\d{2})?(\.\d{1,3})?Z?$/.exec(sinceRaw);
      const sinceIso = m ? (m[2] ? `${m[1]}${m[2]}Z` : m[1]) : null; // milliseconds dropped: rows are per second
      const afterRaw = c.req.query('after') || '';
      const afterId = sinceIso && /^[A-Za-z0-9_-]{1,64}$/.test(afterRaw) ? afterRaw : null;
      const asked = parseInt(c.req.query('limit') || '500', 10) || 500;
      const limit = asked <= 100 ? 100 : asked <= 500 ? 500 : 2000;
      const parts = [
        sinceIso ? `since=${sinceIso}` : '',
        afterId ? `after=${afterId}` : '',
        limit !== 500 ? `limit=${limit}` : '',
      ].filter(Boolean);
      const want = parts.length ? `?${parts.join('&')}` : '';
      // Only the colon may arrive encoded (URLSearchParams does that) — a
      // bounded set of spellings, so the cache can't be walked around.
      const got = new URL(c.req.url).search;
      if (got !== want && got !== want.replace(/:/g, '%3A') && got !== want.replace(/:/g, '%3a')) {
        for (const [k, v] of Object.entries(cacheHeaders(CACHE.NO_STORE))) c.header(k, v);
        return c.redirect(`/api/export/gifts.jsonl${want}`, 302);
      }
      const rows = await exportGifts(c.env.DB, { sinceIso, afterId, limit }, c.env.LIVINGCORE_ENCRYPTION_KEY || null);
      const body = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
      return c.body(body, 200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        ...cacheHeaders(CACHE.DERIVED_JSON),
      });
    } catch (err) {
      return c.text('export error', 500, cacheHeaders(CACHE.NO_STORE));
    }
  });
}
