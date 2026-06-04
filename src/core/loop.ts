// The Learning Loop — orchestrates Kevin and Jenny to process new input
// When new experience arrives:
//   1. Both agents retrieve relevant packets
//   2. They propose rewrites and new packets
//   3. Coherence function scores proposals
//   4. High-coherence proposals are applied
//   5. Results are logged and visible

import { ThoughtPacket, PacketConnection, AgentResponse, RewriteProposal, NewPacketProposal } from '../db/schema';
import * as packetOps from '../db/packet';
import { kevinProcess } from './kevin';
import { jennyProcess } from './jenny';
import { calculateCoherence, estimateCoherenceGain, calculateGlobalCoherence } from './coherence';

export interface ProcessingResult {
  input: string;
  kevin_response: AgentResponse;
  jenny_response: AgentResponse;
  applied_rewrites: number;
  new_packets_added: number;
  new_connections_added: number;
  coherence_before: number;
  coherence_after: number;
}

/**
 * Main processing loop for a new input/experience
 */
export async function processInput(db: D1Database, input: string): Promise<ProcessingResult> {
  // Step 0: Get current state
  const [allPackets, allConnections, totalInteractionsRaw] = await Promise.all([
    packetOps.getAllPackets(db),
    packetOps.getAllConnections(db),
    packetOps.getSystemState(db).then(s => parseInt(s.total_interactions || '0'))
  ]);
  
  const coherenceBefore = await calculateGlobalCoherence(
    db,
    () => packetOps.getAllPackets(db),
    () => packetOps.getAllConnections(db)
  );
  
  // Step 1: Both agents process the input
  const recentPackets = allPackets.slice().sort(
    (a, b) => new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime()
  ).slice(0, 30);
  
  const [kevinResponse, jennyResponse] = await Promise.all([
    kevinProcess(input, recentPackets, allConnections, allPackets.length),
    jennyProcess(input, allPackets, allConnections, allPackets.length)
  ]);
  
  // Step 2: Log agent thoughts
  await packetOps.logAction(db, 'kevin', 'analyze', undefined, { thoughts: kevinResponse.thoughts, input: input.slice(0, 100) });
  await packetOps.logAction(db, 'jenny', 'analyze', undefined, { thoughts: jennyResponse.thoughts, input: input.slice(0, 100) });
  
  // Step 3: Score and apply rewrites
  let appliedRewrites = 0;
  
  for (const proposal of [...kevinResponse.rewrites, ...jennyResponse.rewrites]) {
    // Look up current packet
    const packet = allPackets.find(p => p.id === proposal.packet_id);
    if (!packet) continue;
    
    // Estimate coherence gain
    const gain = estimateCoherenceGain(packet, proposal.new_content, allConnections, allPackets, allPackets.length);
    
    if (gain > 0.05) {
      // Apply rewrite
      await packetOps.updatePacket(db, proposal.packet_id, {
        content: proposal.new_content,
        type: proposal.type || packet.type,
        rewrite_count: packet.rewrite_count + 1,
        strength: Math.min(1, packet.strength + 0.05)
      });
      
      await packetOps.logAction(db, proposal.packet_id.startsWith('jenny_idea') ? 'jenny' : 'kevin', 'rewrite', proposal.packet_id, {
        reason: proposal.reason,
        gain_estimate: gain
      });
      
      appliedRewrites++;
    }
  }
  
  // Step 4: Score and create new packets
  let newPacketsAdded = 0;
  
  for (const proposal of [...kevinResponse.new_packets, ...jennyResponse.new_packets]) {
    const agent = proposal.reason.includes('Kevin') || proposal.content === input ? 'kevin' : 'jenny';
    
    // Create the packet
    const packetId = packetOps.generateId();
    const newPacket = await packetOps.createPacket(db, {
      id: packetId,
      content: proposal.content,
      type: proposal.type,
      strength: 0.3,
      tags: proposal.tags,
      primary_category: proposal.primary_category || null,
      secondary_categories: proposal.secondary_categories || [],
      rewrite_count: 0,
      coherence_score: 0.1
    });
    
    await packetOps.logAction(db, agent as any, 'create_packet', packetId, {
      type: proposal.type,
      tags: proposal.tags,
      reason: proposal.reason
    });
    
    // Create connections
    for (const connId of proposal.connections) {
      await packetOps.createConnection(db, packetId, connId, 'related', 0.5);
    }
    
    newPacketsAdded++;
  }
  
  // Step 5: Recalculate coherence for all affected packets
  const updatedPackets = await packetOps.getAllPackets(db);
  
  for (const packet of updatedPackets) {
    const packetConnections = await packetOps.getConnectionsForPacket(db, packet.id);
    const connectedIds = new Set<string>();
    for (const c of packetConnections) {
      connectedIds.add(c.source_id === packet.id ? c.target_id : c.source_id);
    }
    const connectedPackets = updatedPackets.filter(p => connectedIds.has(p.id));
    
    const result = calculateCoherence({
      packet,
      connectedPackets,
      allConnections: await packetOps.getAllConnections(db),
      totalPacketCount: updatedPackets.length
    });
    
    await packetOps.updatePacket(db, packet.id, {
      coherence_score: result.overall
    });
  }
  
  // Step 6: Update system state
  const newCount = await packetOps.incrementState(db, 'total_interactions');
  const totalRewrites = await packetOps.incrementState(db, 'total_rewrites'); // rough count
  const conceptCount = (await packetOps.getPacketsByType(db, 'concept')).length;
  
  const coherenceAfter = await calculateGlobalCoherence(
    db,
    () => packetOps.getAllPackets(db),
    () => packetOps.getAllConnections(db)
  );
  
  await packetOps.setSystemState(db, 'avg_coherence', coherenceAfter.avg_coherence.toString());
  await packetOps.setSystemState(db, 'concept_count', conceptCount.toString());
  
  // Set born_at if first interaction
  const bornAt = await packetOps.getSystemState(db).then(s => s.born_at);
  if (!bornAt && newPacketsAdded > 0) {
    await packetOps.setSystemState(db, 'born_at', new Date().toISOString());
  }
  
  return {
    input,
    kevin_response: kevinResponse,
    jenny_response: jennyResponse,
    applied_rewrites: appliedRewrites,
    new_packets_added: newPacketsAdded,
    new_connections_added: 0, // tracked implicitly
    coherence_before: coherenceBefore.avg_coherence,
    coherence_after: coherenceAfter.avg_coherence
  };
}
