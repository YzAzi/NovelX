from __future__ import annotations

import ast
import json
from datetime import datetime
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .knowledge_graph import KnowledgeGraph
from .style_knowledge import StyleDocument

CHARACTER_BIO_MAX_LENGTH = 300


def normalize_maybe_json_list(value: Any) -> Any:
    current = value
    for _ in range(3):
        if current is None:
            return []
        if not isinstance(current, str):
            return current

        stripped = current.strip()
        if not stripped:
            return []

        if stripped.startswith("```"):
            stripped = stripped.removeprefix("```json").removeprefix("```").strip()
            if stripped.endswith("```"):
                stripped = stripped[:-3].strip()

        try:
            current = json.loads(stripped)
            continue
        except json.JSONDecodeError:
            pass

        try:
            current = ast.literal_eval(stripped)
            continue
        except (SyntaxError, ValueError):
            return value

    return current

class StoryNode(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    title: str
    content: str
    narrative_order: int
    timeline_order: float
    location_tag: str
    characters: list[str] = Field(default_factory=list)

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "id": "d0a9e241-4d4a-4b14-9e76-78a0e8c1a9f6",
                "title": "失踪的线索",
                "content": "主角在旧档案中发现一份被刻意遮盖的报告。",
                "narrative_order": 1,
                "timeline_order": 1.0,
                "location_tag": "主线",
                "characters": ["c-001", "c-002"],
            }
        }
    )

    @field_validator("narrative_order")
    @classmethod
    def narrative_order_starts_from_one(cls, value: int) -> int:
        if value < 1:
            raise ValueError("narrative_order must be >= 1")
        return value

    @field_validator("timeline_order")
    @classmethod
    def timeline_order_positive(cls, value: float) -> float:
        if value <= 0:
            raise ValueError("timeline_order must be > 0")
        return value


class StoryChapter(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    title: str
    content: str
    order: int

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "id": "ch-001",
                "title": "第一章 雨夜",
                "content": "雨落在屋檐上，像一阵迟到的鼓点。",
                "order": 1,
            }
        }
    )

    @field_validator("order")
    @classmethod
    def order_starts_from_one(cls, value: int) -> int:
        if value < 1:
            raise ValueError("order must be >= 1")
        return value


class CharacterProfile(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    tags: list[str] = Field(default_factory=list)
    bio: str

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "id": "c-001",
                "name": "陆沉",
                "tags": ["冷静", "复仇者"],
                "bio": "失去家人的侦探，在城市阴影中追索真相。",
            }
        }
    )

    @field_validator("bio")
    @classmethod
    def bio_length_limit(cls, value: str) -> str:
        trimmed = value.strip()
        if len(trimmed) > CHARACTER_BIO_MAX_LENGTH:
            return trimmed[:CHARACTER_BIO_MAX_LENGTH]
        return trimmed


class WriterConfig(BaseModel):
    prompt: str | None = None
    model: str | None = None
    api_key: str | None = None
    base_url: str | None = None
    polish_instruction: str | None = None
    expand_instruction: str | None = None
    style_strength: str | None = None
    style_preset: str | None = None


