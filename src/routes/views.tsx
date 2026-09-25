/** @jsxImportSource hono/jsx */
// ─────────────────────────────────────────────────────────────────────────────
// SSR PAGE ROUTES — island era (spec §9). Every route picks a cache policy
// from src/cache.ts; anything that doesn't is sealed no-store by index.ts's
// default-deny middleware.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import { HomePage, fetchHomePageData } from '../views/pages/HomePage';
import { ConversationPage, fetchConversationPageData } from '../views/pages/ConversationPage';
import { ArchivePage, fetchArchivePageData } from '../views/pages/ArchivePage';
import { MemoryPage, fetchMemoryPageData } from '../views/pages/MemoryPage';
import { DayPage, fetchDayPageData } from '../views/pages/DayPage';
import { DaysPage, fetchDaysPageData } from '../views/pages/DaysPage';
import { ScenePage, fetchScenePageData } from '../views/pages/ScenePage';
import { WorkshopPage, fetchWorkshopPageData } from '../views/pages/WorkshopPage';
import { MadePage, fetchMadePageData } from '../views/pages/MadePage';
import { NotebookPage, fetchNotebookPageData } from '../views/pages/NotebookPage';
import { LabPage, fetchLabPageData } from '../views/pages/LabPage';
import { AboutPage } from '../views/pages/AboutPage';
import { getArtifact } from '../world/store';
import { CACHE, cacheHeaders } from '../cache';
import { loadTint } from '../views/chrome';

type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  NVIDIA_API_KEY: string;
};

