// Packet CRUD operations for D1
import { ThoughtPacket, PacketConnection, AgentLogEntry, AgentName, PacketType, SystemState } from './schema';

// Helper to generate short IDs
export function generateId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 12; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

// ---- Packet CRUD ----

export async function createPacket(db: D1Database, packet: Omit<ThoughtPacket, 'created_at' | 'last_updated'>): Promise<ThoughtPacket> {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const tags = JSON.stringify(packet.tags || []);
  
  await db.prepare(
    `INSERT INTO packets (id, content, type, strength, tags, created_at, last_updated, rewrite_count, coherence_score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(packet.id, packet.content, packet.type, packet.strength, tags, now, now, packet.rewrite_count || 0, packet.coherence_score || 0).run();
  
  return { ...packet, created_at: now, last_updated: now };
}

export async function updatePacket(db: D1Database, id: string, updates: Partial<ThoughtPacket>): Promise<void> {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const fields: string[] = [];
  const values: any[] = [];
  
  if (updates.content !== undefined) { fields.push('content = ?'); values.push(updates.content); }
  if (updates.type !== undefined) { fields.push('type = ?'); values.push(updates.type); }
  if (updates.strength !== undefined) { fields.push('strength = ?'); values.push(updates.strength); }
  if (updates.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(updates.tags)); }
  if (updates.rewrite_count !== undefined) { fields.push('rewrite_count = ?'); values.push(updates.rewrite_count); }
  if (updates.coherence_score !== undefined) { fields.push('coherence_score = ?'); values.push(updates.coherence_score); }
  
  fields.push('last_updated = ?');
  values.push(now);
  values.push(id);
  
  await db.prepare(`UPDATE packets SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
}

export async function deletePacket(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM connections WHERE source_id = ? OR target_id = ?').bind(id, id).run();
  await db.prepare('DELETE FROM packets WHERE id = ?').bind(id).run();
}

export async function getPacket(db: D1Database, id: string): Promise<ThoughtPacket | null> {
  const result = await db.prepare('SELECT * FROM packets WHERE id = ?').bind(id).first<Record<string, any>>();
  if (!result) return null;
  return rowToPacket(result);
}

export async function getAllPackets(db: D1Database): Promise<ThoughtPacket[]> {
  const result = await db.prepare('SELECT * FROM packets ORDER BY strength DESC, last_updated DESC').all<Record<string, any>>();
  return result.results.map(rowToPacket);
}

export async function searchPackets(db: D1Database, query: string, limit: number = 20): Promise<ThoughtPacket[]> {
  const searchTerm = `%${query.toLowerCase()}%`;
  const result = await db.prepare(
    `SELECT * FROM packets 
     WHERE LOWER(content) LIKE ? 
        OR LOWER(tags) LIKE ?
     ORDER BY strength DESC, last_updated DESC
     LIMIT ?`
  ).bind(searchTerm, searchTerm, limit).all<Record<string, any>>();
  return result.results.map(rowToPacket);
}

export async function getRecentPackets(db: D1Database, limit: number = 50): Promise<ThoughtPacket[]> {
  const result = await db.prepare(
    'SELECT * FROM packets ORDER BY last_updated DESC LIMIT ?'
  ).bind(limit).all<Record<string, any>>();
  return result.results.map(rowToPacket);
}

export async function getPacketsByType(db: D1Database, type: PacketType): Promise<ThoughtPacket[]> {
  const result = await db.prepare('SELECT * FROM packets WHERE type = ? ORDER BY strength DESC').bind(type).all<Record<string, any>>();
  return result.results.map(rowToPacket);
}

export async function getPacketCount(db: D1Database): Promise<number> {
  const result = await db.prepare('SELECT COUNT(*) as count FROM packets').first<{count: number}>();
  return result?.count || 0;
}

function rowToPacket(row: Record<string, any>): ThoughtPacket {
  return {
    id: row.id,
    content: row.content,
    type: row.type as PacketType,
    strength: row.strength,
    tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags || [],
    created_at: row.created_at,
    last_updated: row.last_updated,
    rewrite_count: row.rewrite_count,
    coherence_score: row.coherence_score
  };
}

// ---- Connection CRUD ----

export async function createConnection(
  db: D1Database, 
  sourceId: string, 
  targetId: string, 
  relationship: string = 'related',
  strength: number = 0.5
): Promise<void> {
  // Ensure both packets exist
  const existing = await db.prepare(
    'SELECT id FROM connections WHERE source_id = ? AND target_id = ?'
  ).bind(sourceId, targetId).first();
  
  if (!existing) {
    await db.prepare(
      'INSERT INTO connections (source_id, target_id, relationship, strength) VALUES (?, ?, ?, ?)'
    ).bind(sourceId, targetId, relationship, strength).run();
  }
}

export async function getConnectionsForPacket(db: D1Database, packetId: string): Promise<PacketConnection[]> {
  const result = await db.prepare(
    'SELECT * FROM connections WHERE source_id = ? OR target_id = ? ORDER BY strength DESC'
  ).bind(packetId, packetId).all<Record<string, any>>();
  return result.results.map(row => ({
    id: row.id,
    source_id: row.source_id,
    target_id: row.target_id,
    relationship: row.relationship,
    strength: row.strength,
    created_at: row.created_at
  }));
}

export async function getAllConnections(db: D1Database): Promise<PacketConnection[]> {
  const result = await db.prepare('SELECT * FROM connections ORDER BY strength DESC').all<Record<string, any>>();
  return result.results.map(row => ({
    id: row.id,
    source_id: row.source_id,
    target_id: row.target_id,
    relationship: row.relationship,
    strength: row.strength,
    created_at: row.created_at
  }));
}

export async function getConnectionCount(db: D1Database): Promise<number> {
  const result = await db.prepare('SELECT COUNT(*) as count FROM connections').first<{count: number}>();
  return result?.count || 0;
}

// ---- Agent Log ----

export async function logAction(
  db: D1Database, 
  agent: AgentName, 
  action: string, 
  packetId?: string, 
  detail?: any
): Promise<void> {
  await db.prepare(
    'INSERT INTO agent_log (agent, action, packet_id, detail) VALUES (?, ?, ?, ?)'
  ).bind(agent, action, packetId || null, detail ? JSON.stringify(detail) : null).run();
}

export async function getRecentLogs(db: D1Database, limit: number = 100): Promise<AgentLogEntry[]> {
  const result = await db.prepare(
    'SELECT * FROM agent_log ORDER BY created_at DESC LIMIT ?'
  ).bind(limit).all<Record<string, any>>();
  return result.results.reverse().map(row => ({
    id: row.id,
    agent: row.agent as AgentName,
    action: row.action,
    packet_id: row.packet_id,
    detail: row.detail,
    created_at: row.created_at
  }));
}

// ---- System State ----

export async function getSystemState(db: D1Database): Promise<Record<string, string>> {
  const result = await db.prepare('SELECT * FROM system_state').all<{key: string, value: string}>();
  const state: Record<string, string> = {};
  for (const row of result.results) {
    state[row.key] = row.value;
  }
  return state;
}

export async function setSystemState(db: D1Database, key: string, value: string): Promise<void> {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  await db.prepare(
    'INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, ?)'
  ).bind(key, value, now).run();
}

export async function incrementState(db: D1Database, key: string): Promise<number> {
  const current = await db.prepare('SELECT value FROM system_state WHERE key = ?').bind(key).first<{value: string}>();
  const newVal = (parseInt(current?.value || '0') + 1).toString();
  await setSystemState(db, key, newVal);
  return parseInt(newVal);
}

export async function getFullState(db: D1Database): Promise<{
  packets: ThoughtPacket[];
  connections: PacketConnection[];
  recent_log: AgentLogEntry[];
  system_state: Record<string, string>;
}> {
  const [packets, connections, recent_log, system_state] = await Promise.all([
    getAllPackets(db),
    getAllConnections(db),
    getRecentLogs(db, 50),
    getSystemState(db)
  ]);
  return { packets, connections, recent_log, system_state };
}
