// RSS Items database operations

import { RssItem } from './schema';

export async function createRssItem(
  db: D1Database,
  item: Omit<RssItem, 'id' | 'fetched_at'>
): Promise<RssItem> {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const result = await db.prepare(
    `INSERT INTO rss_items (feed_url, feed_title, title, link, summary, content, published_at, fetched_at, status, discussion_turn_ids, assigned_category, relevance_score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`
  ).bind(
    item.feed_url, item.feed_title, item.title, item.link,
    item.summary || null, item.content || null,
    item.published_at || null, now,
    item.status, item.discussion_turn_ids,
    item.assigned_category, item.relevance_score
  ).first<RssItem>();

  return result!;
}

export async function getRecentRssItems(
  db: D1Database,
  limit: number = 30
): Promise<RssItem[]> {
  const result = await db.prepare(
    'SELECT * FROM rss_items ORDER BY fetched_at DESC LIMIT ?'
  ).bind(limit).all<RssItem>();
  return result.results;
}

export async function getRssItemsByStatus(
  db: D1Database,
  status: string,
  limit: number = 20
): Promise<RssItem[]> {
  const result = await db.prepare(
    'SELECT * FROM rss_items WHERE status = ? ORDER BY relevance_score DESC LIMIT ?'
  ).bind(status, limit).all<RssItem>();
  return result.results;
}

export async function updateRssItemByLink(
  db: D1Database,
  link: string,
  updates: Partial<Pick<RssItem, 'status' | 'assigned_category' | 'relevance_score' | 'discussion_turn_ids'>>
): Promise<void> {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.assigned_category !== undefined) { fields.push('assigned_category = ?'); values.push(updates.assigned_category); }
  if (updates.relevance_score !== undefined) { fields.push('relevance_score = ?'); values.push(updates.relevance_score); }
  if (updates.discussion_turn_ids !== undefined) { fields.push('discussion_turn_ids = ?'); values.push(updates.discussion_turn_ids); }

  if (fields.length === 0) return;

  values.push(link);
  await db.prepare(`UPDATE rss_items SET ${fields.join(', ')} WHERE link = ?`).bind(...values).run();
}

export async function getRssCount(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) as count FROM rss_items').first<{ count: number }>();
  return row?.count || 0;
}

export async function getRssStats(db: D1Database): Promise<{
  total: number;
  new: number;
  considered: number;
  discussed: number;
  ignored: number;
}> {
  const result = await db.prepare(
    `SELECT status, COUNT(*) as count FROM rss_items GROUP BY status`
  ).all<{ status: string; count: number }>();

  const stats = { total: 0, new: 0, considered: 0, discussed: 0, ignored: 0 };
  for (const row of result.results) {
    stats.total += row.count;
    stats[row.status as keyof typeof stats] = row.count;
  }
  return stats;
}
