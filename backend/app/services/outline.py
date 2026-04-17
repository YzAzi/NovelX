from __future__ import annotations

import json
from datetime import datetime
from typing import Awaitable, Callable

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
    CHARACTER_BIO_MAX_LENGTH,
    CharacterProfile,
    CreateOutlineRequest,
    IdeaLabStageRequest,
    IdeaLabStageResponse,
    OutlineImportRequest,
    OutlineImportResult,
    IdeaLabStageOption,
    StoryDirectionRequest,
    StoryDirectionResponse,
    StoryNode,
    StoryProject,
)
from ..node_indexer import NodeIndexer
from ..runtime import notifier
from ..schema_utils import pydantic_json_schema_inline, pydantic_to_openai_function_inline


async def create_outline_project(
    payload: CreateOutlineRequest,
    session: AsyncSession,
    progress_callback: Callable[[str, dict | None], Awaitable[None]] | None = None,
) -> StoryProject:
    if payload.base_project_id:
        await get_project_or_404(session, payload.base_project_id)

    request_id = payload.request_id

    async def report_progress(stage: str, details: dict | None = None) -> None:
        if progress_callback:
            await progress_callback(stage, details or {})
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


async def generate_story_directions(
    payload: StoryDirectionRequest,
    session: AsyncSession,
    prompt_template: PromptTemplate,
) -> StoryDirectionResponse:
    base_project = None
    if payload.base_project_id:
        base_project = await get_project_or_404(session, payload.base_project_id)

    user_input = (payload.user_input or "").strip()
    world_view = (payload.world_view or "").strip()
    if not world_view and base_project:
        world_view = (base_project.world_view or "").strip()

    style_tags = [tag.strip() for tag in payload.style_tags if tag.strip()]
    if not style_tags and base_project:
        style_tags = [tag.strip() for tag in base_project.style_tags if tag.strip()]

    if not user_input and not world_view:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请至少提供一个模糊想法或世界观设定。",
        )

    api_key = get_api_key("drafting") or get_api_key("default")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="未配置 AI 服务密钥，请先在设置中填写默认模型或大纲模型的 API Key。",
        )

    schema = pydantic_to_openai_function_inline(StoryDirectionResponse)
    llm = ChatOpenAI(
        api_key=api_key,
        base_url=get_base_url(),
        model=get_model_name("drafting"),
    ).with_structured_output(schema)

    prompt_schema = pydantic_json_schema_inline(StoryDirectionResponse)
    prompt_text = prompt_template.format(
        user_input=user_input or "用户目前只有非常模糊的创作冲动，请主动补齐三种清晰方向。",
        world_view=world_view or "未指定",
        style_tags="、".join(style_tags) if style_tags else "未指定",
        output_schema=json.dumps(prompt_schema, ensure_ascii=False, indent=2),
    )
    result = await llm.ainvoke(prompt_text)
    if isinstance(result, StoryDirectionResponse):
        parsed = result
    elif isinstance(result, dict):
        parsed = StoryDirectionResponse.model_validate(result)
    elif hasattr(result, "model_dump"):
        parsed = StoryDirectionResponse.model_validate(result.model_dump())
    else:
        parsed = StoryDirectionResponse.model_validate(result)

    normalized = []
    for index, item in enumerate(parsed.directions[:3], start=1):
        title = item.title.strip() or f"方向 {index}"
        logline = item.logline.strip() or "待补充"
        direction_world_view = item.world_view.strip() or world_view or "待补充世界观"
        direction_tags = [tag.strip() for tag in item.style_tags if tag.strip()][:5]
        direction_prompt = item.initial_prompt.strip() or user_input or logline
        normalized.append(
            {
                "title": title,
                "logline": logline,
                "world_view": direction_world_view,
                "style_tags": direction_tags,
                "initial_prompt": direction_prompt,
            }
        )

    if len(normalized) != 3:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="AI 未能稳定生成 3 个方向，请重试。",
        )

    return StoryDirectionResponse.model_validate({"directions": normalized})


