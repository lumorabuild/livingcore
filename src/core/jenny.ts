// Jenny — The Weaver
// More exploratory and connective. Looks across many packets, proposes new
// connections, suggests higher-level abstractions, rewrites packets to create
// better generalizations, and generates "what if" or hypothetical thoughts.

import { ThoughtPacket, PacketConnection, RewriteProposal, NewPacketProposal, AgentResponse, PacketType } from '../db/schema';
import { calculateCoherence } from './coherence';

const STOP_WORDS = new Set(['the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'and', 'or', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'shall', 'this', 'that', 'these', 'those', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'it', 'its', 'they', 'them', 'their', 'not', 'no', 'but', 'so', 'if', 'as', 'by', 'from', 'about', 'up', 'out', 'over', 'after', 'all', 'each', 'every', 'more', 'some', 'any', 'both', 'very', 'just', 'also', 'now']);

function extractKeywords(text: string): string[] {
  const words = text.toLowerCase().split(/[^a-zA-Z0-9]+/).filter(w => w.length > 2 && !STOP_WORDS.has(w));
  return [...new Set(words)];
}

function computeTextSimilarity(a: string, b: string): number {
  const wordsA = extractKeywords(a);
  const wordsB = extractKeywords(b);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;
  const intersection = wordsA.filter(w => wordsB.includes(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return intersection / union;
}

/**
 * Jenny's response to new input
 * Strategy: look for patterns across many packets, propose abstractions,
 * new connections, and higher-level concept formation
 */
export async function jennyProcess(
  input: string,
  allPackets: ThoughtPacket[],
  allConnections: PacketConnection[],
  totalPacketCount: number
): Promise<AgentResponse> {
  const thoughts: string[] = [];
  const rewrites: RewriteProposal[] = [];
  const newPackets: NewPacketProposal[] = [];
  
  const inputKeywords = extractKeywords(input);
  thoughts.push(`Exploring "${input.slice(0, 60)}${input.length > 60 ? '...' : ''}" across memory`);
  thoughts.push(`Looking for connections and higher-level patterns...`);
  
  // Jenny looks at ALL packets, not just the most relevant
  // She clusters by tag overlap
  const packetsByTag: Map<string, ThoughtPacket[]> = new Map();
  
  for (const packet of allPackets) {
    for (const tag of packet.tags) {
      if (!packetsByTag.has(tag)) packetsByTag.set(tag, []);
      packetsByTag.get(tag)!.push(packet);
    }
  }
  
  // Find clusters of packets that share multiple tags
  const clusters: { tag: string; packets: ThoughtPacket[]; size: number }[] = [];
  for (const [tag, packets] of packetsByTag) {
    if (packets.length >= 2) {
      clusters.push({ tag, packets, size: packets.length });
    }
  }
  clusters.sort((a, b) => b.size - a.size);
  
  if (clusters.length > 0) {
    thoughts.push(`Found ${clusters.length} tag clusters in memory (largest: "${clusters[0].tag}" with ${clusters[0].size} packets)`);
  }
  
  // --- Check for emerging concepts ---
  // If 3+ packets share multiple tags, they might form a concept
  const conceptCandidates: { tags: string[]; packets: ThoughtPacket[] }[] = [];
  
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      // Find packets that belong to BOTH clusters
      const common = clusters[i].packets.filter(p => 
        p.tags.includes(clusters[j].tag)
      );
      if (common.length >= 2) {
        conceptCandidates.push({
          tags: [clusters[i].tag, clusters[j].tag],
          packets: common
        });
      }
    }
  }
  
  // Jenny looks for patterns in the input relative to existing concepts
  const scoredPackets = allPackets.map(packet => ({
    packet,
    score: computeTextSimilarity(input, packet.content) + (inputKeywords.filter(k => packet.tags.includes(k)).length * 0.1)
  }));
  scoredPackets.sort((a, b) => b.score - a.score);
  
  const topPacket = scoredPackets[0];
  const significantMatch = topPacket && topPacket.score > 0.1;
  
  if (significantMatch) {
    thoughts.push(`Best match: "${topPacket.packet.content.slice(0, 50)}..." (${Math.round(topPacket.score * 100)}% similarity)`);
  }
  
  // Jenny's core: propose NEW connections between loosely-related packets
  // She finds packets that could be connected and proposes the link
  if (totalPacketCount >= 2) {
    const topK = scoredPackets.slice(0, 10);
    
    // Group by type to see variety
    const typeGroups: Record<string, number> = {};
    for (const p of allPackets) {
      typeGroups[p.type] = (typeGroups[p.type] || 0) + 1;
    }
    thoughts.push(`Memory composition: ${Object.entries(typeGroups).map(([t, n]) => `${n} ${t}s`).join(', ')}`);
    
    // Check if input suggests a new connection between existing packets
    for (let i = 0; i < Math.min(5, topK.length); i++) {
      for (let j = i + 1; j < Math.min(5, topK.length); j++) {
        if (topK[i].packet.id === topK[j].packet.id) continue;
        
        // Are they already connected?
        const alreadyConnected = allConnections.some(
          c => (c.source_id === topK[i].packet.id && c.target_id === topK[j].packet.id) ||
               (c.source_id === topK[j].packet.id && c.target_id === topK[i].packet.id)
        );
        
        if (!alreadyConnected) {
          // If both relate to the input, they should be connected
          if (topK[i].score > 0.1 && topK[j].score > 0.1) {
            thoughts.push(`Noticing connection potential between two ${topK[i].packet.type} packets both related to this input`);
            
            // Propose a hypothesis or rule that connects them
            newPackets.push({
              content: `${topK[i].packet.content.slice(0, 60)}... and ${topK[j].packet.content.slice(0, 60)}... are related: both provide context for "${input.slice(0, 50)}"`,
              type: 'hypothesis',
              connections: [topK[i].packet.id, topK[j].packet.id],
              tags: [...new Set([...topK[i].packet.tags, ...topK[j].packet.tags])].slice(0, 5),
              reason: 'Both packets relate to the new input — proposed connection to integrate understanding',
              coherence_gain: 0.2
            });
            break; // One connection proposal per turn is enough
          }
        }
      }
    }
  }
  
  // If we have concept clusters and significant packet overlap, propose a concept
  if (conceptCandidates.length > 0) {
    const bestCandidate = conceptCandidates[0];
    // Check if a concept packet already exists for this cluster
    const existingConcepts = allPackets.filter(p => p.type === 'concept');
    const alreadyCovered = existingConcepts.some(c => 
      bestCandidate.tags.some(t => c.tags.includes(t) || c.content.toLowerCase().includes(t))
    );
    
    if (!alreadyCovered && bestCandidate.packets.length >= 2) {
      const packetContents = bestCandidate.packets.map(p => p.content);
      thoughts.push(`Potential emerging concept around "${bestCandidate.tags.join(' + ')}" — ${bestCandidate.packets.length} related packets`);
      
      newPackets.push({
        content: `Concept: ${bestCandidate.tags.join(' + ')} — ${packetContents.slice(0, 2).map(s => s.slice(0, 40)).join('; ')}`,
        type: 'concept',
        connections: bestCandidate.packets.map(p => p.id),
        tags: bestCandidate.tags,
        reason: `${bestCandidate.packets.length} packets share tags "${bestCandidate.tags.join('", "')}" — forming higher-level abstraction`,
        coherence_gain: 0.35
      });
      
      thoughts.push(`Proposing new concept packet to unify these ${bestCandidate.packets.length} related memories`);
    }
  }
  
  // If Jenny found nothing significant, still make an observation
  if (newPackets.length === 0 && rewrites.length === 0) {
    if (totalPacketCount === 0) {
      thoughts.push('Empty mind — this input will be the first seed of memory.');
      newPackets.push({
        content: input,
        type: 'experience',
        connections: [],
        tags: inputKeywords,
        reason: 'First ever memory — the seed of consciousness',
        coherence_gain: 1.0
      });
    } else if (!significantMatch) {
      thoughts.push('Input seems unique — no strong overlap with any existing memory. Adding as new experience.');
      newPackets.push({
        content: input,
        type: 'experience',
        connections: [],
        tags: inputKeywords,
        reason: 'Novel experience with no strong existing connections',
        coherence_gain: 0.3
      });
    }
  }
  
  return {
    agent: 'jenny',
    thoughts: thoughts.join('\n'),
    rewrites,
    new_packets: newPackets,
    timestamp: new Date().toISOString()
  };
}
