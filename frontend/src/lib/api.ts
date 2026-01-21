import type { CharacterGraphResponse } from "@/src/types/character-graph"
import type {
  CreateOutlineRequest,
  AnalysisHistoryRequest,
  AnalysisHistoryResponse,
  InsertNodeRequest,
  ProjectExportData,
  ProjectSummary,
  ProjectStatsResponse,
  SearchResult,
  IndexSnapshot,
  VersionDiff,
  StoryNode,
  StoryProject,
  SyncNodeResponse,
  WorldDocument,
  WorldKnowledgeBase,
  ModelConfigResponse,
  ModelConfigUpdateRequest,
} from "@/src/types/models"
import type { CharacterGraphNode } from "@/src/types/character-graph"
import { useProjectStore } from "@/src/stores/project-store"

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
}

async function request<T>(
  path: string,
  options: RequestInit,
  config: { showLoading?: boolean } = {},
): Promise<T> {
  const { setLoading, setError } = useProjectStore.getState()
  const shouldSetLoading = config.showLoading !== false

  if (shouldSetLoading) {
    setLoading(true)
  }
  setError(null)

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
      ...options,
    })

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null)
      const detail = errorPayload?.detail ?? `Request failed with ${response.status}`
      throw new Error(detail)
    }

    return (await response.json()) as T
  } catch (error) {
    if (!isAbortError(error)) {
      const message = error instanceof Error ? error.message : "Unknown error"
      setError(message)
    }
    throw error
  } finally {
    if (shouldSetLoading) {
      setLoading(false)
    }
  }
}

