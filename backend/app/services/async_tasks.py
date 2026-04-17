from __future__ import annotations

import asyncio
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from langchain.prompts import PromptTemplate
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import create_channel_token
from ..crud import (
    create_async_task,
    get_async_task,
    list_async_tasks,
    mark_async_task_failed,
    mark_async_task_running,
    mark_async_task_succeeded,
    update_async_task_progress,
)
from ..database import AsyncSessionLocal
from ..db_models import AsyncTaskTable
from ..models import (
    AsyncTaskCreateResponse,
    AsyncTaskKind,
    AsyncTaskListResponse,
    AsyncTaskResponse,
    CreateOutlineRequest,
    IdeaLabStageRequest,
    IdeaLabStageResponse,
    OutlineImportRequest,
    StoryDirectionRequest,
    StoryDirectionResponse,
)
from ..notifier import EventNotifier
from ..request_context import reset_current_user_id, set_current_user_id
from .outline import (
    create_outline_project,
    generate_idea_lab_stage,
    generate_story_directions,
    import_outline_into_project,
)

STORY_DIRECTION_PROMPT_PATH = (
    Path(__file__).resolve().parent.parent / "prompts" / "story_direction_prompt.txt"
)
IDEA_LAB_STAGE_PROMPT_PATH = (
    Path(__file__).resolve().parent.parent / "prompts" / "idea_lab_stage_prompt.txt"
)
OUTLINE_IMPORT_PROMPT_PATH = (
    Path(__file__).resolve().parent.parent / "prompts" / "outline_import_prompt.txt"
)

STORY_DIRECTION_PROMPT_TEMPLATE = PromptTemplate.from_template(
    STORY_DIRECTION_PROMPT_PATH.read_text(encoding="utf-8")
)
IDEA_LAB_STAGE_PROMPT_TEMPLATE = PromptTemplate.from_template(
    IDEA_LAB_STAGE_PROMPT_PATH.read_text(encoding="utf-8")
)
OUTLINE_IMPORT_PROMPT_TEMPLATE = PromptTemplate.from_template(
    OUTLINE_IMPORT_PROMPT_PATH.read_text(encoding="utf-8")
)

