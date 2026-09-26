// ─────────────────────────────────────────────────────────────────────────────
// LUMORA BUILD (LB) SIGN-IN — the shared SSO at id.lumorabuild.com.
//
// Ported from the two reference integrations (warmaplive's src/server/auth.ts,
// kickorkiss's worker/src/auth.ts — see scratchpad/patrons/sso.md for the full
// research). Same shape:
//
//   app (signed out) → 302 → id.lumorabuild.com/auth/start?app_id=&return_to=
//     → id signs in the person, mints a one-time HANDOFF token
//     → redirects to <app>/auth/callback?token=<handoff>&next=<path>
//     → app calls id POST /internal/exchange over the AUTH_SERVICE binding
//       → a durable app session token → we set our OWN cookie
//     → later requests verify that cookie's token via POST /internal/verify
//
// ⚠️ TRI-STATE, EVERYWHERE. `verifySiteToken` answers ok / invalid /
// indeterminate — only `invalid` (id said no, definitively) may ever clear a
// cookie or read as "signed out". `indeterminate` (binding missing, timeout,
// network error, a non-2xx/non-401 status, an unparseable body) must render
// as "unknown" and retry later — collapsing it into "signed out" logs a
// signed-in patron out on every id hiccup; collapsing it into "signed in"
// would let an outage forge a session. See sso.md §4.
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from 'hono';
import type { LbEnv } from './env';

export type Viewer =
  | { kind: 'anonymous' }
  | { kind: 'unknown' }
  | { kind: 'member'; userId: string; email: string; displayName: string };

const APP_ID = 'livingcore';
const AUTH_ORIGIN = 'https://id.lumorabuild.com';
// loginUrl/buyCreditsUrl take only a path (see the A1 contract in SPEC4 — no
// env, no request), so the site's own origin has to be a constant here. It
// only feeds the `return_to` id redirects back to, which is why it's safe:
// a mismatched value would just break the round trip, never leak anything.
const SITE_ORIGIN = 'https://livingcore.cc';

export const SESSION_COOKIE = 'site_session';
const VERIFY_TIMEOUT_MS = 1500;

// ── Cookies ──

