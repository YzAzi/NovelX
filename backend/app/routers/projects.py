import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..crud import (
    create_project,
    delete_project,
    get_project,
    list_projects,
    project_id_exists,
    update_project,
)
from ..database import get_session
from ..helpers import count_words, get_project_or_404
from ..knowledge_graph import delete_graph, load_graph, save_graph
from ..models import (
    ChapterCreateRequest,
    ChapterUpdateRequest,
    CreateEmptyProjectRequest,
    ProjectExportData,
    ProjectStatsResponse,
    ProjectSummary,
    ProjectUpdateRequest,
    ReorderNodesRequest,
    StoryChapter,
    StoryProject,
)
from ..node_indexer import NodeIndexer
from ..runtime import style_knowledge_manager, version_manager
from ..services.chapter_memory import summarize_chapter
from ..versioning import IndexSnapshot

router = APIRouter(tags=["projects"])
logger = logging.getLogger(__name__)


@router.post(
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
        base_project = await get_project_or_404(session, payload.base_project_id)

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


@router.get(
    "/api/projects",
    response_model=list[ProjectSummary],
    status_code=status.HTTP_200_OK,
)
async def list_project_records(
    session: AsyncSession = Depends(get_session),
):
    return await list_projects(session)


@router.get(
    "/api/projects/{project_id}",
    response_model=StoryProject,
    status_code=status.HTTP_200_OK,
)
async def get_project_record(
    project_id: str,
    session: AsyncSession = Depends(get_session),
):
    return await get_project_or_404(session, project_id)


@router.get(
    "/api/projects/{project_id}/export",
    response_model=ProjectExportData,
    status_code=status.HTTP_200_OK,
)
async def export_project_data(
    project_id: str,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project_or_404(session, project_id)
    graph = load_graph(project_id)
    style_documents = await style_knowledge_manager.list_project_documents(project_id)
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
        style_documents=style_documents,
        snapshots=snapshots,
    )


@router.put(
    "/api/projects/{project_id}",
    response_model=StoryProject,
    status_code=status.HTTP_200_OK,
)
async def update_project_record(
    project_id: str,
    payload: ProjectUpdateRequest,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project_or_404(session, project_id)
    if payload.title is not None:
        title = payload.title.strip()
        if not title:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Title cannot be empty",
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


@router.post(
    "/api/projects/{project_id}/chapters",
    response_model=StoryProject,
    status_code=status.HTTP_201_CREATED,
)
async def create_project_chapter(
    project_id: str,
    payload: ChapterCreateRequest,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project_or_404(session, project_id)
    title = (payload.title or "").strip() or "未命名章节"
    max_order = max((chapter.order for chapter in project.chapters), default=0)
    new_chapter = StoryChapter(title=title, content="", order=max_order + 1, summary="")
    project.chapters.append(new_chapter)
    project.updated_at = datetime.utcnow()
    await update_project(session, project_id, project)
    return project


@router.put(
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
    project = await get_project_or_404(session, project_id)

    chapter = next((item for item in project.chapters if item.id == chapter_id), None)
    if chapter is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chapter not found",
        )

    if payload.title is not None:
        title = payload.title.strip()
        if not title:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Chapter title cannot be empty",
            )
        chapter.title = title
    if payload.content is not None:
        chapter.content = payload.content
    if payload.title is not None or payload.content is not None:
        chapter.summary = await summarize_chapter(chapter.title, chapter.content)
    if payload.order is not None:
        if payload.order < 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Chapter order must be >= 1",
            )
        chapter.order = payload.order
        project.chapters.sort(key=lambda item: item.order)
        for index, item in enumerate(project.chapters, start=1):
            item.order = index

    project.updated_at = datetime.utcnow()
    await update_project(session, project_id, project)
    return project


@router.delete(
    "/api/projects/{project_id}/chapters/{chapter_id}",
    response_model=StoryProject,
    status_code=status.HTTP_200_OK,
)
async def delete_project_chapter(
    project_id: str,
    chapter_id: str,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project_or_404(session, project_id)
    remaining = [item for item in project.chapters if item.id != chapter_id]
    if len(remaining) == len(project.chapters):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chapter not found",
        )

    project.chapters = remaining
    project.chapters.sort(key=lambda item: item.order)
    for index, item in enumerate(project.chapters, start=1):
        item.order = index

    project.updated_at = datetime.utcnow()
    await update_project(session, project_id, project)
    return project


@router.post(
    "/api/projects/{project_id}/nodes/reorder",
    response_model=StoryProject,
    status_code=status.HTTP_200_OK,
)
async def reorder_project_nodes(
    project_id: str,
    payload: ReorderNodesRequest,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project_or_404(session, project_id)
    node_map = {node.id: node for node in project.nodes}
    for node_id in payload.node_ids:
        if node_id not in node_map:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Node {node_id} not found in project",
            )

    current_max_order = len(payload.node_ids)
    reordered_ids = set(payload.node_ids)
    for index, node_id in enumerate(payload.node_ids):
        node_map[node_id].narrative_order = index + 1

    remaining_nodes = [node for node in project.nodes if node.id not in reordered_ids]
    remaining_nodes.sort(key=lambda item: item.narrative_order)
    for index, node in enumerate(remaining_nodes):
        node.narrative_order = current_max_order + index + 1

    project.updated_at = datetime.utcnow()
    await update_project(session, project_id, project)
    return project


@router.post(
    "/api/projects/import",
    response_model=StoryProject,
    status_code=status.HTTP_200_OK,
)
async def import_project_data(
    payload: ProjectExportData,
    session: AsyncSession = Depends(get_session),
):
    project = payload.project
    if await project_id_exists(session, project.id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Project ID already exists",
        )
    await create_project(session, project)
    save_graph(payload.knowledge_graph)
    await style_knowledge_manager.replace_project_documents(
        project.id,
        payload.style_documents,
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


@router.delete(
    "/api/projects/{project_id}",
    status_code=status.HTTP_200_OK,
)
async def delete_project_record(
    project_id: str,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project_or_404(session, project_id)
    deleted = await delete_project(session, project_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )
    node_indexer = NodeIndexer()
    await node_indexer.clear_project(project_id)
    logger.info("Deleted project %s nodes from vector index", project_id)
    await style_knowledge_manager.delete_project_data(project_id)
    logger.info("Deleted project %s style knowledge data", project_id)
    delete_graph(project_id)
    logger.info("Deleted project %s knowledge graph data", project_id)
    from ..analysis_history import delete_history

    await delete_history(project_id)
    logger.info("Deleted project %s analysis history data", project_id)
    await version_manager.delete_project_data(project_id)
    logger.info("Deleted project %s version snapshots", project_id)
    return {"deleted": True}


@router.get(
    "/api/projects/{project_id}/stats",
    response_model=ProjectStatsResponse,
    status_code=status.HTTP_200_OK,
)
async def get_project_stats(
    project_id: str,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project_or_404(session, project_id)
    knowledge_base = await style_knowledge_manager.get_knowledge_base(project_id)
    graph_snapshot = load_graph(project_id)
    total_words = sum(count_words(doc.content) for doc in knowledge_base.documents)
    return ProjectStatsResponse(
        total_nodes=len(project.nodes),
        total_characters=len(project.characters),
        total_style_docs=len(knowledge_base.documents),
        total_words=total_words,
        graph_entities=len(graph_snapshot.entities),
        graph_relations=len(graph_snapshot.relations),
    )