class StoryProject(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    title: str
    world_view: str
    style_tags: list[str] = Field(default_factory=list)
    nodes: list[StoryNode] = Field(default_factory=list)
    chapters: list[StoryChapter] = Field(default_factory=list)
    characters: list[CharacterProfile] = Field(default_factory=list)
    analysis_profile: str = "auto"
    prompt_overrides: "PromptOverrides" = Field(default_factory=lambda: PromptOverrides())
    writer_config: WriterConfig = Field(default_factory=WriterConfig)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "id": "p-001",
                "title": "雾城谜案",
                "world_view": "灰雾笼罩的港城，信息被财团垄断。",
                "style_tags": ["悬疑", "非线性叙事"],
                "nodes": [
                    {
                        "id": "d0a9e241-4d4a-4b14-9e76-78a0e8c1a9f6",
                        "title": "失踪的线索",
                        "content": "主角在旧档案中发现一份被刻意遮盖的报告。",
                        "narrative_order": 1,
                        "timeline_order": 1.0,
                        "location_tag": "主线",
                        "characters": ["c-001", "c-002"],
                    }
                ],
                "chapters": [
                    {
                        "id": "ch-001",
                        "title": "第一章 雨夜",
                        "content": "雨落在屋檐上，像一阵迟到的鼓点。",
                        "order": 1,
                    }
                ],
                "characters": [
                    {
                        "id": "c-001",
                        "name": "陆沉",
                        "tags": ["冷静", "复仇者"],
                        "bio": "失去家人的侦探，在城市阴影中追索真相。",
                    }
                ],
                "created_at": "2024-04-01T12:00:00Z",
                "updated_at": "2024-04-01T12:00:00Z",
            }
        }
    )

    @model_validator(mode="after")
    def normalize_timestamps(self) -> "StoryProject":
        if self.updated_at < self.created_at:
            self.updated_at = self.created_at
        return self

    @field_validator("style_tags", "nodes", "chapters", "characters", mode="before")
    @classmethod
    def normalize_project_list_fields(cls, value: Any) -> Any:
        return normalize_maybe_json_list(value)


