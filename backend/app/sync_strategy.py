from __future__ import annotations

import asyncio
from datetime import datetime
from enum import Enum

from pydantic import BaseModel

from .graph_extractor import GraphExtractor
from .index_sync import IndexSyncManager, SyncResult
from .knowledge_graph import load_graph, save_graph
from .models import StoryNode
from .node_indexer import NodeIndexer
from .world_knowledge import WorldKnowledgeManager


class SyncMode(str, Enum):
    IMMEDIATE = "immediate"
    DEBOUNCED = "debounced"
    BATCH = "batch"
    MANUAL = "manual"


class SyncConfig(BaseModel):
    vector_sync_mode: SyncMode = SyncMode.IMMEDIATE
    graph_sync_mode: SyncMode = SyncMode.MANUAL
    debounce_seconds: int = 5
    batch_size: int = 10
    batch_timeout_seconds: int = 60


class SyncQueue:
    def __init__(
        self,
        config: SyncConfig,
        index_sync_manager: IndexSyncManager | None = None,
    ):
        self.config = config
        self.index_sync_manager = index_sync_manager
        self.pending_updates: dict[str, dict[str, StoryNode]] = {}
        self.pending_old_nodes: dict[str, dict[str, StoryNode | None]] = {}
        self.last_update_time: dict[str, dict[str, datetime]] = {}
        self._lock = asyncio.Lock()

    async def enqueue(
        self,
        project_id: str,
        node: StoryNode,
        old_node: StoryNode | None = None,
    ) -> None:
        self.pending_updates.setdefault(project_id, {})[node.id] = node
        old_nodes = self.pending_old_nodes.setdefault(project_id, {})
        if node.id not in old_nodes or old_node is not None:
            old_nodes[node.id] = old_node
        self.last_update_time.setdefault(project_id, {})[node.id] = datetime.utcnow()

    async def process_ready(self, project_id: str | None = None) -> list[SyncResult]:
        if self.config.graph_sync_mode not in (SyncMode.DEBOUNCED, SyncMode.BATCH):
            return []
        if not self.index_sync_manager:
            raise RuntimeError("IndexSyncManager is required to process sync queue")

        async with self._lock:
            results: list[SyncResult] = []
            now = datetime.utcnow()
            project_ids = (
                [project_id]
                if project_id
                else list(self.pending_updates.keys())
            )

            for active_project_id in project_ids:
                pending = self.pending_updates.get(active_project_id, {})
                if not pending:
                    continue

                ready_node_ids: list[str] = []
                last_updates = self.last_update_time.get(active_project_id, {})

                if self.config.graph_sync_mode == SyncMode.BATCH:
                    oldest = min(last_updates.values()) if last_updates else now
                    batch_ready = len(pending) >= self.config.batch_size
                    timeout_ready = (
                        (now - oldest).total_seconds() >= self.config.batch_timeout_seconds
                    )
                    if batch_ready or timeout_ready:
                        ready_node_ids = list(pending.keys())
                else:
                    for node_id, update_time in list(last_updates.items()):
                        if (now - update_time).total_seconds() >= self.config.debounce_seconds:
                            ready_node_ids.append(node_id)

                if not ready_node_ids:
                    continue

                current_graph = load_graph(active_project_id)
                project_results: list[SyncResult] = []
                for node_id in ready_node_ids:
                    node = pending.pop(node_id, None)
                    old_node = self.pending_old_nodes.get(active_project_id, {}).pop(
                        node_id, None
                    )
                    last_updates.pop(node_id, None)
                    if node is None:
                        continue
                    result = await self.index_sync_manager.sync_node_update(
                        project_id=active_project_id,
                        old_node=old_node,
                        new_node=node,
                        current_graph=current_graph,
                    )
                    project_results.append(result)

                if project_results:
                    save_graph(current_graph)
                    results.extend(project_results)

                if not pending:
                    self.pending_updates.pop(active_project_id, None)
                    self.pending_old_nodes.pop(active_project_id, None)
                    self.last_update_time.pop(active_project_id, None)

            return results

    async def flush(self, project_id: str) -> list[SyncResult]:
        if self.config.graph_sync_mode == SyncMode.MANUAL:
            return []
        if not self.index_sync_manager:
            raise RuntimeError("IndexSyncManager is required to process sync queue")

        async with self._lock:
            pending = self.pending_updates.get(project_id, {})
            if not pending:
                return []

            current_graph = load_graph(project_id)
            results: list[SyncResult] = []
            for node_id, node in list(pending.items()):
                old_node = self.pending_old_nodes.get(project_id, {}).get(node_id)
                result = await self.index_sync_manager.sync_node_update(
                    project_id=project_id,
                    old_node=old_node,
                    new_node=node,
                    current_graph=current_graph,
                )
                results.append(result)

            save_graph(current_graph)
            self.pending_updates.pop(project_id, None)
            self.pending_old_nodes.pop(project_id, None)
            self.last_update_time.pop(project_id, None)
            return results


DEFAULT_SYNC_CONFIG = SyncConfig()


def build_default_sync_manager() -> IndexSyncManager:
    return IndexSyncManager(
        node_indexer=NodeIndexer(),
        graph_extractor=GraphExtractor(),
        knowledge_manager=WorldKnowledgeManager(),
    )
