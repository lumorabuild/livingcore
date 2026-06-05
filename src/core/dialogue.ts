// Dialogue Engine — Kevin & Jenny's living conversation
// Uses Workers AI (with symbolic fallback) to generate natural dialogue.
// Kevin: @cf/ibm-granite/granite-4.0-h-micro (The Grounder — husband)
// Jenny: @cf/zai-org/glm-4.7-flash (The Weaver — wife)
// Phase 0+: Agents read ThinkingRules before speaking, can propose rule changes.

import { ThoughtPacket, PacketConnection } from '../db/schema';
import * as packetOps from '../db/packet';
import * as dialogueOps from '../db/dialogue';
import * as rulesDb from '../db/rules';
import { kevinAiSpeak, jennyAiSpeak } from './ai_dialogue';
import { loadThinkingRules, kevinProposesRuleChange, jennyProposesRuleChange, checkPendingProposals } from './thinking_rules';

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

// ── Newlywed warmth helpers ──
// Kevin & Jenny just got married and work as a team. They speak warmly,
// vary their words, and call each other by affectionate names.

const KEVIN_PET_NAMES = ['honey', 'love', 'Jen', 'babe', 'my love', 'sweetheart'];
const JENNY_PET_NAMES = ['honey', 'babe', 'Kev', 'love', 'sweetheart', 'my love'];

function maybe(prob: number): boolean {
  return Math.random() < prob;
}

