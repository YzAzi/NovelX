import asyncio
import json
import logging
import re
import time
from datetime import datetime
from pathlib import Path
from typing import Literal

from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from .crud import create_project, delete_project, get_project, list_projects, update_project
from .database import AsyncSessionLocal, get_session, init_db
from .analysis_history import append_messages, load_history, search_history
from .graph_retriever import GraphRetriever
from .conflict_detector import ConflictDetector, SyncNodeResponse
from .config import (
    get_api_key,
    get_base_url,
    get_model_name,
    set_api_key_override,
    set_base_url_override,
    set_model_override,
    settings,
)
from .graph import run_drafting_workflow
from .graph_extractor import GraphExtractor
from langchain_openai import ChatOpenAI
from .knowledge_graph import EntityType, delete_graph, load_graph, save_graph
from .models import (
    CreateOutlineRequest,
    CreateEmptyProjectRequest,
    CharacterProfile,
    CharacterAppearance,
    CharacterGraphLink,
    CharacterGraphNode,
    CharacterGraphResponse,
    AnalysisHistoryRequest,
    AnalysisHistoryResponse,
    HealthResponse,
    OutlineAnalysisRequest,
    OutlineImportRequest,
    OutlineImportResult,
    KnowledgeDocumentRequest,
    KnowledgeImportRequest,
    KnowledgeSearchRequest,
    KnowledgeUpdateRequest,
    InsertNodeRequest,
    ProjectStatsResponse,
    ProjectSummary,
    ProjectUpdateRequest,
    ProjectExportData,
    ModelConfigResponse,
    ModelConfigUpdateRequest,
    ChapterCreateRequest,
    ChapterUpdateRequest,
    StoryNode,
    StoryChapter,
    StoryProject,
    SyncNodeRequest,
    ReorderNodesRequest,
    WritingAssistantRequest,
    VersionCreateRequest,
    VersionUpdateRequest,
)
from .index_sync import IndexSyncManager, SyncResult
from .node_indexer import NodeIndexer
from .schema_utils import pydantic_json_schema_inline, pydantic_to_openai_function_inline
from .sync_strategy import DEFAULT_SYNC_CONFIG, SyncMode, SyncQueue, build_default_sync_manager
from .vectorstore import SearchResult, add_documents
from langchain.prompts import PromptTemplate
from .world_knowledge import WorldKnowledgeBase, WorldDocument, WorldKnowledgeManager
from .graph_editor import GraphEditor
from .notifier import EventNotifier
from .websocket_manager import ConnectionManager, WSMessageType
from .version_manager import VersionManager
from .versioning import SnapshotType, VersionDiff, IndexSnapshot

logger = logging.getLogger(__name__)

index_sync_manager = build_default_sync_manager()
sync_queue = SyncQueue(DEFAULT_SYNC_CONFIG, index_sync_manager=index_sync_manager)
conflict_detector = ConflictDetector()
world_knowledge_manager = WorldKnowledgeManager()
ws_manager = ConnectionManager()
notifier = EventNotifier(ws_manager)
version_manager = VersionManager()

app = FastAPI(
    title="Novel Outline Service",
    description="FastAPI service for drafting and syncing story outlines.",
    version="0.1.0",
)

ANALYSIS_PROMPT_PATH = Path(__file__).parent / "prompts" / "outline_analysis_prompt.txt"
ANALYSIS_PROMPT_TEMPLATE = ANALYSIS_PROMPT_PATH.read_text(encoding="utf-8")
OUTLINE_IMPORT_PROMPT_PATH = Path(__file__).parent / "prompts" / "outline_import_prompt.txt"
OUTLINE_IMPORT_PROMPT_TEMPLATE = PromptTemplate.from_template(
    OUTLINE_IMPORT_PROMPT_PATH.read_text(encoding="utf-8")
)


class GraphSyncRequest(BaseModel):
    mode: Literal["full", "node"] = "full"
    node_id: str | None = None


class GraphSyncResponse(BaseModel):
    sync_result: SyncResult
    sync_status: str = "completed"


def _count_words(text: str) -> int:
    if not text:
        return 0
    cjk_chars = re.findall(r"[\u4e00-\u9fff]", text)
    tokens = re.findall(r"[A-Za-z0-9]+", text)
    return len(cjk_chars) + len(tokens)


def _format_outline(project: StoryProject) -> str:
    character_names = {character.id: character.name for character in project.characters}
    nodes = sorted(project.nodes, key=lambda node: node.narrative_order)
    lines: list[str] = [
        f"标题：{project.title}",
        f"世界观：{project.world_view}",
        f"风格标签：{', '.join(project.style_tags) if project.style_tags else '无'}",
        "节点列表：",
    ]
    for node in nodes:
        characters = [character_names.get(cid, cid) for cid in node.characters]
        lines.append(
            " - "
            f"[叙事{node.narrative_order}/时间轴{node.timeline_order}] "
            f"{node.title}（{node.location_tag}）"
        )
        if node.content:
            lines.append(f"   内容：{node.content}")
        if characters:
            lines.append(f"   角色：{', '.join(characters)}")
    return "\n".join(lines)


def _format_conversation(messages: list[dict]) -> str:
    if not messages:
        return "无"
    lines: list[str] = []
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        lines.append(f"{role.upper()}: {content}")
    return "\n".join(lines)


def _format_conflicts(conflicts: list) -> str:
    if not conflicts:
        return "无"
    lines: list[str] = []
    for conflict in conflicts:
        lines.append(
            f"- {conflict.type}: {conflict.description}"
            + (f"（建议：{conflict.suggestion}）" if conflict.suggestion else "")
        )
    return "\n".join(lines)


def _format_history_snippets(history: list[dict]) -> str:
    if not history:
        return "无"
    lines: list[str] = []
    for item in history:
        role = item.get("role", "user")
        content = item.get("content", "")
        lines.append(f"- {role}: {content}")
    return "\n".join(lines)


def _estimate_outline_words(project: StoryProject) -> int:
    total = _count_words(project.world_view)
    for node in project.nodes:
        total += _count_words(node.title)
        total += _count_words(node.content)
    return total


def _choose_analysis_scope(project: StoryProject) -> str:
    preference = (project.analysis_profile or "auto").lower()
    total_nodes = len(project.nodes)
    total_words = _estimate_outline_words(project)
    is_short = total_nodes <= 20 and total_words <= 6000

    if preference == "short":
        return "full" if is_short else "retrieval"
    if preference in ("medium", "long"):
        return "retrieval"
    return "full" if is_short else "retrieval"

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins_list(),
    allow_origin_regex=settings.cors_allow_origin_regex,
    allow_credentials=settings.cors_allow_credentials,
    allow_methods=settings.cors_allow_methods_list(),
    allow_headers=settings.cors_allow_headers_list(),
)


@app.on_event("startup")
async def startup() -> None:
    await init_db()
    # Auto snapshots disabled: only user-triggered manual snapshots are allowed.


