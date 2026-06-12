// Dialogue Engine — Kevin & Jenny's living conversation.
//
// Every turn is a real completion from the agent's own model (see ai_dialogue.ts).
// The old "symbolic voice" — hundreds of canned template sentences stitched together
// — is gone. When the brain can't produce a genuine reply, no turn is posted; the
// next cron cycle simply tries again. Honest silence over scripted noise.

import * as packetOps from '../db/packet';
import * as dialogueOps from '../db/dialogue';
import * as rulesDb from '../db/rules';
import * as mind from './mind';
import { speakAsAgent, trackUsage, AGENTS } from './ai_dialogue';
import { loadThinkingRules, kevinProposesRuleChange, jennyProposesRuleChange, checkPendingProposals } from './thinking_rules';

// Mechanism note used when a conversation starts with no external seed (no news,
// no visitor note). It tells them THAT a conversation starts — never what to say.
const FRESH_START_NOTE = '[A new conversation begins — open it however you like, about anything at all.]';

// ── Single turn ──

export async function generateDialogueTurn(
  db: D1Database,
  seedText: string,
  speaker: 'kevin' | 'jenny',
  turnGroup?: string,
  triggerSource: string = 'manual',
  apiKey?: string
): Promise<{
  turn: dialogueOps.DialogueTurn;
  nextSpeaker: 'kevin' | 'jenny';
  turnGroup: string;
} | null> {
  const turnGroupId = turnGroup || generateId();

  // The conversation so far (chronological). A fresh group simply has none.
  const history = (await dialogueOps.getDialogueTurns(db, { group: turnGroupId, limit: 16 })).reverse();
  const seedNote = history.length === 0 ? (seedText || FRESH_START_NOTE) : undefined;

  const result = await speakAsAgent(apiKey || '', db, speaker, {
    history,
    seedNote,
    source: triggerSource,
  });
  if (!result) return null;

  const turnSeqRaw = parseInt((await packetOps.getSystemState(db)).turn_sequence || '0');
  const nextTurnNumber = turnSeqRaw + 1;

  const turn = await dialogueOps.createDialogueTurn(db, {
    turn_number: nextTurnNumber,
    speaker,
    content: result.content,
    thoughts: result.thoughts,
    // Provenance for the open dataset: which memories were in context for this turn.
    related_packet_ids: JSON.stringify(result.memoryIds.map(id => `mem:${id}`)),
    trigger_source: triggerSource,
    turn_group: turnGroupId,
  });

  await packetOps.setSystemState(db, 'turn_sequence', String(nextTurnNumber));
  await packetOps.logAction(db, speaker, 'dialogue', undefined, {
    thoughts: result.thoughts,
    summary: result.content.slice(0, 120),
  });

  // ── Self-editing rule system (kept): agents may propose tuning their own rules ──
  try {
    const recentProposals = await rulesDb.getPendingProposals(db);
    const stateRaw = await packetOps.getSystemState(db);
    const currentCoherence = parseFloat(stateRaw.avg_coherence || '0.4');

    if (speaker === 'kevin') {
      const proposal = await kevinProposesRuleChange(db, currentCoherence, nextTurnNumber, recentProposals.length);
      if (proposal.shouldPropose && proposal.proposedContent && proposal.reason) {
        await rulesDb.createProposal(
          db, 'kevin', proposal.ruleName,
          proposal.proposedContent, proposal.reason,
          currentCoherence, turn.id
        );
        await packetOps.logAction(db, 'kevin', 'rule_proposal', undefined, {
          rule_name: proposal.ruleName,
          reason: proposal.reason.slice(0, 200),
        });
      }
    } else {
      const allPkts = await packetOps.getAllPackets(db);
      const uncategorizedCount = allPkts.filter(p => !p.primary_category).length;
      const proposal = await jennyProposesRuleChange(db, currentCoherence, nextTurnNumber, recentProposals.length, uncategorizedCount);
      if (proposal.shouldPropose && proposal.proposedContent && proposal.reason) {
        await rulesDb.createProposal(
          db, 'jenny', proposal.ruleName,
          proposal.proposedContent, proposal.reason,
          currentCoherence, turn.id
        );
        await packetOps.logAction(db, 'jenny', 'rule_proposal', undefined, {
          rule_name: proposal.ruleName,
          reason: proposal.reason.slice(0, 200),
        });
      }
    }
  } catch (err) {
    console.error('Rule proposal error:', err);
  }

  return {
    turn,
    nextSpeaker: speaker === 'kevin' ? 'jenny' : 'kevin',
    turnGroup: turnGroupId,
  };
}

// ── Chaining: alternate speakers for a few turns (cron/inbox driven) ──

export async function continueDialogueChain(
  db: D1Database,
  firstSpeaker: 'kevin' | 'jenny',
  turnGroup: string,
  maxTurns: number,
  apiKey?: string,
  triggerSource: string = 'inbox'
): Promise<number> {
  let currentSpeaker = firstSpeaker;
  let added = 0;

  for (let i = 0; i < maxTurns; i++) {
    try {
      const result = await generateDialogueTurn(db, '', currentSpeaker, turnGroup, triggerSource, apiKey);
      if (!result) break; // no genuine reply available — stop, never fill with noise
      currentSpeaker = result.nextSpeaker;
      added++;
    } catch (err) {
      await packetOps.logAction(db, 'system', 'chain_error', undefined, {
        error: String(err).slice(0, 200),
        turn: i,
        speaker: currentSpeaker,
      }).catch(() => {});
      break;
    }
  }

  if (added > 0) {
    await db.prepare(
      "UPDATE inbox SET status = 'discussed' WHERE turn_group = ? AND status = 'processing'"
    ).bind(turnGroup).run().catch(() => {});
  }

  // Evaluate pending rule proposals as coherence drifts.
  try {
    const stateRaw = await packetOps.getSystemState(db);
    const coherenceVal = parseFloat(stateRaw.avg_coherence || '0.4');
    const result = await checkPendingProposals(db, coherenceVal);
    if (result.adopted > 0) {
      await packetOps.logAction(db, 'system', 'rules_adopted', undefined, {
        count: result.adopted,
        reasons: result.reasons.join('; '),
      });
    }
  } catch (err) {
    console.error('Rule evaluation error:', err);
  }

  return added;
}

// ── Reflection: when a conversation winds down, both agents privately grow from it ──

export async function reflectOnGroup(db: D1Database, apiKey: string, group: string): Promise<void> {
  if (!apiKey || !group) return;

  // One reflection per group (single key — groups end one at a time via cron).
  const state = await packetOps.getSystemState(db);
  if (state.last_reflected_group === group) return;
  await packetOps.setSystemState(db, 'last_reflected_group', group);

  const turns = (await dialogueOps.getDialogueTurns(db, { group, limit: 40 })).reverse();
  if (turns.length < 6) return; // too thin to be worth keeping

  for (const agent of ['kevin', 'jenny'] as const) {
    const res = await mind.reflectOnConversation(db, apiKey, agent, AGENTS[agent].model, turns, group);
    if (res.tokens > 0) await trackUsage(db, res.tokens).catch(() => {});
    if (res.memoriesSaved > 0 || res.journalUpdated) {
      await packetOps.logAction(db, agent, 'reflect', undefined, {
        memories_saved: res.memoriesSaved,
        journal_updated: res.journalUpdated,
        conversation: group,
      }).catch(() => {});
    }
  }
}

export function generateId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 12; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}
