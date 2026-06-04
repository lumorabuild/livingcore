// Types for the Living Core data model — Phase 1: Categories + RSS

export type PacketType = 'experience' | 'observation' | 'concept' | 'hypothesis' | 'rule';
export type AgentName = 'kevin' | 'jenny' | 'system';

export interface ThoughtPacket {
  id: string;
  content: string;
  type: PacketType;
  strength: number;
  tags: string[];
  primary_category: string | null;     // NEW: category ID
  secondary_categories: string[];       // NEW: array of category IDs
  created_at: string;
  last_updated: string;
  rewrite_count: number;
  coherence_score: number;
}

export interface PacketConnection {
  id: number;
  source_id: string;
  target_id: string;
  relationship: string;
  strength: number;
  created_at: string;
}

export interface AgentLogEntry {
  id: number;
  agent: AgentName;
  action: string;
  packet_id: string | null;
  detail: string | null;
  created_at: string;
}

export interface SystemState {
  key: string;
  value: string;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  created_at: string;
}

export interface RssItem {
  id: number;
  feed_url: string;
  feed_title: string;
  title: string;
  link: string;
  summary: string | null;
  content: string | null;
  published_at: string | null;
  fetched_at: string;
  status: 'new' | 'considered' | 'discussed' | 'ignored';
  discussion_turn_ids: string;
  assigned_category: string | null;
  relevance_score: number;
}

export interface RewriteProposal {
  packet_id: string;
  new_content: string;
  type?: PacketType;
  reason: string;
  coherence_gain: number;
}

export interface NewPacketProposal {
  content: string;
  type: PacketType;
  connections: string[];
  tags: string[];
  primary_category?: string;
  secondary_categories?: string[];
  reason: string;
  coherence_gain: number;
}

export interface AgentResponse {
  agent: AgentName;
  thoughts: string;
  rewrites: RewriteProposal[];
  new_packets: NewPacketProposal[];
  timestamp: string;
}

// ── Self-Editing Rule System (Phase 0) ──

export interface ThinkingRule {
  id: number;
  version: number;
  name: string;           // e.g. 'thinking_rules', 'category_definitions'
  content: string;        // full JSON blob
  description: string;
  created_at: string;
  is_active: number;      // 0 or 1
}

export interface RuleProposal {
  id: number;
  agent: AgentName;
  rule_name: string;
  proposed_content: string;
  reason: string;
  coherence_before: number | null;
  coherence_after: number | null;
  status: 'pending' | 'evaluating' | 'adopted' | 'rejected';
  source_turn_id: number | null;
  created_at: string;
  evaluated_at: string | null;
}

export interface RuleAdoption {
  id: number;
  rule_name: string;
  from_version: number;
  to_version: number;
  proposal_id: number | null;
  content: string;
  coherence_before: number | null;
  coherence_after: number | null;
  adopted_at: string;
}

// ── JSON rule content types (for type-safe access to parsed JSON) ──

export interface ThinkingRulesContent {
  version: number;
  description: string;
  category_assignment: {
    rules: string[];
    max_secondary_categories: number;
  };
  coherence_scoring: {
    connection_density_weight: number;
    semantic_consistency_weight: number;
    temporal_stability_weight: number;
    min_connections_for_density: number;
    semantic_overlap_threshold: number;
    temporal_decay_days: number;
  };
  rewriting_strategy: {
    enabled: boolean;
    min_coherence_gain_to_rewrite: number;
    max_rewrites_per_packet: number;
    merge_threshold: number;
    split_threshold: number;
  };
  rss_selection: {
    max_items_per_batch: number;
    max_selected_per_batch: number;
    kevin_bias_weight: number;
    jenny_bias_weight: number;
    cluster_match_weight: number;
    content_diversity_weight: number;
    max_new_packets_from_rss: number;
  };
  dialogue_style: {
    kevin: {
      personality: string;
      max_turns_before_reflection: number;
      quotes_accuracy_threshold: number;
      tone: string;
    };
    jenny: {
      personality: string;
      max_connections_per_turn: number;
      pattern_mining_depth: number;
      tone: string;
    };
  };
  self_improvement: {
    min_turns_between_proposals: number;
    coherence_threshold_for_adoption: number;
    min_improvement_for_adoption: number;
    max_proposals_per_session: number;
    proposal_cooldown_turns: number;
  };
}

export interface CategoryDefinitionsContent {
  version: number;
  categories: Array<{
    id: string;
    name: string;
    icon: string;
    color: string;
    description: string;
    keywords: string[];
  }>;
}

// ── Updated FullState ──

export interface FullState {
  packets: ThoughtPacket[];
  connections: PacketConnection[];
  recent_log: AgentLogEntry[];
  system_state: Record<string, string>;
  categories?: Category[];
  rss_recent?: RssItem[];
  active_rules?: ThinkingRule[];
  pending_proposals?: RuleProposal[];
  recent_adoptions?: RuleAdoption[];
}