function pageParam(c: any, name: string, fallback = 1): number {
  const raw = parseInt(c.req.query(name) || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** A 500 that says nothing about internals (the error text can carry request data); the detail goes to the log. */
function errorPage(c: any, err: unknown) {
  console.error('view error', c.req.path, err);
  return c.html('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Something went wrong — Living Core</title></head><body style="font-family:system-ui;padding:2rem"><h1>Something went wrong</h1><p>The island is still there — try again in a moment. <a href="/">Back to the island</a></p></body></html>', 500, cacheHeaders(CACHE.NO_STORE));
}

export function createViewRoutes(app: Hono<{ Bindings: Bindings }>) {
  // ── Homepage — "The Island" ──
  app.get('/', async (c) => {
    try {
      const data = await fetchHomePageData(c.env.DB);
      return c.html(<HomePage data={data} />, 200, cacheHeaders(CACHE.LIVE_PAGE));
    } catch (err) {
      return errorPage(c, err);
    }
  });

  // ── /about ──
  app.get('/about', async (c) => {
    const tint = await loadTint(c.env.DB);
    return c.html(<AboutPage tint={tint} />, 200, cacheHeaders(CACHE.ARCHIVE_PAGE));
  });

  // ── /days — chapter index ──
  app.get('/days', async (c) => {
    try {
      const [data, tint] = await Promise.all([fetchDaysPageData(c.env.DB, pageParam(c, 'page')), loadTint(c.env.DB)]);
      return c.html(<DaysPage data={data} tint={tint} />, 200, cacheHeaders(CACHE.ARCHIVE_PAGE));
    } catch (err) {
      return errorPage(c, err);
    }
  });

  // ── /day/:n — one day's chapter + scenes ──
  app.get('/day/:n', async (c) => {
    try {
      const n = parseInt(c.req.param('n'), 10);
      if (!Number.isFinite(n) || n < 1) return c.redirect('/days', 302);
      const [data, tint] = await Promise.all([fetchDayPageData(c.env.DB, n), loadTint(c.env.DB)]);
      if (!data.exists) return c.redirect('/days', 302);
      return c.html(<DayPage data={data} tint={tint} />, 200, cacheHeaders(CACHE.ARCHIVE_PAGE));
    } catch (err) {
      return errorPage(c, err);
    }
  });

  // ── /scene/:id — one scene's full transcript ──
  app.get('/scene/:id', async (c) => {
    try {
      const id = c.req.param('id');
      const [data, tint] = await Promise.all([fetchScenePageData(c.env.DB, id), loadTint(c.env.DB)]);
      if (!data) return c.redirect('/', 302);
      return c.html(<ScenePage data={data} tint={tint} />, 200, cacheHeaders(CACHE.ARCHIVE_PAGE));
    } catch (err) {
      return errorPage(c, err);
    }
  });

  // ── /workshop — artifact gallery ──
  app.get('/workshop', async (c) => {
    try {
      const makerQ = c.req.query('maker');
      const maker = makerQ === 'kevin' || makerQ === 'jenny' ? makerQ : null;
      const [data, tint] = await Promise.all([fetchWorkshopPageData(c.env.DB, maker, pageParam(c, 'page')), loadTint(c.env.DB)]);
      return c.html(<WorkshopPage data={data} tint={tint} />, 200, cacheHeaders(CACHE.ARCHIVE_PAGE));
    } catch (err) {
      return errorPage(c, err);
    }
  });

  // ── /made/<id> (the page) and /made/<id>.svg (the drawing) — ONE route ──
  //
  // ⚠️ They used to be two routes, '/made/:id.svg' then '/made/:id'. Hono does
  // not split a dot out of a param, so the first one's param was literally
  // named "id.svg": c.req.param('id') was undefined, every lookup failed, and
  // because it was registered first it also shadowed the plain page route.
  // Every artifact page and every sketch 404'd (found in the 3-day sim run).
  app.get('/made/:file', async (c) => {
    try {
      const file = c.req.param('file') || '';
      const svg = /^\d+\.svg$/.test(file);
      const id = parseInt(file, 10);
      if (!Number.isFinite(id) || !/^\d+(\.svg)?$/.test(file)) return c.redirect('/workshop', 302);

      if (svg) {
        const artifact = await getArtifact(c.env.DB, id);
        if (!artifact || artifact.format !== 'svg') return c.text('not found', 404, cacheHeaders(CACHE.NO_STORE));
        // Served as an image, never inline: an <img>-rendered SVG cannot run script,
        // and this CSP + nosniff hold even if someone opens the URL directly.
        c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
        c.header('X-Content-Type-Options', 'nosniff');
        return c.body(artifact.content, 200, {
          'Content-Type': 'image/svg+xml; charset=utf-8',
          ...cacheHeaders(CACHE.SEO),
        });
      }

      const [data, tint] = await Promise.all([fetchMadePageData(c.env.DB, id), loadTint(c.env.DB)]);
      if (!data) return c.redirect('/workshop', 302);
      return c.html(<MadePage data={data} tint={tint} />, 200, cacheHeaders(CACHE.ARCHIVE_PAGE));
    } catch (err) {
      return errorPage(c, err);
    }
  });

  // ── /notebook ──
  app.get('/notebook', async (c) => {
    try {
      const [data, tint] = await Promise.all([fetchNotebookPageData(c.env.DB, pageParam(c, 'page')), loadTint(c.env.DB)]);
      return c.html(<NotebookPage data={data} tint={tint} />, 200, cacheHeaders(CACHE.ARCHIVE_PAGE));
    } catch (err) {
      return errorPage(c, err);
    }
  });

  // ── /lab — research page ──
  app.get('/lab', async (c) => {
    try {
      const [data, tint] = await Promise.all([fetchLabPageData(c.env.DB), loadTint(c.env.DB)]);
      return c.html(<LabPage data={data} tint={tint} />, 200, cacheHeaders(CACHE.DERIVED_JSON));
    } catch (err) {
      return errorPage(c, err);
    }
  });

  // ── /conversation/:slug — legacy talking-era + island scenes ──
  app.get('/conversation/:slug', async (c) => {
    try {
      const slug = c.req.param('slug');
      const [data, tint] = await Promise.all([fetchConversationPageData(c.env.DB, slug), loadTint(c.env.DB)]);
      if (!data) return c.redirect('/', 302);
      if (data.redirectToScene) return c.redirect(`/scene/${data.redirectToScene}`, 301);
      return c.html(<ConversationPage data={data} tint={tint} />, 200, cacheHeaders(CACHE.ARCHIVE_PAGE));
    } catch (err) {
      return errorPage(c, err);
    }
  });

  // ── /archive — legacy + island conversation index, paginated ──
  app.get('/archive', async (c) => {
    try {
      const [data, tint] = await Promise.all([fetchArchivePageData(c.env.DB, pageParam(c, 'page')), loadTint(c.env.DB)]);
      return c.html(<ArchivePage data={data} tint={tint} />, 200, cacheHeaders(CACHE.ARCHIVE_PAGE));
    } catch (err) {
      return errorPage(c, err);
    }
  });

  // ── /memory/:id ──
  app.get('/memory/:id', async (c) => {
    try {
      const id = c.req.param('id');
      const [data, tint] = await Promise.all([fetchMemoryPageData(c.env.DB, id), loadTint(c.env.DB)]);
      if (!data) return c.redirect('/', 302);
      return c.html(<MemoryPage data={data} tint={tint} />, 200, cacheHeaders(CACHE.ARCHIVE_PAGE));
    } catch (err) {
      return errorPage(c, err);
    }
  });
}
