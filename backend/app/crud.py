from __future__ import annotations

from typing import Iterable
from datetime import datetime
from uuid import uuid4

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .db_models import AsyncTaskTable, ProjectTable, StyleLibraryTable
from .models import (
    AsyncTaskResponse,
    CharacterProfile,
    ProjectSummary,
    StoryChapter,
    StoryNode,
    StoryProject,
    StyleLibrary,
)
from .request_context import get_current_user_id


def _serialize_project(project: StoryProject) -> dict:
    return {
        "nodes": [node.model_dump() for node in project.nodes],
        "chapters": [chapter.model_dump() for chapter in project.chapters],
        "characters": [character.model_dump() for character in project.characters],
        "analysis_profile": project.analysis_profile,
        "prompt_overrides": project.prompt_overrides.model_dump(),
        "writer_config": project.writer_config.model_dump(),
    }


def _deserialize_project(row: ProjectTable) -> StoryProject:
    data = row.data_json or {}
    nodes_data: Iterable[dict] = data.get("nodes", [])
    chapters_data: Iterable[dict] = data.get("chapters", [])
    characters_data: Iterable[dict] = data.get("characters", [])
    analysis_profile = data.get("analysis_profile", "auto")
    prompt_overrides = data.get("prompt_overrides", {})
    writer_config = data.get("writer_config") or {}
    nodes = [StoryNode(**node) for node in nodes_data]
    chapters = [StoryChapter(**chapter) for chapter in chapters_data]
    characters = [CharacterProfile(**character) for character in characters_data]
    return StoryProject(
        id=row.id,
        title=row.title,
        world_view=row.world_view,
        style_tags=row.style_tags or [],
        nodes=nodes,
        chapters=chapters,
        characters=characters,
        analysis_profile=analysis_profile,
        prompt_overrides=prompt_overrides,
        writer_config=writer_config,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def create_project(
    session: AsyncSession, project: StoryProject, owner_id: str | None = None
) -> str:
    resolved_owner_id = owner_id or get_current_user_id()
    record = ProjectTable(
        id=project.id,
        owner_id=resolved_owner_id,
        title=project.title,
        world_view=project.world_view,
        style_tags=project.style_tags,
        data_json=_serialize_project(project),
        created_at=project.created_at,
        updated_at=project.updated_at,
    )
    session.add(record)
    await session.commit()
    return record.id


async def get_project(
    session: AsyncSession, project_id: str, owner_id: str | None = None
) -> StoryProject | None:
    resolved_owner_id = owner_id if owner_id is not None else get_current_user_id()
    if resolved_owner_id is None:
        record = await session.get(ProjectTable, project_id)
    else:
        result = await session.execute(
            select(ProjectTable).where(
                ProjectTable.id == project_id, ProjectTable.owner_id == resolved_owner_id
            )
        )
        record = result.scalar_one_or_none()
    if record is None:
        return None
    return _deserialize_project(record)


async def update_project(
    session: AsyncSession, project_id: str, project: StoryProject, owner_id: str | None = None
) -> StoryProject:
    resolved_owner_id = owner_id if owner_id is not None else get_current_user_id()
    if resolved_owner_id is None:
        record = await session.get(ProjectTable, project_id)
    else:
        result = await session.execute(
            select(ProjectTable).where(
                ProjectTable.id == project_id, ProjectTable.owner_id == resolved_owner_id
            )
        )
        record = result.scalar_one_or_none()
    if record is None:
        raise ValueError("Project not found")

    record.title = project.title
    record.world_view = project.world_view
    record.style_tags = project.style_tags
    record.data_json = _serialize_project(project)
    record.updated_at = project.updated_at
    await session.commit()
    return project


async def list_projects(session: AsyncSession) -> list[ProjectSummary]:
    resolved_owner_id = get_current_user_id()
    statement = select(ProjectTable.id, ProjectTable.title, ProjectTable.updated_at)
    if resolved_owner_id is not None:
        statement = statement.where(ProjectTable.owner_id == resolved_owner_id)
    result = await session.execute(
        statement.order_by(
            ProjectTable.updated_at.desc()
        )
    )
    return [
        ProjectSummary(id=row.id, title=row.title, updated_at=row.updated_at)
        for row in result.fetchall()
    ]


async def delete_project(session: AsyncSession, project_id: str) -> bool:
    resolved_owner_id = get_current_user_id()
    statement = delete(ProjectTable).where(ProjectTable.id == project_id)
    if resolved_owner_id is not None:
        statement = statement.where(ProjectTable.owner_id == resolved_owner_id)
    result = await session.execute(statement)
    await session.commit()
    return (result.rowcount or 0) > 0


async def project_id_exists(session: AsyncSession, project_id: str) -> bool:
    return await session.get(ProjectTable, project_id) is not None


async def claim_unowned_projects(session: AsyncSession, owner_id: str) -> int:
    result = await session.execute(
        update(ProjectTable)
        .where(ProjectTable.owner_id.is_(None))
        .values(owner_id=owner_id)
    )
    await session.commit()
    return int(result.rowcount or 0)


def _serialize_style_library(library: StyleLibrary) -> StyleLibrary:
    return library.model_copy(deep=True)


def _deserialize_style_library(row: StyleLibraryTable) -> StyleLibrary:
    return StyleLibrary(
        id=row.id,
        owner_id=row.owner_id,
        name=row.name,
        description=row.description or "",
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def create_style_library(
    session: AsyncSession,
    library: StyleLibrary,
    owner_id: str | None = None,
) -> StyleLibrary:
    resolved_owner_id = owner_id or get_current_user_id()
    if resolved_owner_id is None:
        raise ValueError("Style library owner is required")
    payload = _serialize_style_library(library)
    record = StyleLibraryTable(
        id=payload.id,
        owner_id=resolved_owner_id,
        name=payload.name,
        description=payload.description,
        created_at=payload.created_at,
        updated_at=payload.updated_at,
    )
    session.add(record)
    await session.commit()
    return _deserialize_style_library(record)


async def get_style_library(
    session: AsyncSession,
    library_id: str,
    owner_id: str | None = None,
) -> StyleLibrary | None:
    resolved_owner_id = owner_id if owner_id is not None else get_current_user_id()
    if resolved_owner_id is None:
        return None
    result = await session.execute(
        select(StyleLibraryTable).where(
            StyleLibraryTable.id == library_id,
            StyleLibraryTable.owner_id == resolved_owner_id,
        )
    )
    record = result.scalar_one_or_none()
    if record is None:
        return None
    return _deserialize_style_library(record)


async def list_style_libraries(session: AsyncSession) -> list[StyleLibrary]:
    resolved_owner_id = get_current_user_id()
    if resolved_owner_id is None:
        return []
    statement = select(StyleLibraryTable).where(StyleLibraryTable.owner_id == resolved_owner_id)
    result = await session.execute(statement.order_by(StyleLibraryTable.updated_at.desc()))
    return [_deserialize_style_library(row) for row in result.scalars().all()]


async def update_style_library(
    session: AsyncSession,
    library_id: str,
    library: StyleLibrary,
    owner_id: str | None = None,
) -> StyleLibrary:
    resolved_owner_id = owner_id if owner_id is not None else get_current_user_id()
    if resolved_owner_id is None:
        raise ValueError("Style library owner is required")
    result = await session.execute(
        select(StyleLibraryTable).where(
            StyleLibraryTable.id == library_id,
            StyleLibraryTable.owner_id == resolved_owner_id,
        )
    )
    record = result.scalar_one_or_none()
    if record is None:
        raise ValueError("Style library not found")

    payload = _serialize_style_library(library)
    record.name = payload.name
    record.description = payload.description
    record.updated_at = payload.updated_at
    await session.commit()
    return _deserialize_style_library(record)


async def delete_style_library(session: AsyncSession, library_id: str) -> bool:
    resolved_owner_id = get_current_user_id()
    if resolved_owner_id is None:
        return False
    statement = delete(StyleLibraryTable).where(StyleLibraryTable.id == library_id)
    statement = statement.where(StyleLibraryTable.owner_id == resolved_owner_id)
    result = await session.execute(statement)
    await session.commit()
    return (result.rowcount or 0) > 0


def _deserialize_async_task(row: AsyncTaskTable) -> AsyncTaskResponse:
    return AsyncTaskResponse(
        id=row.id,
        kind=row.kind,  # type: ignore[arg-type]
        status=row.status,  # type: ignore[arg-type]
        title=row.title,
        request_payload=row.request_json or {},
        result_payload=row.result_json,
        error_message=row.error_message,
        progress_stage=row.progress_stage,
        progress_details=row.progress_json or {},
        created_at=row.created_at,
        updated_at=row.updated_at,
        started_at=row.started_at,
        completed_at=row.completed_at,
    )


async def create_async_task(
    session: AsyncSession,
    *,
    owner_id: str,
    kind: str,
    request_payload: dict,
    title: str | None = None,
) -> AsyncTaskResponse:
    now = datetime.utcnow()
    record = AsyncTaskTable(
        id=str(uuid4()),
        owner_id=owner_id,
        kind=kind,
        status="pending",
        title=title,
        request_json=request_payload,
        result_json=None,
        error_message=None,
        progress_stage=None,
        progress_json={},
        created_at=now,
        updated_at=now,
        started_at=None,
        completed_at=None,
    )
    session.add(record)
    await session.commit()
    return _deserialize_async_task(record)


async def get_async_task(
    session: AsyncSession,
    task_id: str,
    *,
    owner_id: str,
) -> AsyncTaskResponse | None:
    result = await session.execute(
        select(AsyncTaskTable).where(
            AsyncTaskTable.id == task_id,
            AsyncTaskTable.owner_id == owner_id,
        )
    )
    record = result.scalar_one_or_none()
    if record is None:
        return None
    return _deserialize_async_task(record)


async def list_async_tasks(
    session: AsyncSession,
    *,
    owner_id: str,
    kind: str | None = None,
    limit: int = 20,
) -> list[AsyncTaskResponse]:
    statement = select(AsyncTaskTable).where(AsyncTaskTable.owner_id == owner_id)
    if kind:
        statement = statement.where(AsyncTaskTable.kind == kind)
    result = await session.execute(
        statement.order_by(AsyncTaskTable.created_at.desc()).limit(limit)
    )
    return [_deserialize_async_task(row) for row in result.scalars().all()]


async def mark_async_task_running(
    session: AsyncSession,
    task_id: str,
    *,
    owner_id: str,
) -> AsyncTaskResponse | None:
    result = await session.execute(
        select(AsyncTaskTable).where(
            AsyncTaskTable.id == task_id,
            AsyncTaskTable.owner_id == owner_id,
        )
    )
    record = result.scalar_one_or_none()
    if record is None:
        return None
    now = datetime.utcnow()
    record.status = "running"
    record.started_at = record.started_at or now
    record.updated_at = now
    record.error_message = None
    await session.commit()
    return _deserialize_async_task(record)


async def update_async_task_progress(
    session: AsyncSession,
    task_id: str,
    *,
    owner_id: str,
    stage: str | None,
    details: dict,
) -> AsyncTaskResponse | None:
    result = await session.execute(
        select(AsyncTaskTable).where(
            AsyncTaskTable.id == task_id,
            AsyncTaskTable.owner_id == owner_id,
        )
    )
    record = result.scalar_one_or_none()
    if record is None:
        return None
    record.progress_stage = stage
    record.progress_json = details
    record.updated_at = datetime.utcnow()
    await session.commit()
    return _deserialize_async_task(record)


async def mark_async_task_succeeded(
    session: AsyncSession,
    task_id: str,
    *,
    owner_id: str,
    result_payload: dict,
) -> AsyncTaskResponse | None:
    result = await session.execute(
        select(AsyncTaskTable).where(
            AsyncTaskTable.id == task_id,
            AsyncTaskTable.owner_id == owner_id,
        )
    )
    record = result.scalar_one_or_none()
    if record is None:
        return None
    now = datetime.utcnow()
    record.status = "succeeded"
    record.result_json = result_payload
    record.error_message = None
    record.updated_at = now
    record.completed_at = now
    await session.commit()
    return _deserialize_async_task(record)


async def mark_async_task_failed(
    session: AsyncSession,
    task_id: str,
    *,
    owner_id: str,
    error_message: str,
) -> AsyncTaskResponse | None:
    result = await session.execute(
        select(AsyncTaskTable).where(
            AsyncTaskTable.id == task_id,
            AsyncTaskTable.owner_id == owner_id,
        )
    )
    record = result.scalar_one_or_none()
    if record is None:
        return None
    now = datetime.utcnow()
    record.status = "failed"
    record.error_message = error_message
    record.updated_at = now
    record.completed_at = now
    await session.commit()
    return _deserialize_async_task(record)
