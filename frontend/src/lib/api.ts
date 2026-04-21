import type { CharacterGraphResponse } from "@/src/types/character-graph"
import type {
  AsyncTask,
  AsyncTaskCreateResponse,
  AsyncTaskKind,
  AsyncTaskListResponse,
  CreateOutlineRequest,
  IdeaLabStageRequest,
  IdeaLabStageResponse,
  StoryDirectionRequest,
  StoryDirectionResponse,
  CreateEmptyProjectRequest,
  AnalysisHistoryRequest,
  AnalysisHistoryResponse,
  InsertNodeRequest,
  ProjectExportData,
  ProjectSummary,
  ProjectStatsResponse,
  IndexSnapshot,
  VersionDiff,
  StyleRetrievalPreviewResponse,
  StyleKnowledgeUploadResponse,
  StoryNode,
  StoryProject,
  PromptOverrides,
  GraphSyncResponse,
  SyncNodeResponse,
  ModelConfigResponse,
  ModelConfigUpdateRequest,
  AuthTokenResponse,
  AuthOutlineChannelResponse,
  AuthUpdateProfileRequest,
  AuthChangePasswordRequest,
  AuthUser,
  WriterConfig,
  StyleKnowledgeBase,
  StyleDocument,
  StyleKnowledgeImportResponse,
  StyleLibrary,
  StyleLibraryBundle,
} from "@/src/types/models"
import type { CharacterGraphNode, CharacterGraphLink } from "@/src/types/character-graph"
import { useProjectStore } from "@/src/stores/project-store"

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
const AUTH_TOKEN_KEY = "novel_auth_token"
export const AUTH_EXPIRED_EVENT = "novel-auth-expired"

export function buildApiUrl(path: string): string {
  return `${BASE_URL}${path}`
}

export function getAuthToken(): string | null {
  if (typeof window === "undefined") {
    return null
  }
  return window.localStorage.getItem(AUTH_TOKEN_KEY)
}

export function setAuthToken(token: string) {
  if (typeof window === "undefined") {
    return
  }
  window.localStorage.setItem(AUTH_TOKEN_KEY, token)
}

export function clearAuthToken() {
  if (typeof window === "undefined") {
    return
  }
  window.localStorage.removeItem(AUTH_TOKEN_KEY)
}

export function buildAuthHeaders(headers?: HeadersInit): Headers {
  const nextHeaders = new Headers(headers)
  const authToken = getAuthToken()
  if (authToken) {
    nextHeaders.set("Authorization", `Bearer ${authToken}`)
  }
  return nextHeaders
}

export function handleUnauthorized() {
  clearAuthToken()
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
  }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
}

export function formatUserErrorMessage(
  error: unknown,
  fallback = "操作失败，请稍后重试。",
): string {
  if (error instanceof Error) {
    const message = error.message.trim()
    if (!message) {
      return fallback
    }
    if (
      message.includes("Failed to fetch") ||
      message.includes("Load failed") ||
      message.includes("NetworkError")
    ) {
      return "无法连接到后端服务，请确认后端已启动且网络可用。"
    }
    if (message === "Failed to fetch response") {
      return "获取分析结果失败，请稍后重试。"
    }
    if (message === "Failed to call AI") {
      return "写作助手暂时不可用，请检查模型配置后重试。"
    }
    if (
      message.includes("403") &&
      (message.includes("无权访问模型") ||
        message.toLowerCase().includes("access") && message.toLowerCase().includes("model"))
    ) {
      return "当前访问密钥无权使用所选模型，请在配置中更换可用模型或更换已开通权限的密钥。"
    }
    return message
  }
  return fallback
}