@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    start_time = time.perf_counter()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - start_time) * 1000
    logger.info("%s %s %.2fms", request.method, request.url.path, duration_ms)
    return response


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"error": exc.__class__.__name__, "detail": str(exc)},
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.__class__.__name__, "detail": str(exc.detail)},
    )


@app.post(
    "/api/projects/empty",
    response_model=StoryProject,
    status_code=status.HTTP_200_OK,
)
async def create_empty_project(
    payload: CreateEmptyProjectRequest,
    session: AsyncSession = Depends(get_session),
):
    base_project = None
    if payload.base_project_id:
        base_project = await get_project(session, payload.base_project_id)
        if base_project is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Base project not found",
            )

    title = (payload.title or "").strip() or "未命名项目"
    world_view = (payload.world_view or "").strip()
    if not world_view and base_project:
        world_view = base_project.world_view

    style_tags = [tag.strip() for tag in payload.style_tags if tag.strip()]
    if not style_tags and base_project:
        style_tags = base_project.style_tags

    project = StoryProject(
        title=title,
        world_view=world_view,
        style_tags=style_tags,
        nodes=[],
        chapters=[],
        characters=[],
    )
    if base_project:
        project.analysis_profile = base_project.analysis_profile
        project.prompt_overrides = base_project.prompt_overrides.model_copy(deep=True)
        project.writer_config = base_project.writer_config.model_copy(deep=True)
    await create_project(session, project)
    return project


@app.post(
    "/api/create_outline",
    response_model=StoryProject,
    status_code=status.HTTP_200_OK,
)
async def create_outline(
    payload: CreateOutlineRequest,
    session: AsyncSession = Depends(get_session),
):
    if payload.base_project_id:
        base_project = await get_project(session, payload.base_project_id)
        if base_project is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Base project not found",
            )
    request_id = payload.request_id

    async def report_progress(stage: str, details: dict | None = None) -> None:
        if not request_id:
            return
        await notifier.notify_outline_progress(
            request_id, stage, details or {}
        )

    if request_id:
        await notifier.notify_outline_progress(
            request_id, "queued", {}
        )

    try:
        project = await run_drafting_workflow(payload, report_progress if request_id else None)
    except Exception as exc:
        if request_id:
            await notifier.notify_outline_progress(
                request_id, "failed", {"error": str(exc)}
            )
        raise

    await create_project(session, project)
    return project


@app.post(
    "/api/projects/{project_id}/outline/import",
    response_model=StoryProject,
    status_code=status.HTTP_200_OK,
)
async def import_outline(
    project_id: str,
    payload: OutlineImportRequest,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    raw_text = payload.raw_text.strip()
    if not raw_text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Outline content cannot be empty"
        )

    api_key = get_api_key("drafting")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="OPENAI_API_KEY is not configured"
        )

    schema = pydantic_to_openai_function_inline(OutlineImportResult)
    llm = ChatOpenAI(
        api_key=api_key,
        base_url=get_base_url(),
        model=get_model_name("drafting"),
    ).with_structured_output(schema)

    prompt_schema = pydantic_json_schema_inline(OutlineImportResult)
    prompt_override = project.prompt_overrides.outline_import
    prompt_template = (
        PromptTemplate.from_template(prompt_override)
        if prompt_override
        else OUTLINE_IMPORT_PROMPT_TEMPLATE
    )
    try:
        prompt_text = prompt_template.format(
            raw_text=raw_text,
            output_schema=json.dumps(prompt_schema, ensure_ascii=False, indent=2),
        )
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="自定义 Prompt 缺少必要变量：raw_text、output_schema",
        ) from exc
    result = await llm.ainvoke(prompt_text)
    if isinstance(result, OutlineImportResult):
        parsed = result
    elif isinstance(result, dict):
        parsed = OutlineImportResult.model_validate(result)
    elif hasattr(result, "model_dump"):
        parsed = OutlineImportResult.model_validate(result.model_dump())
    else:
        parsed = OutlineImportResult.model_validate(result)

    character_map: dict[str, CharacterProfile] = {}
    for character in parsed.characters:
        name = character.name.strip()
        if not name or name in character_map:
            continue
        bio = (character.bio or "").strip()
        if len(bio) > 100:
            bio = bio[:100]
        character_map[name] = CharacterProfile(
            name=name,
            tags=[tag.strip() for tag in character.tags if tag.strip()],
            bio=bio or "待补充",
        )

    nodes: list[StoryNode] = []
    for index, node in enumerate(parsed.nodes, start=1):
        title = node.title.strip() if node.title else ""
        if not title:
            title = f"未命名节点 {index}"
        content = (node.content or "").strip()
        narrative_order = node.narrative_order if node.narrative_order and node.narrative_order >= 1 else index
        timeline_order = (
            float(node.timeline_order)
            if node.timeline_order and node.timeline_order > 0
            else float(narrative_order)
        )
        location_tag = (node.location_tag or "主线").strip() or "主线"

        character_ids: list[str] = []
        for name in node.characters:
            normalized = name.strip()
            if not normalized:
                continue
            profile = character_map.get(normalized)
            if not profile:
                profile = CharacterProfile(name=normalized, tags=[], bio="待补充")
                character_map[normalized] = profile
            character_ids.append(profile.id)

        nodes.append(
            StoryNode(
                title=title,
                content=content,
                narrative_order=int(narrative_order),
                timeline_order=float(timeline_order),
                location_tag=location_tag,
                characters=character_ids,
            )
        )

    project.nodes = nodes
    project.characters = list(character_map.values())
    project.updated_at = datetime.utcnow()
    await update_project(session, project_id, project)

    prompt_override = project.prompt_overrides.extraction
    prompt_template = (
        PromptTemplate.from_template(prompt_override) if prompt_override else None
    )
    extractor = GraphExtractor(prompt_template=prompt_template)
    node_indexer = NodeIndexer()
    await node_indexer.clear_project(project.id)
    await node_indexer.index_project(project)
    graph = await extractor.build_full_graph(project)
    save_graph(graph)

    return project


