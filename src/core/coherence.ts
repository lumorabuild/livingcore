// Coherence Scoring — the heart of the learning mechanism
// Measures how well a packet fits with its neighbors in the connection graph
// Higher coherence = more integrated, stable understanding

import { ThoughtPacket, PacketConnection } from '../db/schema';

interface CoherenceInput {
  packet: ThoughtPacket;
  connectedPackets: ThoughtPacket[];
  allConnections: PacketConnection[]; // all connections in the graph
  totalPacketCount: number;
}

export interface CoherenceResult {
  overall: number;         // 0.0 - 1.0 total coherence score
  connection_density: number;
  semantic_consistency: number;
  temporal_stability: number;
  details: string[];
}

/**
 * Calculate coherence score for a single packet within the full graph
 * 
 * Three dimensions:
 * 1. Connection Density: How many connections relative to potential
 * 2. Semantic Consistency: How well tags/content align with neighbors
 * 3. Temporal Stability: How recently updated (recent = more relevant)
 */
export function calculateCoherence(input: CoherenceInput): CoherenceResult {
  const details: string[] = [];
  
  // ---- 1. Connection Density (0.0 - 1.0) ----
  // More connections = more integrated
  const packetConnections = input.allConnections.filter(
    c => c.source_id === input.packet.id || c.target_id === input.packet.id
  );
  
  // Max reasonable connections scales with total packets
  const maxExpected = Math.max(1, Math.log2(input.totalPacketCount + 1) * 3);
  const densityRaw = packetConnections.length / maxExpected;
  const connection_density = Math.min(1, densityRaw);
  
  if (packetConnections.length === 0) {
    details.push('No connections — isolated packet');
  } else if (packetConnections.length >= maxExpected) {
    details.push(`Well-connected: ${packetConnections.length} connections`);
  } else {
    details.push(`Moderately connected: ${packetConnections.length}/${Math.round(maxExpected)} optimal`);
  }
  
  // ---- 2. Semantic Consistency (0.0 - 1.0) ----
  // Packets with shared tags or similar strength levels are more coherent
  const connectedPackets = input.connectedPackets;
  
  let tagOverlap = 0;
  let strengthSimilarity = 0;
  
  if (connectedPackets.length > 0 && input.packet.tags.length > 0) {
    for (const neighbor of connectedPackets) {
      // Tag overlap
      if (neighbor.tags.length > 0) {
        const shared = input.packet.tags.filter(t => neighbor.tags.includes(t)).length;
        tagOverlap += shared / Math.max(1, input.packet.tags.length);
      }
      // Strength similarity (closer values = more consistent)
      strengthSimilarity += 1 - Math.abs(input.packet.strength - neighbor.strength);
    }
    tagOverlap /= connectedPackets.length;
    strengthSimilarity /= connectedPackets.length;
  } else {
    tagOverlap = 0.5; // neutral — no data
    strengthSimilarity = 0.5;
  }
  
  const semantic_consistency = (tagOverlap * 0.6 + strengthSimilarity * 0.4);
  
  if (tagOverlap > 0.3) {
    details.push(`Shares tags with ${Math.round(tagOverlap * 100)}% of neighbors`);
  } else if (tagOverlap < 0.1 && connectedPackets.length > 0) {
    details.push('Weak tag overlap with neighbors — possible mismatch');
  }
  
  // ---- 3. Temporal Stability (0.0 - 1.0) ----
  // Recently updated = actively maintained = more stable
  // More rewrites = more refined = more coherent
  const now = Date.now();
  const updated = new Date(input.packet.last_updated).getTime();
  const ageHours = (now - updated) / (1000 * 60 * 60);
  const temporalFreshness = Math.max(0, 1 - (ageHours / (24 * 7))); // decays over a week
  const rewriteBonus = Math.min(1, input.packet.rewrite_count / 20); // 20 rewrites = fully refined
  
  const temporal_stability = (temporalFreshness * 0.5 + rewriteBonus * 0.5);
  
  if (input.packet.rewrite_count > 5) {
    details.push(`Refined through ${input.packet.rewrite_count} rewrites`);
  }
  
  // ---- Overall ----
  const overall = Math.round(
    (connection_density * 0.4 + semantic_consistency * 0.35 + temporal_stability * 0.25) * 1000
  ) / 1000;
  
  return {
    overall,
    connection_density: Math.round(connection_density * 1000) / 1000,
    semantic_consistency: Math.round(semantic_consistency * 1000) / 1000,
    temporal_stability: Math.round(temporal_stability * 1000) / 1000,
    details
  };
}

/**
 * Calculate the global average coherence across all packets
 */
export async function calculateGlobalCoherence(
  db: D1Database,
  getAllPacketsFn: () => Promise<ThoughtPacket[]>,
  getAllConnectionsFn: () => Promise<PacketConnection[]>
): Promise<{ avg_coherence: number; total: number }> {
  const [packets, connections] = await Promise.all([
    getAllPacketsFn(),
    getAllConnectionsFn()
  ]);
  
  if (packets.length === 0) return { avg_coherence: 0, total: 0 };
  
  let totalCoherence = 0;
  
  for (const packet of packets) {
    const packetConnections = connections.filter(
      c => c.source_id === packet.id || c.target_id === packet.id
    );
    const connectedIds = new Set<string>();
    for (const c of packetConnections) {
      connectedIds.add(c.source_id === packet.id ? c.target_id : c.source_id);
    }
    const connectedPackets = packets.filter(p => connectedIds.has(p.id));
    
    const result = calculateCoherence({
      packet,
      connectedPackets,
      allConnections: connections,
      totalPacketCount: packets.length
    });
    
    totalCoherence += result.overall;
  }
  
  return {
    avg_coherence: Math.round((totalCoherence / packets.length) * 1000) / 1000,
    total: packets.length
  };
}

/**
 * Predict coherence gain from a proposed rewrite
 * Simpler: packs with low coherence have more room for improvement
 * Packets with high connection potential get a bonus
 */
export function estimateCoherenceGain(
  packet: ThoughtPacket,
  newContent: string,
  connections: PacketConnection[],
  allPackets: ThoughtPacket[],
  totalPacketCount: number
): number {
  // Low coherence = more room to improve
  const roomForImprovement = 1 - packet.coherence_score;
  
  // Content similarity boost — content that overlaps more with existing packets
  // is more likely to be coherent (since "understanding" means fitting in)
  const newWords = newContent.toLowerCase().split(/\s+/);
  let overlapScore = 0;
  
  if (allPackets.length > 0) {
    let totalSharedWords = 0;
    for (const other of allPackets) {
      if (other.id === packet.id) continue;
      const otherWords = other.content.toLowerCase().split(/\s+/);
      const shared = newWords.filter(w => w.length > 3 && otherWords.includes(w)).length;
      totalSharedWords += shared / Math.max(1, otherWords.length);
    }
    overlapScore = totalSharedWords / allPackets.length;
  }
  
  // Combine: room for improvement + overlap bonus
  const gain = roomForImprovement * 0.6 + Math.min(roomForImprovement, overlapScore) * 0.4;
  return Math.round(Math.min(0.5, gain) * 1000) / 1000; // cap at 0.5 per rewrite
}