class StyleLibrary(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    owner_id: str | None = None
    name: str
    description: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    @field_validator("name")
    @classmethod
    def normalize_library_name(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Library name cannot be empty")
        return trimmed

    @field_validator("description")
    @classmethod
    def normalize_library_description(cls, value: str) -> str:
        return value.strip()


class StyleLibraryBundle(BaseModel):
    library: StyleLibrary
    documents: list[StyleDocument] = Field(default_factory=list)
    total_chunks: int = 0
    total_characters: int = 0


class CreateOutlineRequest(BaseModel):
    world_view: str
    style_tags: list[str] = Field(default_factory=list)
    initial_prompt: str
    drafting_prompt: str | None = None
    base_project_id: str | None = None
    request_id: str | None = None

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "world_view": "灰雾笼罩的港城，信息被财团垄断。",
                "style_tags": ["悬疑", "非线性叙事"],
                "initial_prompt": "主角收到一封来自失踪姐姐的信。",
            }
        }
    )

    @field_validator("style_tags", mode="before")
    @classmethod
    def normalize_style_tags(cls, value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            return [tag.strip() for tag in value.split(",") if tag.strip()]
        return value

    @field_validator("drafting_prompt", mode="before")
    @classmethod
    def normalize_drafting_prompt(cls, value: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, str):
            trimmed = value.strip()
            return trimmed or None
        return value


class StoryDirectionRequest(BaseModel):
    user_input: str | None = None
    world_view: str | None = None
    style_tags: list[str] = Field(default_factory=list)
    base_project_id: str | None = None

    @field_validator("style_tags", mode="before")
    @classmethod
    def normalize_story_direction_style_tags(cls, value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            return [tag.strip() for tag in value.split(",") if tag.strip()]
        return value


class StoryDirectionOption(BaseModel):
    title: str
    logline: str
    world_view: str
    style_tags: list[str] = Field(default_factory=list)
    initial_prompt: str

    @field_validator("style_tags", mode="before")
    @classmethod
    def normalize_story_direction_option_tags(cls, value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            return [tag.strip() for tag in value.split(",") if tag.strip()]
        return value


class StoryDirectionResponse(BaseModel):
    directions: list[StoryDirectionOption]


class IdeaLabStageOption(BaseModel):
    project_title: str
    hook: str
    premise: str
    protagonist: str
    conflict: str
    world_view: str
    style_tags: list[str] = Field(default_factory=list)
    initial_prompt: str

    @field_validator("style_tags", mode="before")
    @classmethod
    def normalize_idea_lab_option_tags(cls, value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            return [tag.strip() for tag in value.split(",") if tag.strip()]
        return value


class IdeaLabStageRequest(BaseModel):
    stage: Literal["concept", "protagonist", "conflict", "outline"]
    seed_input: str | None = None
    world_view: str | None = None
    style_tags: list[str] = Field(default_factory=list)
    base_project_id: str | None = None
    feedback: str | None = None
    selected_option: IdeaLabStageOption | None = None

    @field_validator("style_tags", mode="before")
    @classmethod
    def normalize_idea_lab_request_tags(cls, value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            return [tag.strip() for tag in value.split(",") if tag.strip()]
        return value


class IdeaLabStageResponse(BaseModel):
    stage: Literal["concept", "protagonist", "conflict", "outline"]
    stage_title: str
    stage_instruction: str
    is_final_stage: bool = False
    options: list[IdeaLabStageOption]


AsyncTaskKind = Literal["story_directions", "idea_lab_stage", "create_outline", "import_outline"]
AsyncTaskStatus = Literal["pending", "running", "succeeded", "failed"]


class AsyncTaskResponse(BaseModel):
    id: str
    kind: AsyncTaskKind
    status: AsyncTaskStatus
    title: str | None = None
    request_payload: dict[str, Any] = Field(default_factory=dict)
    result_payload: dict[str, Any] | None = None
    error_message: str | None = None
    progress_stage: str | None = None
    progress_details: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None


class AsyncTaskCreateResponse(BaseModel):
    task: AsyncTaskResponse
    channel_token: str


class AsyncTaskListResponse(BaseModel):
    tasks: list[AsyncTaskResponse] = Field(default_factory=list)


class CreateEmptyProjectRequest(BaseModel):
    title: str | None = None
    world_view: str | None = None
    style_tags: list[str] = Field(default_factory=list)
    base_project_id: str | None = None

    @field_validator("style_tags", mode="before")
    @classmethod
    def normalize_style_tags(cls, value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            return [tag.strip() for tag in value.split(",") if tag.strip()]
        return value


class PromptOverrides(BaseModel):
    drafting: str | None = None
    sync: str | None = None
    extraction: str | None = None
    analysis: str | None = None
    outline_import: str | None = None

    @field_validator(
        "drafting",
        "sync",
        "extraction",
        "analysis",
        "outline_import",
        mode="before",
    )
    @classmethod
    def normalize_prompt_value(cls, value: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, str):
            trimmed = value.strip()
            return trimmed or None
        return value


class SyncNodeRequest(BaseModel):
    project_id: str
    node: StoryNode
    request_id: str | None = None

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "project_id": "p-001",
                "node": {
                    "id": "d0a9e241-4d4a-4b14-9e76-78a0e8c1a9f6",
                    "title": "失踪的线索",
                    "content": "主角在旧档案中发现一份被刻意遮盖的报告。",
                    "narrative_order": 1,
                    "timeline_order": 1.0,
                    "location_tag": "主线",
                    "characters": ["c-001", "c-002"],
                },
            }
        }
    )


class InsertNodeRequest(BaseModel):
    project_id: str
    node: StoryNode
    request_id: str | None = None

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "project_id": "p-001",
                "node": {
                    "title": "新的插入节点",
                    "content": "插入到特定叙事顺序的位置。",
                    "narrative_order": 3,
                    "timeline_order": 3.0,
                    "location_tag": "主线",
                    "characters": [],
                },
                "request_id": "req-123",
            }
        }
    )


class ReorderNodesRequest(BaseModel):
    node_ids: list[str] = Field(description="Ordered list of node IDs")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "node_ids": [
                    "node-1-id",
                    "node-2-id",
                    "node-3-id"
                ]
            }
        }
    )


class AnalysisMessage(BaseModel):
    role: str
    content: str


class OutlineAnalysisRequest(BaseModel):
    project_id: str
    messages: list[AnalysisMessage] = Field(default_factory=list)


class AnalysisHistoryRequest(BaseModel):
    project_id: str
    messages: list[AnalysisMessage] = Field(default_factory=list)


class AnalysisHistoryMessage(BaseModel):
    id: str
    role: str
    content: str
    created_at: str


