from __future__ import annotations

from enum import Enum

from fastapi import WebSocket


class WSMessageType(str, Enum):
    NODE_UPDATED = "node_updated"
    NODE_CREATED = "node_created"
    NODE_DELETED = "node_deleted"
    GRAPH_UPDATED = "graph_updated"
    CONFLICT_DETECTED = "conflict_detected"
    OUTLINE_PROGRESS = "outline_progress"
    ASYNC_TASK_UPDATED = "async_task_updated"
    SYNC_STARTED = "sync_started"
    SYNC_COMPLETED = "sync_completed"
    SYNC_FAILED = "sync_failed"
    PING = "ping"
    PONG = "pong"


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = {}

    async def connect(self, project_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.setdefault(project_id, set()).add(websocket)

    def disconnect(self, project_id: str, websocket: WebSocket) -> None:
        connections = self._connections.get(project_id)
        if not connections:
            return
        connections.discard(websocket)
        if not connections:
            self._connections.pop(project_id, None)

    async def broadcast_to_project(
        self,
        project_id: str,
        message_type: WSMessageType | str,
        payload: dict | None = None,
    ) -> None:
        connections = list(self._connections.get(project_id, set()))
        if not connections:
            return
        message = {"type": str(message_type), "payload": payload or {}}
        for websocket in connections:
            try:
                await websocket.send_json(message)
            except Exception:
                self.disconnect(project_id, websocket)
