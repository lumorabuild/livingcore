// Self-Editing Rule Engine
// Kevin & Jenny read ThinkingRules.json before making decisions,
// and can propose improvements to those same rules.
// This is the core of Phase 0 — the meta-loop.

import * as rulesOps from '../db/rules';
import * as packetOps from '../db/packet';
import {
  AgentName,
  ThinkingRule,
  ThinkingRulesContent,
  CategoryDefinitionsContent,
  RuleProposal
} from '../db/schema';

// ── Load current rules ──

let cachedRules: ThinkingRulesContent | null = null;
let cachedCategories: CategoryDefinitionsContent | null = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 30000; // 30 seconds

export async function loadThinkingRules(db: D1Database): Promise<ThinkingRulesContent> {
  const now = Date.now();
  if (cachedRules && now - lastCacheTime < CACHE_TTL_MS) return cachedRules;

  const rule = await rulesOps.getActiveRule(db, 'thinking_rules');
  if (!rule) throw new Error('No active thinking_rules found');
  
  const parsed = JSON.parse(rule.content) as ThinkingRulesContent;
  cachedRules = parsed;
  lastCacheTime = now;
  return parsed;
}

export async function loadCategoryDefinitions(db: D1Database): Promise<CategoryDefinitionsContent> {
  const now = Date.now();
  if (cachedCategories && now - lastCacheTime < CACHE_TTL_MS) return cachedCategories;

  const rule = await rulesOps.getActiveRule(db, 'category_definitions');
  if (!rule) throw new Error('No active category_definitions found');

  const parsed = JSON.parse(rule.content) as CategoryDefinitionsContent;
  cachedCategories = parsed;
  lastCacheTime = now;
  return parsed;
}

// Invalidate cache (call after rule adoption)
export function invalidateCache(): void {
  cachedRules = null;
  cachedCategories = null;
  lastCacheTime = 0;
}

// ── Proposal Generation ──

interface RuleChangeProposal {
  shouldPropose: boolean;
  ruleName: string;
  proposedContent: string | null;
  reason: string | null;
}

/**
 * Kevin evaluates the current rules and proposes improvements.
 * Called during his dialogue turn when conditions are met.
 */
export async function kevinProposesRuleChange(
  db: D1Database,
  recentCoherence: number,
  recentTurnsCount: number,
  recentProposalsCount: number
): Promise<RuleChangeProposal> {
  const rules = await loadThinkingRules(db);
  const selfImp = rules.self_improvement;

  // Check proposal cooldown
  if (recentProposalsCount >= selfImp.max_proposals_per_session) {
    return { shouldPropose: false, ruleName: '', proposedContent: null, reason: null };
  }

  // Kevin only proposes when coherence is below threshold — he's the fixer
  if (recentCoherence < selfImp.coherence_threshold_for_adoption && recentTurnsCount > selfImp.proposal_cooldown_turns) {
    const newRules = JSON.parse(JSON.stringify(rules));
    const diff = selfImp.coherence_threshold_for_adoption - recentCoherence;
    
    // Adjust coherence weights based on deficit size
    const oldDensity = newRules.coherence_scoring.connection_density_weight;
    if (diff > 0.1) {
      // Big coherence gap — significantly increase connection density
      newRules.coherence_scoring.connection_density_weight = Math.min(0.6, oldDensity + 0.1);
      newRules.coherence_scoring.semantic_consistency_weight = Math.max(0.2, newRules.coherence_scoring.semantic_consistency_weight - 0.05);
      newRules.coherence_scoring.temporal_stability_weight = Math.max(0.15, newRules.coherence_scoring.temporal_stability_weight - 0.05);
      newRules.version = rules.version + 1;
      
      return {
        shouldPropose: true,
        ruleName: 'thinking_rules',
        proposedContent: JSON.stringify(newRules, null, 2),
        reason: `Coherence (${(recentCoherence * 100).toFixed(0)}%) is significantly below threshold (${(selfImp.coherence_threshold_for_adoption * 100).toFixed(0)}%). Proposing to increase connection_density_weight from ${oldDensity} to ${newRules.coherence_scoring.connection_density_weight} to encourage more packet connections.`
      };
    }

    if (diff > 0.04) {
      // Medium gap — small weight tweak
      newRules.coherence_scoring.connection_density_weight = Math.min(0.55, oldDensity + 0.05);
      newRules.coherence_scoring.temporal_stability_weight = Math.max(0.15, newRules.coherence_scoring.temporal_stability_weight - 0.03);
      newRules.version = rules.version + 1;

      return {
        shouldPropose: true,
        ruleName: 'thinking_rules',
        proposedContent: JSON.stringify(newRules, null, 2),
        reason: `Coherence (${(recentCoherence * 100).toFixed(0)}%) is below target. Proposing slight weight adjustment: connection_density from ${oldDensity} to ${newRules.coherence_scoring.connection_density_weight} to strengthen network formation.`
      };
    }

    // Small gap — suggest lowering adoption threshold
    if (recentTurnsCount > 10) {
      const oldThreshold = newRules.self_improvement.coherence_threshold_for_adoption;
      newRules.self_improvement.coherence_threshold_for_adoption = Math.max(0.40, oldThreshold - 0.03);
      newRules.version = rules.version + 1;

      return {
        shouldPropose: true,
        ruleName: 'thinking_rules',
        proposedContent: JSON.stringify(newRules, null, 2),
        reason: `Coherence (${(recentCoherence * 100).toFixed(0)}%) has been stable just below threshold (${(oldThreshold * 100).toFixed(0)}%) for ${recentTurnsCount}+ turns. Proposing to lower adoption threshold to ${(newRules.self_improvement.coherence_threshold_for_adoption * 100).toFixed(0)}% to allow rule improvements through.`
      };
    }
  }

  // No change needed
  return { shouldPropose: false, ruleName: '', proposedContent: null, reason: null };
}