IDEA_LAB_STAGE_META = {
    "concept": {
        "title": "第一步：故事方向",
        "instruction": "先选一个你最想展开的故事切入口。",
        "goal": "围绕原始灵感拉开 3 个明显不同的故事方向。",
        "is_final": False,
    },
    "protagonist": {
        "title": "第二步：主角方案",
        "instruction": "在已选方向上，挑一个最有行动力的主角版本。",
        "goal": "围绕已选方向，拉开 3 种主角身份、欲望与行动方式。",
        "is_final": False,
    },
    "conflict": {
        "title": "第三步：核心冲突",
        "instruction": "在已选人物基础上，确定哪种主线阻力最能撑住长篇。",
        "goal": "围绕已选方案，拉开 3 条主要冲突与升级路径。",
        "is_final": False,
    },
    "outline": {
        "title": "第四步：成稿方向",
        "instruction": "最后选一个最适合直接生成大纲的完整版本。",
        "goal": "输出 3 个已经接近成稿、可直接进入大纲生成的项目方案。",
        "is_final": True,
    },
}


async def generate_idea_lab_stage(
    payload: IdeaLabStageRequest,
    session: AsyncSession,
    prompt_template: PromptTemplate,
) -> IdeaLabStageResponse:
    base_project = None
    if payload.base_project_id:
        base_project = await get_project_or_404(session, payload.base_project_id)

    seed_input = (payload.seed_input or "").strip()
    world_view = (payload.world_view or "").strip()
    if not world_view and base_project:
        world_view = (base_project.world_view or "").strip()

    style_tags = [tag.strip() for tag in payload.style_tags if tag.strip()]
    if not style_tags and base_project:
        style_tags = [tag.strip() for tag in base_project.style_tags if tag.strip()]

    if not seed_input and not world_view and payload.selected_option is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请至少提供一个创意起点、世界观，或上一阶段的已选方案。",
        )

    api_key = get_api_key("drafting") or get_api_key("default")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="未配置 AI 服务密钥，请先在设置中填写默认模型或大纲模型的 API Key。",
        )

    schema = pydantic_to_openai_function_inline(IdeaLabStageResponse)
    llm = ChatOpenAI(
        api_key=api_key,
        base_url=get_base_url(),
        model=get_model_name("drafting"),
    ).with_structured_output(schema)

    meta = IDEA_LAB_STAGE_META[payload.stage]
    prompt_schema = pydantic_json_schema_inline(IdeaLabStageResponse)
    selected_option_text = (
        json.dumps(payload.selected_option.model_dump(), ensure_ascii=False, indent=2)
        if payload.selected_option
        else "无，这是第一步。"
    )
    prompt_text = prompt_template.format(
        stage=payload.stage,
        stage_goal=meta["goal"],
        seed_input=seed_input or "用户目前只有非常模糊的创作冲动，请主动补齐方案。",
        world_view=world_view or "未指定",
        style_tags="、".join(style_tags) if style_tags else "未指定",
        selected_option=selected_option_text,
        feedback=(payload.feedback or "").strip() or "无额外要求",
        output_schema=json.dumps(prompt_schema, ensure_ascii=False, indent=2),
    )
    result = await llm.ainvoke(prompt_text)
    if isinstance(result, IdeaLabStageResponse):
        parsed = result
    elif isinstance(result, dict):
        parsed = IdeaLabStageResponse.model_validate(result)
    elif hasattr(result, "model_dump"):
        parsed = IdeaLabStageResponse.model_validate(result.model_dump())
    else:
        parsed = IdeaLabStageResponse.model_validate(result)

    options: list[IdeaLabStageOption] = []
    for index, item in enumerate(parsed.options[:3], start=1):
        item_world_view = item.world_view.strip() or world_view or "待补充世界观"
        item_tags = [tag.strip() for tag in item.style_tags if tag.strip()][:5]
        options.append(
            IdeaLabStageOption(
                project_title=item.project_title.strip() or f"{meta['title']}方案 {index}",
                hook=item.hook.strip() or "待补充",
                premise=item.premise.strip() or "待补充",
                protagonist=item.protagonist.strip() or "待补充",
                conflict=item.conflict.strip() or "待补充",
                world_view=item_world_view,
                style_tags=item_tags,
                initial_prompt=item.initial_prompt.strip() or seed_input or item.hook.strip() or "待补充",
            )
        )

    if len(options) != 3:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="AI 未能稳定生成 3 个候选方案，请重试。",
        )

    return IdeaLabStageResponse(
        stage=payload.stage,
        stage_title=meta["title"],
        stage_instruction=meta["instruction"],
        is_final_stage=bool(meta["is_final"]),
        options=options,
    )


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
        if len(bio) > CHARACTER_BIO_MAX_LENGTH:
            bio = bio[:CHARACTER_BIO_MAX_LENGTH]
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
