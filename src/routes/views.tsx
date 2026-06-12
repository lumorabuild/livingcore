/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { HomePage, fetchHomePageData } from '../views/pages/HomePage';
import { ConversationPage, fetchConversationPageData } from '../views/pages/ConversationPage';
import { ArchivePage, fetchArchivePageData } from '../views/pages/ArchivePage';
import { MemoryPage, fetchMemoryPageData } from '../views/pages/MemoryPage';

type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  NVIDIA_API_KEY: string;
};

export function createViewRoutes(app: Hono<{ Bindings: Bindings }>) {
  // Homepage
  app.get('/', async (c) => {
    try {
      const data = await fetchHomePageData(c.env.DB);
      return c.html(<HomePage data={data} />);
    } catch (err) {
      return c.html(`<html><body><h1>Error</h1><pre>${err}</pre></body></html>`, 500);
    }
  });

  // Conversation detail page
  app.get('/conversation/:slug', async (c) => {
    try {
      const slug = c.req.param('slug');
      const data = await fetchConversationPageData(c.env.DB, slug);
      if (!data) return c.redirect('/');
      return c.html(<ConversationPage data={data} />);
    } catch (err) {
      return c.json({ error: 'Conversation route error', message: String(err), stack: (err as any).stack }, 500);
    }
  });

  // Archive listing
  app.get('/archive', async (c) => {
    try {
      const data = await fetchArchivePageData(c.env.DB);
      return c.html(<ArchivePage data={data} />);
    } catch (err) {
      return c.html(`<html><body><h1>Error</h1><pre>${err}</pre></body></html>`, 500);
    }
  });

  // Memory detail page
  app.get('/memory/:id', async (c) => {
    try {
      const id = c.req.param('id');
      const data = await fetchMemoryPageData(c.env.DB, id);
      if (!data) return c.redirect('/');
      return c.html(<MemoryPage data={data} />);
    } catch (err) {
      return c.json({ error: 'Memory route error', message: String(err), stack: (err as any).stack }, 500);
    }
  });
}