@app.post(
    "/api/sync_node",
    response_model=SyncNodeResponse,
    status_code=status.HTTP_200_OK,
)
async def sync_node(
    payload: SyncNodeRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, payload.project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )

    request_id = payload.request_id
    await notifier.notify_sync_progress(
        payload.project_id,
        "started",
        {"node_id": payload.node.id, "request_id": request_id},
    )

    old_node = next(
        (node for node in project.nodes if node.id == payload.node.id),
        None,
    )
    updated = False
    for idx, node in enumerate(project.nodes):
        if node.id == payload.node.id:
            project.nodes[idx] = payload.node
            updated = True
            break
    if not updated:
        project.nodes.append(payload.node)
    project.updated_at = datetime.utcnow()
    updated_project = project
    await update_project(session, updated_project.id, updated_project)

    updated_node = next(
        (node for node in updated_project.nodes if node.id == payload.node.id),
        payload.node,
    )

    await notifier.notify_node_updated(
        payload.project_id,
        updated_node.model_dump(),
        updated_by="user",
    )

    sync_result = SyncResult(success=True, vector_updated=False, graph_updated=False)
    sync_status = "pending"

    async def _load_latest_project() -> StoryProject | None:
        async with AsyncSessionLocal() as session:
            return await get_project(session, payload.project_id)

    async def sync_graph_background() -> None:
        nonlocal sync_result
        try:
            async def sync_vector_with_delay(delay: int) -> None:
                await asyncio.sleep(delay)
                await index_sync_manager.node_indexer.index_node(
                    payload.project_id, updated_node
                )
                sync_result.vector_updated = True

            if DEFAULT_SYNC_CONFIG.graph_sync_mode == SyncMode.MANUAL:
                if DEFAULT_SYNC_CONFIG.vector_sync_mode == SyncMode.IMMEDIATE:
                    await index_sync_manager.node_indexer.index_node(
                        payload.project_id, updated_node
                    )
                    sync_result.vector_updated = True
                elif DEFAULT_SYNC_CONFIG.vector_sync_mode in (
                    SyncMode.DEBOUNCED,
                    SyncMode.BATCH,
                ):
                    delay = (
                        DEFAULT_SYNC_CONFIG.debounce_seconds
                        if DEFAULT_SYNC_CONFIG.vector_sync_mode == SyncMode.DEBOUNCED
                        else DEFAULT_SYNC_CONFIG.batch_timeout_seconds
                    )
                    await sync_vector_with_delay(delay)
            else:
                if DEFAULT_SYNC_CONFIG.vector_sync_mode == SyncMode.IMMEDIATE:
                    await index_sync_manager.node_indexer.index_node(
                        payload.project_id, updated_node
                    )
                    sync_result.vector_updated = True
                if DEFAULT_SYNC_CONFIG.graph_sync_mode in (
                    SyncMode.DEBOUNCED,
                    SyncMode.BATCH,
                ):
                    await sync_queue.enqueue(
                        payload.project_id,
                        updated_node,
                        old_node=old_node,
                    )
                    results = await sync_queue.process_ready(payload.project_id)
                    if not results:
                        delay = (
                            DEFAULT_SYNC_CONFIG.debounce_seconds
                            if DEFAULT_SYNC_CONFIG.graph_sync_mode == SyncMode.DEBOUNCED
                            else DEFAULT_SYNC_CONFIG.batch_timeout_seconds
                        )
                        await asyncio.sleep(delay)
                        results = await sync_queue.process_ready(payload.project_id)
                    if results:
                        await notifier.notify_graph_updated(
                            payload.project_id,
                            {"updates": [result.model_dump() for result in results]},
                        )
                        latest_project = await _load_latest_project()
                        if latest_project:
                            graph_snapshot = load_graph(payload.project_id)
                            conflicts = await conflict_detector.detect_conflicts(
                                project=latest_project,
                                graph=graph_snapshot,
                                modified_node=updated_node,
                            )
                            if conflicts:
                                await notifier.notify_conflict_detected(
                                    payload.project_id,
                                    [conflict.model_dump() for conflict in conflicts],
                                )
            await notifier.notify_sync_progress(
                payload.project_id,
                "completed",
                {"node_id": payload.node.id, "request_id": request_id},
            )
        except Exception as exc:
            await notifier.notify_sync_progress(
                payload.project_id,
                "failed",
                {"error": str(exc), "node_id": payload.node.id, "request_id": request_id},
            )

    conflicts: list = []
    if DEFAULT_SYNC_CONFIG.graph_sync_mode == SyncMode.IMMEDIATE:
        try:
            current_graph = load_graph(payload.project_id)
            sync_result = await index_sync_manager.sync_node_update(
                project_id=payload.project_id,
                old_node=old_node,
                new_node=updated_node,
                current_graph=current_graph,
            )
            save_graph(current_graph)
            await notifier.notify_graph_updated(
                payload.project_id, sync_result.model_dump()
            )
            graph_snapshot = current_graph
            conflicts = await conflict_detector.detect_conflicts(
                project=updated_project,
                graph=graph_snapshot,
                modified_node=updated_node,
            )
            if conflicts:
                await notifier.notify_conflict_detected(
                    payload.project_id,
                    [conflict.model_dump() for conflict in conflicts],
                )
            sync_status = "completed"
            await notifier.notify_sync_progress(
                payload.project_id,
                "completed",
                {"node_id": payload.node.id, "request_id": request_id},
            )
        except Exception as exc:
            sync_result.success = False
            sync_status = "failed"
            await notifier.notify_sync_progress(
                payload.project_id,
                "failed",
                {"error": str(exc), "node_id": payload.node.id, "request_id": request_id},
            )
    else:
        def schedule_background_task() -> None:
            asyncio.create_task(sync_graph_background())

        background_tasks.add_task(schedule_background_task)
    return SyncNodeResponse(
        project=updated_project,
        sync_result=sync_result,
        conflicts=conflicts,
        sync_status=sync_status,
    )


