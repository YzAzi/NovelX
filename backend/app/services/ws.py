from __future__ import annotations

import asyncio

from fastapi import WebSocket, WebSocketDisconnect

from ..auth import decode_access_token
from ..crud import get_project
from ..database import AsyncSessionLocal
from ..runtime import ws_manager
from ..websocket_manager import WSMessageType


async def serve_channel_socket(websocket: WebSocket, channel_id: str) -> None:
    await ws_manager.connect(channel_id, websocket)

    async def heartbeat() -> None:
        while True:
            await asyncio.sleep(30)
            try:
                await websocket.send_json({"type": WSMessageType.PING.value, "payload": {}})
            except Exception:
                break

    heartbeat_task = asyncio.create_task(heartbeat())
    try:
        while True:
            data = await websocket.receive_json()
            message_type = data.get("type")
            if message_type == WSMessageType.PONG.value:
                continue
            if message_type == WSMessageType.PING.value:
                await websocket.send_json({"type": WSMessageType.PONG.value, "payload": {}})
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        heartbeat_task.cancel()
        ws_manager.disconnect(channel_id, websocket)


async def project_websocket(websocket: WebSocket, project_id: str) -> None:
    token = websocket.query_params.get("token")
    payload = decode_access_token(token) if token else None
    if not payload:
        await websocket.close(code=4401)
        return
    user_id = payload["sub"]

    async with AsyncSessionLocal() as session:
        project = await get_project(session, project_id, owner_id=user_id)
    if project is None:
        await websocket.close(code=4403)
        return

    await serve_channel_socket(websocket, project_id)


async def outline_progress_websocket_channel(
    websocket: WebSocket,
    request_id: str,
) -> None:
    token = websocket.query_params.get("token")
    payload = decode_access_token(token) if token else None
    if not payload:
        await websocket.close(code=4401)
        return

    await serve_channel_socket(websocket, request_id)