class AsyncTaskService:
    def __init__(self, notifier: EventNotifier) -> None:
        self._notifier = notifier
        self._running_tasks: dict[str, asyncio.Task[None]] = {}

    async def submit_story_directions_task(
        self,
        session: AsyncSession,
        *,
        owner_id: str,
        payload: StoryDirectionRequest,
    ) -> AsyncTaskCreateResponse:
        title = "快速 3 选 1"
        task = await create_async_task(
            session,
            owner_id=owner_id,
            kind="story_directions",
            title=title,
            request_payload=payload.model_dump(mode="json"),
        )
        self._schedule(task.id, owner_id)
        return AsyncTaskCreateResponse(
            task=task,
            channel_token=create_channel_token(owner_id, task.id, scope="async_task"),
        )

    async def submit_idea_lab_stage_task(
        self,
        session: AsyncSession,
        *,
        owner_id: str,
        payload: IdeaLabStageRequest,
    ) -> AsyncTaskCreateResponse:
        title = f"Idea Lab · {payload.stage}"
        task = await create_async_task(
            session,
            owner_id=owner_id,
            kind="idea_lab_stage",
            title=title,
            request_payload=payload.model_dump(mode="json"),
        )
        self._schedule(task.id, owner_id)
        return AsyncTaskCreateResponse(
            task=task,
            channel_token=create_channel_token(owner_id, task.id, scope="async_task"),
        )

    async def submit_outline_generation_task(
        self,
        session: AsyncSession,
        *,
        owner_id: str,
        payload: CreateOutlineRequest,
    ) -> AsyncTaskCreateResponse:
        sanitized_payload = payload.model_copy(update={"request_id": None})
        task = await create_async_task(
            session,
            owner_id=owner_id,
            kind="create_outline",
            title="生成大纲",
            request_payload=sanitized_payload.model_dump(mode="json"),
        )
        self._schedule(task.id, owner_id)
        return AsyncTaskCreateResponse(
            task=task,
            channel_token=create_channel_token(owner_id, task.id, scope="async_task"),
        )

    async def submit_outline_import_task(
        self,
        session: AsyncSession,
        *,
        owner_id: str,
        project_id: str,
        payload: OutlineImportRequest,
    ) -> AsyncTaskCreateResponse:
        task = await create_async_task(
            session,
            owner_id=owner_id,
            kind="import_outline",
            title="导入大纲",
            request_payload={
                "project_id": project_id,
                **payload.model_dump(mode="json"),
            },
        )
        self._schedule(task.id, owner_id)
        return AsyncTaskCreateResponse(
            task=task,
            channel_token=create_channel_token(owner_id, task.id, scope="async_task"),
        )

    async def get_task(
        self,
        session: AsyncSession,
        *,
        task_id: str,
        owner_id: str,
    ) -> AsyncTaskResponse:
        task = await get_async_task(session, task_id, owner_id=owner_id)
        if task is None:
            raise HTTPException(status_code=404, detail="任务不存在")
        return task

    async def list_tasks(
        self,
        session: AsyncSession,
        *,
        owner_id: str,
        kind: AsyncTaskKind | None = None,
        limit: int = 20,
    ) -> AsyncTaskListResponse:
        tasks = await list_async_tasks(
            session,
            owner_id=owner_id,
            kind=kind,
            limit=max(1, min(limit, 100)),
        )
        return AsyncTaskListResponse(tasks=tasks)

    async def recover_interrupted_tasks(self) -> None:
        async with AsyncSessionLocal() as session:
            now = datetime.utcnow()
            await session.execute(
                update(AsyncTaskTable)
                .where(AsyncTaskTable.status.in_(["pending", "running"]))
                .values(
                    status="failed",
                    error_message="任务因服务重启而中断，请重新发起。",
                    updated_at=now,
                    completed_at=now,
                )
            )
            await session.commit()

    def _schedule(self, task_id: str, owner_id: str) -> None:
        existing = self._running_tasks.get(task_id)
        if existing and not existing.done():
            return
        task = asyncio.create_task(self._run(task_id, owner_id))
        self._running_tasks[task_id] = task
        task.add_done_callback(lambda _: self._running_tasks.pop(task_id, None))

    async def _run(self, task_id: str, owner_id: str) -> None:
        token = set_current_user_id(owner_id)
        try:
            async with AsyncSessionLocal() as session:
                task = await mark_async_task_running(session, task_id, owner_id=owner_id)
            if task is None:
                return
            await self._broadcast(task)

            if task.kind == "story_directions":
                await self._run_story_directions(task_id, owner_id, task.request_payload)
            elif task.kind == "idea_lab_stage":
                await self._run_idea_lab_stage(task_id, owner_id, task.request_payload)
            elif task.kind == "create_outline":
                await self._run_create_outline(task_id, owner_id, task.request_payload)
            elif task.kind == "import_outline":
                await self._run_import_outline(task_id, owner_id, task.request_payload)
            else:
                raise ValueError(f"未知任务类型: {task.kind}")
        except Exception as exc:
            async with AsyncSessionLocal() as session:
                failed = await mark_async_task_failed(
                    session,
                    task_id,
                    owner_id=owner_id,
                    error_message=self._format_task_error(exc),
                )
            if failed is not None:
                await self._broadcast(failed)
        finally:
            reset_current_user_id(token)

    async def _run_story_directions(
        self,
        task_id: str,
        owner_id: str,
        request_payload: dict[str, Any],
    ) -> None:
        payload = StoryDirectionRequest.model_validate(request_payload)
        async with AsyncSessionLocal() as session:
            result = await generate_story_directions(
                payload=payload,
                session=session,
                prompt_template=STORY_DIRECTION_PROMPT_TEMPLATE,
            )
        await self._finish_success(
            task_id,
            owner_id,
            result.model_dump(mode="json"),
        )

    async def _run_idea_lab_stage(
        self,
        task_id: str,
        owner_id: str,
        request_payload: dict[str, Any],
    ) -> None:
        payload = IdeaLabStageRequest.model_validate(request_payload)
        async with AsyncSessionLocal() as session:
            result = await generate_idea_lab_stage(
                payload=payload,
                session=session,
                prompt_template=IDEA_LAB_STAGE_PROMPT_TEMPLATE,
            )
        await self._finish_success(
            task_id,
            owner_id,
            result.model_dump(mode="json"),
        )

    async def _run_create_outline(
        self,
        task_id: str,
        owner_id: str,
        request_payload: dict[str, Any],
    ) -> None:
        payload = CreateOutlineRequest.model_validate(request_payload)

        async def report_progress(stage: str, details: dict[str, Any] | None = None) -> None:
            async with AsyncSessionLocal() as progress_session:
                updated = await update_async_task_progress(
                    progress_session,
                    task_id,
                    owner_id=owner_id,
                    stage=stage,
                    details=details or {},
                )
            if updated is not None:
                await self._broadcast(updated)

        async with AsyncSessionLocal() as session:
            project = await create_outline_project(
                payload,
                session,
                progress_callback=report_progress,
            )
        await self._finish_success(
            task_id,
            owner_id,
            project.model_dump(mode="json"),
        )

    async def _run_import_outline(
        self,
        task_id: str,
        owner_id: str,
        request_payload: dict[str, Any],
    ) -> None:
        project_id = str(request_payload.get("project_id") or "").strip()
        if not project_id:
            raise ValueError("缺少 project_id，无法导入大纲。")
        payload = OutlineImportRequest.model_validate(
            {"raw_text": request_payload.get("raw_text")}
        )

        async with AsyncSessionLocal() as session:
            project = await import_outline_into_project(
                project_id=project_id,
                payload=payload,
                session=session,
                outline_import_prompt_template=OUTLINE_IMPORT_PROMPT_TEMPLATE,
            )
        await self._finish_success(
            task_id,
            owner_id,
            project.model_dump(mode="json"),
        )

    async def _finish_success(
        self,
        task_id: str,
        owner_id: str,
        result_payload: dict[str, Any],
    ) -> None:
        async with AsyncSessionLocal() as session:
            completed = await mark_async_task_succeeded(
                session,
                task_id,
                owner_id=owner_id,
                result_payload=result_payload,
            )
        if completed is not None:
            await self._broadcast(completed)

    async def _broadcast(self, task: AsyncTaskResponse) -> None:
        await self._notifier.notify_async_task_updated(
            task.id,
            task.model_dump(mode="json"),
        )

    def _format_task_error(self, error: Exception) -> str:
        if isinstance(error, HTTPException):
            return str(error.detail)
        if isinstance(error, ValueError):
            return str(error)
        return str(error) or "任务执行失败，请稍后重试。"