@app.post(
    "/api/insert_node",
    response_model=SyncNodeResponse,
    status_code=status.HTTP_200_OK,
)
async def insert_node(
    payload: InsertNodeRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, payload.project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )

    if any(node.id == payload.node.id for node in project.nodes):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Node id already exists"
        )

    insert_narrative = payload.node.narrative_order
    insert_timeline = payload.node.timeline_order
    shifted_nodes: dict[str, StoryNode] = {}
    for node in project.nodes:
        shifted = False
        if node.narrative_order >= insert_narrative:
            node.narrative_order += 1
            shifted = True
        if node.timeline_order >= insert_timeline:
            node.timeline_order += 1
            shifted = True
        if shifted:
            shifted_nodes[node.id] = node

    request_id = payload.request_id
    await notifier.notify_sync_progress(
        payload.project_id,
        "started",
        {"node_id": payload.node.id, "request_id": request_id},
    )

    project.nodes.append(payload.node)
    project.updated_at = datetime.utcnow()
    updated_project = project
    await update_project(session, updated_project.id, updated_project)

    updated_node = next(
        (node for node in updated_project.nodes if node.id == payload.node.id),
        payload.node,
    )
    await notifier.notify_node_updated(
        payload.project_id,
        updated_node.model_dump(),
        updated_by="user",
    )
    for node in shifted_nodes.values():
        await notifier.notify_node_updated(
            payload.project_id,
            node.model_dump(),
            updated_by="system",
        )

    sync_result = SyncResult(success=True, vector_updated=False, graph_updated=False)
    sync_status = "pending"
    old_node = None

    async def _load_latest_project() -> StoryProject | None:
        async with AsyncSessionLocal() as session:
            return await get_project(session, payload.project_id)

    async def sync_graph_background() -> None:
        nonlocal sync_result
        try:
            async def sync_vector_with_delay(delay: int) -> None:
                await asyncio.sleep(delay)
                await index_sync_manager.node_indexer.index_node(
                    payload.project_id, updated_node
                )
                sync_result.vector_updated = True

            if DEFAULT_SYNC_CONFIG.graph_sync_mode == SyncMode.MANUAL:
                if DEFAULT_SYNC_CONFIG.vector_sync_mode == SyncMode.IMMEDIATE:
                    await index_sync_manager.node_indexer.index_node(
                        payload.project_id, updated_node
                    )
                    sync_result.vector_updated = True
                elif DEFAULT_SYNC_CONFIG.vector_sync_mode in (
                    SyncMode.DEBOUNCED,
                    SyncMode.BATCH,
                ):
                    delay = (
                        DEFAULT_SYNC_CONFIG.debounce_seconds
                        if DEFAULT_SYNC_CONFIG.vector_sync_mode == SyncMode.DEBOUNCED
                        else DEFAULT_SYNC_CONFIG.batch_timeout_seconds
                    )
                    await sync_vector_with_delay(delay)
            else:
                if DEFAULT_SYNC_CONFIG.vector_sync_mode == SyncMode.IMMEDIATE:
                    await index_sync_manager.node_indexer.index_node(
                        payload.project_id, updated_node
                    )
                    sync_result.vector_updated = True
                if DEFAULT_SYNC_CONFIG.graph_sync_mode in (
                    SyncMode.DEBOUNCED,
                    SyncMode.BATCH,
                ):
                    await sync_queue.enqueue(
                        payload.project_id,
                        updated_node,
                        old_node=old_node,
                    )
                    results = await sync_queue.process_ready(payload.project_id)
                    if not results:
                        delay = (
                            DEFAULT_SYNC_CONFIG.debounce_seconds
                            if DEFAULT_SYNC_CONFIG.graph_sync_mode == SyncMode.DEBOUNCED
                            else DEFAULT_SYNC_CONFIG.batch_timeout_seconds
                        )
                        await asyncio.sleep(delay)
                        results = await sync_queue.process_ready(payload.project_id)
                    if results:
                        await notifier.notify_graph_updated(
                            payload.project_id,
                            {"updates": [result.model_dump() for result in results]},
                        )
                        latest_project = await _load_latest_project()
                        if latest_project:
                            graph_snapshot = load_graph(payload.project_id)
                            conflicts = await conflict_detector.detect_conflicts(
                                project=latest_project,
                                graph=graph_snapshot,
                                modified_node=updated_node,
                            )
                            if conflicts:
                                await notifier.notify_conflict_detected(
                                    payload.project_id,
                                    [conflict.model_dump() for conflict in conflicts],
                                )
            await notifier.notify_sync_progress(
                payload.project_id,
                "completed",
                {"node_id": updated_node.id, "request_id": request_id},
            )
        except Exception as exc:
            await notifier.notify_sync_progress(
                payload.project_id,
                "failed",
                {"error": str(exc), "node_id": updated_node.id, "request_id": request_id},
            )

    conflicts: list = []
    if DEFAULT_SYNC_CONFIG.graph_sync_mode == SyncMode.IMMEDIATE:
        try:
            current_graph = load_graph(payload.project_id)
            sync_result = await index_sync_manager.sync_node_update(
                project_id=payload.project_id,
                old_node=old_node,
                new_node=updated_node,
                current_graph=current_graph,
            )
            save_graph(current_graph)
            await notifier.notify_graph_updated(
                payload.project_id, sync_result.model_dump()
            )
            graph_snapshot = current_graph
            conflicts = await conflict_detector.detect_conflicts(
                project=updated_project,
                graph=graph_snapshot,
                modified_node=updated_node,
            )
            if conflicts:
                await notifier.notify_conflict_detected(
                    payload.project_id,
                    [conflict.model_dump() for conflict in conflicts],
                )
            sync_status = "completed"
            await notifier.notify_sync_progress(
                payload.project_id,
                "completed",
                {"node_id": updated_node.id, "request_id": request_id},
            )
        except Exception as exc:
            sync_result.success = False
            sync_status = "failed"
            await notifier.notify_sync_progress(
                payload.project_id,
                "failed",
                {"error": str(exc), "node_id": updated_node.id, "request_id": request_id},
            )
    else:
        def schedule_background_task() -> None:
            asyncio.create_task(sync_graph_background())

        background_tasks.add_task(schedule_background_task)

    return SyncNodeResponse(
        project=updated_project,
        sync_result=sync_result,
        conflicts=conflicts,
        sync_status=sync_status,
    )


@app.post(
    "/api/projects/{project_id}/graph/sync",
    response_model=GraphSyncResponse,
    status_code=status.HTTP_200_OK,
)
async def sync_graph_manual(
    project_id: str,
    payload: GraphSyncRequest,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )

    prompt_override = project.prompt_overrides.extraction
    prompt_template = (
        PromptTemplate.from_template(prompt_override)
        if prompt_override
        else None
    )
    extractor = GraphExtractor(prompt_template=prompt_template)
    node_indexer = NodeIndexer()

    if payload.mode == "full":
        await node_indexer.clear_project(project_id)
        indexed = await node_indexer.index_project(project)
        updated_graph = await extractor.build_full_graph(project)
        save_graph(updated_graph)
        sync_result = SyncResult(
            success=True,
            vector_updated=indexed > 0,
            graph_updated=True,
            new_entities=updated_graph.entities,
            new_relations=updated_graph.relations,
        )
    elif payload.mode == "node":
        if not payload.node_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Missing node_id for node sync",
            )
        node = next(
            (item for item in project.nodes if item.id == payload.node_id),
            None,
        )
        if node is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Node not found"
            )
        current_graph = load_graph(project_id)
        temp_sync_manager = IndexSyncManager(
            node_indexer=node_indexer,
            graph_extractor=extractor,
            knowledge_manager=world_knowledge_manager,
        )
        sync_result = await temp_sync_manager.sync_node_create(
            project_id=project_id,
            new_node=node,
            current_graph=current_graph,
        )
        save_graph(current_graph)
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid sync mode"
        )

    if sync_result.graph_updated:
        await notifier.notify_graph_updated(project_id, sync_result.model_dump())

    return GraphSyncResponse(sync_result=sync_result, sync_status="completed")