export async function createOutline(
  payload: CreateOutlineRequest,
): Promise<StoryProject> {
  return request<StoryProject>("/api/create_outline", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export async function syncNode(
  projectId: string,
  node: StoryNode,
  requestId?: string,
  options: { signal?: AbortSignal } = {},
): Promise<SyncNodeResponse> {
  return request<SyncNodeResponse>(
    "/api/sync_node",
    {
      method: "POST",
      body: JSON.stringify({ project_id: projectId, node, request_id: requestId }),
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function insertNode(
  payload: InsertNodeRequest,
  options: { signal?: AbortSignal } = {},
): Promise<SyncNodeResponse> {
  return request<SyncNodeResponse>(
    "/api/insert_node",
    {
      method: "POST",
      body: JSON.stringify(payload),
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function getAnalysisHistory(
  projectId: string,
  options: { signal?: AbortSignal } = {},
): Promise<AnalysisHistoryResponse> {
  return request<AnalysisHistoryResponse>(
    `/api/analysis_history/${encodeURIComponent(projectId)}`,
    { method: "GET", signal: options.signal },
    { showLoading: false },
  )
}

export async function saveAnalysisHistory(
  payload: AnalysisHistoryRequest,
  options: { signal?: AbortSignal } = {},
): Promise<AnalysisHistoryResponse> {
  return request<AnalysisHistoryResponse>(
    "/api/analysis_history/save",
    {
      method: "POST",
      body: JSON.stringify(payload),
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function getCharacterGraph(
  projectId?: string,
  options: { signal?: AbortSignal } = {},
): Promise<CharacterGraphResponse> {
  const query = projectId ? `?project_id=${encodeURIComponent(projectId)}` : ""
  return request<CharacterGraphResponse>(
    `/api/character_graph${query}`,
    {
      method: "GET",
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function getProjects(
  options: { signal?: AbortSignal } = {},
): Promise<ProjectSummary[]> {
  return request<ProjectSummary[]>(
    "/api/projects",
    {
      method: "GET",
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function getProject(
  projectId: string,
  options: { signal?: AbortSignal } = {},
): Promise<StoryProject> {
  return request<StoryProject>(
    `/api/projects/${encodeURIComponent(projectId)}`,
    {
      method: "GET",
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function updateProjectTitle(
  projectId: string,
  payload: { title: string },
  options: { signal?: AbortSignal } = {},
): Promise<StoryProject> {
  return request<StoryProject>(
    `/api/projects/${encodeURIComponent(projectId)}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function updateProjectSettings(
  projectId: string,
  payload: { analysis_profile?: "auto" | "short" | "medium" | "long" },
  options: { signal?: AbortSignal } = {},
): Promise<StoryProject> {
  return request<StoryProject>(
    `/api/projects/${encodeURIComponent(projectId)}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function exportProject(
  projectId: string,
  options: { signal?: AbortSignal } = {},
): Promise<ProjectExportData> {
  return request<ProjectExportData>(
    `/api/projects/${encodeURIComponent(projectId)}/export`,
    {
      method: "GET",
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function importProject(
  payload: ProjectExportData,
  options: { signal?: AbortSignal } = {},
): Promise<StoryProject> {
  return request<StoryProject>(
    "/api/projects/import",
    {
      method: "POST",
      body: JSON.stringify(payload),
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function deleteProject(
  projectId: string,
  options: { signal?: AbortSignal } = {},
): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(
    `/api/projects/${encodeURIComponent(projectId)}`,
    {
      method: "DELETE",
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function getWorldKnowledgeBase(
  projectId: string,
  options: { signal?: AbortSignal } = {},
): Promise<WorldKnowledgeBase> {
  return request<WorldKnowledgeBase>(
    `/api/projects/${encodeURIComponent(projectId)}/knowledge`,
    {
      method: "GET",
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function getWorldDocument(
  projectId: string,
  docId: string,
  options: { signal?: AbortSignal } = {},
): Promise<WorldDocument> {
  return request<WorldDocument>(
    `/api/projects/${encodeURIComponent(projectId)}/knowledge/${encodeURIComponent(docId)}`,
    {
      method: "GET",
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function createWorldDocument(
  projectId: string,
  payload: { title: string; category: string; content: string },
  options: { signal?: AbortSignal } = {},
): Promise<WorldDocument> {
  return request<WorldDocument>(
    `/api/projects/${encodeURIComponent(projectId)}/knowledge`,
    {
      method: "POST",
      body: JSON.stringify(payload),
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function updateWorldDocument(
  projectId: string,
  docId: string,
  payload: { content: string },
  options: { signal?: AbortSignal } = {},
): Promise<WorldDocument> {
  return request<WorldDocument>(
    `/api/projects/${encodeURIComponent(projectId)}/knowledge/${encodeURIComponent(docId)}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function deleteWorldDocument(
  projectId: string,
  docId: string,
  options: { signal?: AbortSignal } = {},
): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(
    `/api/projects/${encodeURIComponent(projectId)}/knowledge/${encodeURIComponent(docId)}`,
    {
      method: "DELETE",
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function importWorldKnowledge(
  projectId: string,
  payload: { markdown_content: string },
  options: { signal?: AbortSignal } = {},
): Promise<WorldDocument[]> {
  return request<WorldDocument[]>(
    `/api/projects/${encodeURIComponent(projectId)}/knowledge/import`,
    {
      method: "POST",
      body: JSON.stringify(payload),
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function searchWorldKnowledge(
  projectId: string,
  payload: { query: string; categories?: string[]; top_k?: number },
  options: { signal?: AbortSignal } = {},
): Promise<SearchResult[]> {
  return request<SearchResult[]>(
    `/api/projects/${encodeURIComponent(projectId)}/knowledge/search`,
    {
      method: "POST",
      body: JSON.stringify(payload),
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function uploadWorldKnowledgeFile(
  projectId: string,
  file: File,
  options: { signal?: AbortSignal } = {},
): Promise<WorldDocument[]> {
  const formData = new FormData()
  formData.append("file", file)

  const { setLoading, setError } = useProjectStore.getState()
  setLoading(true)
  setError(null)
  try {
    const response = await fetch(
      `${BASE_URL}/api/projects/${encodeURIComponent(projectId)}/knowledge/upload`,
      {
        method: "POST",
        body: formData,
        signal: options.signal,
      }
    )
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null)
      const detail = errorPayload?.detail ?? `Request failed with ${response.status}`
      throw new Error(detail)
    }
    return (await response.json()) as WorldDocument[]
  } catch (error) {
    if (!isAbortError(error)) {
      const message = error instanceof Error ? error.message : "Unknown error"
      setError(message)
    }
    throw error
  } finally {
    setLoading(false)
  }
}

export async function getProjectStats(
  projectId: string,
  options: { signal?: AbortSignal } = {},
): Promise<ProjectStatsResponse> {
  return request<ProjectStatsResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/stats`,
    {
      method: "GET",
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function listVersions(
  projectId: string,
  options: { signal?: AbortSignal } = {},
): Promise<Array<{
  id: number
  project_id: string
  version: number
  snapshot_type: string
  name: string | null
  description: string | null
  node_count: number
  words_added?: number
  words_removed?: number
  created_at: string
  file_path: string
  is_compressed: boolean
}>> {
  return request(
    `/api/projects/${encodeURIComponent(projectId)}/versions`,
    {
      method: "GET",
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function getVersionSnapshot(
  projectId: string,
  version: number,
  options: { signal?: AbortSignal } = {},
): Promise<IndexSnapshot> {
  return request<IndexSnapshot>(
    `/api/projects/${encodeURIComponent(projectId)}/versions/${version}`,
    {
      method: "GET",
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function compareVersions(
  projectId: string,
  fromVersion: number,
  toVersion: number,
  options: { signal?: AbortSignal } = {},
): Promise<VersionDiff> {
  return request<VersionDiff>(
    `/api/projects/${encodeURIComponent(projectId)}/versions/${fromVersion}/diff/${toVersion}`,
    {
      method: "GET",
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function createVersion(
  projectId: string,
  payload: { name?: string | null; description?: string | null; type?: string },
  options: { signal?: AbortSignal } = {},
): Promise<IndexSnapshot> {
  return request<IndexSnapshot>(
    `/api/projects/${encodeURIComponent(projectId)}/versions`,
    {
      method: "POST",
      body: JSON.stringify(payload),
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function restoreVersion(
  projectId: string,
  version: number,
  options: { signal?: AbortSignal } = {},
): Promise<StoryProject> {
  return request<StoryProject>(
    `/api/projects/${encodeURIComponent(projectId)}/versions/${version}/restore`,
    {
      method: "POST",
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function deleteVersion(
  projectId: string,
  version: number,
  options: { signal?: AbortSignal } = {},
): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(
    `/api/projects/${encodeURIComponent(projectId)}/versions/${version}`,
    {
      method: "DELETE",
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function updateVersion(
  projectId: string,
  version: number,
  payload: {
    name?: string | null
    description?: string | null
    promote_to_milestone?: boolean
  },
  options: { signal?: AbortSignal } = {},
): Promise<IndexSnapshot> {
  return request<IndexSnapshot>(
    `/api/projects/${encodeURIComponent(projectId)}/versions/${version}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function updateGraphEntity(
  projectId: string,
  entityId: string,
  updates: Partial<CharacterGraphNode>,
  options: { signal?: AbortSignal } = {},
): Promise<CharacterGraphNode> {
  return request<CharacterGraphNode>(
    `/api/projects/${encodeURIComponent(projectId)}/graph/entities/${encodeURIComponent(entityId)}`,
    {
      method: "PUT",
      body: JSON.stringify(updates),
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function createGraphEntity(
  projectId: string,
  payload: Partial<CharacterGraphNode>,
  options: { signal?: AbortSignal } = {},
): Promise<CharacterGraphNode> {
  return request<CharacterGraphNode>(
    `/api/projects/${encodeURIComponent(projectId)}/graph/entities`,
    {
      method: "POST",
      body: JSON.stringify(payload),
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function deleteGraphEntity(
  projectId: string,
  entityId: string,
  options: { signal?: AbortSignal } = {},
): Promise<{ deleted_relations: number }> {
  return request<{ deleted_relations: number }>(
    `/api/projects/${encodeURIComponent(projectId)}/graph/entities/${encodeURIComponent(entityId)}`,
    {
      method: "DELETE",
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function mergeGraphEntities(
  projectId: string,
  fromId: string,
  intoId: string,
  options: { signal?: AbortSignal } = {},
): Promise<CharacterGraphNode> {
  return request<CharacterGraphNode>(
    `/api/projects/${encodeURIComponent(projectId)}/graph/entities/${encodeURIComponent(fromId)}/merge`,
    {
      method: "POST",
      body: JSON.stringify({ into_id: intoId }),
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function getModelConfig(
  options: { signal?: AbortSignal } = {},
): Promise<ModelConfigResponse> {
  return request<ModelConfigResponse>(
    "/api/models",
    {
      method: "GET",
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function updateModelConfig(
  payload: ModelConfigUpdateRequest,
  options: { signal?: AbortSignal } = {},
): Promise<ModelConfigResponse> {
  return request<ModelConfigResponse>(
    "/api/models",
    {
      method: "POST",
      body: JSON.stringify(payload),
      signal: options.signal,
    },
    { showLoading: false },
  )
}
