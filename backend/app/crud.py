from __future__ import annotations

from typing import Iterable

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .db_models import ProjectTable
from .models import CharacterProfile, ProjectSummary, StoryChapter, StoryNode, StoryProject
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
