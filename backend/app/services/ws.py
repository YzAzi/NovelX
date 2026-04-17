from __future__ import annotations

import asyncio

from fastapi import WebSocket, WebSocketDisconnect

from ..auth import authenticate_access_token, decode_channel_token
from ..crud import get_project
from ..database import AsyncSessionLocal
from ..db_models import AsyncTaskTable
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
    async with AsyncSessionLocal() as session:
        user = await authenticate_access_token(session, token)
        if user is None:
            await websocket.close(code=4401)
            return
        project = await get_project(session, project_id, owner_id=user.id)
    if project is None:
        await websocket.close(code=4403)
        return

    await serve_channel_socket(websocket, project_id)


async def outline_progress_websocket_channel(
    websocket: WebSocket,
    request_id: str,
) -> None:
    token = websocket.query_params.get("token")
    async with AsyncSessionLocal() as session:
        user = await authenticate_access_token(session, token)
    if user is None:
        await websocket.close(code=4401)
        return
    channel_token = websocket.query_params.get("channel_token")
    if not channel_token:
        await websocket.close(code=4403)
        return
    if (
        decode_channel_token(
            channel_token,
            expected_user_id=user.id,
            expected_channel_id=request_id,
            expected_scope="outline_progress",
        )
        is None
    ):
        await websocket.close(code=4403)
        return

    await serve_channel_socket(websocket, request_id)


async def async_task_websocket_channel(websocket: WebSocket, task_id: str) -> None:
    token = websocket.query_params.get("token")
    async with AsyncSessionLocal() as session:
        user = await authenticate_access_token(session, token)
        if user is None:
            await websocket.close(code=4401)
            return
        task = await session.get(AsyncTaskTable, task_id)
    if task is None or task.owner_id != user.id:
        await websocket.close(code=4403)
        return

    await serve_channel_socket(websocket, f"task:{task_id}")
