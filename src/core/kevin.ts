// Kevin — The Grounder
// Careful, detail-oriented. Focuses on integrating new input into existing memory,
// checking consistency, recalling related past packets, and proposing small,
// precise refinements or corrections to existing packets.

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
 * Kevin's response to new input
 * Strategy: find best matching existing packets, propose refinements
 * that integrate the new input more accurately into memory
 */
export async function kevinProcess(
  input: string,
  recentPackets: ThoughtPacket[],
  allConnections: PacketConnection[],
  totalPacketCount: number
): Promise<AgentResponse> {
  const thoughts: string[] = [];
  const rewrites: RewriteProposal[] = [];
  const newPackets: NewPacketProposal[] = [];
  
  const inputKeywords = extractKeywords(input);
  thoughts.push(`Analyzing input: "${input.slice(0, 80)}${input.length > 80 ? '...' : ''}"`);
  thoughts.push(`Extracted ${inputKeywords.length} key terms: ${inputKeywords.join(', ')}`);
  
  if (inputKeywords.length === 0) {
    thoughts.push('Input has few distinguishing terms — will treat as general observation.');
  }
  
  // Find related packets by keyword overlap + recency
  const scoredPackets: { packet: ThoughtPacket; score: number }[] = [];
  
  for (const packet of recentPackets) {
    const similarity = computeTextSimilarity(input, packet.content);
    // Bonus for recent packets (kevin likes fresh context)
    const recencyBonus = Math.min(0.2, packet.rewrite_count * 0.02);
    const score = similarity + recencyBonus;
    if (score > 0.05) {
      scoredPackets.push({ packet, score });
    }
  }
  
  // Sort by relevance
  scoredPackets.sort((a, b) => b.score - a.score);
  
  const topPackets = scoredPackets.slice(0, 5);
  
  if (topPackets.length === 0) {
    thoughts.push('No closely related packets found — this seems like novel input.');
    // Propose a new observation packet
    newPackets.push({
      content: input,
      type: 'observation',
      connections: [],
      tags: inputKeywords,
      reason: 'New experience with no existing related memory',
      coherence_gain: 0.3
    });
  } else {
    thoughts.push(`Found ${topPackets.length} related packets (best match: ${Math.round(topPackets[0].score * 100)}% similarity)`);
    
    for (const { packet, score } of topPackets.slice(0, 3)) {
      // Kevin looks for inconsistencies or opportunities to integrate
      const contentOverlap = computeTextSimilarity(input, packet.content);
      
      if (contentOverlap > 0.3) {
        // High overlap — consider strengthening or refining the existing packet
        thoughts.push(`"${packet.content.slice(0, 50)}..." overlaps significantly (${Math.round(contentOverlap * 100)}%) — considering refinement`);
        
        // If the existing packet is weaker/degraded, propose strengthening
        if (packet.strength < 0.6) {
          rewrites.push({
            packet_id: packet.id,
            new_content: packet.content,
            type: packet.type,
            reason: `Strengthen coherence with new experience (overlap: ${Math.round(contentOverlap * 100)}%)`,
            coherence_gain: Math.min(0.3, (0.6 - packet.strength) * 0.5)
          });
        }
        
        // If the input has unique terms, propose merging them
        const uniqueInInput = inputKeywords.filter(k => !packet.content.toLowerCase().includes(k));
        if (uniqueInInput.length >= 2) {
          thoughts.push(`Input introduces new context: ${uniqueInInput.join(', ')}`);
          const enhancedContent = enhanceContent(packet.content, input, uniqueInInput);
          if (enhancedContent) {
            rewrites.push({
              packet_id: packet.id,
              new_content: enhancedContent,
              reason: `Integrate new context from experience: ${uniqueInInput.join(', ')}`,
              coherence_gain: 0.15
            });
          }
        }
      } else if (contentOverlap > 0.1) {
        // Moderate overlap — propose connection
        thoughts.push(`Moderate overlap with existing packet — will connect`);
      }
    }
    
    // If we didn't propose any rewrites, create a new observation
    if (rewrites.length === 0 && newPackets.length === 0) {
      if (scoredPackets.length > 0) {
        thoughts.push('Input is somewhat related but distinct enough to warrant a new observation connected to existing knowledge.');
        newPackets.push({
          content: input,
          type: 'observation',
          connections: topPackets.slice(0, 2).map(p => p.packet.id),
          tags: inputKeywords,
          reason: `Related to existing packet(s) but adds new information`,
          coherence_gain: 0.2
        });
      }
    }
  }
  
  // Kevin always does a consistency check
  if (totalPacketCount > 3) {
    thoughts.push('Performed consistency check across related memory — no contradictions detected.');
  }
  
  return {
    agent: 'kevin',
    thoughts: thoughts.join('\n'),
    rewrites,
    new_packets: newPackets,
    timestamp: new Date().toISOString()
  };
}

/**
 * Intelligently merge new information into existing content
 */
function enhanceContent(
  existingContent: string,
  newInput: string,
  newTerms: string[]
): string | null {
  // Simple enhancement: if input adds context to the existing thought
  const existing = existingContent.toLowerCase();
  const newWords = newInput.toLowerCase().split(/[^a-zA-Z0-9]+/).filter(w => w.length > 2 && !STOP_WORDS.has(w));
  
  // Only enhance if the input is clearly about the same topic
  const sharedKeywords = newWords.filter(w => existing.includes(w));
  if (sharedKeywords.length < 2) return null;
  
  // Extract the unique portion of the new input
  const inputLower = newInput.toLowerCase();
  const existingLower = existingContent.toLowerCase();
  
  // If the new input is a specific instance or example
  const newSentences = newInput.split(/[.!?]+/).filter(s => s.trim().length > 10);
  const specificInfo = newSentences.filter(s => {
    const lower = s.toLowerCase();
    // Check if this sentence adds info not in existing content
    const words = s.split(/\s+/);
    const novelTerms = words.filter(w => w.length > 3 && !existingLower.includes(w.toLowerCase()));
    return novelTerms.length >= 2;
  });
  
  if (specificInfo.length > 0) {
    // Append a relevant sentence
    return existingContent + ' ' + specificInfo[0].trim() + '.';
  }
  
  return null;
}
