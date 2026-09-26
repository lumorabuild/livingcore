/** @jsxImportSource hono/jsx */
// ─────────────────────────────────────────────────────────────────────────────
// LB SIGN-IN + ACCOUNT ROUTES (SPEC4 §A1).
//
// GET  /auth/login              → redirect to id's /auth/start
// GET  /auth/callback           → exchange the handoff token, set our cookie
// GET  /auth/logout             → same-origin only, clear cookie, redirect to id's /logout
// GET  /auth/dev-login          → LOCAL DEV ONLY convenience (see below); 404 elsewhere
// GET  /api/me                  → no-store JSON: {viewer, balance, patron, buy_url}
// GET  /account                 → the settings page (sign-in sheet when signed out)
// POST /api/account/patron      → save public name / show / daily cap
//
// Every route here is per-viewer: ALWAYS Cache-Control: no-store (never rely
// on the default-deny alone — see sso.md §6 / src/cache.ts).
// ─────────────────────────────────────────────────────────────────────────────

import type { Hono, Context } from 'hono';
import { CACHE, cacheHeaders } from '../cache';
import { loadTint } from '../views/chrome';
import { rateLimit } from '../core/ratelimit';
import type { LbEnv } from '../lb/env';
import {
  resolveViewer, loginUrl, buyCreditsUrl, logoutUrl, exchangeHandoff,
  sessionCookie, clearedSessionCookie, safeLocalPath, isSameOriginRequest,
  isLocalDevRequest, newLoginState, loginStateCookie, clearedLoginStateCookie,
  readLoginState, idSignInUrl,
} from '../lb/auth';
import { getBalance } from '../lb/credits';
import { getPatron, updatePatron, patronLabel } from '../lb/patrons';
import { giftHistory } from '../world/gifts';
import { AccountPage, type AccountNotice } from '../views/pages/AccountPage';

const NO_STORE = cacheHeaders(CACHE.NO_STORE);

