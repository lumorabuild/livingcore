// REST API Routes for Living Core
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import * as packetOps from '../db/packet';
import * as coherenceFunc from '../core/coherence';
import { processInput } from '../core/loop';
import { getFullState } from '../db/packet';

// Bindings type
type Bindings = {
  DB: D1Database;
};

const api = new Hono<{ Bindings: Bindings }>();

// CORS for frontend
api.use('/*', cors());

// ---- State endpoints ----

// GET /api/state — full system state (for dashboard)
api.get('/state', async (c) => {
  const state = await getFullState(c.env.DB);
  return c.json({ success: true, data: state });
});

// GET /api/packets — all thought packets
api.get('/packets', async (c) => {
  const type = c.req.query('type');
  const search = c.req.query('search');
  
  let packets;
  if (type) {
    packets = await packetOps.getPacketsByType(c.env.DB, type as any);
  } else if (search) {
    packets = await packetOps.searchPackets(c.env.DB, search);
  } else {
    packets = await packetOps.getAllPackets(c.env.DB);
  }
  
  return c.json({ success: true, data: packets });
});

// GET /api/packets/:id — single packet with connections
api.get('/packets/:id', async (c) => {
  const id = c.req.param('id');
  const packet = await packetOps.getPacket(c.env.DB, id);
  if (!packet) return c.json({ success: false, error: 'Packet not found' }, 404);
  
  const connections = await packetOps.getConnectionsForPacket(c.env.DB, id);
  
  // Fetch connected packets
  const connectedIds = new Set<string>();
  for (const conn of connections) {
    connectedIds.add(conn.source_id === id ? conn.target_id : conn.source_id);
  }
  const connectedPackets: any[] = [];
  for (const cid of connectedIds) {
    const cp = await packetOps.getPacket(c.env.DB, cid);
    if (cp) connectedPackets.push(cp);
  }
  
  return c.json({ success: true, data: { packet, connections, connectedPackets } });
});

// ---- Agent interaction endpoints ----

// POST /api/input — submit new experience for processing
api.post('/input', async (c) => {
  const body = await c.req.json<{ content: string }>();
  
  if (!body.content || body.content.trim().length === 0) {
    return c.json({ success: false, error: 'Content is required' }, 400);
  }
  
  const result = await processInput(c.env.DB, body.content.trim());
  
  return c.json({ success: true, data: result });
});

// ---- Log and stats endpoints ----

// GET /api/log — recent agent activity
api.get('/log', async (c) => {
  const limit = parseInt(c.req.query('limit') || '50');
  const logs = await packetOps.getRecentLogs(c.env.DB, limit);
  return c.json({ success: true, data: logs });
});

// GET /api/stats — system vitals
api.get('/stats', async (c) => {
  const [packets, connections, logs, state] = await Promise.all([
    packetOps.getAllPackets(c.env.DB),
    packetOps.getAllConnections(c.env.DB),
    packetOps.getRecentLogs(c.env.DB, 1),
    packetOps.getSystemState(c.env.DB)
  ]);
  
  const coherence = await coherenceFunc.calculateGlobalCoherence(
    c.env.DB,
    () => packetOps.getAllPackets(c.env.DB),
    () => packetOps.getAllConnections(c.env.DB)
  );
  
  const conceptPackets = packets.filter(p => p.type === 'concept');
  const typeBreakdown: Record<string, number> = {};
  for (const p of packets) {
    typeBreakdown[p.type] = (typeBreakdown[p.type] || 0) + 1;
  }
  
  return c.json({
    success: true,
    data: {
      total_packets: packets.length,
      total_connections: connections.length,
      total_interactions: parseInt(state.total_interactions || '0'),
      total_rewrites: parseInt(state.total_rewrites || '0'),
      avg_coherence: coherence.avg_coherence,
      concept_count: conceptPackets.length,
      type_breakdown: typeBreakdown,
      born_at: state.born_at || null,
      last_active: logs.length > 0 ? logs[0].created_at : null
    }
  });
});

// POST /api/reset — reset the system (for development)
api.post('/reset', async (c) => {
  await c.env.DB.prepare('DELETE FROM agent_log').run();
  await c.env.DB.prepare('DELETE FROM connections').run();
  await c.env.DB.prepare('DELETE FROM packets').run();
  await c.env.DB.prepare("UPDATE system_state SET value = '0' WHERE key IN ('total_interactions', 'total_rewrites')").run();
  await c.env.DB.prepare("UPDATE system_state SET value = '0.0' WHERE key = 'avg_coherence'").run();
  await c.env.DB.prepare("UPDATE system_state SET value = '0' WHERE key = 'concept_count'").run();
  await c.env.DB.prepare("UPDATE system_state SET value = '' WHERE key = 'born_at'").run();
  
  return c.json({ success: true, message: 'System reset complete' });
});

export default api;
