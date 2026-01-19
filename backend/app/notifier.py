from __future__ import annotations

from typing import Any

from .websocket_manager import ConnectionManager, WSMessageType


class EventNotifier:
    def __init__(self, manager: ConnectionManager) -> None:
        self._manager = manager

    async def notify_node_updated(
        self, project_id: str, node: dict, updated_by: str
    ) -> None:
        await self._manager.broadcast_to_project(
            project_id,
            WSMessageType.NODE_UPDATED,
            {"node": node, "updated_by": updated_by},
        )

    async def notify_graph_updated(
        self, project_id: str, sync_result: dict
    ) -> None:
        await self._manager.broadcast_to_project(
            project_id,
            WSMessageType.GRAPH_UPDATED,
            {"sync_result": sync_result},
        )

    async def notify_conflict_detected(
        self, project_id: str, conflicts: list[dict]
    ) -> None:
        await self._manager.broadcast_to_project(
            project_id,
            WSMessageType.CONFLICT_DETECTED,
            {"conflicts": conflicts},
        )

    async def notify_sync_progress(
        self, project_id: str, status: str, details: dict | None = None
    ) -> None:
        message_type = WSMessageType.SYNC_COMPLETED
        if status == "started":
            message_type = WSMessageType.SYNC_STARTED
        elif status == "failed":
            message_type = WSMessageType.SYNC_FAILED
        await self._manager.broadcast_to_project(
            project_id,
            message_type,
            {"status": status, "details": details or {}},
        )

    async def notify_outline_progress(
        self, channel_id: str, stage: str, details: dict | None = None
    ) -> None:
        await self._manager.broadcast_to_project(
            channel_id,
            WSMessageType.OUTLINE_PROGRESS,
            {"stage": stage, "details": details or {}},
        )