@app.post("/api/outline_analysis_stream")
async def outline_analysis_stream(
    payload: OutlineAnalysisRequest,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, payload.project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )

    api_key = get_api_key("sync")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OPENAI_API_KEY is not configured",
        )

    graph = load_graph(payload.project_id)
    modified_node = (
        project.nodes[0]
        if project.nodes
        else StoryNode(
            title="占位",
            content="",
            narrative_order=1,
            timeline_order=1.0,
            location_tag="未标记",
            characters=[],
        )
    )
    conflicts = await conflict_detector.detect_conflicts(
        project=project,
        graph=graph,
        modified_node=modified_node,
    )

    scope = _choose_analysis_scope(project)
    outline_text = _format_outline(project) if scope == "full" else "已启用检索摘要。"
    conflicts_text = _format_conflicts(conflicts)
    conversation_text = _format_conversation(
        [message.model_dump() for message in payload.messages]
    )
    user_query = ""
    for message in reversed(payload.messages):
        if message.role == "user":
            user_query = message.content
            break
    if not user_query:
        user_query = "大纲一致性分析"
    history_hits = await search_history(
        project_id=payload.project_id,
        query=user_query,
        top_k=6,
    )
    history_text = _format_history_snippets(history_hits)
    retrieval_text = "无"
    if scope == "retrieval":
        retriever = GraphRetriever(
            knowledge_graph=graph,
            node_indexer=NodeIndexer(),
            world_knowledge=world_knowledge_manager,
        )
        retrieval_context = await retriever.retrieve_context(
            query=user_query,
            project_id=payload.project_id,
            max_tokens=3200,
        )
        retrieval_text = retrieval_context.to_prompt_text()
    prompt_override = project.prompt_overrides.analysis if project.prompt_overrides else None
    prompt_template = (
        PromptTemplate.from_template(prompt_override)
        if prompt_override
        else PromptTemplate.from_template(ANALYSIS_PROMPT_TEMPLATE)
    )
    try:
        prompt_text = prompt_template.format(
            outline=outline_text,
            retrieval_context=retrieval_text,
            conflicts=conflicts_text,
            history=history_text,
            conversation=conversation_text,
        )
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="自定义 Prompt 缺少必要变量：outline、retrieval_context、conflicts、history、conversation",
        ) from exc

    model_name = get_model_name("sync")
    llm = ChatOpenAI(
        api_key=api_key,
        base_url=get_base_url(),
        model=model_name,
        streaming=True,
    )

    async def event_stream():
        yield "event: start\ndata: {}\n\n"
        try:
            async for chunk in llm.astream(prompt_text):
                content = getattr(chunk, "content", None)
                if content is None and hasattr(chunk, "message"):
                    content = chunk.message.content
                if not content:
                    continue
                for line in content.split("\n"):
                    yield f"data: {line}\n"
                yield "\n"
        except Exception as exc:
            yield f"event: error\ndata: {str(exc)}\n\n"
        finally:
            yield "event: done\ndata: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/writing_assistant")
async def writing_assistant(
    payload: WritingAssistantRequest,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, payload.project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )

    # Resolve configuration
    # Priority: Project Writer Config -> Global Default Key -> Error
    
    config = project.writer_config
    
    api_key = config.api_key or get_api_key("default") or get_api_key("drafting")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No API Key configured. Please set it in Writing Settings.",
        )
    
    base_url = config.base_url or get_base_url()
    model = config.model or "gpt-4o"
    system_prompt = config.prompt or "You are a professional novel editor. Polish the text to be more immersive and vivid."

    llm = ChatOpenAI(
        api_key=api_key,
        base_url=base_url,
        model=model,
        streaming=True,
    )
    
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"{payload.instruction}\n\n[Text Start]\n{payload.text}\n[Text End]"}
    ]

    async def event_stream():
        yield "event: start\ndata: {}\n\n"
        try:
            async for chunk in llm.astream(messages):
                content = getattr(chunk, "content", None)
                if content is None and hasattr(chunk, "message"):
                    content = chunk.message.content
                if not content:
                    continue
                for line in content.split("\n"):
                    yield f"data: {line}\n"
                yield "\n"
        except Exception as exc:
            yield f"event: error\ndata: {str(exc)}\n\n"
        finally:
            yield "event: done\ndata: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get(
    "/api/analysis_history/{project_id}",
    response_model=AnalysisHistoryResponse,
    status_code=status.HTTP_200_OK,
)
async def get_analysis_history(project_id: str):
    messages = load_history(project_id)
    return AnalysisHistoryResponse(messages=messages)


@app.post(
    "/api/analysis_history/save",
    response_model=AnalysisHistoryResponse,
    status_code=status.HTTP_200_OK,
)
async def save_analysis_history(payload: AnalysisHistoryRequest):
    stored = append_messages(
        payload.project_id,
        [message.model_dump() for message in payload.messages],
    )
    if stored:
        await add_documents(
            collection_name="analysis_history",
            documents=[f"{item['role']}: {item['content']}" for item in stored],
            metadatas=[
                {
                    "project_id": payload.project_id,
                    "role": item["role"],
                    "created_at": item["created_at"],
                    "source": "outline_analysis",
                }
                for item in stored
            ],
            ids=[item["id"] for item in stored],
        )
    return AnalysisHistoryResponse(messages=stored)


@app.get(
    "/api/projects",
    response_model=list[ProjectSummary],
    status_code=status.HTTP_200_OK,
)
async def list_project_records(
    session: AsyncSession = Depends(get_session),
):
    return await list_projects(session)


@app.get(
    "/api/projects/{project_id}",
    response_model=StoryProject,
    status_code=status.HTTP_200_OK,
)
async def get_project_record(
    project_id: str,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    return project


@app.get(
    "/api/projects/{project_id}/export",
    response_model=ProjectExportData,
    status_code=status.HTTP_200_OK,
)
async def export_project_data(
    project_id: str,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    graph = load_graph(project_id)
    world_documents = await world_knowledge_manager.list_project_documents(project_id)
    snapshot_records = await version_manager.list_versions(project_id)
    snapshots = []
    for record in snapshot_records:
        try:
            snapshot = await version_manager.load_snapshot(project_id, record["version"])
            snapshots.append(snapshot.model_dump(mode="json"))
        except Exception:
            continue
    return ProjectExportData(
        project=project,
        knowledge_graph=graph,
        world_documents=world_documents,
        snapshots=snapshots,
    )


@app.put(
    "/api/projects/{project_id}",
    response_model=StoryProject,
    status_code=status.HTTP_200_OK,
)
async def update_project_record(
    project_id: str,
    payload: ProjectUpdateRequest,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    if payload.title is not None:
        title = payload.title.strip()
        if not title:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Title cannot be empty"
            )
        project.title = title
    if payload.analysis_profile is not None:
        project.analysis_profile = payload.analysis_profile
    if payload.prompt_overrides is not None:
        for field_name in payload.prompt_overrides.model_fields_set:
            setattr(
                project.prompt_overrides,
                field_name,
                getattr(payload.prompt_overrides, field_name),
            )
    if payload.writer_config is not None:
        project.writer_config = payload.writer_config
    project.updated_at = datetime.utcnow()
    await update_project(session, project_id, project)
    return project


@app.post(
    "/api/projects/{project_id}/chapters",
    response_model=StoryProject,
    status_code=status.HTTP_201_CREATED,
)
async def create_project_chapter(
    project_id: str,
    payload: ChapterCreateRequest,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )

    title = (payload.title or "").strip() or "未命名章节"
    max_order = max((chapter.order for chapter in project.chapters), default=0)
    new_chapter = StoryChapter(title=title, content="", order=max_order + 1)
    project.chapters.append(new_chapter)
    project.updated_at = datetime.utcnow()
    await update_project(session, project_id, project)
    return project


@app.put(
    "/api/projects/{project_id}/chapters/{chapter_id}",
    response_model=StoryProject,
    status_code=status.HTTP_200_OK,
)
async def update_project_chapter(
    project_id: str,
    chapter_id: str,
    payload: ChapterUpdateRequest,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )

    chapter = next((item for item in project.chapters if item.id == chapter_id), None)
    if chapter is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Chapter not found"
        )

    if payload.title is not None:
        title = payload.title.strip()
        if not title:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Chapter title cannot be empty"
            )
        chapter.title = title
    if payload.content is not None:
        chapter.content = payload.content
    if payload.order is not None:
        if payload.order < 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Chapter order must be >= 1"
            )
        chapter.order = payload.order
        project.chapters.sort(key=lambda item: item.order)
        for index, item in enumerate(project.chapters, start=1):
            item.order = index

    project.updated_at = datetime.utcnow()
    await update_project(session, project_id, project)
    return project


