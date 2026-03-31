from __future__ import annotations

from fastapi import HTTPException, status
from fastapi.responses import StreamingResponse
from langchain.prompts import PromptTemplate
from langchain_openai import ChatOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_api_key, get_base_url, get_model_name
from ..graph_retriever import GraphRetriever
from ..helpers import (
    choose_analysis_scope,
    format_conflicts,
    format_conversation,
    format_history_snippets,
    format_outline,
    get_project_or_404,
    resolve_style_preview,
)
from ..knowledge_graph import load_graph
from ..models import OutlineAnalysisRequest, StoryNode, WritingAssistantRequest
from ..node_indexer import NodeIndexer
from ..runtime import conflict_detector


def _build_streaming_response(event_stream) -> StreamingResponse:
    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def outline_analysis_stream_response(
    payload: OutlineAnalysisRequest,
    session: AsyncSession,
    analysis_prompt_template: str,
) -> StreamingResponse:
    project = await get_project_or_404(session, payload.project_id)

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

    scope = choose_analysis_scope(project)
    outline_text = format_outline(project) if scope == "full" else "已启用检索摘要。"
    conflicts_text = format_conflicts(conflicts)
    conversation_text = format_conversation([message.model_dump() for message in payload.messages])
    user_query = ""
    for message in reversed(payload.messages):
        if message.role == "user":
            user_query = message.content
            break
    if not user_query:
        user_query = "大纲一致性分析"

    from ..analysis_history import search_history

    history_hits = await search_history(project_id=payload.project_id, query=user_query, top_k=6)
    history_text = format_history_snippets(history_hits)
    retrieval_text = "无"
    if scope == "retrieval":
        retriever = GraphRetriever(knowledge_graph=graph, node_indexer=NodeIndexer())
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
        else PromptTemplate.from_template(analysis_prompt_template)
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

    llm = ChatOpenAI(
        api_key=api_key,
        base_url=get_base_url(),
        model=get_model_name("sync"),
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

    return _build_streaming_response(event_stream)


async def writing_assistant_stream_response(
    payload: WritingAssistantRequest,
    session: AsyncSession,
) -> StreamingResponse:
    project = await get_project_or_404(session, payload.project_id)
    graph = load_graph(payload.project_id)
    config = project.writer_config

    api_key = config.api_key or get_api_key("default") or get_api_key("drafting")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No API Key configured. Please set it in Writing Settings.",
        )

    llm = ChatOpenAI(
        api_key=api_key,
        base_url=config.base_url or get_base_url(),
        model=config.model or "gpt-4o",
        streaming=True,
    )
    system_prompt = (
        config.prompt
        or "You are a professional novel editor. Polish the text to be more immersive and vivid."
    )
    guardrails = conflict_detector.build_generation_guardrails(project, graph, payload.text)
    existing_conflicts = await conflict_detector.detect_conflicts(
        project=project,
        graph=graph,
        modified_node=(
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
        ),
    )

    style_context = ""
    if payload.style_document_ids:
        preview = await resolve_style_preview(
            project_id=payload.project_id,
            instruction=payload.instruction,
            text=payload.text,
            style_document_ids=payload.style_document_ids,
            top_k=6,
        )
        if preview.references:
            lines: list[str] = []
            for item in preview.references:
                prefix = item.title
                if item.focus:
                    prefix = f"{prefix}（{item.focus}）"
                lines.append(f"- {prefix}: {item.content}")
            style_context = "\n".join(lines)

    messages = [{"role": "system", "content": system_prompt}]
    if guardrails:
        messages.append(
            {
                "role": "system",
                "content": (
                    "以下是当前项目需要优先保持的一致性约束，请在润色或扩写时尽量不要破坏：\n"
                    + "\n".join(guardrails)
                ),
            }
        )
    if existing_conflicts:
        messages.append(
            {
                "role": "system",
                "content": (
                    "当前项目里已经检测到一些潜在冲突，生成时不要继续放大它们：\n"
                    f"{format_conflicts(existing_conflicts)}"
                ),
            }
        )
    if style_context:
        messages.append(
            {
                "role": "system",
                "content": (
                    "以下是写作风格参考片段，请在润色或扩写时参考其语感与节奏，"
                    "但不要直接抄袭原句：\n"
                    f"{style_context}"
                ),
            }
        )
    messages.append(
        {
            "role": "user",
            "content": f"{payload.instruction}\n\n[Text Start]\n{payload.text}\n[Text End]",
        }
    )

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

    return _build_streaming_response(event_stream)