class AnalysisHistoryResponse(BaseModel):
    messages: list[AnalysisHistoryMessage] = Field(default_factory=list)


class OutlineImportNode(BaseModel):
    title: str
    content: str | None = None
    narrative_order: int | None = None
    timeline_order: float | None = None
    location_tag: str | None = None
    characters: list[str] = Field(default_factory=list)


class OutlineImportCharacter(BaseModel):
    name: str
    tags: list[str] = Field(default_factory=list)
    bio: str | None = None


class OutlineImportRequest(BaseModel):
    raw_text: str


class OutlineImportResult(BaseModel):
    nodes: list[OutlineImportNode] = Field(default_factory=list)
    characters: list[OutlineImportCharacter] = Field(default_factory=list)

    @field_validator("nodes", "characters", mode="before")
    @classmethod
    def normalize_outline_import_lists(cls, value: Any) -> Any:
        return normalize_maybe_json_list(value)


class WritingAssistantRequest(BaseModel):
    project_id: str
    text: str
    instruction: str
    stream: bool = True
    style_document_ids: list[str] = Field(default_factory=list)


class StyleRetrievalPreviewRequest(BaseModel):
    instruction: str
    text: str
    style_document_ids: list[str] = Field(default_factory=list)
    top_k: int = 5


class StyleReferencePreview(BaseModel):
    id: str
    title: str
    document_id: str | None = None
    focus: str | None = None
    techniques: list[str] = Field(default_factory=list)
    content: str
    score: float


class StyleRetrievalPreviewResponse(BaseModel):
    preferred_focuses: list[str] = Field(default_factory=list)
    references: list[StyleReferencePreview] = Field(default_factory=list)


class StyleKnowledgeUploadResponse(BaseModel):
    document: StyleDocument
    total_batches: int = 0
    successful_batches: int = 0
    failed_batches: int = 0
    warnings: list[str] = Field(default_factory=list)


class StyleKnowledgeImportResponse(BaseModel):
    documents: list[StyleDocument] = Field(default_factory=list)
    imported_count: int = 0
    warnings: list[str] = Field(default_factory=list)


class StyleKnowledgeUpdateRequest(BaseModel):
    title: str


class StyleLibraryCreateRequest(BaseModel):
    name: str
    description: str | None = None


class StyleLibraryUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None


class HealthResponse(BaseModel):
    status: str
    version: str

    model_config = ConfigDict(
        json_schema_extra={"example": {"status": "ok", "version": "0.1.0"}}
    )


class ProjectSummary(BaseModel):
    id: str
    title: str
    updated_at: datetime

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "id": "p-001",
                "title": "雾城谜案",
                "updated_at": "2024-04-01T12:00:00Z",
            }
        }
    )


class ProjectStatsResponse(BaseModel):
    total_nodes: int
    total_characters: int
    total_style_docs: int
    total_words: int
    graph_entities: int
    graph_relations: int


class PromptOverridesUpdate(BaseModel):
    drafting: str | None = None
    sync: str | None = None
    extraction: str | None = None
    analysis: str | None = None
    outline_import: str | None = None

    model_config = ConfigDict(extra="forbid")

    @field_validator(
        "drafting",
        "sync",
        "extraction",
        "analysis",
        "outline_import",
        mode="before",
    )
    @classmethod
    def normalize_prompt_value(cls, value: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, str):
            trimmed = value.strip()
            return trimmed or None
        return value


class ProjectUpdateRequest(BaseModel):
    title: str | None = None
    analysis_profile: str | None = None
    prompt_overrides: PromptOverridesUpdate | None = None
    writer_config: WriterConfig | None = None


class ChapterCreateRequest(BaseModel):
    title: str | None = None


class ChapterUpdateRequest(BaseModel):
    title: str | None = None
    content: str | None = None
    order: int | None = None


