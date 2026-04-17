from __future__ import annotations

import re
from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from .crud import get_project, list_style_libraries
from .knowledge_graph import EntityType, KnowledgeGraph
from .models import (
    CHARACTER_BIO_MAX_LENGTH,
    CharacterAppearance,
    CharacterGraphLink,
    CharacterGraphNode,
    CharacterGraphResponse,
    CharacterProfile,
    StoryProject,
    StyleReferencePreview,
    StyleRetrievalPreviewResponse,
)
from .style_knowledge import StyleDocument


def _get_style_knowledge_manager():
    from .runtime import style_knowledge_manager

    return style_knowledge_manager


async def get_project_or_404(
    session: AsyncSession,
    project_id: str,
) -> StoryProject:
    project = await get_project(session, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )
    return project


def count_words(text: str) -> int:
    if not text:
        return 0
    cjk_chars = re.findall(r"[\u4e00-\u9fff]", text)
    tokens = re.findall(r"[A-Za-z0-9]+", text)
    return len(cjk_chars) + len(tokens)


def format_outline(project: StoryProject) -> str:
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


def format_conversation(messages: list[dict]) -> str:
    if not messages:
        return "无"
    lines: list[str] = []
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        lines.append(f"{role.upper()}: {content}")
    return "\n".join(lines)


def format_conflicts(conflicts: list) -> str:
    if not conflicts:
        return "无"
    lines: list[str] = []
    for conflict in conflicts:
        lines.append(
            f"- {conflict.type}: {conflict.description}"
            + (f"（建议：{conflict.suggestion}）" if conflict.suggestion else "")
        )
    return "\n".join(lines)


def format_history_snippets(history: list[dict]) -> str:
    if not history:
        return "无"
    lines: list[str] = []
    for item in history:
        role = item.get("role", "user")
        content = item.get("content", "")
        lines.append(f"- {role}: {content}")
    return "\n".join(lines)


def estimate_outline_words(project: StoryProject) -> int:
    total = count_words(project.world_view)
    for node in project.nodes:
        total += count_words(node.title)
        total += count_words(node.content)
    return total


def choose_analysis_scope(project: StoryProject) -> str:
    preference = (project.analysis_profile or "auto").lower()
    total_nodes = len(project.nodes)
    total_words = estimate_outline_words(project)
    is_short = total_nodes <= 20 and total_words <= 6000

    if preference == "short":
        return "full" if is_short else "retrieval"
    if preference in ("medium", "long"):
        return "retrieval"
    return "full" if is_short else "retrieval"


def infer_style_focuses(instruction: str, text: str) -> list[str]:
    combined = f"{instruction}\n{text}".lower()
    dialogue_terms = (
        "对话",
        "对白",
        "台词",
        "说话",
        "语气",
        "口吻",
        "交流",
        "争执",
        "质问",
        "回答",
    )
    environment_terms = (
        "环境",
        "场景",
        "氛围",
        "描写",
        "景物",
        "空间",
        "光线",
        "空气",
        "雨夜",
        "房间",
        "街道",
    )
    dialogue_score = sum(1 for term in dialogue_terms if term in combined)
    environment_score = sum(1 for term in environment_terms if term in combined)

    if "“" in text or "\"" in text:
        dialogue_score += 1
    if any(term in text for term in ("雨", "风", "灯", "夜", "雾", "冷", "热")):
        environment_score += 1

    if dialogue_score > 0 and environment_score > 0:
        return ["hybrid", "dialogue", "environment"]
    if dialogue_score > 0:
        return ["dialogue", "hybrid"]
    if environment_score > 0:
        return ["environment", "hybrid"]
    return ["general"]


def build_style_query(
    instruction: str,
    text: str,
    preferred_focuses: list[str],
) -> str:
    if not preferred_focuses:
        return f"{instruction}\n{text}".strip()
    focus_map = {
        "dialogue": "对话型",
        "environment": "环境型",
        "hybrid": "混合型",
        "general": "通用型",
    }
    focus_text = "、".join(
        focus_map[item] for item in preferred_focuses if item in focus_map
    )
    return f"优先参考类型：{focus_text}\n{instruction}\n{text}".strip()


def sync_project_characters_from_graph(
    project: StoryProject,
    graph: KnowledgeGraph,
) -> StoryProject:
    existing_profiles = {character.id: character for character in project.characters}
    characters: list[CharacterProfile] = []
    for entity in graph.entities:
        if entity.type != EntityType.CHARACTER:
            continue
        existing = existing_profiles.get(entity.id)
        tags: list[str] = []
        if isinstance(entity.properties, dict):
            raw_tags = entity.properties.get("tags")
            if isinstance(raw_tags, list):
                tags = [str(tag).strip() for tag in raw_tags if str(tag).strip()]
        bio = (entity.description or "").strip()
        if not bio and existing:
            bio = existing.bio
        if len(bio) > CHARACTER_BIO_MAX_LENGTH:
            bio = bio[:CHARACTER_BIO_MAX_LENGTH]
        characters.append(
            CharacterProfile(
                id=entity.id,
                name=entity.name.strip() or (existing.name if existing else "未命名角色"),
                tags=tags or (existing.tags if existing else []),
                bio=bio or "待补充",
            )
        )
    project.characters = characters
    project.updated_at = datetime.utcnow()
    return project