@app.delete(
    "/api/projects/{project_id}/chapters/{chapter_id}",
    response_model=StoryProject,
    status_code=status.HTTP_200_OK,
)
async def delete_project_chapter(
    project_id: str,
    chapter_id: str,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )

    remaining = [item for item in project.chapters if item.id != chapter_id]
    if len(remaining) == len(project.chapters):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Chapter not found"
        )

    project.chapters = remaining
    project.chapters.sort(key=lambda item: item.order)
    for index, item in enumerate(project.chapters, start=1):
        item.order = index

    project.updated_at = datetime.utcnow()
    await update_project(session, project_id, project)
    return project


@app.post(
    "/api/projects/{project_id}/nodes/reorder",
    response_model=StoryProject,
    status_code=status.HTTP_200_OK,
)
async def reorder_project_nodes(
    project_id: str,
    payload: ReorderNodesRequest,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    
    node_map = {node.id: node for node in project.nodes}
    if len(payload.node_ids) != len(project.nodes):
         # If the list length doesn't match, we only reorder the subset provided? 
         # Or strictly require full list? 
         # Strict is safer to avoid accidents, but let's allow partial reorder if needed?
         # No, for drag and drop it's usually safer to expect the full list of IDs in the current view.
         # But maybe the view is filtered. 
         # Let's assume the client sends the list of IDs it knows about, and we update those.
         pass

    # Validate IDs
    for nid in payload.node_ids:
        if nid not in node_map:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, 
                detail=f"Node {nid} not found in project"
            )

    # Update narrative_order
    # We assign order starting from 1 for the first ID in the list.
    # What about nodes NOT in the list? They might conflict.
    # Strategy:
    # 1. We update the nodes in the list to have order 1..N
    # 2. Nodes not in the list (if any) are appended after N? Or kept as is?
    # Better to assume this is a "reorder all" operation for simplicity.
    
    current_max_order = len(payload.node_ids)
    
    # Create a set for fast lookup
    reordered_ids = set(payload.node_ids)
    
    # Update reordered nodes
    for index, nid in enumerate(payload.node_ids):
        node = node_map[nid]
        node.narrative_order = index + 1
        
    # Handle remaining nodes (if any)
    # We push them after the reordered ones to avoid duplicates
    remaining_nodes = [n for n in project.nodes if n.id not in reordered_ids]
    remaining_nodes.sort(key=lambda x: x.narrative_order)
    
    for i, node in enumerate(remaining_nodes):
        node.narrative_order = current_max_order + i + 1

    project.updated_at = datetime.utcnow()
    await update_project(session, project_id, project)
    
    # Also notify via websocket if needed? 
    # For now, just return the project.
    return project


@app.post(
    "/api/projects/import",
    response_model=StoryProject,
    status_code=status.HTTP_200_OK,
)
async def import_project_data(
    payload: ProjectExportData,
    session: AsyncSession = Depends(get_session),
):
    project = payload.project
    existing = await get_project(session, project.id)
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Project already exists",
        )
    await create_project(session, project)
    save_graph(payload.knowledge_graph)
    await world_knowledge_manager.replace_project_documents(
        project.id, payload.world_documents
    )
    snapshots = []
    for item in payload.snapshots:
        try:
            snapshots.append(IndexSnapshot.model_validate(item))
        except Exception:
            continue
    if snapshots:
        await version_manager.import_snapshots(snapshots)
    node_indexer = NodeIndexer()
    await node_indexer.clear_project(project.id)
    await node_indexer.index_project(project)
    return project


