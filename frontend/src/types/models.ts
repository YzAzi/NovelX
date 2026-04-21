export interface StoryNode {
  id: string
  title: string
  content: string
  narrative_order: number
  timeline_order: number
  location_tag: string
  characters: string[]
}

export interface StoryChapter {
  id: string
  title: string
  content: string
  order: number
  summary?: string
}

export interface CharacterProfile {
  id: string
  name: string
  tags: string[]
  bio: string
}

export interface WriterConfig {
  prompt?: string | null
  model?: string | null
  api_key?: string | null
  base_url?: string | null
  polish_instruction?: string | null
  expand_instruction?: string | null
  style_strength?: string | null
  style_preset?: string | null
}

export interface PromptOverrides {
  drafting?: string | null
  sync?: string | null
  extraction?: string | null
  analysis?: string | null
  outline_import?: string | null
}

export interface StoryProject {
  id: string
  title: string
  world_view: string
  style_tags: string[]
  nodes: StoryNode[]
  chapters: StoryChapter[]
  characters: CharacterProfile[]
  analysis_profile?: "auto" | "short" | "medium" | "long"
  prompt_overrides?: PromptOverrides
  writer_config?: WriterConfig
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

export interface GraphSyncResponse {
  sync_result: SyncResult
  sync_status?: "pending" | "completed" | "failed"
}

export interface StyleDocument {
  id: string
  project_id?: string | null
  library_id?: string | null
  owner_id?: string | null
  scope?: "project" | "library" | string
  title: string
  category: string
  content: string
  chunks: string[]
  source_characters?: number
  curated_characters?: number
  curated_segments?: number
  created_at: string
  updated_at: string
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

export interface StyleReferencePreview {
  id: string
  title: string
  document_id?: string | null
  focus?: string | null
  techniques: string[]
  content: string
  score: number
}

export interface StyleRetrievalPreviewResponse {
  preferred_focuses: string[]
  references: StyleReferencePreview[]
}

export interface StyleKnowledgeUploadResponse {
  document: StyleDocument
  total_batches: number
  successful_batches: number
  failed_batches: number
  warnings: string[]
}

export interface StyleKnowledgeImportResponse {
  documents: StyleDocument[]
  imported_count: number
  warnings: string[]
}

export interface StyleLibrary {
  id: string
  owner_id?: string | null
  name: string
  description: string
  created_at: string
  updated_at: string
}

export interface StyleLibraryBundle {
  library: StyleLibrary
  documents: StyleDocument[]
  total_chunks: number
  total_characters: number
}

export interface ProjectStatsResponse {
  total_nodes: number
  total_characters: number
  total_style_docs: number
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
  style_documents?: StyleDocument[]
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
  drafting_prompt?: string | null
  base_project_id?: string | null
  request_id?: string | null
}

export interface StoryDirectionRequest {
  user_input?: string | null
  world_view?: string | null
  style_tags?: string[]
  base_project_id?: string | null
}

export interface StoryDirectionOption {
  title: string
  logline: string
  world_view: string
  style_tags: string[]
  initial_prompt: string
}

export interface StoryDirectionResponse {
  directions: StoryDirectionOption[]
}

export type IdeaLabStage = "concept" | "protagonist" | "conflict" | "outline"

export interface IdeaLabStageOption {
  project_title: string
  hook: string
  premise: string
  protagonist: string
  conflict: string
  world_view: string
  style_tags: string[]
  initial_prompt: string
}

export interface IdeaLabStageRequest {
  stage: IdeaLabStage
  seed_input?: string | null
  world_view?: string | null
  style_tags?: string[]
  base_project_id?: string | null
  feedback?: string | null
  selected_option?: IdeaLabStageOption | null
}

export interface IdeaLabStageResponse {
  stage: IdeaLabStage
  stage_title: string
  stage_instruction: string
  is_final_stage: boolean
  options: IdeaLabStageOption[]
}

export type AsyncTaskKind = "story_directions" | "idea_lab_stage" | "create_outline" | "import_outline"
export type AsyncTaskStatus = "pending" | "running" | "succeeded" | "failed"

export interface AsyncTask<T = Record<string, unknown>> {
  id: string
  kind: AsyncTaskKind
  status: AsyncTaskStatus
  title?: string | null
  request_payload: Record<string, unknown>
  result_payload?: T | null
  error_message?: string | null
  progress_stage?: string | null
  progress_details: Record<string, unknown>
  created_at: string
  updated_at: string
  started_at?: string | null
  completed_at?: string | null
}

export interface AsyncTaskCreateResponse<T = Record<string, unknown>> {
  task: AsyncTask<T>
  channel_token: string
}

export interface AsyncTaskListResponse<T = Record<string, unknown>> {
  tasks: AsyncTask<T>[]
}

export interface CreateEmptyProjectRequest {
  title?: string | null
  world_view?: string | null
  style_tags?: string[]
  base_project_id?: string | null
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
  style_documents: StyleDocument[]
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

export interface AuthUser {
  id: string
  username: string
  created_at?: string | null
}

export interface AuthTokenResponse {
  access_token: string
  token_type: "bearer"
  user: AuthUser
}

export interface AuthOutlineChannelResponse {
  request_id: string
  channel_token: string
}

export interface AuthUpdateProfileRequest {
  username: string
}

export interface AuthChangePasswordRequest {
  current_password: string
  new_password: string
}

export interface WritingAssistantRequest {
  project_id: string
  text: string
  instruction: string
  stream?: boolean
  chapter_id?: string | null
  mode?: "transform" | "continue"
  style_document_ids?: string[]
}

export interface StyleKnowledgeBase {
  project_id: string
  documents: StyleDocument[]
  total_chunks: number
  total_characters: number
}
