// DB operations for the Self-Editing Rule System
// Stores versioned JSON rules and agent proposals to improve them.

import { ThinkingRule, RuleProposal, RuleAdoption, AgentName } from './schema';

// ── Thinking Rules ──

export async function getActiveRules(db: D1Database): Promise<ThinkingRule[]> {
  const result = await db.prepare(
    `SELECT * FROM thinking_rules WHERE is_active = 1 ORDER BY name`
  ).all();
  return (result.results || []) as unknown as ThinkingRule[];
}

export async function getActiveRule(db: D1Database, name: string): Promise<ThinkingRule | null> {
  const result = await db.prepare(
    `SELECT * FROM thinking_rules WHERE name = ? AND is_active = 1 LIMIT 1`
  ).bind(name).first();
  return result as unknown as ThinkingRule | null;
}

export async function getRuleVersion(db: D1Database, name: string, version: number): Promise<ThinkingRule | null> {
  const result = await db.prepare(
    `SELECT * FROM thinking_rules WHERE name = ? AND version = ? LIMIT 1`
  ).bind(name, version).first();
  return result as unknown as ThinkingRule | null;
}

export async function getAllVersions(db: D1Database, name: string): Promise<ThinkingRule[]> {
  const result = await db.prepare(
    `SELECT * FROM thinking_rules WHERE name = ? ORDER BY version DESC`
  ).bind(name).all();
  return (result.results || []) as unknown as ThinkingRule[];
}

export async function deactivateRule(db: D1Database, name: string): Promise<void> {
  await db.prepare(
    `UPDATE thinking_rules SET is_active = 0 WHERE name = ? AND is_active = 1`
  ).bind(name).run();
}

export async function insertRule(
  db: D1Database,
  name: string,
  version: number,
  content: string,
  description: string
): Promise<void> {
  await db.prepare(
    `INSERT INTO thinking_rules (version, name, content, description, is_active)
     VALUES (?, ?, ?, ?, 1)`
  ).bind(version, name, content, description).run();
}

// Update rule in place (increment version, update content and description)
// Use this instead of deactivate+insert to avoid UNIQUE constraint on name
export async function updateRuleContent(
  db: D1Database,
  name: string,
  newVersion: number,
  content: string,
  description: string
): Promise<void> {
  await db.prepare(
    `UPDATE thinking_rules SET version = ?, content = ?, description = ? WHERE name = ? AND is_active = 1`
  ).bind(newVersion, content, description, name).run();
}

// ── Rule Proposals ──

export async function createProposal(
  db: D1Database,
  agent: AgentName,
  ruleName: string,
  proposedContent: string,
  reason: string,
  coherenceBefore: number | null,
  sourceTurnId: number | null
): Promise<RuleProposal> {
  const result = await db.prepare(
    `INSERT INTO rule_proposals (agent, rule_name, proposed_content, reason, coherence_before, source_turn_id)
     VALUES (?, ?, ?, ?, ?, ?)
     RETURNING *`
  ).bind(agent, ruleName, proposedContent, reason, coherenceBefore, sourceTurnId).first();
  return result as unknown as RuleProposal;
}

export async function getPendingProposals(db: D1Database): Promise<RuleProposal[]> {
  const result = await db.prepare(
    `SELECT * FROM rule_proposals WHERE status = 'pending' ORDER BY created_at DESC`
  ).all();
  return (result.results || []) as unknown as RuleProposal[];
}

export async function getRecentProposals(db: D1Database, limit: number = 10): Promise<RuleProposal[]> {
  const result = await db.prepare(
    `SELECT * FROM rule_proposals ORDER BY created_at DESC LIMIT ?`
  ).bind(limit).all();
  return (result.results || []) as unknown as RuleProposal[];
}

export async function updateProposalStatus(
  db: D1Database,
  id: number,
  status: 'pending' | 'evaluating' | 'adopted' | 'rejected',
  coherenceAfter?: number | null
): Promise<void> {
  if (status === 'adopted' || status === 'rejected') {
    await db.prepare(
      `UPDATE rule_proposals SET status = ?, coherence_after = ?, evaluated_at = datetime('now') WHERE id = ?`
    ).bind(status, coherenceAfter ?? null, id).run();
  } else {
    await db.prepare(
      `UPDATE rule_proposals SET status = ? WHERE id = ?`
    ).bind(status, id).run();
  }
}

// ── Rule Adoptions ──

export async function recordAdoption(
  db: D1Database,
  ruleName: string,
  fromVersion: number,
  toVersion: number,
  content: string,
  coherenceBefore: number | null,
  coherenceAfter: number | null,
  proposalId: number | null
): Promise<void> {
  await db.prepare(
    `INSERT INTO rule_adoptions (rule_name, from_version, to_version, content, coherence_before, coherence_after, proposal_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(ruleName, fromVersion, toVersion, content, coherenceBefore, coherenceAfter, proposalId).run();
}

export async function getRecentAdoptions(db: D1Database, limit: number = 10): Promise<RuleAdoption[]> {
  const result = await db.prepare(
    `SELECT * FROM rule_adoptions ORDER BY adopted_at DESC LIMIT ?`
  ).bind(limit).all();
  return (result.results || []) as unknown as RuleAdoption[];
}
