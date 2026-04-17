from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_session
from ..models import (
    AsyncTaskCreateResponse,
    AsyncTaskKind,
    AsyncTaskListResponse,
    AsyncTaskResponse,
    CreateOutlineRequest,
    IdeaLabStageRequest,
    OutlineImportRequest,
    StoryDirectionRequest,
)
from ..runtime import async_task_service
from .auth import get_authenticated_user

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.post(
    "/story_directions",
    response_model=AsyncTaskCreateResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_story_directions_task(
    payload: StoryDirectionRequest,
    session: AsyncSession = Depends(get_session),
    user=Depends(get_authenticated_user),
):
    return await async_task_service.submit_story_directions_task(
        session,
        owner_id=user.id,
        payload=payload,
    )


@router.post(
    "/idea_lab/stage",
    response_model=AsyncTaskCreateResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_idea_lab_stage_task(
    payload: IdeaLabStageRequest,
    session: AsyncSession = Depends(get_session),
    user=Depends(get_authenticated_user),
):
    return await async_task_service.submit_idea_lab_stage_task(
        session,
        owner_id=user.id,
        payload=payload,
    )


@router.post(
    "/outline",
    response_model=AsyncTaskCreateResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_outline_task(
    payload: CreateOutlineRequest,
    session: AsyncSession = Depends(get_session),
    user=Depends(get_authenticated_user),
):
    return await async_task_service.submit_outline_generation_task(
        session,
        owner_id=user.id,
        payload=payload,
    )


@router.post(
    "/projects/{project_id}/outline/import",
    response_model=AsyncTaskCreateResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_outline_import_task(
    project_id: str,
    payload: OutlineImportRequest,
    session: AsyncSession = Depends(get_session),
    user=Depends(get_authenticated_user),
):
    return await async_task_service.submit_outline_import_task(
        session,
        owner_id=user.id,
        project_id=project_id,
        payload=payload,
    )


@router.get(
    "/{task_id}",
    response_model=AsyncTaskResponse,
    status_code=status.HTTP_200_OK,
)
async def get_task(
    task_id: str,
    session: AsyncSession = Depends(get_session),
    user=Depends(get_authenticated_user),
):
    return await async_task_service.get_task(session, task_id=task_id, owner_id=user.id)


@router.get(
    "",
    response_model=AsyncTaskListResponse,
    status_code=status.HTTP_200_OK,
)
async def get_tasks(
    kind: AsyncTaskKind | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
    user=Depends(get_authenticated_user),
):
    return await async_task_service.list_tasks(
        session,
        owner_id=user.id,
        kind=kind,
        limit=limit,
    )
