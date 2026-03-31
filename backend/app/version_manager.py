from __future__ import annotations

import logging
from datetime import datetime

from .knowledge_graph import KnowledgeGraph
from .models import StoryNode, StoryProject
from .version_storage import VersionStorage
from .versioning import IndexSnapshot, SnapshotType, VersionDiff
from .style_knowledge import StyleKnowledgeManager, StyleDocument

logger = logging.getLogger(__name__)


class VersionManager:
    def __init__(
        self,
        storage: VersionStorage | None = None,
        style_knowledge: StyleKnowledgeManager | None = None,
    ) -> None:
        self._storage = storage or VersionStorage()
        self._style_knowledge = style_knowledge or StyleKnowledgeManager()

    async def create_snapshot(
        self,
        project: StoryProject,
        graph: KnowledgeGraph,
        snapshot_type: SnapshotType,
        name: str | None = None,
        description: str | None = None,
    ) -> IndexSnapshot:
        latest_version = await self._get_latest_version(project.id)
        version = latest_version + 1
        style_documents = await self._style_knowledge.list_project_documents(project.id)
        snapshot = IndexSnapshot(
            version=version,
            snapshot_type=snapshot_type,
            name=name,
            description=description,
            story_project=project,
            knowledge_graph=graph,
            style_documents=style_documents,
            node_count=len(project.nodes),
            entity_count=len(graph.entities),
            created_at=datetime.utcnow(),
        )
        await self._storage.save_snapshot(snapshot)
        return snapshot

    async def restore_snapshot(
        self, project_id: str, version: int
    ) -> tuple[StoryProject, KnowledgeGraph, list[StyleDocument]]:
        snapshot = await self._storage.load_snapshot(project_id, version)
        return (
            snapshot.story_project,
            snapshot.knowledge_graph,
            snapshot.style_documents,
        )

    async def load_snapshot(self, project_id: str, version: int) -> IndexSnapshot:
        return await self._storage.load_snapshot(project_id, version)

    async def compare_versions(
        self, project_id: str, from_ver: int, to_ver: int
    ) -> VersionDiff:
        before = await self._storage.load_snapshot(project_id, from_ver)
        after = await self._storage.load_snapshot(project_id, to_ver)

        before_nodes = {node.id: node for node in before.story_project.nodes}
        after_nodes = {node.id: node for node in after.story_project.nodes}

        nodes_added = [node_id for node_id in after_nodes if node_id not in before_nodes]
        nodes_deleted = [node_id for node_id in before_nodes if node_id not in after_nodes]
        nodes_modified = [
            node_id
            for node_id in after_nodes
            if node_id in before_nodes
            and not self._nodes_equal(before_nodes[node_id], after_nodes[node_id])
        ]

        before_entities = {entity.id for entity in before.knowledge_graph.entities}
        after_entities = {entity.id for entity in after.knowledge_graph.entities}
        entities_added = [entity_id for entity_id in after_entities if entity_id not in before_entities]
        entities_deleted = [entity_id for entity_id in before_entities if entity_id not in after_entities]

        before_relations = {relation.id for relation in before.knowledge_graph.relations}
        after_relations = {relation.id for relation in after.knowledge_graph.relations}
        relations_added = [rel_id for rel_id in after_relations if rel_id not in before_relations]
        relations_deleted = [rel_id for rel_id in before_relations if rel_id not in after_relations]

        before_words = self._count_words(before.story_project.nodes)
        after_words = self._count_words(after.story_project.nodes)
        if after_words >= before_words:
            words_added = after_words - before_words
            words_removed = 0
        else:
            words_added = 0
            words_removed = before_words - after_words

        return VersionDiff(
            nodes_added=nodes_added,
            nodes_modified=nodes_modified,
            nodes_deleted=nodes_deleted,
            entities_added=entities_added,
            entities_deleted=entities_deleted,
            relations_added=relations_added,
            relations_deleted=relations_deleted,
            words_added=words_added,
            words_removed=words_removed,
        )

    async def list_versions(self, project_id: str) -> list[dict]:
        snapshots = await self._storage.list_snapshots(project_id)
        if not snapshots:
            return []

        snapshots_sorted = sorted(snapshots, key=lambda item: item["version"])
        words_by_version: dict[int, int] = {}
        for item in snapshots_sorted:
            try:
                snapshot = await self._storage.load_snapshot(project_id, item["version"])
            except Exception as exc:
                logger.warning(
                    "Failed to load snapshot %s v%s: %s",
                    project_id,
                    item["version"],
                    exc,
                )
                continue
            words_by_version[item["version"]] = self._count_words(
                snapshot.story_project.nodes
            )

        changes_by_version: dict[int, dict[str, int]] = {}
        prev_words: int | None = None
        for item in snapshots_sorted:
            current_words = words_by_version.get(item["version"])
            if current_words is None:
                changes_by_version[item["version"]] = {
                    "words_added": 0,
                    "words_removed": 0,
                }
                continue
            if prev_words is None:
                changes_by_version[item["version"]] = {
                    "words_added": 0,
                    "words_removed": 0,
                }
            else:
                diff = current_words - prev_words
                changes_by_version[item["version"]] = {
                    "words_added": max(diff, 0),
                    "words_removed": max(-diff, 0),
                }
            prev_words = current_words

        return [
            {**item, **changes_by_version.get(item["version"], {"words_added": 0, "words_removed": 0})}
            for item in snapshots
        ]

    async def delete_version(self, project_id: str, version: int) -> None:
        snapshots = await self._storage.list_snapshots(project_id)
        target = next((item for item in snapshots if item["version"] == version), None)
        if not target:
            raise FileNotFoundError("Snapshot not found")
        await self._storage.delete_snapshot(project_id, version)

    async def delete_project_data(self, project_id: str) -> None:
        await self._storage.delete_project_data(project_id)

    async def import_snapshots(self, snapshots: list[IndexSnapshot]) -> None:
        for snapshot in snapshots:
            await self._storage.save_snapshot(snapshot)

    async def _get_latest_version(self, project_id: str) -> int:
        snapshots = await self._storage.list_snapshots(project_id)
        if not snapshots:
            return 0
        return max(item["version"] for item in snapshots)

    @staticmethod
    def _nodes_equal(first: StoryNode, second: StoryNode) -> bool:
        return first.model_dump() == second.model_dump()

    @staticmethod
    def _count_words(nodes: list[StoryNode]) -> int:
        return sum(
            len(node.content or "")
            + len(node.title or "")
            + len(node.location_tag or "")
            for node in nodes
        )