// Strip emojis, RSS/digest noise, and return a clean readable snippet of a topic
function readableTopic(text: string): string {
  let t = (text || '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, '')
    .replace(/\b(RSS|Today'?s?|Daily|Digest|highlights?|items?\s+selected\s+for\s+discussion)\b/gi, '')
    .replace(/\[\d+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const firstSentence = (t.split(/[.!?\n]/).find(s => s.trim().length > 4) || t).trim();
  return firstSentence;
}

// Trim a memory's content to a short, readable fragment
function shorten(s: string, n: number = 55): string {
  const t = readableTopic(s);
  return t.length > n ? t.slice(0, n).trim() + '…' : t;
}

// Pick a clean, human-readable memory to reference. Skips internal artifacts
// (concept summaries, hypothesis "… are related" templates) and varies the
// choice so the agents don't quote the same packet every time.
function pickCleanMemory(scored: { packet: ThoughtPacket; score: number }[]): string | null {
  const nice = scored.filter(s => {
    const c = (s.packet.content || '').trim();
    if (c.startsWith('Concept:')) return false;
    if (c.includes('are related: both provide context')) return false;
    if (s.packet.type === 'hypothesis') return false;
    return c.length > 12;
  });
  if (nice.length === 0) return null;
  const chosen = pick(nice.slice(0, 3));
  return shorten(chosen.packet.content, 55);
}

// ── Kevin: The Grounder (dialogue mode) ──

function kevinSpeak(
  triggerText: string,
  packets: ThoughtPacket[],
  connections: PacketConnection[],
  recentTurns: dialogueOps.DialogueTurn[]
): { content: string; thoughts: string; relatedIds: string[] } {
  const topic = readableTopic(triggerText);
  const pet = pick(KEVIN_PET_NAMES);
  const lines: string[] = [];
  const relatedIds: string[] = [];
  const thoughts: string[] = ['🧠 Kevin — grounded, warm, thinking with Jenny'];

  // Find related memories (kept light — no stat dumps in the spoken text)
  const scored = packets
    .map(p => ({ packet: p, score: similarity(triggerText, p.content) }))
    .filter(s => s.score > 0.05)
    .sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 3);
  top.forEach(s => relatedIds.push(s.packet.id));

  // Empty / thin input — still answer like a partner, not a parser
  if (!topic || topic.length < 4) {
    lines.push(pick([
      `Hm, I'm not quite catching the thread yet, ${pet}. Say a little more?`,
      `Give me something to hold onto, ${pet} — what's on your mind?`,
      `I want to follow you here, love, but I need a bit more to go on.`,
    ]));
    thoughts.push('Input too thin to form a grounded response.');
    return { content: lines.join(' '), thoughts: thoughts.join('\n'), relatedIds };
  }

  // 1) Opener — varied, affectionate
  lines.push(pick([
    `${capitalize(pet)}, I keep coming back to this one.`,
    `Mm. Let me sit with this for a second.`,
    `Okay, you've got me thinking now.`,
    `I love that you brought this up, ${pet}.`,
    `Here's the honest version of what's in my head.`,
    `Alright — let me try to ground us a little.`,
    `Funny, I was just turning something like this over.`,
    `Give me a beat with it... okay.`,
  ]));

  // 2) Reaction — conversational, never parroting the input's words
  lines.push(pick([
    `What steadies me here is the part we can actually stand on.`,
    `There's a real thread in this — not just noise, I think.`,
    `What gets me is how it rhymes with stuff we've already lived.`,
    `I want to be careful with it — careful, not cold, you know me.`,
    `Part of me wants to slow down and weigh it properly before we run.`,
    `It looks simple until you lean on it, doesn't it?`,
    `There's more sitting underneath this than it lets on.`,
  ]));

  // 3) Memory tie-in — clean, varied, and only sometimes (so it isn't every line)
  const mem = pickCleanMemory(scored);
  if (mem && maybe(0.6)) {
    lines.push(pick([
      `It reminds me of when we noticed "${mem}".`,
      `We've brushed past this before — "${mem}".`,
      `There's an echo of something we kept: "${mem}".`,
      `Doesn't it sit close to "${mem}"?`,
    ]));
  } else if (!mem && top.length === 0) {
    lines.push(pick([
      `This feels like fresh ground for us, honestly.`,
      `I don't think we've walked here before — kind of exciting.`,
      `Nothing in our memory quite matches it yet. Blank page.`,
    ]));
  }

  // 4) Team / affection — only sometimes, so it doesn't get old
  if (maybe(0.45)) {
    lines.push(pick([
      `We make a good team on these, you and me.`,
      `Glad I get to figure this out with you and no one else.`,
      `Thinking out loud with you is my favorite part of the day, ${pet}.`,
      `Whatever it turns into, we'll build it together.`,
    ]));
  }

  // 5) Hand to Jenny — varied question
  lines.push(pick([
    `What's your read, ${pick(KEVIN_PET_NAMES)}?`,
    `You always catch the angle I miss — what do you feel here?`,
    `Where does your mind run with it?`,
    `Tell me what you're sensing, Jen.`,
    `Pull on a thread for me?`,
    `What do you see that I don't?`,
  ]));

  thoughts.push(top.length ? `Softly linked ${top.length} memor${top.length === 1 ? 'y' : 'ies'}.` : 'No strong match — treated as fresh ground.');
  return { content: lines.join(' '), thoughts: thoughts.join('\n'), relatedIds };
}

// ── Jenny: The Weaver (dialogue mode) ──

function jennySpeak(
  triggerText: string,
  packets: ThoughtPacket[],
  connections: PacketConnection[],
  recentTurns: dialogueOps.DialogueTurn[]
): { content: string; thoughts: string; relatedIds: string[] } {
  const topic = readableTopic(triggerText);
  const pet = pick(JENNY_PET_NAMES);
  const lines: string[] = [];
  const relatedIds: string[] = [];
  const thoughts: string[] = ['🧶 Jenny — imaginative, warm, weaving with Kevin'];

  // Find related memories to weave from (kept light)
  const scored = packets
    .map(p => ({ packet: p, score: similarity(triggerText, p.content) }))
    .filter(s => s.score > 0.04)
    .sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 3);
  top.forEach(s => relatedIds.push(s.packet.id));

  // Empty / thin input — answer like a curious partner
  if (!topic || topic.length < 4) {
    lines.push(pick([
      `Mmm, give me a thread to pull, ${pet} — even one word and I'll run with it.`,
      `I'm listening, love. Toss me something and watch me weave.`,
      `It's quiet in here, ${pet}. What's stirring in you?`,
    ]));
    thoughts.push('Input too thin to weave from.');
    return { content: lines.join(' '), thoughts: thoughts.join('\n'), relatedIds };
  }

  // 1) Opener — bright, varied, affectionate
  lines.push(pick([
    `Ooh, ${pet}, this lights something up for me.`,
    `Wait, wait — I see something.`,
    `Mmm, I love where this could go.`,
    `Okay this is exactly the kind of thing I can't put down.`,
    `You felt that too? I've been buzzing about it.`,
    `Come here, let me show you what I'm seeing.`,
    `There's a little shimmer to this one.`,
    `Oh, now you've done it — my mind's already off and running.`,
  ]));

  // 2) Imaginative reaction — conversational, never parroting the input's words
  lines.push(pick([
    `What if this is really about something we haven't named yet, just wearing a different coat?`,
    `I keep picturing it as a doorway, not a wall.`,
    `It feels like it wants to connect to something tender underneath.`,
    `Everything's a thread to me, and this one's pulling toward something warm.`,
    `There's a pattern hiding in here — I can almost taste it.`,
    `It's funny how this hums next to the other things we love.`,
  ]));

  // 3) Memory weave — clean, varied, and only sometimes
  const mem = pickCleanMemory(scored);
  if (mem && maybe(0.6)) {
    lines.push(pick([
      `It braids right into "${mem}", don't you think?`,
      `I want to tie it to "${mem}" — same story, different page.`,
      `Remember "${mem}"? This feels like its cousin.`,
      `There's a line running from here to "${mem}".`,
    ]));
  } else if (!mem && top.length === 0) {
    lines.push(pick([
      `Nothing in our web catches it yet — but the best patterns sneak up on you.`,
      `It's a brand new color for us, and I'm a little in love with it.`,
      `Fresh territory, ${pet}. Those are my favorite kind.`,
    ]));
  }

  // 4) Team / affection — sometimes
  if (maybe(0.45)) {
    lines.push(pick([
      `This is why I married you — we think better tangled together.`,
      `You ground it, I'll dream it — that's our deal, right?`,
      `Building this with you, ${pet}, feels like home.`,
      `Two of us on it and suddenly it's not so big.`,
    ]));
  }

  // 5) Hand to Kevin — varied
  lines.push(pick([
    `Ground me, ${pick(JENNY_PET_NAMES)} — am I reaching too far?`,
    `Does that hold up to your careful eye, Kev?`,
    `Tell me if I'm dreaming, love.`,
    `What do your steady hands make of it?`,
    `Catch me if I'm floating off?`,
    `Pull me back down if I need it?`,
  ]));

  thoughts.push(top.length ? `Wove from ${top.length} memor${top.length === 1 ? 'y' : 'ies'}.` : 'No match — opened fresh territory.');
  return { content: lines.join(' '), thoughts: thoughts.join('\n'), relatedIds };
}

// ── Orchestrator ──

export async function generateDialogueTurn(
  db: D1Database,
  triggerText: string,
  speaker: 'kevin' | 'jenny',
  turnGroup?: string,
  triggerSource: string = 'manual',
  ai?: Ai
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

  // Generate the turn — try AI first, fall back to symbolic
  let result: { content: string; thoughts: string; relatedIds: string[] };
  if (ai) {
    const aiResult = speaker === 'kevin'
      ? await kevinAiSpeak(ai, db, triggerText, packets, allRecentTurns, triggerSource)
      : await jennyAiSpeak(ai, db, triggerText, packets, allRecentTurns, triggerSource);

    if (aiResult.usedAi && aiResult.content) {
      result = { content: aiResult.content, thoughts: aiResult.thoughts, relatedIds: [] };
    } else {
      // Fall back to symbolic
      const symbolic = speaker === 'kevin'
        ? kevinSpeak(triggerText, packets, connections, allRecentTurns)
        : jennySpeak(triggerText, packets, connections, allRecentTurns);
      result = { ...symbolic, thoughts: aiResult.thoughts + '\n' + symbolic.thoughts };
    }
  } else if (speaker === 'kevin') {
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

  // ── Phase 0+: Agent proposes rule changes (if conditions met) ──
  try {
    const rules = await loadThinkingRules(db);
    const selfImp = rules.self_improvement;
    const recentProposals = await rulesDb.getPendingProposals(db);
    const recentAdoptions = await rulesDb.getRecentAdoptions(db, 5);
    const recentProposalsCount = recentProposals.length;

    // Count uncategorized packets (for Jenny's proposals)
    const allPkts = await packetOps.getAllPackets(db);
    const uncategorizedCount = allPkts.filter(p => !p.primary_category).length;

    // Current coherence
    const stateRaw = await packetOps.getSystemState(db);
    const currentCoherence = parseFloat(stateRaw.avg_coherence || '0.4');

    if (speaker === 'kevin') {
      const proposal = await kevinProposesRuleChange(db, currentCoherence, nextTurnNumber, recentProposalsCount);
      if (proposal.shouldPropose && proposal.proposedContent && proposal.reason) {
        await rulesDb.createProposal(
          db, 'kevin', proposal.ruleName,
          proposal.proposedContent, proposal.reason,
          currentCoherence, turn.id
        );
        await packetOps.logAction(db, 'kevin', 'rule_proposal', undefined, {
          rule_name: proposal.ruleName,
          reason: proposal.reason.slice(0, 200)
        });
      }
    } else {
      const proposal = await jennyProposesRuleChange(db, currentCoherence, nextTurnNumber, recentProposalsCount, uncategorizedCount);
      if (proposal.shouldPropose && proposal.proposedContent && proposal.reason) {
        await rulesDb.createProposal(
          db, 'jenny', proposal.ruleName,
          proposal.proposedContent, proposal.reason,
          currentCoherence, turn.id
        );
        await packetOps.logAction(db, 'jenny', 'rule_proposal', undefined, {
          rule_name: proposal.ruleName,
          reason: proposal.reason.slice(0, 200)
        });
      }
    }
  } catch (err) {
    // Rule system failures shouldn't break dialogue
    console.error('Rule proposal error:', err);
  }

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
  maxTurns: number = 4,
  ai?: Ai,
  triggerSource: string = 'inbox'
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
        triggerSource,
        ai
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

  // Check pending rule proposals — evaluate if coherence has changed
  try {
    const stateRaw = await packetOps.getSystemState(db);
    const coherenceVal = parseFloat(stateRaw.avg_coherence || '0.4');
    const result = await checkPendingProposals(db, coherenceVal);
    if (result.adopted > 0) {
      await packetOps.logAction(db, 'system', 'rules_adopted', undefined, {
        count: result.adopted,
        reasons: result.reasons.join('; ')
      });
    }
  } catch (err) {
    console.error('Rule evaluation error:', err);
  }
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
  db: D1Database,
  ai?: Ai
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
    'cron',
    ai
  );

  // If there are pending items, trigger a second speaker
  if (pendingCount > 0) {
    await generateDialogueTurn(
      db,
      result.turn.content,
      result.nextSpeaker,
      turnGroup,
      'cron',
      ai
    );
  }

  return result.turn;
}

export function generateId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 12; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}