function readCookie(c: Context, name: string): string | null {
  const header = c.req.header('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/** True only for the local, plain-http, DEV_FAKE_AUTH loop — never in production (prod is https). */
export function isLocalDevRequest(c: Context): boolean {
  try {
    const u = new URL(c.req.url);
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

/**
 * `<name>=<token>; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000[; Secure]`
 * `secure` is false only for the local http dev loop — a `Secure` cookie is
 * silently refused by the browser over plain http, which would make sign-in
 * look broken in dev for a reason that has nothing to do with the app.
 */
export function sessionCookie(token: string, secure = true): string {
  const base = `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
  return secure ? `${base}; Secure` : base;
}

export function clearedSessionCookie(secure = true): string {
  const base = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  return secure ? `${base}; Secure` : base;
}

// ── Open-redirect guard ──
//
// A previously-shipped bug (documented in sso.md, warmaplive auth.ts:184-203):
// a bare `startsWith("/") && !startsWith("//")` check let `/\evil.com`
// through, because browsers treat a leading backslash as a slash. Reject `\`
// and control characters, then re-resolve against our own origin.
// ⚠️ The RESOLVED path must be checked too: URL resolution removes dot
// segments, so `/.//evil.com`, `/a/..//evil.com` and `/%2e//evil.com` all pass
// the raw check and come out as `//evil.com` — a protocol-relative Location
// that leaves the site.
export function safeLocalPath(raw: string | null | undefined): string {
  if (!raw) return '/';
  if (/[\\\x00-\x1f]/.test(raw)) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  try {
    const u = new URL(raw, SITE_ORIGIN);
    if (u.origin !== SITE_ORIGIN) return '/';
    if (u.pathname.startsWith('//') || u.pathname.includes('\\')) return '/';
    return u.pathname + u.search;
  } catch {
    return '/';
  }
}

/**
 * Fetch-metadata same-origin check for state-changing POSTs (patron settings,
 * gifts, donations — every builder's money/settings routes want this). Never
 * hardcodes a production origin, so it works the same in local dev
 * (http://localhost:8787) and in production: it always compares against the
 * ORIGIN THE REQUEST ARRIVED ON, never a baked-in constant.
 *
 * `Sec-Fetch-Site` is sent by every modern browser and is authoritative when
 * present. Older/unusual clients fall back to Origin, then Referer. No
 * signal at all (no browser headers, no Referer) is treated as NOT
 * same-origin — the safe default for something that changes state.
 */
export function isSameOriginRequest(c: Context): boolean {
  let selfOrigin: string;
  try {
    selfOrigin = new URL(c.req.url).origin;
  } catch {
    return false;
  }
  const site = c.req.header('sec-fetch-site');
  if (site) return site === 'same-origin' || site === 'none';
  const origin = c.req.header('origin');
  if (origin) {
    try {
      return new URL(origin).origin === selfOrigin;
    } catch {
      return false;
    }
  }
  const referer = c.req.header('referer');
  if (referer) {
    try {
      return new URL(referer).origin === selfOrigin;
    } catch {
      return false;
    }
  }
  return false;
}

// ── id calls (over the AUTH_SERVICE binding — never a public fetch) ──

type VerifyState =
  | { state: 'ok'; userId: string; email: string; displayName: string }
  | { state: 'invalid' }
  | { state: 'indeterminate' };

async function verifySiteToken(env: LbEnv, token: string): Promise<VerifyState> {
  if (!env.AUTH_SERVICE) return { state: 'indeterminate' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    const res = await env.AUTH_SERVICE.fetch('https://internal.lumora-master-auth.local/internal/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, appId: APP_ID }),
      signal: controller.signal,
    });
    // Only a definitive 401 or a parseable 2xx carry a typed answer — every
    // other status (5xx, a network throw below, an unparseable body) is
    // indeterminate, never "invalid" (kickorkiss auth.ts's rule: collapsing a
    // hung id into "signed out" strands a real session with no way back).
    if (res.status === 401) return { state: 'invalid' };
    if (!res.ok) return { state: 'indeterminate' };
    const data = await res.json<any>().catch(() => null);
    if (!data) return { state: 'indeterminate' };
    if (data.valid === false) return { state: 'invalid' };
    if (data.valid === true && data.userId) {
      return {
        state: 'ok',
        userId: String(data.userId),
        email: String(data.email || ''),
        displayName: String(data.displayName || data.email || 'a patron'),
      };
    }
    return { state: 'indeterminate' };
  } catch {
    return { state: 'indeterminate' };
  } finally {
    clearTimeout(timer);
  }
}

export async function exchangeHandoff(env: LbEnv, handoffToken: string): Promise<{ token: string } | null> {
  if (!env.AUTH_SERVICE) return null;
  try {
    const res = await env.AUTH_SERVICE.fetch('https://internal.lumora-master-auth.local/internal/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handoffToken, appId: APP_ID }),
    });
    if (!res.ok) return null;
    const data = await res.json<any>().catch(() => null);
    if (!data || !data.token) return null;
    return { token: String(data.token) };
  } catch {
    return null;
  }
}

// ── The public entry point ──

/**
 * Resolves the current visitor. Cookie-first (`site_session`); in local dev
 * only (DEV_FAKE_AUTH === 'allow' AND a plain-http localhost/127.0.0.1
 * request), a `site_session=dev:<uid>` cookie is trusted directly with no id
 * round trip at all — see docs/LB-INTEGRATION.md "Local dev".
 */
export async function resolveViewer(c: Context): Promise<Viewer> {
  const env = c.env as LbEnv;
  const raw = readCookie(c, SESSION_COOKIE);
  if (!raw) return { kind: 'anonymous' };

  if (env.DEV_FAKE_AUTH === 'allow' && isLocalDevRequest(c) && raw.startsWith('dev:')) {
    const uid = raw.slice(4).trim();
    if (!uid) return { kind: 'anonymous' };
    return { kind: 'member', userId: `dev-${uid}`, email: `${uid}@dev.local`, displayName: uid };
  }

  const result = await verifySiteToken(env, raw);
  if (result.state === 'ok') {
    return { kind: 'member', userId: result.userId, email: result.email, displayName: result.displayName };
  }
  if (result.state === 'invalid') return { kind: 'anonymous' };
  return { kind: 'unknown' };
}

// ── Sign-in state (login-CSRF guard) ──
//
// Without it, anyone could send a victim `/auth/callback?token=<a handoff for
// the ATTACKER's account>` and sign them in as the attacker — and a key the
// victim then lends would be stored under the attacker's account, where the
// attacker controls its limits and the victim can never revoke it. So every
// sign-in starts at OUR /auth/login, which sets a short-lived random cookie and
// carries the same value through id in return_to; /auth/callback only
// exchanges a token whose `s` matches the cookie in THIS browser.
const LOGIN_STATE_COOKIE = 'lc_login_state';

export function newLoginState(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function loginStateCookie(state: string, secure = true): string {
  const base = `${LOGIN_STATE_COOKIE}=${state}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=900`;
  return secure ? `${base}; Secure` : base;
}

export function clearedLoginStateCookie(secure = true): string {
  const base = `${LOGIN_STATE_COOKIE}=; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=0`;
  return secure ? `${base}; Secure` : base;
}

export function readLoginState(c: Context): string | null {
  const v = readCookie(c, LOGIN_STATE_COOKIE);
  return v && /^[0-9a-f]{32}$/.test(v) ? v : null;
}

/** Where every "Sign in" link points: our own /auth/login, which sets the state first. */
export function loginUrl(nextPath: string): string {
  return `/auth/login?next=${encodeURIComponent(safeLocalPath(nextPath))}`;
}

/** id's sign-in start, carrying the state back to /auth/callback. Only /auth/login uses it. */
export function idSignInUrl(nextPath: string, state: string): string {
  const next = safeLocalPath(nextPath);
  const returnTo = `${SITE_ORIGIN}/auth/callback?next=${encodeURIComponent(next)}&s=${state}`;
  return `${AUTH_ORIGIN}/auth/start?app_id=${APP_ID}&return_to=${encodeURIComponent(returnTo)}`;
}

// RULE 4: billing lives ONLY in the shared account center. This is a link
// out, never an in-app "buy credits" flow.
export function buyCreditsUrl(nextPath: string): string {
  const next = safeLocalPath(nextPath);
  const returnTo = `${SITE_ORIGIN}/auth/callback?next=${encodeURIComponent(next)}`;
  return `${AUTH_ORIGIN}/account/billing?app_id=${APP_ID}&reason=out_of_credits&return_to=${encodeURIComponent(returnTo)}`;
}

/** id clears its OWN session too (single sign-out) once we've cleared ours. */
export function logoutUrl(): string {
  return `${AUTH_ORIGIN}/logout?app_id=${APP_ID}&return_to=${encodeURIComponent(SITE_ORIGIN + '/')}`;
}
