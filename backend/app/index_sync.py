from __future__ import annotations

import difflib
from dataclasses import dataclass
from typing import Iterable

from pydantic import BaseModel, Field

from .graph_extractor import GraphExtractor
from .knowledge_graph import Entity, KnowledgeGraph, Relation
from .models import StoryNode, StoryProject
from .node_indexer import NodeIndexer


class SyncResult(BaseModel):
    success: bool
    vector_updated: bool
    graph_updated: bool
    new_entities: list[Entity] = Field(default_factory=list)
    new_relations: list[Relation] = Field(default_factory=list)
    removed_entities: list[str] = Field(default_factory=list)
    removed_relations: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


@dataclass
class _GraphDiff:
    new_entities: list[Entity]
    new_relations: list[Relation]
    removed_entities: list[str]
    removed_relations: list[str]


class IndexSyncManager:
    def __init__(
        self,
        node_indexer: NodeIndexer,
        graph_extractor: GraphExtractor,
    ):
        self.node_indexer = node_indexer
        self.graph_extractor = graph_extractor

    async def sync_node_update(
        self,
        project_id: str,
        old_node: StoryNode | None,
        new_node: StoryNode,
        current_graph: KnowledgeGraph,
    ) -> SyncResult:
        result = SyncResult(success=True, vector_updated=False, graph_updated=False)

        await self.node_indexer.index_node(project_id, new_node)
        result.vector_updated = True

        if old_node:
            similarity = self._calculate_similarity(
                self._node_text(old_node),
                self._node_text(new_node),
            )
            if similarity > 0.95:
                return result

        updated_graph = await self.graph_extractor.incremental_update(
            project_id=project_id,
            modified_node=new_node,
            current_graph=current_graph,
        )

        removed_entities: set[str] = set()
        removed_entity_refs: set[str] = set()
        if old_node:
            old_mentions = self._extract_entity_mentions(old_node.content, current_graph)
            new_mentions = self._extract_entity_mentions(new_node.content, current_graph)
            removed_entities = old_mentions - new_mentions
            removed_entity_refs = removed_entities.copy()

        diff = self._diff_graphs(current_graph, updated_graph)
        if removed_entities:
            diff.removed_entities.extend(
                entity_id
                for entity_id in removed_entities
                if entity_id not in diff.removed_entities
            )

        if removed_entity_refs:
            for entity in updated_graph.entities:
                if entity.id not in removed_entity_refs:
                    continue
                if not isinstance(entity.properties, dict):
                    continue
                appearances = entity.properties.get("appearances")
                if not isinstance(appearances, list):
                    continue
                if old_node and old_node.id in appearances:
                    entity.properties["appearances"] = [
                        item for item in appearances if item != old_node.id
                    ]

        result.new_entities = diff.new_entities
        result.new_relations = diff.new_relations
        result.removed_entities = diff.removed_entities
        result.removed_relations = diff.removed_relations
        result.graph_updated = True
        current_graph.entities = updated_graph.entities
        current_graph.relations = updated_graph.relations
        current_graph.last_updated = updated_graph.last_updated
        return result

    async def sync_node_create(
        self,
        project_id: str,
        new_node: StoryNode,
        current_graph: KnowledgeGraph,
    ) -> SyncResult:
        return await self.sync_node_update(
            project_id=project_id,
            old_node=None,
            new_node=new_node,
            current_graph=current_graph,
        )

    async def sync_node_delete(
        self,
        project_id: str,
        node_id: str,
        current_graph: KnowledgeGraph,
    ) -> SyncResult:
        result = SyncResult(success=True, vector_updated=False, graph_updated=False)

        await self.node_indexer.remove_node(project_id, node_id)
        result.vector_updated = True

        removed_entities: list[str] = []
        removed_relations: list[str] = []
        for entity in list(current_graph.entities):
            if node_id in entity.source_refs:
                entity.source_refs = [ref for ref in entity.source_refs if ref != node_id]
                if not entity.source_refs:
                    removed_entities.append(entity.id)
                    current_graph.entities.remove(entity)
            if entity.id not in removed_entities and isinstance(entity.properties, dict):
                appearances = entity.properties.get("appearances")
                if isinstance(appearances, list) and node_id in appearances:
                    entity.properties["appearances"] = [
                        item for item in appearances if item != node_id
                    ]
        for relation in list(current_graph.relations):
            if node_id in relation.source_refs:
                relation.source_refs = [
                    ref for ref in relation.source_refs if ref != node_id
                ]
                if not relation.source_refs:
                    removed_relations.append(relation.id)
                    current_graph.relations.remove(relation)

        result.removed_entities = removed_entities
        result.removed_relations = removed_relations
        result.graph_updated = True
        return result

    async def full_reindex(
        self,
        project: StoryProject,
    ) -> SyncResult:
        result = SyncResult(success=True, vector_updated=False, graph_updated=False)
        indexed = await self.node_indexer.index_project(project)
        result.vector_updated = indexed > 0

        updated_graph = await self.graph_extractor.build_full_graph(project)
        result.new_entities = updated_graph.entities
        result.new_relations = updated_graph.relations
        result.graph_updated = True
        return result

    async def sync_batch_updates(
        self,
        project_id: str,
        updates: list[tuple[StoryNode | None, StoryNode]],
        current_graph: KnowledgeGraph,
    ) -> SyncResult:
        result = SyncResult(success=True, vector_updated=False, graph_updated=False)

        significant_updates: list[StoryNode] = []
        for old_node, new_node in updates:
            await self.node_indexer.index_node(project_id, new_node)
            result.vector_updated = True
            if old_node is None:
                significant_updates.append(new_node)
                continue
            similarity = self._calculate_similarity(
                self._node_text(old_node),
                self._node_text(new_node),
            )
            if similarity <= 0.95:
                significant_updates.append(new_node)

        graph = current_graph
        all_new_entities: list[Entity] = []
        all_new_relations: list[Relation] = []
        for node in significant_updates:
            updated_graph = await self.graph_extractor.incremental_update(
                project_id=project_id,
                modified_node=node,
                current_graph=graph,
            )
            diff = self._diff_graphs(graph, updated_graph)
            all_new_entities.extend(diff.new_entities)
            all_new_relations.extend(diff.new_relations)
            graph = updated_graph

        if significant_updates:
            result.new_entities = all_new_entities
            result.new_relations = all_new_relations
            result.graph_updated = True
            current_graph.entities = graph.entities
            current_graph.relations = graph.relations
            current_graph.last_updated = graph.last_updated

        return result

    def _calculate_similarity(self, old_text: str, new_text: str) -> float:
        return difflib.SequenceMatcher(None, old_text, new_text).ratio()

    @staticmethod
    def _node_text(node: StoryNode) -> str:
        parts = [node.title.strip(), node.content.strip()]
        return "\n\n".join(part for part in parts if part)

    def _extract_entity_mentions(
        self,
        text: str,
        graph: KnowledgeGraph,
    ) -> set[str]:
        lowered = text.lower()
        mentioned: set[str] = set()
        for entity in graph.entities:
            if entity.name.lower() in lowered:
                mentioned.add(entity.id)
                continue
            for alias in entity.aliases:
                if alias.lower() in lowered:
                    mentioned.add(entity.id)
                    break
        return mentioned

    def _diff_graphs(
        self,
        before: KnowledgeGraph,
        after: KnowledgeGraph,
    ) -> _GraphDiff:
        before_entities = {entity.id: entity for entity in before.entities}
        after_entities = {entity.id: entity for entity in after.entities}
        before_relations = {relation.id: relation for relation in before.relations}
        after_relations = {relation.id: relation for relation in after.relations}

        new_entities = [
            entity for entity_id, entity in after_entities.items() if entity_id not in before_entities
        ]
        new_relations = [
            relation
            for relation_id, relation in after_relations.items()
            if relation_id not in before_relations
        ]
        removed_entities = [
            entity_id for entity_id in before_entities if entity_id not in after_entities
        ]
        removed_relations = [
            relation_id for relation_id in before_relations if relation_id not in after_relations
        ]

        return _GraphDiff(
            new_entities=new_entities,
            new_relations=new_relations,
            removed_entities=removed_entities,
            removed_relations=removed_relations,
        )
