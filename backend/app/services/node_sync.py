from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Callable

from fastapi import BackgroundTasks, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..conflict_detector import SyncNodeResponse
from ..crud import get_project, update_project
from ..database import AsyncSessionLocal
from ..helpers import get_project_or_404
from ..index_sync import SyncResult
from ..knowledge_graph import load_graph, save_graph
from ..models import InsertNodeRequest, StoryNode, StoryProject, SyncNodeRequest
from ..runtime import conflict_detector, index_sync_manager, notifier, sync_queue
from ..sync_strategy import DEFAULT_SYNC_CONFIG, SyncMode


async def _load_latest_project(project_id: str) -> StoryProject | None:
    async with AsyncSessionLocal() as session:
        return await get_project(session, project_id)


async def _run_background_sync(
    project_id: str,
    updated_node: StoryNode,
    old_node: StoryNode | None,
    request_id: str | None,
    sync_result: SyncResult,
) -> None:
    try:
        async def sync_vector_with_delay(delay: int) -> None:
            await asyncio.sleep(delay)
            await index_sync_manager.node_indexer.index_node(project_id, updated_node)
            sync_result.vector_updated = True

        if DEFAULT_SYNC_CONFIG.graph_sync_mode == SyncMode.MANUAL:
            if DEFAULT_SYNC_CONFIG.vector_sync_mode == SyncMode.IMMEDIATE:
                await index_sync_manager.node_indexer.index_node(project_id, updated_node)
                sync_result.vector_updated = True
            elif DEFAULT_SYNC_CONFIG.vector_sync_mode in (SyncMode.DEBOUNCED, SyncMode.BATCH):
                delay = (
                    DEFAULT_SYNC_CONFIG.debounce_seconds
                    if DEFAULT_SYNC_CONFIG.vector_sync_mode == SyncMode.DEBOUNCED
                    else DEFAULT_SYNC_CONFIG.batch_timeout_seconds
                )
                await sync_vector_with_delay(delay)
        else:
            if DEFAULT_SYNC_CONFIG.vector_sync_mode == SyncMode.IMMEDIATE:
                await index_sync_manager.node_indexer.index_node(project_id, updated_node)
                sync_result.vector_updated = True
            if DEFAULT_SYNC_CONFIG.graph_sync_mode in (SyncMode.DEBOUNCED, SyncMode.BATCH):
                await sync_queue.enqueue(
                    project_id,
                    updated_node,
                    old_node=old_node,
                )
                results = await sync_queue.process_ready(project_id)
                if not results:
                    delay = (
                        DEFAULT_SYNC_CONFIG.debounce_seconds
                        if DEFAULT_SYNC_CONFIG.graph_sync_mode == SyncMode.DEBOUNCED
                        else DEFAULT_SYNC_CONFIG.batch_timeout_seconds
                    )
                    await asyncio.sleep(delay)
                    results = await sync_queue.process_ready(project_id)
                if results:
                    await notifier.notify_graph_updated(
                        project_id,
                        {"updates": [result.model_dump() for result in results]},
                    )
                    latest_project = await _load_latest_project(project_id)
                    if latest_project:
                        graph_snapshot = load_graph(project_id)
                        conflicts = await conflict_detector.detect_conflicts(
                            project=latest_project,
                            graph=graph_snapshot,
                            modified_node=updated_node,
                        )
                        if conflicts:
                            await notifier.notify_conflict_detected(
                                project_id,
                                [conflict.model_dump() for conflict in conflicts],
                            )
        await notifier.notify_sync_progress(
            project_id,
            "completed",
            {"node_id": updated_node.id, "request_id": request_id},
        )
    except Exception as exc:
        await notifier.notify_sync_progress(
            project_id,
            "failed",
            {"error": str(exc), "node_id": updated_node.id, "request_id": request_id},
        )