/**
 * Jenny proposes rule changes from a creativity/exploration angle.
 * She's more likely to propose new categories or category changes.
 */
export async function jennyProposesRuleChange(
  db: D1Database,
  recentCoherence: number,
  recentTurnsCount: number,
  recentProposalsCount: number,
  uncategorizedCount: number
): Promise<RuleChangeProposal> {
  const rules = await loadThinkingRules(db);
  const selfImp = rules.self_improvement;

  if (recentProposalsCount >= selfImp.max_proposals_per_session) {
    return { shouldPropose: false, ruleName: '', proposedContent: null, reason: null };
  }

  // Jenny's specialty: propose category changes when there are many uncategorized packets
  if (uncategorizedCount > 3) {
    const categories = await loadCategoryDefinitions(db);
    // See if current categories cover the uncategorized packets
    // For now, propose a simple keyword expansion for the meta category
    const metaCat = categories.categories.find(c => c.id === 'meta');
    if (metaCat) {
      const newCategories = JSON.parse(JSON.stringify(categories));
      const cat = newCategories.categories.find((c: any) => c.id === 'meta');
      if (cat && !cat.keywords.includes('self-edit')) {
        cat.keywords.push('self-edit', 'rule', 'proposal', 'adoption', 'meta-cognition', 'introspection');
        newCategories.version = categories.version + 1;
        
        return {
          shouldPropose: true,
          ruleName: 'category_definitions',
          proposedContent: JSON.stringify(newCategories, null, 2),
          reason: `Noticed ${uncategorizedCount} packets without clear category matches. Proposed expanding 'meta' (System Self-Reflection) keywords to include self-editing related terms like 'self-edit', 'rule', 'proposal', 'adoption', 'meta-cognition', and 'introspection'.`
        };
      }
    }
  }

  // Jenny also looks for emerging patterns — if coherence is decent, propose something creative
  if (recentCoherence > 0.4 && recentTurnsCount > selfImp.proposal_cooldown_turns) {
    const categories = await loadCategoryDefinitions(db);
    const maxCatLen = Math.max(...categories.categories.map(c => c.keywords.length));
    
    if (maxCatLen < 25) {
      // Some categories have sparse keywords — propose expansion
      const sparseCats = categories.categories.filter(c => c.keywords.length < 10);
      if (sparseCats.length > 0) {
        const newCategories = JSON.parse(JSON.stringify(categories));
        for (const cat of sparseCats) {
          const nc = newCategories.categories.find((c: any) => c.id === cat.id);
          if (nc) {
            // Add general intellectual keywords
            const additions = ['think', 'reflect', 'knowledge', 'understanding', 'meaning', 'pattern', 'system', 'connection', 'idea', 'question'];
            for (const a of additions) {
              if (!nc.keywords.includes(a)) nc.keywords.push(a);
            }
          }
        }
        newCategories.version = categories.version + 1;

        return {
          shouldPropose: true,
          ruleName: 'category_definitions',
          proposedContent: JSON.stringify(newCategories, null, 2),
          reason: `Found ${sparseCats.length} categories with sparse keyword definitions (${sparseCats.map(c => c.id).join(', ')}). Proposed enriching them with common intellectual keywords to improve classification accuracy.`
        };
      }
    }
  }

  return { shouldPropose: false, ruleName: '', proposedContent: null, reason: null };
}

// ── Adoption Mechanism ──

/**
 * Evaluate a pending proposal by comparing coherence before vs after.
 * Phase 0: adopt immediately when coherence is below threshold and the
 * agent made a reasoned proposal. The "evaluation" happens after adoption
 * by measuring whether coherence improves over subsequent turns.
 */
