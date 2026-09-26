// ─────────────────────────────────────────────────────────────────────────────
// LEND-A-MIND MANAGEMENT API (SPEC4 §A3).
//
//   GET  /api/account/donations            → the signed-in donor's own donations (no keys, ever)
//   POST /api/account/donations            → add one (validated with a real call before it is ever stored)
//   POST /api/account/donations/:id        → pause / resume / edit limits (ownership-checked)
//   POST /api/account/donations/:id/revoke → revoke (deletes the encrypted key)
//
// Every route: member-only, same-origin (money-safety rule — these change
// state and hold a key, same bar as a coin spend), Cache-Control: no-store,
// rate-limited. Registered from src/index.ts before the catch-all.
// ─────────────────────────────────────────────────────────────────────────────

import type { Hono, Context } from 'hono';
import { CACHE, cacheHeaders } from '../cache';
import { rateLimit } from '../core/ratelimit';
import type { LbEnv } from '../lb/env';
import { resolveViewer, loginUrl, isSameOriginRequest } from '../lb/auth';
import { addDonation, listDonations, updateDonation, revokeDonation, PROVIDERS, CONSENT_VERSION } from '../world/donations';

const NO_STORE = cacheHeaders(CACHE.NO_STORE);

function wantsJson(c: Context): boolean {
  const accept = c.req.header('accept') || '';
  const ct = c.req.header('content-type') || '';
  return accept.includes('application/json') || ct.includes('application/json');
}