async def _handle_immediate_sync(
    project_id: str,
    updated_project: StoryProject,
    updated_node: StoryNode,
    old_node: StoryNode | None,
    request_id: str | None,
    sync_result: SyncResult,
) -> tuple[SyncResult, list, str]:
    conflicts: list = []
    sync_status = "pending"
    try:
        current_graph = load_graph(project_id)
        sync_result = await index_sync_manager.sync_node_update(
            project_id=project_id,
            old_node=old_node,
            new_node=updated_node,
            current_graph=current_graph,
        )
        save_graph(current_graph)
        await notifier.notify_graph_updated(project_id, sync_result.model_dump())
        conflicts = await conflict_detector.detect_conflicts(
            project=updated_project,
            graph=current_graph,
            modified_node=updated_node,
        )
        if conflicts:
            await notifier.notify_conflict_detected(
                project_id,
                [conflict.model_dump() for conflict in conflicts],
            )
        sync_status = "completed"
        await notifier.notify_sync_progress(
            project_id,
            "completed",
            {"node_id": updated_node.id, "request_id": request_id},
        )
    except Exception as exc:
        sync_result.success = False
        sync_status = "failed"
        await notifier.notify_sync_progress(
            project_id,
            "failed",
            {"error": str(exc), "node_id": updated_node.id, "request_id": request_id},
        )
    return sync_result, conflicts, sync_status


def _schedule_background_task(
    background_tasks: BackgroundTasks,
    task_factory: Callable[[], None],
) -> None:
    background_tasks.add_task(task_factory)


async def sync_node_request(
    payload: SyncNodeRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession,
) -> SyncNodeResponse:
    project = await get_project_or_404(session, payload.project_id)

    request_id = payload.request_id
    await notifier.notify_sync_progress(
        payload.project_id,
        "started",
        {"node_id": payload.node.id, "request_id": request_id},
    )

    old_node = next((node for node in project.nodes if node.id == payload.node.id), None)
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
    conflicts: list = []
    sync_status = "pending"

    if DEFAULT_SYNC_CONFIG.graph_sync_mode == SyncMode.IMMEDIATE:
        sync_result, conflicts, sync_status = await _handle_immediate_sync(
            project_id=payload.project_id,
            updated_project=updated_project,
            updated_node=updated_node,
            old_node=old_node,
            request_id=request_id,
            sync_result=sync_result,
        )
    else:
        def schedule_background_task() -> None:
            asyncio.create_task(
                _run_background_sync(
                    project_id=payload.project_id,
                    updated_node=updated_node,
                    old_node=old_node,
                    request_id=request_id,
                    sync_result=sync_result,
                )
            )

        _schedule_background_task(background_tasks, schedule_background_task)

    return SyncNodeResponse(
        project=updated_project,
        sync_result=sync_result,
        conflicts=conflicts,
        sync_status=sync_status,
    )


async def insert_node_request(
    payload: InsertNodeRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession,
) -> SyncNodeResponse:
    project = await get_project_or_404(session, payload.project_id)
    if any(node.id == payload.node.id for node in project.nodes):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Node id already exists",
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
    conflicts: list = []
    sync_status = "pending"

    if DEFAULT_SYNC_CONFIG.graph_sync_mode == SyncMode.IMMEDIATE:
        sync_result, conflicts, sync_status = await _handle_immediate_sync(
            project_id=payload.project_id,
            updated_project=updated_project,
            updated_node=updated_node,
            old_node=None,
            request_id=request_id,
            sync_result=sync_result,
        )
    else:
        def schedule_background_task() -> None:
            asyncio.create_task(
                _run_background_sync(
                    project_id=payload.project_id,
                    updated_node=updated_node,
                    old_node=None,
                    request_id=request_id,
                    sync_result=sync_result,
                )
            )

        _schedule_background_task(background_tasks, schedule_background_task)

    return SyncNodeResponse(
        project=updated_project,
        sync_result=sync_result,
        conflicts=conflicts,
        sync_status=sync_status,
    )