export async function evaluateProposal(
  db: D1Database,
  proposal: RuleProposal,
  currentCoherence: number
): Promise<{ adopted: boolean; reason: string }> {
  const rules = await loadThinkingRules(db);
  const selfImp = rules.self_improvement;
  const coherenceBefore = proposal.coherence_before ?? currentCoherence;

  // Phase 0: Adopt immediately when coherence is below threshold
  // The agent already reasoned about why the change helps.
  // True evaluation happens over subsequent turns as new data comes in.
  if (coherenceBefore < selfImp.coherence_threshold_for_adoption) {
    const currentRule = await rulesOps.getActiveRule(db, proposal.rule_name);
    if (!currentRule) {
      await rulesOps.updateProposalStatus(db, proposal.id, 'rejected', currentCoherence);
      return { adopted: false, reason: `No active rule '${proposal.rule_name}' to replace` };
    }

    // Update rule in place instead of deactivate+insert
    const newVersion = currentRule.version + 1;
    const parsed = JSON.parse(proposal.proposed_content);
    parsed.version = newVersion;
    const cleanJSON = JSON.stringify(parsed, null, 2);

    await rulesOps.updateRuleContent(
      db,
      proposal.rule_name,
      newVersion,
      cleanJSON,
      `Adopted from proposal by ${proposal.agent} — ${proposal.reason.slice(0, 100)}...`
    );

    await rulesOps.recordAdoption(
      db,
      proposal.rule_name,
      currentRule.version,
      newVersion,
      cleanJSON,
      coherenceBefore,
      currentCoherence,
      proposal.id
    );

    await rulesOps.updateProposalStatus(db, proposal.id, 'adopted', currentCoherence);
    invalidateCache();

    return {
      adopted: true,
      reason: `✅ Adopted ${proposal.rule_name} v${currentRule.version}→v${newVersion} (coherence ${(coherenceBefore * 100).toFixed(0)}% → ${(currentCoherence * 100).toFixed(0)}%). Will measure improvement over subsequent turns.`
    };
  }

  // If coherence is already above threshold, only adopt if there's meaningful improvement
  const gain = currentCoherence - coherenceBefore;
  if (gain >= selfImp.min_improvement_for_adoption) {
    const currentRule = await rulesOps.getActiveRule(db, proposal.rule_name);
    if (!currentRule) {
      await rulesOps.updateProposalStatus(db, proposal.id, 'rejected', currentCoherence);
      return { adopted: false, reason: 'No active rule to replace' };
    }

    const newVersion = currentRule.version + 1;
    const parsed = JSON.parse(proposal.proposed_content);
    parsed.version = newVersion;
    const cleanJSON = JSON.stringify(parsed, null, 2);

    await rulesOps.updateRuleContent(
      db,
      proposal.rule_name,
      newVersion,
      cleanJSON,
      `Adopted from proposal by ${proposal.agent} — ${proposal.reason.slice(0, 100)}...`
    );

    await rulesOps.recordAdoption(
      db,
      proposal.rule_name,
      currentRule.version,
      newVersion,
      cleanJSON,
      coherenceBefore,
      currentCoherence,
      proposal.id
    );

    await rulesOps.updateProposalStatus(db, proposal.id, 'adopted', currentCoherence);
    invalidateCache();

    return {
      adopted: true,
      reason: `Adopted ${proposal.rule_name} v${currentRule.version}→v${newVersion}. Coherence improved ${(gain * 100).toFixed(1)}% (${(coherenceBefore * 100).toFixed(0)}% → ${(currentCoherence * 100).toFixed(0)}%).`
    };
  } else {
    // Not enough improvement — reject
    await rulesOps.updateProposalStatus(db, proposal.id, 'rejected', currentCoherence);
    return {
      adopted: false,
      reason: `Rejected ${proposal.rule_name} change by ${proposal.agent}. Coherence gain ${(gain * 100).toFixed(1)}% below threshold ${(selfImp.min_improvement_for_adoption * 100).toFixed(0)}%.`
    };
  }
}

/**
 * Called during dialogue turns — checks pending proposals and evaluates them.
 */
export async function checkPendingProposals(db: D1Database, currentCoherence: number): Promise<{ evaluated: number; adopted: number; reasons: string[] }> {
  const pending = await rulesOps.getPendingProposals(db);
  if (pending.length === 0) return { evaluated: 0, adopted: 0, reasons: [] };

  let adopted = 0;
  let evaluated = 0;
  const reasons: string[] = [];

  for (const proposal of pending) {
    await rulesOps.updateProposalStatus(db, proposal.id, 'evaluating');
    try {
      const result = await evaluateProposal(db, proposal, currentCoherence);
      evaluated++;
      if (result.adopted) adopted++;
      reasons.push(result.reason);
    } catch (err) {
      // Individual proposal evaluation failed — mark as rejected and continue
      await rulesOps.updateProposalStatus(db, proposal.id, 'rejected', currentCoherence);
      evaluated++;
      reasons.push(`Error evaluating proposal #${proposal.id}: ${err}`);
    }
  }

  return { evaluated, adopted, reasons };
}