async function readBody(c: Context): Promise<Record<string, unknown>> {
  const ct = c.req.header('content-type') || '';
  if (ct.includes('application/json')) {
    try {
      const j = await c.req.json();
      return j && typeof j === 'object' ? (j as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  try {
    const body = await c.req.parseBody();
    return body as Record<string, unknown>;
  } catch {
    return {};
  }
}

function truthy(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  return s !== '' && s !== '0' && s !== 'false' && s !== 'off';
}

/** Same "headers must land on the redirect Response" note as src/routes/account.tsx's noStoreRedirect — c.redirect() has no headers argument. */
function noStoreRedirect(c: Context, location: string, status: 301 | 302 | 303 = 303) {
  for (const [k, v] of Object.entries(NO_STORE)) c.header(k, v);
  return c.redirect(location, status);
}

const ADD_ERROR_MESSAGES: Record<string, string> = {
  disabled: 'Lending a mind is temporarily disabled on this server.',
  invalid_provider: 'Pick a provider from the list.',
  invalid_role: 'Pick who should think with it.',
  invalid_model: 'Enter a model id.',
  model_not_allowed: 'Only public base models can be lent — not fine-tunes, presets or custom deployments.',
  same_as_partner: "That's the other character's own model, and Kevin and Jenny never share one. Pick a different model.",
  invalid_key: 'That does not look like a real API key.',
  consent_required: 'You need to accept the terms above first.',
  rate_limited: 'Too many attempts — try again in a while.',
  sign_in_required: 'Sign in first.',
  error: 'Something went wrong saving that. Please try again.',
};

export function registerDonationRoutes(app: Hono<any>): void {
  // ── GET /api/account/donations ──
  app.get('/api/account/donations', async (c: Context) => {
    const env = c.env as LbEnv;
    const viewer = await resolveViewer(c);
    if (viewer.kind !== 'member') return c.json({ error: 'sign_in_required' }, 401, NO_STORE);

    const enabled = !!env.LIVINGCORE_ENCRYPTION_KEY;
    const donations = enabled ? await listDonations(env, viewer.userId) : [];
    const providers = Object.fromEntries(
      Object.entries(PROVIDERS).map(([k, v]) => [k, { label: v.label, model_placeholder: v.modelPlaceholder }])
    );
    return c.json({ enabled, donations, providers, consent_version: CONSENT_VERSION }, 200, NO_STORE);
  });

  // ── POST /api/account/donations ──
  app.post('/api/account/donations', async (c: Context) => {
    const env = c.env as LbEnv;
    const viewer = await resolveViewer(c);
    if (viewer.kind !== 'member') {
      return wantsJson(c) ? c.json({ error: 'sign_in_required' }, 401, NO_STORE) : noStoreRedirect(c, loginUrl('/account'));
    }
    if (!isSameOriginRequest(c)) return c.text('cross-site request refused', 403, NO_STORE);
    if (!env.LIVINGCORE_ENCRYPTION_KEY) {
      return wantsJson(c)
        ? c.json({ error: 'disabled', message: ADD_ERROR_MESSAGES.disabled }, 400, NO_STORE)
        : noStoreRedirect(c, '/account?donation_error=disabled');
    }

    // 5/hour/user, specifically for ADDING (spec's money-safety section:
    // "Rate-limit adds (5/hour/user)") — this also happens to be the ONE
    // route that spends a real, tiny call against the donor's own key on
    // every attempt, valid or not, so it's the route worth guarding hardest.
    const rl = await rateLimit(env.DB, `donation:add:${viewer.userId}`, 5, 60 * 60 * 1000);
    if (!rl.ok) {
      return wantsJson(c)
        ? c.json({ error: 'rate_limited', message: ADD_ERROR_MESSAGES.rate_limited }, 429, { ...NO_STORE, 'Retry-After': String(rl.retryAfterSec) })
        : noStoreRedirect(c, '/account?donation_error=rate_limited');
    }

    const body = await readBody(c);
    if (!truthy(body.consent)) {
      return wantsJson(c)
        ? c.json({ error: 'consent_required', message: ADD_ERROR_MESSAGES.consent_required }, 400, NO_STORE)
        : noStoreRedirect(c, '/account?donation_error=consent_required');
    }

    const result = await addDonation(env, {
      userId: viewer.userId,
      provider: String(body.provider || ''),
      model: String(body.model || ''),
      role: String(body.role || ''),
      apiKey: String(body.api_key || ''),
      callsPerDay: body.calls_per_day !== undefined ? Number(body.calls_per_day) : undefined,
      tokensPerDay: body.tokens_per_day !== undefined ? Number(body.tokens_per_day) : undefined,
      consentVersion: String(body.consent_version || CONSENT_VERSION),
    });

    if (!result.ok) {
      return wantsJson(c)
        ? c.json({ error: result.error, message: ADD_ERROR_MESSAGES[result.error] || result.error }, 400, NO_STORE)
        : noStoreRedirect(c, `/account?donation_error=${encodeURIComponent(result.error)}`);
    }

    return wantsJson(c)
      ? c.json({ ok: true, donation: result.donation }, 200, NO_STORE)
      : noStoreRedirect(c, '/account?donation_saved=1');
  });

  // ── POST /api/account/donations/:id — pause / resume / edit limits ──
  app.post('/api/account/donations/:id', async (c: Context) => {
    const env = c.env as LbEnv;
    const viewer = await resolveViewer(c);
    if (viewer.kind !== 'member') return c.json({ error: 'sign_in_required' }, 401, NO_STORE);
    if (!isSameOriginRequest(c)) return c.text('cross-site request refused', 403, NO_STORE);

    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id)) return c.json({ error: 'not_found' }, 404, NO_STORE);

    const rl = await rateLimit(env.DB, `donation:manage:${viewer.userId}`, 30, 60 * 60 * 1000);
    if (!rl.ok) return c.json({ error: 'rate_limited' }, 429, { ...NO_STORE, 'Retry-After': String(rl.retryAfterSec) });

    const body = await readBody(c);
    const patch: { action?: 'pause' | 'resume'; calls_per_day?: number; tokens_per_day?: number } = {};
    if (body.action === 'pause' || body.action === 'resume') patch.action = body.action;
    if (body.calls_per_day !== undefined) {
      const n = Number(body.calls_per_day);
      if (Number.isFinite(n)) patch.calls_per_day = n;
    }
    if (body.tokens_per_day !== undefined) {
      const n = Number(body.tokens_per_day);
      if (Number.isFinite(n)) patch.tokens_per_day = n;
    }

    const result = await updateDonation(env, id, viewer.userId, patch);
    if (!result.ok) return c.json({ error: result.error }, result.error === 'not_found' ? 404 : 400, NO_STORE);
    return c.json({ ok: true }, 200, NO_STORE);
  });

  // ── POST /api/account/donations/:id/revoke ──
  app.post('/api/account/donations/:id/revoke', async (c: Context) => {
    const env = c.env as LbEnv;
    const viewer = await resolveViewer(c);
    if (viewer.kind !== 'member') return c.json({ error: 'sign_in_required' }, 401, NO_STORE);
    if (!isSameOriginRequest(c)) return c.text('cross-site request refused', 403, NO_STORE);

    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id)) return c.json({ error: 'not_found' }, 404, NO_STORE);

    const rl = await rateLimit(env.DB, `donation:manage:${viewer.userId}`, 30, 60 * 60 * 1000);
    if (!rl.ok) return c.json({ error: 'rate_limited' }, 429, { ...NO_STORE, 'Retry-After': String(rl.retryAfterSec) });

    const ok = await revokeDonation(env, id, viewer.userId);
    if (!ok) return c.json({ error: 'not_found' }, 404, NO_STORE);
    return c.json({ ok: true }, 200, NO_STORE);
  });
}