async function request<T>(
  path: string,
  options: RequestInit,
  config: { showLoading?: boolean; suppressGlobalError?: boolean } = {},
): Promise<T> {
  const { setLoading, setError } = useProjectStore.getState()
  const shouldSetLoading = config.showLoading !== false

  if (shouldSetLoading) {
    setLoading(true)
  }
  setError(null)

  try {
    const response = await fetch(buildApiUrl(path), {
      headers: buildAuthHeaders({
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      }),
      ...options,
    })

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null)
      const detail = errorPayload?.detail ?? `Request failed with ${response.status}`
      if (response.status === 401) {
        handleUnauthorized()
      }
      throw new Error(detail)
    }

    return (await response.json()) as T
  } catch (error) {
    if (!isAbortError(error)) {
      if (!config.suppressGlobalError) {
        const message = formatUserErrorMessage(error)
        setError(message)
      } else {
        console.warn(`Suppressed global error for ${path}:`, error)
      }
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

export async function generateStoryDirections(
  payload: StoryDirectionRequest,
  options: { signal?: AbortSignal } = {},
): Promise<StoryDirectionResponse> {
  return request<StoryDirectionResponse>(
    "/api/story_directions",
    {
      method: "POST",
      body: JSON.stringify(payload),
      signal: options.signal,
    },
    { showLoading: false, suppressGlobalError: true },
  )
}

export async function createStoryDirectionsTask(
  payload: StoryDirectionRequest,
  options: { signal?: AbortSignal } = {},
): Promise<AsyncTaskCreateResponse<StoryDirectionResponse>> {
  return request<AsyncTaskCreateResponse<StoryDirectionResponse>>(
    "/api/tasks/story_directions",
    {
      method: "POST",
      body: JSON.stringify(payload),
      signal: options.signal,
    },
    { showLoading: false, suppressGlobalError: true },
  )
}

export async function generateIdeaLabStage(
  payload: IdeaLabStageRequest,
  options: { signal?: AbortSignal } = {},
): Promise<IdeaLabStageResponse> {
  return request<IdeaLabStageResponse>(
    "/api/idea_lab/stage",
    {
      method: "POST",
      body: JSON.stringify(payload),
      signal: options.signal,
    },
    { showLoading: false, suppressGlobalError: true },
  )
}

export async function createIdeaLabStageTask(
  payload: IdeaLabStageRequest,
  options: { signal?: AbortSignal } = {},
): Promise<AsyncTaskCreateResponse<IdeaLabStageResponse>> {
  return request<AsyncTaskCreateResponse<IdeaLabStageResponse>>(
    "/api/tasks/idea_lab/stage",
    {
      method: "POST",
      body: JSON.stringify(payload),
      signal: options.signal,
    },
    { showLoading: false, suppressGlobalError: true },
  )
}

export async function createOutlineTask(
  payload: CreateOutlineRequest,
  options: { signal?: AbortSignal } = {},
): Promise<AsyncTaskCreateResponse<StoryProject>> {
  return request<AsyncTaskCreateResponse<StoryProject>>(
    "/api/tasks/outline",
    {
      method: "POST",
      body: JSON.stringify(payload),
      signal: options.signal,
    },
    { showLoading: false, suppressGlobalError: true },
  )
}

export async function createImportOutlineTask(
  projectId: string,
  rawText: string,
  options: { signal?: AbortSignal } = {},
): Promise<AsyncTaskCreateResponse<StoryProject>> {
  return request<AsyncTaskCreateResponse<StoryProject>>(
    `/api/tasks/projects/${encodeURIComponent(projectId)}/outline/import`,
    {
      method: "POST",
      body: JSON.stringify({ raw_text: rawText }),
      signal: options.signal,
    },
    { showLoading: false, suppressGlobalError: true },
  )
}

export async function getAsyncTask<T = Record<string, unknown>>(
  taskId: string,
  options: { signal?: AbortSignal } = {},
): Promise<AsyncTask<T>> {
  return request<AsyncTask<T>>(
    `/api/tasks/${encodeURIComponent(taskId)}`,
    {
      method: "GET",
      signal: options.signal,
    },
    { showLoading: false, suppressGlobalError: true },
  )
}

export async function listAsyncTasks<T = Record<string, unknown>>(
  options: { kind?: AsyncTaskKind; limit?: number; signal?: AbortSignal } = {},
): Promise<AsyncTaskListResponse<T>> {
  const searchParams = new URLSearchParams()
  if (options.kind) {
    searchParams.set("kind", options.kind)
  }
  if (options.limit) {
    searchParams.set("limit", String(options.limit))
  }
  const query = searchParams.size > 0 ? `?${searchParams.toString()}` : ""
  return request<AsyncTaskListResponse<T>>(
    `/api/tasks${query}`,
    {
      method: "GET",
      signal: options.signal,
    },
    { showLoading: false, suppressGlobalError: true },
  )
}

function sleepWithSignal(delayMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup()
      resolve()
    }, delayMs)
    const onAbort = () => {
      cleanup()
      reject(new DOMException("Aborted", "AbortError"))
    }
    const cleanup = () => {
      window.clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

export async function waitForAsyncTask<T = Record<string, unknown>>(
  taskId: string,
  options: {
    signal?: AbortSignal
    intervalMs?: number
    onUpdate?: (task: AsyncTask<T>) => void
  } = {},
): Promise<AsyncTask<T>> {
  const intervalMs = options.intervalMs ?? 1200

  while (true) {
    const task = await getAsyncTask<T>(taskId, { signal: options.signal })
    options.onUpdate?.(task)

    if (task.status === "succeeded" || task.status === "failed") {
      return task
    }

    await sleepWithSignal(intervalMs, options.signal)
  }
}

export async function createEmptyProject(
  payload: CreateEmptyProjectRequest,
): Promise<StoryProject> {
  return request<StoryProject>("/api/projects/empty", {
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
    { showLoading: false, suppressGlobalError: true },
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
    { showLoading: false, suppressGlobalError: true },
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
  payload: {
    analysis_profile?: "auto" | "short" | "medium" | "long"
    prompt_overrides?: PromptOverrides
    writer_config?: WriterConfig
  },
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

export async function createChapter(
  projectId: string,
  payload: { title?: string | null },
  options: { signal?: AbortSignal } = {},
): Promise<StoryProject> {
  return request<StoryProject>(
    `/api/projects/${encodeURIComponent(projectId)}/chapters`,
    {
      method: "POST",
      body: JSON.stringify(payload),
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function updateChapter(
  projectId: string,
  chapterId: string,
  payload: { title?: string | null; content?: string | null; order?: number | null },
  options: { signal?: AbortSignal } = {},
): Promise<StoryProject> {
  return request<StoryProject>(
    `/api/projects/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function importOutline(
  projectId: string,
  rawText: string,
  options: { signal?: AbortSignal } = {},
): Promise<StoryProject> {
  return request<StoryProject>(
    `/api/projects/${encodeURIComponent(projectId)}/outline/import`,
    {
      method: "POST",
      body: JSON.stringify({ raw_text: rawText }),
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function deleteChapter(
  projectId: string,
  chapterId: string,
  options: { signal?: AbortSignal } = {},
): Promise<StoryProject> {
  return request<StoryProject>(
    `/api/projects/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}`,
    {
      method: "DELETE",
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

export async function getStyleKnowledgeBase(
  projectId: string,
  options: { signal?: AbortSignal } = {},
): Promise<StyleKnowledgeBase> {
  return request<StyleKnowledgeBase>(
    `/api/projects/${encodeURIComponent(projectId)}/style_knowledge`,
    {
      method: "GET",
      signal: options.signal,
    },
    { showLoading: false, suppressGlobalError: true },
  )
}

export async function uploadStyleKnowledgeFile(
  projectId: string,
  file: File,
  options: { signal?: AbortSignal } = {},
): Promise<StyleKnowledgeUploadResponse> {
  const formData = new FormData()
  formData.append("file", file)

  const { setLoading, setError } = useProjectStore.getState()
  setLoading(true)
  setError(null)
  try {
    const response = await fetch(
      buildApiUrl(`/api/projects/${encodeURIComponent(projectId)}/style_knowledge/upload`),
      {
        method: "POST",
        body: formData,
        headers: buildAuthHeaders(),
        signal: options.signal,
      }
    )
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null)
      const detail =
        typeof errorPayload?.detail === "string"
          ? errorPayload.detail
          : errorPayload?.detail?.message ?? `Request failed with ${response.status}`
      if (response.status === 401) {
        handleUnauthorized()
      }
      throw new Error(detail)
    }
    return (await response.json()) as StyleKnowledgeUploadResponse
  } catch (error) {
    if (!isAbortError(error)) {
      const message = formatUserErrorMessage(error)
      setError(message)
    }
    throw error
  } finally {
    setLoading(false)
  }
}

export async function listStyleLibraries(
  options: { signal?: AbortSignal } = {},
): Promise<StyleLibraryBundle[]> {
  return request<StyleLibraryBundle[]>(
    "/api/style_libraries",
    {
      method: "GET",
      signal: options.signal,
    },
    { showLoading: false, suppressGlobalError: true },
  )
}

export async function createStyleLibrary(
  payload: { name: string; description?: string | null },
  options: { signal?: AbortSignal } = {},
): Promise<StyleLibrary> {
  return request<StyleLibrary>(
    "/api/style_libraries",
    {
      method: "POST",
      body: JSON.stringify(payload),
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function importCleanedStyleLibraryFile(
  libraryId: string,
  file: File,
  options: { signal?: AbortSignal } = {},
): Promise<StyleKnowledgeImportResponse> {
  const formData = new FormData()
  formData.append("file", file)

  const { setLoading, setError } = useProjectStore.getState()
  setLoading(true)
  setError(null)
  try {
    const response = await fetch(
      buildApiUrl(`/api/style_libraries/${encodeURIComponent(libraryId)}/documents/import`),
      {
        method: "POST",
        body: formData,
        headers: buildAuthHeaders(),
        signal: options.signal,
      }
    )
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null)
      const detail =
        typeof errorPayload?.detail === "string"
          ? errorPayload.detail
          : errorPayload?.detail?.message ?? `Request failed with ${response.status}`
      if (response.status === 401) {
        handleUnauthorized()
      }
      throw new Error(detail)
    }
    return (await response.json()) as StyleKnowledgeImportResponse
  } catch (error) {
    if (!isAbortError(error)) {
      const message = formatUserErrorMessage(error)
      setError(message)
    }
    throw error
  } finally {
    setLoading(false)
  }
}

export async function uploadStyleLibrarySourceFile(
  libraryId: string,
  file: File,
  options: { signal?: AbortSignal } = {},
): Promise<StyleKnowledgeUploadResponse> {
  const formData = new FormData()
  formData.append("file", file)

  const { setLoading, setError } = useProjectStore.getState()
  setLoading(true)
  setError(null)
  try {
    const response = await fetch(
      buildApiUrl(`/api/style_libraries/${encodeURIComponent(libraryId)}/documents/upload`),
      {
        method: "POST",
        body: formData,
        headers: buildAuthHeaders(),
        signal: options.signal,
      }
    )
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null)
      const detail =
        typeof errorPayload?.detail === "string"
          ? errorPayload.detail
          : errorPayload?.detail?.message ?? `Request failed with ${response.status}`
      if (response.status === 401) {
        handleUnauthorized()
      }
      throw new Error(detail)
    }
    return (await response.json()) as StyleKnowledgeUploadResponse
  } catch (error) {
    if (!isAbortError(error)) {
      const message = formatUserErrorMessage(error)
      setError(message)
    }
    throw error
  } finally {
    setLoading(false)
  }
}

export async function previewStyleReferences(
  projectId: string,
  payload: {
    instruction: string
    text: string
    style_document_ids: string[]
    top_k?: number
  },
  options: { signal?: AbortSignal } = {},
): Promise<StyleRetrievalPreviewResponse> {
  return request<StyleRetrievalPreviewResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/style_knowledge/preview`,
    {
      method: "POST",
      body: JSON.stringify(payload),
      signal: options.signal,
    },
    { showLoading: false, suppressGlobalError: true },
  )
}

export async function updateStyleKnowledgeTitle(
  projectId: string,
  docId: string,
  payload: { title: string },
  options: { signal?: AbortSignal } = {},
): Promise<StyleDocument> {
  return request<StyleDocument>(
    `/api/projects/${encodeURIComponent(projectId)}/style_knowledge/${encodeURIComponent(docId)}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function deleteStyleKnowledgeDocument(
  projectId: string,
  docId: string,
  options: { signal?: AbortSignal } = {},
): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(
    `/api/projects/${encodeURIComponent(projectId)}/style_knowledge/${encodeURIComponent(docId)}`,
    {
      method: "DELETE",
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function updateStyleLibraryTitle(
  libraryId: string,
  payload: { name?: string; description?: string | null },
  options: { signal?: AbortSignal } = {},
): Promise<StyleLibrary> {
  return request<StyleLibrary>(
    `/api/style_libraries/${encodeURIComponent(libraryId)}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function deleteStyleLibrary(
  libraryId: string,
  options: { signal?: AbortSignal } = {},
): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(
    `/api/style_libraries/${encodeURIComponent(libraryId)}`,
    {
      method: "DELETE",
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function updateStyleLibraryDocumentTitle(
  libraryId: string,
  docId: string,
  payload: { title: string },
  options: { signal?: AbortSignal } = {},
): Promise<StyleDocument> {
  return request<StyleDocument>(
    `/api/style_libraries/${encodeURIComponent(libraryId)}/documents/${encodeURIComponent(docId)}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function deleteStyleLibraryDocument(
  libraryId: string,
  docId: string,
  options: { signal?: AbortSignal } = {},
): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(
    `/api/style_libraries/${encodeURIComponent(libraryId)}/documents/${encodeURIComponent(docId)}`,
    {
      method: "DELETE",
      signal: options.signal,
    },
    { showLoading: false },
  )
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
  payload: { name?: string | null; description?: string | null },
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

export async function updateGraphRelation(
  projectId: string,
  relationId: string,
  updates: Partial<CharacterGraphLink>,
  options: { signal?: AbortSignal } = {},
): Promise<CharacterGraphLink> {
  return request<CharacterGraphLink>(
    `/api/projects/${encodeURIComponent(projectId)}/graph/relations/${encodeURIComponent(relationId)}`,
    {
      method: "PUT",
      body: JSON.stringify(updates),
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function deleteGraphRelation(
  projectId: string,
  relationId: string,
  options: { signal?: AbortSignal } = {},
): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(
    `/api/projects/${encodeURIComponent(projectId)}/graph/relations/${encodeURIComponent(relationId)}`,
    {
      method: "DELETE",
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function createGraphRelation(
  projectId: string,
  payload: Partial<CharacterGraphLink> & {
    source_id: string
    target_id: string
  },
  options: { signal?: AbortSignal } = {},
): Promise<CharacterGraphLink> {
  return request<CharacterGraphLink>(
    `/api/projects/${encodeURIComponent(projectId)}/graph/relations`,
    {
      method: "POST",
      body: JSON.stringify(payload),
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function syncCharacterGraph(
  projectId: string,
  payload: { mode: "full" | "node"; node_id?: string | null },
  options: { signal?: AbortSignal } = {},
): Promise<GraphSyncResponse> {
  return request<GraphSyncResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/graph/sync`,
    {
      method: "POST",
      body: JSON.stringify(payload),
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
    { showLoading: false, suppressGlobalError: true },
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

export async function reorderNodes(
  projectId: string,
  nodeIds: string[],
  options: { signal?: AbortSignal } = {},
): Promise<StoryProject> {
  return request<StoryProject>(
    `/api/projects/${encodeURIComponent(projectId)}/nodes/reorder`,
    {
      method: "POST",
      body: JSON.stringify({ node_ids: nodeIds }),
      signal: options.signal,
    },
    { showLoading: false },
  )
}

export async function registerUser(payload: {
  username: string
  password: string
}): Promise<AuthTokenResponse> {
  return request<AuthTokenResponse>(
    "/api/auth/register",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    { showLoading: false },
  )
}

export async function loginUser(payload: {
  username: string
  password: string
}): Promise<AuthTokenResponse> {
  return request<AuthTokenResponse>(
    "/api/auth/login",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    { showLoading: false },
  )
}

export async function getCurrentUser(
  options: { signal?: AbortSignal } = {},
): Promise<AuthUser> {
  return request<AuthUser>(
    "/api/auth/me",
    {
      method: "GET",
      signal: options.signal,
    },
    { showLoading: false, suppressGlobalError: true },
  )
}

export async function createOutlineChannel(): Promise<AuthOutlineChannelResponse> {
  return request<AuthOutlineChannelResponse>(
    "/api/auth/outline-channel",
    {
      method: "POST",
    },
    { showLoading: false },
  )
}

export async function updateCurrentUser(
  payload: AuthUpdateProfileRequest,
): Promise<AuthUser> {
  return request<AuthUser>(
    "/api/auth/me",
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
    { showLoading: false },
  )
}

export async function changePassword(
  payload: AuthChangePasswordRequest,
): Promise<AuthTokenResponse> {
  return request<AuthTokenResponse>(
    "/api/auth/change-password",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    { showLoading: false },
  )
}

export async function logoutAllSessions(): Promise<{ logged_out: boolean }> {
  return request<{ logged_out: boolean }>(
    "/api/auth/logout-all",
    {
      method: "POST",
    },
    { showLoading: false },
  )
}
