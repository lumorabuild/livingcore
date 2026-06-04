// Types for the Living Core data model

export type PacketType = 'experience' | 'observation' | 'concept' | 'hypothesis' | 'rule';
export type AgentName = 'kevin' | 'jenny' | 'system';

export interface ThoughtPacket {
  id: string;
  content: string;
  type: PacketType;
  strength: number;
  tags: string[];
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

export interface RewriteProposal {
  packet_id: string;
  new_content: string;
  type?: PacketType;
  reason: string;
  coherence_gain: number; // estimated improvement
}

export interface NewPacketProposal {
  content: string;
  type: PacketType;
  connections: string[];
  tags: string[];
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

export interface FullState {
  packets: ThoughtPacket[];
  connections: PacketConnection[];
  recent_log: AgentLogEntry[];
  system_state: Record<string, string>;
}
