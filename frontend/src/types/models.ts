export interface StoryNode {
  id: string
  title: string
  content: string
  narrative_order: number
  timeline_order: number
  location_tag: string
  characters: string[]
}

export interface CharacterProfile {
  id: string
  name: string
  tags: string[]
  bio: string
}

export interface StoryProject {
  id: string
  title: string
  world_view: string
  style_tags: string[]
  nodes: StoryNode[]
  characters: CharacterProfile[]
  analysis_profile?: "auto" | "short" | "medium" | "long"
  created_at: string
  updated_at: string
}

export interface ProjectSummary {
  id: string
  title: string
  updated_at: string
}

export type ConflictType =
  | "timeline"
  | "character"
  | "relation"
  | "world_rule"

export interface Conflict {
  type: ConflictType
  severity: "error" | "warning" | "info"
  description: string
  node_ids: string[]
  entity_ids: string[]
  suggestion: string | null
}

export interface SyncResult {
  success: boolean
  vector_updated: boolean
  graph_updated: boolean
  new_entities: unknown[]
  new_relations: unknown[]
  removed_entities: string[]
  removed_relations: string[]
  warnings: string[]
}

export interface SyncNodeResponse {
  project: StoryProject
  sync_result: SyncResult
  conflicts: Conflict[]
  sync_status?: "pending" | "completed" | "failed"
}

export interface WorldDocument {
  id: string
  project_id: string
  title: string
  category: string
  content: string
  chunks: string[]
  created_at: string
  updated_at: string
}

export interface WorldKnowledgeBase {
  project_id: string
  documents: WorldDocument[]
  total_chunks: number
  total_characters: number
}

export interface KnowledgeGraph {
  project_id: string
  entities: unknown[]
  relations: unknown[]
  last_updated: string
}

export interface SearchResult {
  id: string
  content: string
  metadata: Record<string, unknown>
  score: number
}

export interface ProjectStatsResponse {
  total_nodes: number
  total_characters: number
  total_knowledge_docs: number
  total_words: number
  graph_entities: number
  graph_relations: number
}

export type SnapshotType = "auto" | "manual" | "milestone" | "pre_sync"

export interface IndexSnapshot {
  version: number
  snapshot_type: SnapshotType
  name: string | null
  description: string | null
  story_project: StoryProject
  knowledge_graph: KnowledgeGraph
  world_documents?: WorldDocument[]
  node_count: number
  entity_count: number
  created_at: string
}

export interface VersionDiff {
  nodes_added: string[]
  nodes_modified: string[]
  nodes_deleted: string[]
  entities_added: string[]
  entities_deleted: string[]
  relations_added: string[]
  relations_deleted: string[]
  words_added: number
  words_removed: number
}

export interface CreateOutlineRequest {
  world_view: string
  style_tags: string[]
  initial_prompt: string
  base_project_id?: string | null
  request_id?: string | null
}

export interface InsertNodeRequest {
  project_id: string
  node: StoryNode
  request_id?: string | null
}

export interface AnalysisMessage {
  role: "user" | "assistant"
  content: string
}

export interface AnalysisHistoryMessage {
  id: string
  role: "user" | "assistant"
  content: string
  created_at: string
}

export interface AnalysisHistoryResponse {
  messages: AnalysisHistoryMessage[]
}

export interface AnalysisHistoryRequest {
  project_id: string
  messages: AnalysisMessage[]
}

export interface ProjectExportData {
  project: StoryProject
  knowledge_graph: KnowledgeGraph
  world_documents: WorldDocument[]
  snapshots: IndexSnapshot[]
}

export interface ModelConfigResponse {
  base_url?: string | null
  drafting_model: string
  sync_model: string
  extraction_model: string
  has_default_key?: boolean
  has_drafting_key?: boolean
  has_sync_key?: boolean
  has_extraction_key?: boolean
}

export interface ModelConfigUpdateRequest {
  base_url?: string | null
  default_api_key?: string | null
  drafting_api_key?: string | null
  sync_api_key?: string | null
  extraction_api_key?: string | null
  drafting_model?: string | null
  sync_model?: string | null
  extraction_model?: string | null
}