@app.delete(
    "/api/projects/{project_id}",
    status_code=status.HTTP_200_OK,
)
async def delete_project_record(
    project_id: str,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, project_id)
    deleted = await delete_project(session, project_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    if project:
        node_indexer = NodeIndexer()
        await node_indexer.clear_project(project_id)
        logger.info("Deleted project %s nodes from vector index", project_id)
        await world_knowledge_manager.delete_project_data(project_id)
        logger.info("Deleted project %s world knowledge data", project_id)
        delete_graph(project_id)
        logger.info("Deleted project %s knowledge graph data", project_id)
        await version_manager.delete_project_data(project_id)
        logger.info("Deleted project %s version snapshots", project_id)
    return {"deleted": True}


@app.post(
    "/api/projects/{project_id}/knowledge",
    response_model=WorldDocument,
    status_code=status.HTTP_200_OK,
)
async def create_world_document(
    project_id: str,
    payload: KnowledgeDocumentRequest,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    return await world_knowledge_manager.add_document(
        project_id=project_id,
        title=payload.title,
        category=payload.category,
        content=payload.content,
    )


@app.get(
    "/api/projects/{project_id}/knowledge",
    response_model=WorldKnowledgeBase,
    status_code=status.HTTP_200_OK,
)
async def get_world_knowledge_base(
    project_id: str,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    return await world_knowledge_manager.get_knowledge_base(project_id)


@app.get(
    "/api/projects/{project_id}/knowledge/{doc_id}",
    response_model=WorldDocument,
    status_code=status.HTTP_200_OK,
)
async def get_world_document(
    project_id: str,
    doc_id: str,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    document = await world_knowledge_manager.get_document(project_id, doc_id)
    if document is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Document not found"
        )
    return document


@app.put(
    "/api/projects/{project_id}/knowledge/{doc_id}",
    response_model=WorldDocument,
    status_code=status.HTTP_200_OK,
)
async def update_world_document(
    project_id: str,
    doc_id: str,
    payload: KnowledgeUpdateRequest,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    try:
        return await world_knowledge_manager.update_document_in_project(
            project_id=project_id,
            doc_id=doc_id,
            content=payload.content,
        )
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Document not found"
        )


@app.delete(
    "/api/projects/{project_id}/knowledge/{doc_id}",
    status_code=status.HTTP_200_OK,
)
async def delete_world_document(
    project_id: str,
    doc_id: str,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    await world_knowledge_manager.delete_document_in_project(project_id, doc_id)
    return {"deleted": True}


@app.post(
    "/api/projects/{project_id}/knowledge/import",
    response_model=list[WorldDocument],
    status_code=status.HTTP_200_OK,
)
async def import_world_knowledge(
    project_id: str,
    payload: KnowledgeImportRequest,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    return await world_knowledge_manager.import_from_markdown(
        project_id=project_id,
        markdown_content=payload.markdown_content,
    )


@app.post(
    "/api/projects/{project_id}/knowledge/search",
    response_model=list[SearchResult],
    status_code=status.HTTP_200_OK,
)
async def search_world_knowledge(
    project_id: str,
    payload: KnowledgeSearchRequest,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    return await world_knowledge_manager.search_knowledge(
        project_id=project_id,
        query=payload.query,
        categories=payload.categories,
        top_k=payload.top_k or 10,
    )


@app.post(
    "/api/projects/{project_id}/knowledge/upload",
    response_model=list[WorldDocument],
    status_code=status.HTTP_200_OK,
)
async def upload_world_knowledge(
    project_id: str,
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )

    filename = file.filename or ""
    if not (filename.endswith(".md") or filename.endswith(".txt")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported file type"
        )

    raw = await file.read()
    try:
        content = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported file encoding (expected UTF-8)",
        )
    if filename.endswith(".md"):
        documents = await world_knowledge_manager.import_from_markdown(
            project_id=project_id,
            markdown_content=content,
        )
    else:
        title = Path(filename).stem or "未命名世界观"
        document = await world_knowledge_manager.add_document(
            project_id=project_id,
            title=title,
            category="general",
            content=content,
        )
        documents = [document]
    return documents


@app.get(
    "/api/projects/{project_id}/stats",
    response_model=ProjectStatsResponse,
    status_code=status.HTTP_200_OK,
)
async def get_project_stats(
    project_id: str,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    knowledge_base = await world_knowledge_manager.get_knowledge_base(project_id)
    graph_snapshot = load_graph(project_id)
    total_words = sum(_count_words(doc.content) for doc in knowledge_base.documents)
    return ProjectStatsResponse(
        total_nodes=len(project.nodes),
        total_characters=len(project.characters),
        total_knowledge_docs=len(knowledge_base.documents),
        total_words=total_words,
        graph_entities=len(graph_snapshot.entities),
        graph_relations=len(graph_snapshot.relations),
    )


@app.get(
    "/api/projects/{project_id}/versions",
    response_model=list[dict],
    status_code=status.HTTP_200_OK,
)
async def list_project_versions(
    project_id: str,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return await version_manager.list_versions(project_id)


@app.get(
    "/api/projects/{project_id}/versions/{version}",
    response_model=IndexSnapshot,
    status_code=status.HTTP_200_OK,
)
async def get_project_version(
    project_id: str,
    version: int,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    try:
        snapshot = await version_manager.load_snapshot(project_id, version)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Snapshot not found")
    return snapshot


@app.get(
    "/api/projects/{project_id}/versions/{from_ver}/diff/{to_ver}",
    response_model=VersionDiff,
    status_code=status.HTTP_200_OK,
)
async def compare_project_versions(
    project_id: str,
    from_ver: int,
    to_ver: int,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return await version_manager.compare_versions(project_id, from_ver, to_ver)


@app.post(
    "/api/projects/{project_id}/versions",
    response_model=IndexSnapshot,
    status_code=status.HTTP_200_OK,
)
async def create_project_version(
    project_id: str,
    payload: VersionCreateRequest,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if payload.type and payload.type != SnapshotType.MANUAL.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only manual snapshots are supported",
        )
    snapshot_type = SnapshotType.MANUAL
    graph = load_graph(project_id)
    return await version_manager.create_snapshot(
        project=project,
        graph=graph,
        snapshot_type=snapshot_type,
        name=payload.name,
        description=payload.description,
    )


@app.post(
    "/api/projects/{project_id}/versions/{version}/restore",
    response_model=StoryProject,
    status_code=status.HTTP_200_OK,
)
async def restore_project_version(
    project_id: str,
    version: int,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    try:
        restored_project, restored_graph, restored_docs = await version_manager.restore_snapshot(
            project_id, version
        )
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Snapshot not found")
    await update_project(session, restored_project.id, restored_project)
    save_graph(restored_graph)
    node_indexer = NodeIndexer()
    await node_indexer.clear_project(project_id)
    await node_indexer.index_project(restored_project)
    await world_knowledge_manager.replace_project_documents(project_id, restored_docs)
    return restored_project


@app.delete(
    "/api/projects/{project_id}/versions/{version}",
    status_code=status.HTTP_200_OK,
)
async def delete_project_version(
    project_id: str,
    version: int,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    try:
        await version_manager.delete_version(project_id, version)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Snapshot not found")
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return {"deleted": True}


@app.put(
    "/api/projects/{project_id}/versions/{version}",
    response_model=IndexSnapshot,
    status_code=status.HTTP_200_OK,
)
async def update_project_version(
    project_id: str,
    version: int,
    payload: VersionUpdateRequest,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    snapshot_type = SnapshotType.MILESTONE if payload.promote_to_milestone else None
    try:
        snapshot = await version_manager.update_version_metadata(
            project_id=project_id,
            version=version,
            name=payload.name,
            snapshot_type=snapshot_type,
            description=payload.description,
        )
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Snapshot not found")
    return snapshot


@app.websocket("/ws/{project_id}")
async def websocket_endpoint(websocket: WebSocket, project_id: str):
    await ws_manager.connect(project_id, websocket)

    async def heartbeat() -> None:
        while True:
            await asyncio.sleep(30)
            try:
                await websocket.send_json({"type": WSMessageType.PING.value, "payload": {}})
            except Exception:
                break

    heartbeat_task = asyncio.create_task(heartbeat())

    try:
        while True:
            data = await websocket.receive_json()
            message_type = data.get("type")
            if message_type == WSMessageType.PONG.value:
                continue
            if message_type == WSMessageType.PING.value:
                await websocket.send_json({"type": WSMessageType.PONG.value, "payload": {}})
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        heartbeat_task.cancel()
        ws_manager.disconnect(project_id, websocket)


@app.put(
    "/api/projects/{project_id}/graph/entities/{entity_id}",
    response_model=dict,
    status_code=status.HTTP_200_OK,
)
async def update_graph_entity(
    project_id: str,
    entity_id: str,
    payload: dict,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    graph = load_graph(project_id)
    editor = GraphEditor(graph)
    try:
        entity = await editor.update_entity(entity_id, payload)
    except ValueError as exc:
        detail = str(exc) or "Invalid entity update"
        status_code = (
            status.HTTP_404_NOT_FOUND
            if detail == "Entity not found"
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(status_code=status_code, detail=detail)
    save_graph(graph)
    return entity.model_dump()


@app.post(
    "/api/projects/{project_id}/graph/entities",
    response_model=dict,
    status_code=status.HTTP_200_OK,
)
async def create_graph_entity(
    project_id: str,
    payload: dict,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    graph = load_graph(project_id)
    editor = GraphEditor(graph)
    try:
        entity = await editor.create_entity(payload)
    except ValueError as exc:
        detail = str(exc) or "Invalid entity create"
        status_code = (
            status.HTTP_400_BAD_REQUEST
            if detail != "Entity not found"
            else status.HTTP_404_NOT_FOUND
        )
        raise HTTPException(status_code=status_code, detail=detail)
    save_graph(graph)
    return entity.model_dump()


@app.delete(
    "/api/projects/{project_id}/graph/entities/{entity_id}",
    response_model=dict,
    status_code=status.HTTP_200_OK,
)
async def delete_graph_entity(
    project_id: str,
    entity_id: str,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    graph = load_graph(project_id)
    editor = GraphEditor(graph)
    try:
        stats = await editor.delete_entity(entity_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found"
        )
    save_graph(graph)
    return stats


@app.post(
    "/api/projects/{project_id}/graph/entities/{entity_id}/merge",
    response_model=dict,
    status_code=status.HTTP_200_OK,
)
async def merge_graph_entities(
    project_id: str,
    entity_id: str,
    payload: dict,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    target_id = payload.get("into_id")
    if not target_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing into_id",
        )
    graph = load_graph(project_id)
    editor = GraphEditor(graph)
    try:
        entity = await editor.merge_entities(entity_id, target_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        )
    save_graph(graph)
    return entity.model_dump()


@app.get(
    "/api/health",
    response_model=HealthResponse,
    status_code=status.HTTP_200_OK,
)
def health():
    return {"status": "ok", "version": "0.1.0"}


@app.get(
    "/api/models",
    response_model=ModelConfigResponse,
    status_code=status.HTTP_200_OK,
)
def get_model_config():
    return ModelConfigResponse(
        base_url=get_base_url(),
        drafting_model=get_model_name("drafting"),
        sync_model=get_model_name("sync"),
        extraction_model=get_model_name("extraction"),
        has_default_key=bool(get_api_key("default")),
        has_drafting_key=bool(get_api_key("drafting")),
        has_sync_key=bool(get_api_key("sync")),
        has_extraction_key=bool(get_api_key("extraction")),
    )


@app.post(
    "/api/models",
    response_model=ModelConfigResponse,
    status_code=status.HTTP_200_OK,
)
def update_model_config(payload: ModelConfigUpdateRequest):
    if payload.base_url is not None:
        set_base_url_override(payload.base_url)
    if payload.default_api_key is not None:
        set_api_key_override("default", payload.default_api_key)
    if payload.drafting_api_key is not None:
        set_api_key_override("drafting", payload.drafting_api_key)
    if payload.sync_api_key is not None:
        set_api_key_override("sync", payload.sync_api_key)
    if payload.extraction_api_key is not None:
        set_api_key_override("extraction", payload.extraction_api_key)
    if payload.drafting_model is not None:
        set_model_override("drafting", payload.drafting_model)
    if payload.sync_model is not None:
        set_model_override("sync", payload.sync_model)
    if payload.extraction_model is not None:
        set_model_override("extraction", payload.extraction_model)
    return ModelConfigResponse(
        base_url=get_base_url(),
        drafting_model=get_model_name("drafting"),
        sync_model=get_model_name("sync"),
        extraction_model=get_model_name("extraction"),
        has_default_key=bool(get_api_key("default")),
        has_drafting_key=bool(get_api_key("drafting")),
        has_sync_key=bool(get_api_key("sync")),
        has_extraction_key=bool(get_api_key("extraction")),
    )


@app.put(
    "/api/projects/{project_id}/graph/relations/{relation_id}",
    response_model=dict,
    status_code=status.HTTP_200_OK,
)
async def update_graph_relation(
    project_id: str,
    relation_id: str,
    payload: dict,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    graph = load_graph(project_id)
    editor = GraphEditor(graph)
    try:
        relation = editor.update_relation(relation_id, payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        )
    save_graph(graph)
    return relation.model_dump()


@app.post(
    "/api/projects/{project_id}/graph/relations",
    response_model=dict,
    status_code=status.HTTP_200_OK,
)
async def create_graph_relation(
    project_id: str,
    payload: dict,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    graph = load_graph(project_id)
    editor = GraphEditor(graph)
    try:
        relation = editor.create_relation(payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        )
    save_graph(graph)
    return relation.model_dump()


@app.delete(
    "/api/projects/{project_id}/graph/relations/{relation_id}",
    response_model=dict,
    status_code=status.HTTP_200_OK,
)
async def delete_graph_relation(
    project_id: str,
    relation_id: str,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project(session, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    graph = load_graph(project_id)
    editor = GraphEditor(graph)
    try:
        result = editor.delete_relation(relation_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        )
    save_graph(graph)
    return result


@app.get(
    "/api/character_graph",
    response_model=CharacterGraphResponse,
    status_code=status.HTTP_200_OK,
)
async def get_character_graph(
    project_id: str | None = None,
    session: AsyncSession = Depends(get_session),
):
    if not project_id:
        return CharacterGraphResponse()

    project = await get_project(session, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )

    graph = load_graph(project_id)
    node_map = {node.id: node for node in project.nodes}
    character_entities = [
        entity for entity in graph.entities if entity.type == EntityType.CHARACTER
    ]
    character_ids = {entity.id for entity in character_entities}

    def _extract_appearance_ids(entity) -> set[str]:
        appearances: set[str] = set()
        props = entity.properties or {}
        if isinstance(props, dict):
            raw = props.get("appearances")
            if isinstance(raw, list):
                for item in raw:
                    if isinstance(item, str):
                        appearances.add(item)
                    elif isinstance(item, dict):
                        node_id = item.get("node_id")
                        if isinstance(node_id, str):
                            appearances.add(node_id)
        for ref in entity.source_refs:
            appearances.add(ref)
        for node in project.nodes:
            if entity.id in node.characters:
                appearances.add(node.id)
        return appearances

    nodes: list[CharacterGraphNode] = []
    for entity in character_entities:
        appearance_ids = _extract_appearance_ids(entity)
        appearances = []
        for node_id in appearance_ids:
            node = node_map.get(node_id)
            if not node:
                continue
            appearances.append(
                CharacterAppearance(
                    node_id=node.id,
                    node_title=node.title,
                    narrative_order=node.narrative_order,
                    timeline_order=node.timeline_order,
                )
            )
        appearances.sort(
            key=lambda item: (item.narrative_order, item.timeline_order or 0)
        )
        nodes.append(
            CharacterGraphNode(
                id=entity.id,
                name=entity.name,
                type=entity.type.value
                if hasattr(entity.type, "value")
                else str(entity.type),
                description=entity.description,
                aliases=entity.aliases,
                properties=entity.properties or {},
                source_refs=entity.source_refs,
                appearances=appearances,
            )
        )

    links = [
        CharacterGraphLink(
            id=relation.id,
            source=relation.source_id,
            target=relation.target_id,
            relation_type=relation.relation_type.value
            if hasattr(relation.relation_type, "value")
            else str(relation.relation_type),
            relation_name=relation.relation_name,
            description=relation.description,
        )
        for relation in graph.relations
        if relation.source_id in character_ids
        and relation.target_id in character_ids
    ]
    return CharacterGraphResponse(nodes=nodes, links=links)
