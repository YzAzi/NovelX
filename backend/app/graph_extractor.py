from __future__ import annotations

import asyncio
import json
from datetime import datetime
from pathlib import Path
from typing import Iterable
from uuid import uuid4

from langchain.prompts import PromptTemplate
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

from .config import get_api_key, get_base_url, get_model_name
from .knowledge_graph import Entity, KnowledgeGraph, Relation
from .models import StoryNode, StoryProject
from .schema_utils import pydantic_json_schema_inline, pydantic_to_openai_function_inline


class ExtractionResult(BaseModel):
    new_entities: list[Entity] = Field(default_factory=list)
    new_relations: list[Relation] = Field(default_factory=list)
    alias_mappings: list[dict] = Field(default_factory=list)
    confidence_notes: list[str] = Field(default_factory=list)


PROMPT_PATH = Path(__file__).parent / "prompts" / "entity_extraction_prompt.txt"
PROMPT_TEMPLATE = PromptTemplate.from_template(PROMPT_PATH.read_text(encoding="utf-8"))


def _serialize_entities(entities: Iterable[Entity]) -> str:
    lines = []
    for entity in entities:
        alias_text = f" aliases={entity.aliases}" if entity.aliases else ""
        lines.append(f"- {entity.id}: {entity.name} ({entity.type.value}){alias_text}")
    return "\n".join(lines)


def _ensure_relation_ids(relations: list[Relation]) -> list[Relation]:
    updated: list[Relation] = []
    for relation in relations:
        if not relation.id:
            relation.id = str(uuid4())
        updated.append(relation)
    return updated


def _ensure_entity_ids(entities: list[Entity]) -> list[Entity]:
    updated: list[Entity] = []
    for entity in entities:
        if not entity.id:
            entity.id = str(uuid4())
        updated.append(entity)
    return updated


class GraphExtractor:
    def __init__(self, prompt_template: PromptTemplate | None = None) -> None:
        self.prompt_template = prompt_template or PROMPT_TEMPLATE

    async def extract_from_text(
        self,
        text: str,
        existing_graph: KnowledgeGraph,
    ) -> ExtractionResult:
        if not text.strip():
            return ExtractionResult()
        api_key = get_api_key("extraction")
        if not api_key:
            return ExtractionResult()

        model_name = get_model_name("extraction")
        schema = pydantic_to_openai_function_inline(ExtractionResult)
        prompt_schema = pydantic_json_schema_inline(ExtractionResult)
        llm = ChatOpenAI(
            api_key=api_key,
            base_url=get_base_url(),
            model=model_name,
        ).with_structured_output(schema)

        try:
            prompt = self.prompt_template.format(
                text=text,
                existing_entities=_serialize_entities(existing_graph.entities),
                output_schema=json.dumps(
                    prompt_schema, ensure_ascii=False, indent=2
                ),
            )
        except KeyError as exc:
            raise ValueError(
                "自定义 Prompt 缺少必要变量：text、existing_entities、output_schema"
            ) from exc

        raw_result = await asyncio.to_thread(llm.invoke, prompt)
        if raw_result is None:
            return ExtractionResult()
        if isinstance(raw_result, ExtractionResult):
            result = raw_result
        elif isinstance(raw_result, dict):
            result = ExtractionResult.model_validate(raw_result)
        elif hasattr(raw_result, "model_dump"):
            result = ExtractionResult.model_validate(raw_result.model_dump())
        else:
            result = ExtractionResult.model_validate(raw_result)
        result.new_entities = _ensure_entity_ids(result.new_entities)
        result.new_relations = _ensure_relation_ids(result.new_relations)
        return result

    async def extract_from_node(
        self,
        node: StoryNode,
        existing_graph: KnowledgeGraph,
    ) -> ExtractionResult:
        text = "\n".join([node.title, node.content]).strip()
        result = await self.extract_from_text(text, existing_graph)
        if result.new_entities:
            for entity in result.new_entities:
                if node.id not in entity.source_refs:
                    entity.source_refs.append(node.id)
        if result.new_relations:
            for relation in result.new_relations:
                if node.id not in relation.source_refs:
                    relation.source_refs.append(node.id)
        return result

    async def build_full_graph(
        self,
        project: StoryProject,
    ) -> KnowledgeGraph:
        graph = KnowledgeGraph(
            project_id=project.id,
            entities=[],
            relations=[],
            last_updated=project.updated_at,
        )

        for node in project.nodes:
            result = await self.extract_from_node(node, graph)
            graph.entities.extend(result.new_entities)
            graph.relations.extend(result.new_relations)
        graph.last_updated = project.updated_at
        return graph

    async def incremental_update(
        self,
        project_id: str,
        modified_node: StoryNode,
        current_graph: KnowledgeGraph,
    ) -> KnowledgeGraph:
        updated_graph = KnowledgeGraph(
            project_id=project_id,
            entities=list(current_graph.entities),
            relations=list(current_graph.relations),
            last_updated=current_graph.last_updated,
        )
        result = await self.extract_from_node(modified_node, updated_graph)
        updated_graph.entities.extend(result.new_entities)
        updated_graph.relations.extend(result.new_relations)
        updated_graph.last_updated = datetime.utcnow()
        return updated_graph
