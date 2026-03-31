from __future__ import annotations

import json
from datetime import datetime

from fastapi import HTTPException, status
from langchain.prompts import PromptTemplate
from langchain_openai import ChatOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_api_key, get_base_url, get_model_name
from ..crud import create_project, update_project
from ..graph import WorkflowError, run_drafting_workflow
from ..graph_extractor import GraphExtractor
from ..helpers import get_project_or_404
from ..knowledge_graph import save_graph
from ..models import (
    CharacterProfile,
    CreateOutlineRequest,
    OutlineImportRequest,
    OutlineImportResult,
    StoryNode,
    StoryProject,
)
from ..node_indexer import NodeIndexer
from ..runtime import notifier
from ..schema_utils import pydantic_json_schema_inline, pydantic_to_openai_function_inline


async def create_outline_project(
    payload: CreateOutlineRequest,
    session: AsyncSession,
) -> StoryProject:
    if payload.base_project_id:
        await get_project_or_404(session, payload.base_project_id)

    request_id = payload.request_id

    async def report_progress(stage: str, details: dict | None = None) -> None:
        if not request_id:
            return
        await notifier.notify_outline_progress(request_id, stage, details or {})

    if request_id:
        await notifier.notify_outline_progress(request_id, "queued", {})

    try:
        project = await run_drafting_workflow(payload, report_progress if request_id else None)
    except WorkflowError as exc:
        if request_id:
            await notifier.notify_outline_progress(
                request_id,
                "failed",
                {"error": str(exc)},
            )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        if request_id:
            await notifier.notify_outline_progress(
                request_id,
                "failed",
                {"error": str(exc)},
            )
        raise

    await create_project(session, project)
    return project


async def import_outline_into_project(
    project_id: str,
    payload: OutlineImportRequest,
    session: AsyncSession,
    outline_import_prompt_template: PromptTemplate,
) -> StoryProject:
    project = await get_project_or_404(session, project_id)
    raw_text = payload.raw_text.strip()
    if not raw_text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Outline content cannot be empty",
        )

    api_key = get_api_key("drafting")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OPENAI_API_KEY is not configured",
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
        else outline_import_prompt_template
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
        narrative_order = (
            node.narrative_order
            if node.narrative_order and node.narrative_order >= 1
            else index
        )
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
    prompt_template = PromptTemplate.from_template(prompt_override) if prompt_override else None
    extractor = GraphExtractor(prompt_template=prompt_template)
    node_indexer = NodeIndexer()
    await node_indexer.clear_project(project.id)
    await node_indexer.index_project(project)
    graph = await extractor.build_full_graph(project)
    save_graph(graph)

    return project
