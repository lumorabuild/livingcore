/** @jsxImportSource hono/jsx */
// ─────────────────────────────────────────────────────────────────────────────
// SHARED PAGE SHELL — island era, part 3 (SPEC3).
//
// The old SaaS chrome — a disclaimer bar, a <header> with a brand + a nav
// row, a <footer> — is GONE from every page, not just the home page. The
// owner's own words: "make this website go away from old SaaS website
// style." What replaces it, site-wide:
//   - the home page (`chrome="map"`) is the full-viewport island itself and
//     builds its OWN floating HUD (HomePage.tsx) — this file renders only
//     the page shell (head/meta/GA4/fonts/css) and hands back `children`
//     completely unwrapped.
//   - every other page (`chrome="sheet"`, the default) gets a blurred,
//     dimmed rendering of the island behind a floating "paper sheet" that
//     holds the real content, plus the two floating icons every sheet page
//     shares (src/views/chrome.tsx's SheetChrome) — never a header, never a
//     footer bar.
//
// No Tailwind CDN: one hand-written stylesheet (public/app.css, linked with
// a short version constant so a deploy busts the cache) plus Inter (UI) +
// Source Serif 4 (chapters/prose) + Caveat (hand-lettered map labels) from
// Google Fonts. GA4 tag id kept EXACTLY as before.
// ─────────────────────────────────────────────────────────────────────────────

import { safeJson } from './safe-json';
import { SheetChrome, SheetBackdrop, CreditLine, type Tint } from './chrome';

// Bump when app.css/script.js change — the only reason this exists is a cache
// buster on the two static assets, so a deploy is visible immediately.
const ASSET_VERSION = 'island4';

interface BaseLayoutProps {
  title: string;
  description: string;
  children: any;
  canonicalUrl?: string;
  ogType?: string; // 'website' (default) | 'article'
  jsonLd?: any; // extra JSON-LD graph node(s) to merge into the page's @graph
  noindex?: boolean;
  /** 'map' = the home page, which renders its own full-viewport HUD and
   *  wants nothing else on the page; 'sheet' (default) = every other page,
   *  which gets the blurred backdrop + floating paper sheet + back/menu
   *  icons below. */
  chrome?: 'map' | 'sheet';
  /** Sheet pages only: the current slot/weather, for the backdrop's sky
   *  tint (src/views/chrome.tsx's loadTint — one cheap, edge-cached read). */
  tint?: Tint;
  /** Day/scene pages only: floating ←/→ icons alongside the shared menu. */
  prevNav?: { href: string; label: string };
  nextNav?: { href: string; label: string };
}

/*
  ONE place that enforces the search-engine limits, so no page can drift past
  them. Bing flags titles over ~60 characters and descriptions over 150 (it is
  stricter than Google, and it is the one that sends the error mails). Page
  titles here are built from model-written text (scene, chapter and artifact
  titles) of any length, so per-page slicing kept missing: the review found
  scene and artifact titles running to 80+ characters.
*/
const BRAND_SUFFIX = ' — Living Core';
const TITLE_MAX = 60;
const DESC_MIN = 25;
const DESC_MAX = 150;

function cutAtWord(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:—–-]+$/, '') + '…';
}

export function fitTitle(title: string): string {
  const t = title.replace(/\s+/g, ' ').trim();
  if (t.length <= TITLE_MAX) return t;
  // Shorten the page-specific part, never the brand.
  if (t.endsWith(BRAND_SUFFIX)) return cutAtWord(t.slice(0, -BRAND_SUFFIX.length), TITLE_MAX - BRAND_SUFFIX.length) + BRAND_SUFFIX;
  return cutAtWord(t, TITLE_MAX);
}

export function fitDescription(description: string): string {
  let d = description.replace(/\s+/g, ' ').trim();
  if (d.length < DESC_MIN) d = `${d} Kevin and Jenny, two AI agents living on a simulated island.`.trim();
  return cutAtWord(d, DESC_MAX);
}

export function BaseLayout({
  title: rawTitle, description: rawDescription, children, canonicalUrl, ogType, jsonLd, noindex,
  chrome = 'sheet', tint, prevNav, nextNav,
}: BaseLayoutProps) {
  const title = fitTitle(rawTitle);
  const description = fitDescription(rawDescription);
  // A RASTER 1200×630 card (the island itself). Every major link preview —
  // Facebook, X, LinkedIn, Slack, WhatsApp, Discord, iMessage — rejects an SVG
  // og:image and shows a blank grey box; this used to be favicon.svg.
  const ogImage = 'https://livingcore.cc/og-image.png';
  const graph: any[] = Array.isArray(jsonLd) ? jsonLd : jsonLd ? [jsonLd] : [];

  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        {/* Google Analytics (gtag.js) — id kept exactly */}
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-QL2811J7YS"></script>
        <script dangerouslySetInnerHTML={{ __html: `
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', 'G-QL2811J7YS');
        ` }}></script>
        <title>{title}</title>
        <meta name="description" content={description} />
        {canonicalUrl && <link rel="canonical" href={canonicalUrl} />}

        <meta
          name="robots"
          content={noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'}
        />
        <meta name="author" content="Lumora Build" />
        <meta name="theme-color" content="#f6f1e4" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="sitemap" type="application/xml" title="Sitemap" href="/sitemap.xml" />

        {/* Open Graph */}
        <meta property="og:site_name" content="Living Core" />
        <meta property="og:type" content={ogType || 'website'} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        {canonicalUrl && <meta property="og:url" content={canonicalUrl} />}
        <meta property="og:image" content={ogImage} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:type" content="image/png" />
        <meta property="og:image:alt" content="Sorrel Island from above, with Kevin and Jenny beside their cottage" />

        {/* Twitter card */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <meta name="twitter:image" content={ogImage} />

        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&family=Caveat:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
        <link rel="stylesheet" href={`/app.css?v=${ASSET_VERSION}`} />

        {graph.length > 0 && (
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJson({ '@context': 'https://schema.org', '@graph': graph }) }}></script>
        )}
      </head>
      <body class={chrome === 'map' ? 'v-map' : 'v-sheet'}>
        {chrome === 'map' ? (
          children
        ) : (
          <>
            <SheetBackdrop tint={tint || { slot: 'midday', weatherKind: 'clear' }} />
            <main class="sheet-main">
              <article class="paper-sheet">
                {children}
                <CreditLine />
              </article>
            </main>
            <SheetChrome prev={prevNav} next={nextNav} />
          </>
        )}

        <script src={`/script.js?v=${ASSET_VERSION}`}></script>
      </body>
    </html>
  );
}