def remap_project_node_characters(
    project: StoryProject,
    remap: dict[str, str] | None = None,
    remove_ids: set[str] | None = None,
) -> StoryProject:
    remap = remap or {}
    remove_ids = remove_ids or set()
    for node in project.nodes:
        next_ids: list[str] = []
        seen_ids: set[str] = set()
        for character_id in node.characters:
            if character_id in remove_ids:
                continue
            mapped_id = remap.get(character_id, character_id)
            if mapped_id in remove_ids or mapped_id in seen_ids:
                continue
            seen_ids.add(mapped_id)
            next_ids.append(mapped_id)
        node.characters = next_ids
    project.updated_at = datetime.utcnow()
    return project


def truncate_reference_content(text: str, limit: int = 240) -> str:
    cleaned = text.strip()
    if len(cleaned) <= limit:
        return cleaned
    return f"{cleaned[: limit - 3]}..."


def normalize_preview_focuses(preferred_focuses: list[str]) -> list[str]:
    mapping = {
        "dialogue": "对话型",
        "environment": "环境型",
        "hybrid": "混合型",
        "general": "通用型",
    }
    return [mapping[item] for item in preferred_focuses if item in mapping]


async def resolve_style_preview(
    session: AsyncSession,
    project_id: str,
    instruction: str,
    text: str,
    style_document_ids: list[str],
    top_k: int = 5,
) -> StyleRetrievalPreviewResponse:
    if not style_document_ids:
        return StyleRetrievalPreviewResponse(preferred_focuses=[], references=[])

    selected_documents = await resolve_accessible_style_documents(
        session=session,
        project_id=project_id,
        style_document_ids=style_document_ids,
    )
    if not selected_documents:
        return StyleRetrievalPreviewResponse(preferred_focuses=[], references=[])

    preferred_focuses = infer_style_focuses(instruction, text)
    style_query = build_style_query(instruction, text, preferred_focuses)
    style_knowledge_manager = _get_style_knowledge_manager()
    style_hits = await style_knowledge_manager.search_style_documents(
        query=style_query,
        documents=selected_documents,
        top_k=top_k,
        preferred_focuses=preferred_focuses,
    )
    references = [
        StyleReferencePreview(
            id=item.id,
            title=str(item.metadata.get("title") or "风格参考"),
            document_id=str(item.metadata.get("document_id") or "") or None,
            focus=str(item.metadata.get("focus") or "") or None,
            techniques=[
                str(entry).strip()
                for entry in (item.metadata.get("techniques") or [])
                if str(entry).strip()
            ],
            content=truncate_reference_content(item.content),
            score=float(item.score),
        )
        for item in style_hits
    ]
    return StyleRetrievalPreviewResponse(
        preferred_focuses=normalize_preview_focuses(preferred_focuses),
        references=references,
    )


async def resolve_accessible_style_documents(
    session: AsyncSession,
    project_id: str,
    style_document_ids: list[str],
) -> list[StyleDocument]:
    remaining_ids = [item for item in style_document_ids if item]
    if not remaining_ids:
        return []

    documents_by_id: dict[str, StyleDocument] = {}
    style_knowledge_manager = _get_style_knowledge_manager()
    project_documents = await style_knowledge_manager.list_project_documents(project_id)
    for document in project_documents:
        if document.id in remaining_ids:
            documents_by_id[document.id] = document

    unresolved = [item for item in remaining_ids if item not in documents_by_id]
    if unresolved:
        libraries = await list_style_libraries(session)
        for library in libraries:
            library_documents = await style_knowledge_manager.list_library_documents(library.id)
            for document in library_documents:
                if document.id in unresolved:
                    documents_by_id[document.id] = document
            unresolved = [item for item in unresolved if item not in documents_by_id]
            if not unresolved:
                break

    return [documents_by_id[item] for item in remaining_ids if item in documents_by_id]


def build_character_graph_response(
    project: StoryProject,
    graph: KnowledgeGraph,
) -> CharacterGraphResponse:
    node_map = {node.id: node for node in project.nodes}
    character_entities = [
        entity for entity in graph.entities if entity.type == EntityType.CHARACTER
    ]
    character_ids = {entity.id for entity in character_entities}

    def extract_appearance_ids(entity) -> set[str]:
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
        appearance_ids = extract_appearance_ids(entity)
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


def build_model_config_response():
    from .config import get_api_key, get_base_url, get_model_name
    from .models import ModelConfigResponse

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