class ProjectExportData(BaseModel):
    project: StoryProject
    knowledge_graph: KnowledgeGraph
    style_documents: list[StyleDocument] = Field(default_factory=list)
    snapshots: list[dict] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def normalize_legacy_export_fields(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        if "style_documents" not in value and "world_documents" in value:
            value = dict(value)
            value["style_documents"] = value.pop("world_documents")
        return value


class ModelConfigResponse(BaseModel):
    base_url: str | None = None
    drafting_model: str
    sync_model: str
    extraction_model: str
    has_default_key: bool = False
    has_drafting_key: bool = False
    has_sync_key: bool = False
    has_extraction_key: bool = False


class ModelConfigUpdateRequest(BaseModel):
    base_url: str | None = None
    default_api_key: str | None = None
    drafting_api_key: str | None = None
    sync_api_key: str | None = None
    extraction_api_key: str | None = None
    drafting_model: str | None = None
    sync_model: str | None = None
    extraction_model: str | None = None


class AuthRegisterRequest(BaseModel):
    username: str
    password: str


class AuthLoginRequest(BaseModel):
    username: str
    password: str


class AuthUserResponse(BaseModel):
    id: str
    username: str
    created_at: datetime | None = None


class AuthTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: AuthUserResponse


class AuthOutlineChannelResponse(BaseModel):
    request_id: str
    channel_token: str


class AuthUpdateProfileRequest(BaseModel):
    username: str


class AuthChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class CharacterAppearance(BaseModel):
    node_id: str
    node_title: str
    narrative_order: int
    timeline_order: float | None = None


class CharacterGraphNode(BaseModel):
    id: str
    name: str
    type: str | None = None
    description: str | None = None
    aliases: list[str] = Field(default_factory=list)
    properties: dict = Field(default_factory=dict)
    source_refs: list[str] = Field(default_factory=list)
    appearances: list[CharacterAppearance] = Field(default_factory=list)


class CharacterGraphLink(BaseModel):
    id: str | None = None
    source: str
    target: str
    relation_type: str | None = None
    relation_name: str | None = None
    description: str | None = None


class CharacterGraphResponse(BaseModel):
    nodes: list[CharacterGraphNode] = Field(default_factory=list)
    links: list[CharacterGraphLink] = Field(default_factory=list)


class VersionCreateRequest(BaseModel):
    name: str | None = None
    description: str | None = None


class TimelineUpdate(BaseModel):
    node_id: str
    new_timeline_order: float

    model_config = ConfigDict(
        json_schema_extra={
            "example": {"node_id": "d0a9e241-4d4a-4b14-9e76-78a0e8c1a9f6", "new_timeline_order": 2.5}
        }
    )


class ConflictRecord(BaseModel):
    description: str
    affected_nodes: list[str] = Field(default_factory=list)

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "description": "节点时间线与既有事件冲突。",
                "affected_nodes": ["d0a9e241-4d4a-4b14-9e76-78a0e8c1a9f6"],
            }
        }
    )


class SyncAnalysisResult(BaseModel):
    new_characters: list[CharacterProfile] = Field(default_factory=list)
    timeline_updates: list[TimelineUpdate] = Field(default_factory=list)
    conflicts: list[ConflictRecord] = Field(default_factory=list)

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "new_characters": [
                    {
                        "id": "c-003",
                        "name": "秦岚",
                        "tags": ["敏锐", "记者"],
                        "bio": "追踪财团内幕的调查记者，嗅觉灵敏。",
                    }
                ],
                "timeline_updates": [
                    {"node_id": "d0a9e241-4d4a-4b14-9e76-78a0e8c1a9f6", "new_timeline_order": 2.0}
                ],
                "conflicts": [
                    {
                        "description": "新节点暗示事件发生在此前节点之前。",
                        "affected_nodes": ["d0a9e241-4d4a-4b14-9e76-78a0e8c1a9f6"],
                    }
                ],
            }
        }
    )

    @field_validator("new_characters", "timeline_updates", "conflicts", mode="before")
    @classmethod
    def normalize_sync_analysis_lists(cls, value: Any) -> Any:
        return normalize_maybe_json_list(value)
