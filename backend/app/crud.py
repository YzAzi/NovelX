from __future__ import annotations

from typing import Iterable

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .db_models import ProjectTable
from .models import CharacterProfile, ProjectSummary, StoryChapter, StoryNode, StoryProject


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


async def create_project(session: AsyncSession, project: StoryProject) -> str:
    record = ProjectTable(
        id=project.id,
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


async def get_project(session: AsyncSession, project_id: str) -> StoryProject | None:
    record = await session.get(ProjectTable, project_id)
    if record is None:
        return None
    return _deserialize_project(record)


async def update_project(
    session: AsyncSession, project_id: str, project: StoryProject
) -> StoryProject:
    record = await session.get(ProjectTable, project_id)
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
    result = await session.execute(
        select(ProjectTable.id, ProjectTable.title, ProjectTable.updated_at).order_by(
            ProjectTable.updated_at.desc()
        )
    )
    return [
        ProjectSummary(id=row.id, title=row.title, updated_at=row.updated_at)
        for row in result.fetchall()
    ]


async def delete_project(session: AsyncSession, project_id: str) -> bool:
    result = await session.execute(
        delete(ProjectTable).where(ProjectTable.id == project_id)
    )
    await session.commit()
    return (result.rowcount or 0) > 0
