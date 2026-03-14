export type LinkingSourceType = 'task' | 'agent' | 'criteria' | 'learning' | 'memory' | 'code_context' | 'deliverable';
export type LinkType = 'depends_on' | 'motivated' | 'justifies' | 'resolved_by' | 'follow_up_for' | 'related_to' | 'evidence_for' | 'learned_from';
export type LearningType = 'decision' | 'observation' | 'pattern' | 'failure' | 'success' | 'caveat';
export type MemoryType = 'skill' | 'preference' | 'pattern' | 'context' | 'tool_usage' | 'codebase_knowledge';
export type ChangeType = 'created' | 'modified' | 'deleted' | 'referenced';
export type EvidenceType = 'test_result' | 'deliverable' | 'code_change' | 'activity' | 'manual_verification' | 'artifact';

export interface EntityLinking {
  id: string;
  workspace_id: string;
  source_type: LinkingSourceType;
  source_id: string;
  target_type: LinkingSourceType;
  target_id: string;
  link_type: LinkType;
  explanation: string | null;
  metadata: string | null;
  created_by: string | null;
  created_at: string;
}

export interface ProjectLearning {
  id: string;
  workspace_id: string;
  task_id: string | null;
  agent_id: string | null;
  session_id: string | null;
  learning_type: LearningType;
  title: string;
  summary: string;
  detail: string | null;
  confidence: number | null;
  tags: string | null;
  related_file_paths: string | null;
  related_task_ids: string | null;
  metadata: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface AgentMemory {
  id: string;
  agent_id: string;
  workspace_id: string | null;
  task_id: string | null;
  memory_type: MemoryType;
  title: string;
  content: string;
  relevance_tags: string | null;
  recall_count: number;
  last_accessed_at: string | null;
  expires_at: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskCodeContext {
  id: string;
  task_id: string;
  workspace_id: string;
  file_path: string;
  commit_sha: string | null;
  change_summary: string | null;
  change_type: ChangeType | null;
  language: string | null;
  symbols: string | null;
  diff_stats: string | null;
  metadata: string | null;
  created_at: string;
}

export interface AcceptanceEvidence {
  id: string;
  criteria_id: string;
  task_id: string;
  evidence_type: EvidenceType;
  evidence_ref_id: string | null;
  evidence_ref_type: string | null;
  summary: string;
  is_positive: number;
  verified_by: string | null;
  metadata: string | null;
  created_at: string;
}

export interface DiffStats {
  additions: number;
  deletions: number;
  hunks: number;
}

export interface LearningMetadata {
  alternatives?: string[];
  outcome?: string;
  evidence_ids?: string[];
  source_tool_run_id?: string;
  [key: string]: unknown;
}

export interface CreateLearningInput {
  workspace_id: string;
  task_id?: string;
  agent_id?: string;
  session_id?: string;
  learning_type: LearningType;
  title: string;
  summary: string;
  detail?: string;
  confidence?: number;
  tags?: string[];
  related_file_paths?: string[];
  related_task_ids?: string[];
  metadata?: LearningMetadata;
}

export interface CreateMemoryInput {
  agent_id: string;
  workspace_id?: string;
  task_id?: string;
  memory_type: MemoryType;
  title: string;
  content: string;
  relevance_tags?: string[];
  expires_at?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateCodeContextInput {
  task_id: string;
  workspace_id: string;
  file_path: string;
  commit_sha?: string;
  change_summary?: string;
  change_type?: ChangeType;
  language?: string;
  symbols?: string[];
  diff_stats?: DiffStats;
  metadata?: Record<string, unknown>;
}

export interface CreateEvidenceInput {
  criteria_id: string;
  task_id: string;
  evidence_type: EvidenceType;
  evidence_ref_id?: string;
  evidence_ref_type?: string;
  summary: string;
  is_positive?: boolean;
  verified_by?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateLinkingInput {
  workspace_id: string;
  source_type: LinkingSourceType;
  source_id: string;
  target_type: LinkingSourceType;
  target_id: string;
  link_type: LinkType;
  explanation?: string;
  metadata?: Record<string, unknown>;
  created_by?: string;
}

export interface CriteriaEvaluation {
  criteria_id: string;
  description: string;
  is_met: number;
  gate_type: string;
  artifact_key: string | null;
  evidence_count: number;
  positive_evidence: number;
  negative_evidence: number;
  computed_is_met: number;
}
