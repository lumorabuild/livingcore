// Dialogue, Inbox, and Best Ideas database operations
import { generateId } from './packet';

// ── Dialogue Turns ──

export interface DialogueTurn {
  id: number;
  turn_number: number;
  speaker: 'kevin' | 'jenny' | 'system';
  content: string;
  thoughts: string | null;
  related_packet_ids: string;
  trigger_source: string;
  turn_group: string;
  created_at: string;
}

export async function createDialogueTurn(
  db: D1Database,
  turn: Omit<DialogueTurn, 'id' | 'created_at'>
): Promise<DialogueTurn> {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const result = await db.prepare(
    `INSERT INTO dialogue_turns (turn_number, speaker, content, thoughts, related_packet_ids, trigger_source, turn_group, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`
  ).bind(
    turn.turn_number, turn.speaker, turn.content, turn.thoughts,
    turn.related_packet_ids, turn.trigger_source, turn.turn_group, now
  ).first<DialogueTurn>();
  
  // Update total count
  await db.prepare(
    `UPDATE system_state SET value = CAST(CAST((SELECT value FROM system_state WHERE key = 'total_dialogue_turns') AS INTEGER) + 1 AS TEXT) WHERE key = 'total_dialogue_turns'`
  ).run();
  
  return result!;
}

export async function getDialogueTurns(
  db: D1Database,
  options: { limit?: number; offset?: number; group?: string } = {}
): Promise<DialogueTurn[]> {
  let query = 'SELECT * FROM dialogue_turns';
  const params: any[] = [];
  const conditions: string[] = [];
  
  if (options.group) {
    conditions.push('turn_group = ?');
    params.push(options.group);
  }
  
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  
  query += ' ORDER BY id ASC';
  
  if (options.limit) {
    query += ' LIMIT ?';
    params.push(options.limit);
  }
  if (options.offset) {
    query += ' OFFSET ?';
    params.push(options.offset);
  }
  
  const result = await db.prepare(query).bind(...params).all<DialogueTurn>();
  return result.results;
}

export async function getDialogueGroups(
  db: D1Database,
  limit: number = 20
): Promise<{ turn_group: string; count: number; first_speaker: string; created_at: string }[]> {
  const result = await db.prepare(
    `SELECT turn_group, COUNT(*) as count,
            (SELECT speaker FROM dialogue_turns d2 WHERE d2.turn_group = d1.turn_group ORDER BY id ASC LIMIT 1) as first_speaker,
            MIN(created_at) as created_at
     FROM dialogue_turns d1
     GROUP BY turn_group
     ORDER BY MAX(id) DESC
     LIMIT ?`
  ).bind(limit).all<{ turn_group: string; count: number; first_speaker: string; created_at: string }>();
  return result.results;
}

export async function getLastDialogueTurn(db: D1Database): Promise<DialogueTurn | null> {
  return db.prepare('SELECT * FROM dialogue_turns ORDER BY id DESC LIMIT 1').first<DialogueTurn>() || null;
}

export async function getDialogueTurnCount(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT value FROM system_state WHERE key = 'total_dialogue_turns'").first<{ value: string }>();
  return row ? parseInt(row.value) || 0 : 0;
}

// ── Idea Inbox ──

export interface InboxItem {
  id: number;
  author: string;
  content: string;
  status: 'pending' | 'processing' | 'discussed' | 'promoted';
  turn_group: string | null;
  created_at: string;
}

export async function createInboxItem(
  db: D1Database,
  item: { author?: string; content: string }
): Promise<InboxItem> {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const result = await db.prepare(
    `INSERT INTO inbox (author, content, status, created_at)
     VALUES (?, ?, 'pending', ?)
     RETURNING *`
  ).bind(item.author || 'anonymous', item.content, now).first<InboxItem>();
  return result!;
}

export async function updateInboxStatus(
  db: D1Database,
  id: number,
  status: InboxItem['status'],
  turnGroup?: string
): Promise<void> {
  if (turnGroup) {
    await db.prepare('UPDATE inbox SET status = ?, turn_group = ? WHERE id = ?')
      .bind(status, turnGroup, id).run();
  } else {
    await db.prepare('UPDATE inbox SET status = ? WHERE id = ?')
      .bind(status, id).run();
  }
}

export async function getInboxItems(
  db: D1Database,
  options: { limit?: number; offset?: number; status?: string } = {}
): Promise<InboxItem[]> {
  let query = 'SELECT * FROM inbox';
  const params: any[] = [];
  
  if (options.status) {
    query += ' WHERE status = ?';
    params.push(options.status);
  }
  
  query += ' ORDER BY id DESC';
  
  if (options.limit) {
    query += ' LIMIT ?';
    params.push(options.limit);
  }
  if (options.offset) {
    query += ' OFFSET ?';
    params.push(options.offset);
  }
  
  const result = await db.prepare(query).bind(...params).all<InboxItem>();
  return result.results;
}

export async function getPendingInboxCount(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) as count FROM inbox WHERE status = 'pending'").first<{ count: number }>();
  return row?.count || 0;
}

// ── Best Ideas ──

export interface BestIdea {
  id: number;
  title: string;
  content: string;
  packet_ids: string;
  inbox_id: number | null;
  promoted_by: 'kevin' | 'jenny';
  promoted_reason: string | null;
  promoted_at: string;
}

export async function createBestIdea(
  db: D1Database,
  idea: Omit<BestIdea, 'id' | 'promoted_at'>
): Promise<BestIdea> {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const result = await db.prepare(
    `INSERT INTO best_ideas (title, content, packet_ids, inbox_id, promoted_by, promoted_reason, promoted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     RETURNING *`
  ).bind(idea.title, idea.content, idea.packet_ids, idea.inbox_id, idea.promoted_by, idea.promoted_reason, now)
   .first<BestIdea>();
  return result!;
}

export async function getBestIdeas(db: D1Database): Promise<BestIdea[]> {
  const result = await db.prepare('SELECT * FROM best_ideas ORDER BY promoted_at DESC').all<BestIdea>();
  return result.results;
}
