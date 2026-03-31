from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..crud import update_project
from ..database import get_session
from ..graph_editor import GraphEditor
from ..graph_extractor import GraphExtractor
from ..helpers import (
    build_character_graph_response,
    get_project_or_404,
    remap_project_node_characters,
    sync_project_characters_from_graph,
)
from ..index_sync import IndexSyncManager, SyncResult
from ..knowledge_graph import load_graph, save_graph
from ..models import CharacterGraphResponse
from ..node_indexer import NodeIndexer
from ..runtime import notifier
from langchain.prompts import PromptTemplate


router = APIRouter(tags=["graph"])


class GraphSyncRequest(BaseModel):
    mode: Literal["full", "node"] = "full"
    node_id: str | None = None


class GraphSyncResponse(BaseModel):
    sync_result: SyncResult
    sync_status: str = "completed"


@router.post(
    "/api/projects/{project_id}/graph/sync",
    response_model=GraphSyncResponse,
    status_code=status.HTTP_200_OK,
)
async def sync_graph_manual(
    project_id: str,
    payload: GraphSyncRequest,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project_or_404(session, project_id)
    prompt_override = project.prompt_overrides.extraction
    prompt_template = PromptTemplate.from_template(prompt_override) if prompt_override else None
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
        node = next((item for item in project.nodes if item.id == payload.node_id), None)
        if node is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Node not found",
            )
        current_graph = load_graph(project_id)
        temp_sync_manager = IndexSyncManager(
            node_indexer=node_indexer,
            graph_extractor=extractor,
        )
        sync_result = await temp_sync_manager.sync_node_create(
            project_id=project_id,
            new_node=node,
            current_graph=current_graph,
        )
        save_graph(current_graph)
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid sync mode",
        )

    if sync_result.graph_updated:
        latest_graph = updated_graph if payload.mode == "full" else current_graph
        updated_project = sync_project_characters_from_graph(project, latest_graph)
        await update_project(session, updated_project.id, updated_project)
        await notifier.notify_graph_updated(project_id, sync_result.model_dump())

    return GraphSyncResponse(sync_result=sync_result, sync_status="completed")


@router.put(
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
    project = await get_project_or_404(session, project_id)
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
        raise HTTPException(status_code=status_code, detail=detail) from exc
    save_graph(graph)
    updated_project = sync_project_characters_from_graph(project, graph)
    await update_project(session, updated_project.id, updated_project)
    return entity.model_dump()


@router.post(
    "/api/projects/{project_id}/graph/entities",
    response_model=dict,
    status_code=status.HTTP_200_OK,
)
async def create_graph_entity(
    project_id: str,
    payload: dict,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project_or_404(session, project_id)
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
        raise HTTPException(status_code=status_code, detail=detail) from exc
    save_graph(graph)
    updated_project = sync_project_characters_from_graph(project, graph)
    await update_project(session, updated_project.id, updated_project)
    return entity.model_dump()


@router.delete(
    "/api/projects/{project_id}/graph/entities/{entity_id}",
    response_model=dict,
    status_code=status.HTTP_200_OK,
)
async def delete_graph_entity(
    project_id: str,
    entity_id: str,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project_or_404(session, project_id)
    graph = load_graph(project_id)
    editor = GraphEditor(graph)
    try:
        stats = await editor.delete_entity(entity_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Entity not found",
        ) from exc
    save_graph(graph)
    project = remap_project_node_characters(project, remove_ids={entity_id})
    updated_project = sync_project_characters_from_graph(project, graph)
    await update_project(session, updated_project.id, updated_project)
    return stats


@router.post(
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
    project = await get_project_or_404(session, project_id)
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
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    save_graph(graph)
    project = remap_project_node_characters(project, remap={entity_id: target_id})
    updated_project = sync_project_characters_from_graph(project, graph)
    await update_project(session, updated_project.id, updated_project)
    return entity.model_dump()


@router.put(
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
    await get_project_or_404(session, project_id)
    graph = load_graph(project_id)
    editor = GraphEditor(graph)
    try:
        relation = editor.update_relation(relation_id, payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    save_graph(graph)
    return relation.model_dump()


@router.post(
    "/api/projects/{project_id}/graph/relations",
    response_model=dict,
    status_code=status.HTTP_200_OK,
)
async def create_graph_relation(
    project_id: str,
    payload: dict,
    session: AsyncSession = Depends(get_session),
):
    await get_project_or_404(session, project_id)
    graph = load_graph(project_id)
    editor = GraphEditor(graph)
    try:
        relation = editor.create_relation(payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    save_graph(graph)
    return relation.model_dump()


@router.delete(
    "/api/projects/{project_id}/graph/relations/{relation_id}",
    response_model=dict,
    status_code=status.HTTP_200_OK,
)
async def delete_graph_relation(
    project_id: str,
    relation_id: str,
    session: AsyncSession = Depends(get_session),
):
    await get_project_or_404(session, project_id)
    graph = load_graph(project_id)
    editor = GraphEditor(graph)
    try:
        result = editor.delete_relation(relation_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    save_graph(graph)
    return result


@router.get(
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

    project = await get_project_or_404(session, project_id)
    graph = load_graph(project_id)
    return build_character_graph_response(project, graph)