function isHttps(c: Context): boolean {
  try {
    return new URL(c.req.url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Does the caller want JSON back (a fetch()-enhanced form) rather than a redirect? */
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

/**
 * c.redirect() only takes (location, status) — no third headers argument
 * (unlike c.json/c.html/c.text) — so a no-store redirect has to set the
 * headers via c.header() first; they're picked up by the Response the
 * redirect call builds. Every redirect on a per-viewer route goes through
 * this rather than a bare c.redirect(), per sso.md §6.
 */
function noStoreRedirect(c: Context, location: string, status: 301 | 302 | 303 | 307 | 308 = 302) {
  for (const [k, v] of Object.entries(NO_STORE)) c.header(k, v);
  return c.redirect(location, status);
}

function truthy(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  return s !== '' && s !== '0' && s !== 'false' && s !== 'off';
}

const PATRON_ERROR_MESSAGES: Record<string, string> = {
  invalid_name: "That name doesn't work — 2 to 24 characters, letters/numbers/spaces/.-' only, no links or reserved words.",
  name_required: 'Add a public name before choosing to show it.',
  invalid_cap: 'Daily cap must be between 100 and 10,000 credits.',
  rate_limited: 'Too many changes — try again in a few minutes.',
  sign_in_required: 'Sign in first.',
  sign_in_failed: "Sign-in didn't finish. Please try again.",
};

export function registerAccountRoutes(app: Hono<any>): void {
  // ── GET /auth/login ──
  app.get('/auth/login', (c: Context) => {
    const next = safeLocalPath(c.req.query('next'));
    const state = newLoginState();
    c.header('Set-Cookie', loginStateCookie(state, isHttps(c)));
    return noStoreRedirect(c, idSignInUrl(next, state), 302);
  });

  // ── GET /auth/dev-login — LOCAL DEV ONLY. ──
  // Sets `site_session=dev:<uid>` directly, skipping id entirely, so the
  // whole feature set is testable without the real id/coin services (SPEC4
  // "Local dev"). Gated on the exact same conditions resolveViewer trusts a
  // dev cookie under — DEV_FAKE_AUTH === 'allow' AND a plain-http
  // localhost/127.0.0.1 request — so it 404s outright anywhere else,
  // including a misconfigured production deploy.
  app.get('/auth/dev-login', (c: Context) => {
    const env = c.env as LbEnv;
    if (env.DEV_FAKE_AUTH !== 'allow' || !isLocalDevRequest(c)) return c.notFound();
    const uidRaw = c.req.query('uid') || 'tester';
    const uid = uidRaw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'tester';
    c.header('Set-Cookie', `site_session=dev:${uid}; Path=/; HttpOnly; SameSite=Lax`);
    return noStoreRedirect(c, safeLocalPath(c.req.query('next') || '/account'), 302);
  });

  // ── GET /auth/callback ──
  app.get('/auth/callback', async (c: Context) => {
    const next = safeLocalPath(c.req.query('next'));
    const handoff = c.req.query('token');
    const s = c.req.query('s');
    // No `s`: not a sign-in WE started — e.g. the way back from id's account
    // centre after buying credits, which appends its own token. Nothing is
    // exchanged, so the visitor's session stays exactly what it was.
    if (!handoff || !s) return noStoreRedirect(c, next, 302);
    // A token is exchanged ONLY when it comes back to the browser that started
    // this sign-in (see the login-state note in lb/auth.ts). Anything else is a
    // forged or stale link: it never switches whose session this browser holds.
    const state = readLoginState(c);
    const secure = isHttps(c);
    c.header('Set-Cookie', clearedLoginStateCookie(secure), { append: true });
    if (!state || s !== state) {
      return noStoreRedirect(c, '/account?patron_error=sign_in_failed', 302);
    }
    const env = c.env as LbEnv;
    const exchanged = await exchangeHandoff(env, handoff);
    if (!exchanged) return noStoreRedirect(c, '/account?patron_error=sign_in_failed', 302);
    c.header('Set-Cookie', sessionCookie(exchanged.token, secure), { append: true });
    return noStoreRedirect(c, next, 302);
  });

  // ── GET /auth/logout ──
  // Sec-Fetch-Site guard: refuse a cross-site GET so a third-party page can't
  // silently log a visitor out via an <img>/<link> pointed here.
  app.get('/auth/logout', (c: Context) => {
    const site = c.req.header('sec-fetch-site');
    if (site && site !== 'same-origin' && site !== 'none') {
      return c.text('cross-site logout refused', 400, NO_STORE);
    }
    const env = c.env as LbEnv;
    c.header('Set-Cookie', clearedSessionCookie(isHttps(c)));
    // Local dev has no real id session to clear — skip the round trip.
    if (env.DEV_FAKE_AUTH === 'allow' && isLocalDevRequest(c)) {
      return noStoreRedirect(c, '/', 302);
    }
    return noStoreRedirect(c, logoutUrl(), 302);
  });

  // ── GET /api/me ──
  app.get('/api/me', async (c: Context) => {
    const env = c.env as LbEnv;
    const viewer = await resolveViewer(c);
    if (viewer.kind !== 'member') {
      return c.json({ viewer, balance: null, patron: null, buy_url: null }, 200, NO_STORE);
    }
    const referer = c.req.header('referer');
    let refererPath = '/account';
    if (referer) {
      try {
        const u = new URL(referer);
        if (u.origin === new URL(c.req.url).origin) refererPath = safeLocalPath(u.pathname + u.search);
      } catch {
        /* keep default */
      }
    }
    const [balance, patronRow] = await Promise.all([
      getBalance(env, viewer.userId),
      getPatron(env.DB, viewer.userId),
    ]);
    return c.json(
      {
        viewer,
        balance,
        patron: {
          public_name: patronRow.public_name,
          show_name: !!patronRow.show_name,
          daily_cap: patronRow.daily_cap,
          label: patronLabel(patronRow),
        },
        buy_url: buyCreditsUrl(refererPath),
      },
      200,
      NO_STORE
    );
  });

  // ── GET /account ──
  app.get('/account', async (c: Context) => {
    const env = c.env as LbEnv;
    const viewer = await resolveViewer(c);
    const tint = await loadTint(env.DB).catch(() => undefined);

    let notice: AccountNotice | null = null;
    if (c.req.query('patron_saved')) notice = { kind: 'saved', message: 'Saved.' };
    const err = c.req.query('patron_error');
    if (err) notice = { kind: 'error', message: PATRON_ERROR_MESSAGES[err] || 'Could not save — check your entry.' };

    if (viewer.kind !== 'member') {
      return c.html(<AccountPage viewer={viewer} tint={tint} loginHref={loginUrl('/account')} notice={notice} />, 200, NO_STORE);
    }

    const [balance, patron, gifts] = await Promise.all([
      getBalance(env, viewer.userId),
      getPatron(env.DB, viewer.userId),
      giftHistory(env.DB, viewer.userId).catch(() => []),
    ]);

    return c.html(
      <AccountPage
        viewer={viewer}
        tint={tint}
        balance={balance}
        patron={patron}
        buyUrl={buyCreditsUrl('/account')}
        encryptionEnabled={!!env.LIVINGCORE_ENCRYPTION_KEY}
        notice={notice}
        gifts={gifts}
      />,
      200,
      NO_STORE
    );
  });

  // ── POST /api/account/patron ──
  app.post('/api/account/patron', async (c: Context) => {
    const env = c.env as LbEnv;
    const viewer = await resolveViewer(c);
    if (viewer.kind !== 'member') {
      return wantsJson(c)
        ? c.json({ error: 'sign_in_required' }, 401, NO_STORE)
        : noStoreRedirect(c, loginUrl('/account'), 303);
    }
    if (!isSameOriginRequest(c)) {
      return c.text('cross-site request refused', 403, NO_STORE);
    }

    const rl = await rateLimit(env.DB, `patron:${viewer.userId}`, 12, 10 * 60 * 1000);
    if (!rl.ok) {
      return wantsJson(c)
        ? c.json({ error: 'rate_limited' }, 429, { ...NO_STORE, 'Retry-After': String(rl.retryAfterSec) })
        : noStoreRedirect(c, '/account?patron_error=rate_limited', 303);
    }

    const body = await readBody(c);
    const patch: { public_name?: string | null; show_name?: boolean; daily_cap?: number } = {};
    if ('public_name' in body) {
      const v = String(body.public_name ?? '').trim();
      patch.public_name = v === '' ? null : v;
    }
    patch.show_name = truthy(body.show_name);
    if ('daily_cap' in body) {
      const n = Number(body.daily_cap);
      if (Number.isFinite(n)) patch.daily_cap = n;
    }

    const result = await updatePatron(env.DB, viewer.userId, patch);
    if ('error' in result) {
      return wantsJson(c)
        ? c.json({ error: result.error }, 400, NO_STORE)
        : noStoreRedirect(c, `/account?patron_error=${encodeURIComponent(result.error)}`, 303);
    }

    return wantsJson(c)
      ? c.json(
          {
            ok: true,
            patron: {
              public_name: result.public_name,
              show_name: !!result.show_name,
              daily_cap: result.daily_cap,
              label: patronLabel(result),
            },
          },
          200,
          NO_STORE
        )
      : noStoreRedirect(c, '/account?patron_saved=1', 303);
  });
}
