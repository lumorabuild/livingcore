// ─────────────────────────────────────────────────────────────────────────────
// THE ONE PLACE THAT DECIDES WHAT CLOUDFLARE MAY STORE
//
// `cache.enabled` is set in wrangler.jsonc, so Cloudflare now keeps this
// Worker's responses at the edge and serves them WITHOUT running the Worker.
// This site needs it more than most: the client polls /api/poll every FIVE
// SECONDS, and each poll was three D1 queries. The conversation itself only
// moves when the cron fires, once every two minutes — so almost all of that
// work was re-deriving an answer that had not changed.
//
// ⚠️ A RESPONSE WITH NO Cache-Control IS NOT UNCACHED — IT IS CACHED FOR TWO
//    HOURS. Cloudflare applies RFC 9111 heuristic freshness when the header is
//    absent (200 -> 7200s, 301 -> 1200s, 404 -> 180s). Before this file, not one
//    route here set Cache-Control, so switching caching on without a default
//    would have frozen the home page for two hours and — far worse — cached
//    /__cron, a GET that writes to D1 and spends the AI budget.
//
//    `seal()` below inverts that default: anything that did not state a policy
//    gets `no-store`. Deny by default, allow on purpose.
//
// ⚠️ THE CACHE KEY DOES NOT INCLUDE THE HOSTNAME OR THE SCHEME. It is
//    entrypoint + path + query + Worker version. Nothing here redirects based on
//    the request host, so there is no apex/www hazard today — but if one is ever
//    added it must be `no-store`, or the canonical host gets served a redirect
//    pointing at itself (this took www.warmaplive.com down on 2026-08-20).
//
// Two headers, aimed at two different caches:
//   Cache-Control                 -> the visitor's browser (reaches the client)
//   Cloudflare-CDN-Cache-Control  -> Cloudflare's edge; overrides the above
//                                    there, and is stripped before the client
//                                    sees it.
// That split is what lets the live feed stay `no-store` for the browser while
// the edge still absorbs a burst of identical polls.
// ─────────────────────────────────────────────────────────────────────────────

const EDGE = 'Cloudflare-CDN-Cache-Control';

export interface Policy {
  browser: string;
  edge: string;
}

export const CACHE = {
  /** Never stored. The default for anything that did not choose. */
  NO_STORE: { browser: 'no-store', edge: 'no-store' } as Policy,

  /**
   * The live poll, /api/poll?since=N.
   *
   * `since` is the caller's last-seen turn id, and in steady state every open
   * tab converges on the same value within one cycle — so this is a low
   * cardinality key, not one entry per visitor.
   *
   * 10s fresh + 20s stale-while-revalidate against a client that asks every 5s
   * and a cron that writes every 120s: a turn can be at most half a minute late
   * on a feed that only changes every two minutes, and the D1 work drops by
   * roughly a factor of six.
   */
  POLL: { browser: 'no-store', edge: 'max-age=10, stale-while-revalidate=20' } as Policy,

  /** The home page — server-rendered from the same state the poll returns. */
  LIVE_PAGE: {
    browser: 'no-store',
    edge: 'max-age=60, stale-while-revalidate=120',
  } as Policy,

  /**
   * Archive, conversation and memory pages. A finished conversation never
   * changes again; the one still running changes every two minutes.
   */
  ARCHIVE_PAGE: {
    browser: 'public, max-age=60',
    edge: 'max-age=300, stale-while-revalidate=3600',
  } as Policy,

  /** Read-only JSON that is derived, not live: stats, exports, categories. */
  DERIVED_JSON: {
    browser: 'public, max-age=60',
    edge: 'max-age=300, stale-while-revalidate=600',
  } as Policy,

  /** robots.txt, sitemap.xml, favicon. */
  SEO: {
    browser: 'public, max-age=3600',
    edge: 'max-age=86400, stale-while-revalidate=86400',
  } as Policy,
} as const;

/** Spread into a Hono `c.json(body, status, headers)` call. */
export function cacheHeaders(p: Policy): Record<string, string> {
  return { 'Cache-Control': p.browser, [EDGE]: p.edge };
}

/**
 * Default-deny, applied to every response on the way out.
 *
 * A handler that already stated `Cache-Control` is left alone — including the
 * ones that set only `Cache-Control` and no edge header, which then means
 * exactly what it says at both layers.
 */
export function seal(res: Response): Response {
  if (res.headers.has('Cache-Control') || res.headers.has(EDGE)) return res;
  try {
    res.headers.set('Cache-Control', 'no-store');
    res.headers.set(EDGE, 'no-store');
    return res;
  } catch {
    // A response handed back by another fetcher can have immutable headers.
    const out = new Response(res.body, res);
    out.headers.set('Cache-Control', 'no-store');
    out.headers.set(EDGE, 'no-store');
    return out;
  }
}
