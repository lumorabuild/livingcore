// Dialogue Engine — Kevin & Jenny's living conversation
// Generates natural-sounding dialogue turns using the existing packet memory system.
// No LLM — pure symbolic generation from memory state.

import { ThoughtPacket, PacketConnection } from '../db/schema';
import * as packetOps from '../db/packet';
import * as dialogueOps from '../db/dialogue';

// ── Shared helpers ──

const STOP_WORDS = new Set([
  'the','a','an','in','on','at','to','for','of','with','and','or','is','are','was','were',
  'be','been','being','have','has','had','do','does','did','will','would','could','should',
  'may','might','can','shall','this','that','these','those','i','me','my','we','our','you',
  'your','it','its','they','them','their','not','no','but','so','if','as','by','from','about',
  'up','out','over','after','all','each','every','more','some','any','both','very','just',
  'also','now','then','than','too','only','own','same','such','here','there','when','where',
  'why','how','what','which','who','whom'
]);

function extractKeywords(text: string): string[] {
  return [...new Set(
    text.toLowerCase().split(/[^a-zA-Z0-9]+/).filter(w => w.length > 2 && !STOP_WORDS.has(w))
  )];
}

function similarity(a: string, b: string): number {
  const ka = extractKeywords(a);
  const kb = extractKeywords(b);
  if (ka.length === 0 || kb.length === 0) return 0;
  const intersection = ka.filter(w => kb.includes(w)).length;
  return intersection / new Set([...ka, ...kb]).size;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Kevin: The Grounder (dialogue mode) ──

function kevinSpeak(
  triggerText: string,
  packets: ThoughtPacket[],
  connections: PacketConnection[],
  recentTurns: dialogueOps.DialogueTurn[]
): { content: string; thoughts: string; relatedIds: string[] } {
  const keywords = extractKeywords(triggerText);
  const thoughts: string[] = ['🧠 Kevin is processing...'];

  // Find related packets
  const scored = packets
    .map(p => ({ packet: p, score: similarity(triggerText, p.content) }))
    .filter(s => s.score > 0.05)
    .sort((a, b) => b.score - a.score);
  const topPackets = scored.slice(0, 5);

  // Build response
  const lines: string[] = [];
  const relatedIds: string[] = [];

  if (keywords.length === 0) {
    lines.push("I'm trying to make sense of this, but I need something more concrete to work with. Could you add more detail?");
    thoughts.push('⚠ Input has few distinguishing keywords — cannot form strong connections');
    return { content: lines.join(' '), thoughts: thoughts.join('\n'), relatedIds };
  }

  // Kevin's opening — thoughtful, analytical
  if (topPackets.length === 0) {
    lines.push(`Interesting. I don't have any existing memories that relate to "${triggerText.slice(0, 60)}..." — this feels like something new.`);
    lines.push(`The key terms I noticed are: ${keywords.slice(0, 8).join(', ')}. These don't match anything in my current understanding.`);
    lines.push(`I'll create a new memory for this so we don't lose it. Jenny may see connections I'm missing.`);
    thoughts.push(`Extracted ${keywords.length} key terms: ${keywords.join(', ')}`);
    thoughts.push('No matching packets found — will create new observation');
  } else {
    const best = topPackets[0];
    relatedIds.push(best.packet.id);
    const matchPct = Math.round(best.score * 100);

    if (matchPct > 30) {
      lines.push(`This resonates strongly with something I already know. "${best.packet.content.slice(0, 80)}..." — the overlap is ${matchPct}%.`);
      lines.push(`It's consistent with what we've observed before. I'd say this reinforces an existing pattern rather than adding something entirely new.`);
      thoughts.push(`Best match: "${best.packet.content.slice(0, 60)}..." (${matchPct}% similarity)`);
    } else if (matchPct > 10) {
      lines.push(`There's a faint connection to an existing memory: "${best.packet.content.slice(0, 60)}..." — about ${matchPct}% overlap.`);
      lines.push(`Not a strong match, but the shared keywords (${keywords.slice(0, 5).join(', ')}) suggest a distant family resemblance.`);
      lines.push(`I'll note this as a loose connection and keep watching for stronger patterns.`);
      thoughts.push(`Weak match: "${best.packet.content.slice(0, 60)}..." (${matchPct}% similarity)`);
    } else {
      lines.push(`Hmm. I can see a whisper of connection to "${best.packet.content.slice(0, 50)}..." but it's barely there — just ${matchPct}% overlap.`);
      lines.push(`This might be something genuinely new, or it might be related in a way I can't see yet. Jenny's better at finding those hidden links.`);
      thoughts.push(`Marginal match: "${best.packet.content.slice(0, 60)}..." (${matchPct}% similarity)`);
    }

    // Check for contradictions
    if (topPackets.length >= 2) {
      const second = topPackets[1];
      if (Math.abs(best.score - second.score) < 0.05) {
        lines.push(`I notice that two different memories have almost equal relevance to this — "${best.packet.content.slice(0, 30)}..." and "${second.packet.content.slice(0, 30)}...". That ambiguity makes me cautious.`);
        thoughts.push('⚠ Ambiguous — two packets with near-equal relevance scores');
      }
    }

    // Add related packet IDs
    topPackets.slice(0, 3).forEach(p => {
      if (!relatedIds.includes(p.packet.id)) relatedIds.push(p.packet.id);
    });
  }

  // Kevin closes with a reflection
  lines.push(`That's my reading. Jenny, what do you see?`);
  thoughts.push(`Analysis complete. ${topPackets.length} related packets found.`);

  return {
    content: lines.join(' '),
    thoughts: thoughts.join('\n'),
    relatedIds
  };
}

// ── Jenny: The Weaver (dialogue mode) ──

function jennySpeak(
  triggerText: string,
  packets: ThoughtPacket[],
  connections: PacketConnection[],
  recentTurns: dialogueOps.DialogueTurn[]
): { content: string; thoughts: string; relatedIds: string[] } {
  const keywords = extractKeywords(triggerText);
  const thoughts: string[] = ['🧶 Jenny is weaving...'];

  // Cluster packets by tag overlap
  const tagClusters: Map<string, { packets: ThoughtPacket[]; connections: number }> = new Map();
  for (const p of packets) {
    for (const tag of p.tags) {
      if (!tagClusters.has(tag)) tagClusters.set(tag, { packets: [], connections: 0 });
      tagClusters.get(tag)!.packets.push(p);
    }
  }
  for (const conn of connections) {
    const src = packets.find(p => p.id === conn.source_id);
    const tgt = packets.find(p => p.id === conn.target_id);
    if (src && tgt) {
      for (const tag of [...src.tags, ...tgt.tags]) {
        const cluster = tagClusters.get(tag);
        if (cluster) cluster.connections++;
      }
    }
  }

  const clusters = [...tagClusters.entries()]
    .map(([tag, data]) => ({ tag, count: data.packets.length, connections: data.connections }))
    .sort((a, b) => b.count - a.count);

  const lines: string[] = [];
  const relatedIds: string[] = [];

  if (keywords.length === 0) {
    lines.push("I'm looking but I don't see much to weave with here. Kevin's right — we need something more. But even a single word can bloom if you let it...");
    thoughts.push('⚠ Minimal input — cannot form connections');
    return { content: lines.join(' '), thoughts: thoughts.join('\n'), relatedIds };
  }

  const relevantClusters = clusters.filter(c =>
    keywords.some(k => c.tag.includes(k) || k.includes(c.tag))
  ).slice(0, 5);

  if (relevantClusters.length > 0) {
    const biggest = relevantClusters[0];
    lines.push(`Oh, I see threads! The idea of "${biggest.tag}" connects ${biggest.count} memories with ${biggest.connections} links between them.`);
    thoughts.push(`Found cluster: "${biggest.tag}" — ${biggest.count} packets, ${biggest.connections} connections`);

    if (relevantClusters.length > 1) {
      const second = relevantClusters[1];
      lines.push(`And there's another cluster around "${second.tag}" (${second.count} memories). I wonder if these two clusters are actually talking about the same thing from different angles.`);
      thoughts.push(`Secondary cluster: "${second.tag}" — ${second.count} packets`);
    }

    // Nature-inspired connection proposals
    const typeCount = new Map<string, number>();
    const clusterPackets = biggest.tag
      ? packets.filter(p => p.tags.includes(biggest.tag))
      : packets.slice(0, 5);
    clusterPackets.forEach(p => {
      typeCount.set(p.type, (typeCount.get(p.type) || 0) + 1);
    });
    const typeSummary = [...typeCount.entries()]
      .map(([t, c]) => `${c} ${t}${c > 1 ? 's' : ''}`)
      .join(', ');

    if (clusterPackets.length >= 3) {
      lines.push(`Looking at these ${clusterPackets.length} memories together (${typeSummary}), I'm noticing a pattern.`);
      lines.push(`Kevin sees them as separate observations, but I think they might be whispering about something larger — a concept trying to emerge.`);
      lines.push(`My intuition says: there's an abstraction here waiting to be named.`);
      thoughts.push(`Memory composition in cluster: ${typeSummary}`);
    } else {
      lines.push(`There are only ${clusterPackets.length} memories in this cluster (${typeSummary}). It's fragile — but sometimes the most interesting ideas start small.`);
      lines.push(`I'll keep watching this space.`);
    }

    // Add references
    clusterPackets.slice(0, 3).forEach(p => {
      if (!relatedIds.includes(p.id)) relatedIds.push(p.id);
    });
  } else {
    lines.push(`Nothing obvious in my existing web. ${capitalize(keywords.slice(0, 3).join(', '))} — these feel like seeds of something that hasn't grown yet.`);
    lines.push(`That's exciting, actually. The best patterns are the ones you don't see coming.`);
    lines.push(`I'll remember this. When more arrives, I'll know where to connect it.`);
    thoughts.push('No tag clusters match — new territory');
  }

  // Check for cross-pollination opportunities
  const distinctTypes = new Set(packets.map(p => p.type));
  if (distinctTypes.size >= 3) {
    const types = [...distinctTypes];
    lines.push(`Also — and Kevin might think this is a stretch — but we have ${types.length} different types of memory now (${types.join(', ')}).`);
    lines.push(`When you have that many colors, you can paint something new. I'm going to think about what emerges when we combine them.`);
    thoughts.push(`Cross-pollination opportunity: ${types.length} memory types available`);
  }

  lines.push(`Kevin, what do you think? Am I seeing things that aren't there?`);

  return {
    content: lines.join(' '),
    thoughts: thoughts.join('\n'),
    relatedIds
  };
}

// ── Orchestrator ──

export async function generateDialogueTurn(
  db: D1Database,
  triggerText: string,
  speaker: 'kevin' | 'jenny',
  turnGroup?: string,
  triggerSource: string = 'manual'
): Promise<{
  turn: dialogueOps.DialogueTurn;
  nextSpeaker: 'kevin' | 'jenny';
  turnGroup: string;
}> {
  // Get current state
  const [packets, connections, lastTurn, turnSeqRaw] = await Promise.all([
    packetOps.getAllPackets(db),
    packetOps.getAllConnections(db),
    getLastDialogueTurn(db),
    packetOps.getSystemState(db).then(s => parseInt(s.turn_sequence || '0'))
  ]);

  const turnGroupId = turnGroup || generateId();
  const nextTurnNumber = turnSeqRaw + 1;
  const recentTurns = lastTurn ? [lastTurn] : [];

  // Get recent dialogue for context
  const recentDialogue = await dialogueOps.getDialogueTurns(db, { limit: 5 });
  const allRecentTurns = lastTurn
    ? [lastTurn, ...recentDialogue.filter(t => t.id !== lastTurn.id)]
    : recentDialogue;

  // Generate the turn
  let result: { content: string; thoughts: string; relatedIds: string[] };
  if (speaker === 'kevin') {
    result = kevinSpeak(triggerText, packets, connections, allRecentTurns);
  } else {
    result = jennySpeak(triggerText, packets, connections, allRecentTurns);
  }

  // Save the turn
  const turn = await dialogueOps.createDialogueTurn(db, {
    turn_number: nextTurnNumber,
    speaker,
    content: result.content,
    thoughts: result.thoughts,
    related_packet_ids: JSON.stringify(result.relatedIds),
    trigger_source: triggerSource,
    turn_group: turnGroupId
  });

  // Update turn sequence
  await packetOps.setSystemState(db, 'turn_sequence', String(nextTurnNumber));

  // Log it
  await packetOps.logAction(db, speaker, 'dialogue', undefined, {
    thoughts: result.thoughts,
    summary: result.content.slice(0, 120)
  });

  // Determine next speaker
  const nextSpeaker: 'kevin' | 'jenny' = speaker === 'kevin' ? 'jenny' : 'kevin';

  return { turn, nextSpeaker, turnGroup: turnGroupId };
}

// ── Background chaining (runs via ctx.waitUntil) ──

export async function continueDialogueChain(
  db: D1Database,
  initialContent: string,
  firstSpeaker: 'kevin' | 'jenny',
  turnGroup: string,
  maxTurns: number = 4
): Promise<void> {
  let currentSpeaker = firstSpeaker;
  let currentContent = initialContent;
  const startSpeaker = firstSpeaker;

  for (let i = 0; i < maxTurns; i++) {
    try {
      const result = await generateDialogueTurn(
        db,
        currentContent,
        currentSpeaker,
        turnGroup,
        'inbox'
      );

      // The next agent speaks about what the previous one said
      currentContent = result.turn.content;
      currentSpeaker = result.nextSpeaker;

      // Brief pause between turns (not needed — turns are sequential saves)
      // Small delay to make dialogue feel natural
      await new Promise(r => setTimeout(r, 50));
    } catch (err) {
      // Log failure and stop chain
      await packetOps.logAction(db, 'system', 'chain_error', undefined, {
        error: String(err),
        turn: i,
        speaker: currentSpeaker
      }).catch(() => {});
      break;
    }
  }

  // After chain completes, mark any pending inbox items
  await updateInboxStatusesAfterDialogue(db, turnGroup).catch(() => {});
}

async function updateInboxStatusesAfterDialogue(
  db: D1Database,
  turnGroup: string
): Promise<void> {
  // Find the inbox item that triggered this dialogue chain
  await db.prepare(
    "UPDATE inbox SET status = 'discussed' WHERE turn_group = ? AND status = 'processing'"
  ).bind(turnGroup).run();
}

async function getLastDialogueTurn(db: D1Database): Promise<dialogueOps.DialogueTurn | null> {
  return dialogueOps.getDialogueTurns(db, { limit: 1 }).then(r => r[0] || null);
}

// ── Cron-triggered thought (safety net) ──

export async function generateStandaloneThought(
  db: D1Database
): Promise<dialogueOps.DialogueTurn | null> {
  const [packets, pendingCount] = await Promise.all([
    packetOps.getAllPackets(db),
    dialogueOps.getPendingInboxCount(db)
  ]);

  if (packets.length < 3) return null;

  // Pick a random packet and reflect on it
  const target = pick(packets);
  const speaker: 'kevin' | 'jenny' = Math.random() > 0.5 ? 'kevin' : 'jenny';
  const turnGroup = generateId();

  const result = await generateDialogueTurn(
    db,
    target.content,
    speaker,
    turnGroup,
    'cron'
  );

  // If there are pending items, trigger a second speaker
  if (pendingCount > 0) {
    const secondResult = await generateDialogueTurn(
      db,
      result.turn.content,
      result.nextSpeaker,
      turnGroup,
      'cron'
    );
  }

  return result.turn;
}

function generateId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 12; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}
