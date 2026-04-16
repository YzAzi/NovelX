from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import (
    create_channel_token,
    create_access_token,
    hash_password,
    verify_password,
)
from ..crud import claim_unowned_projects
from ..database import get_session
from ..db_models import UserTable
from ..models import (
    AuthChangePasswordRequest,
    AuthLoginRequest,
    AuthOutlineChannelResponse,
    AuthRegisterRequest,
    AuthTokenResponse,
    AuthUpdateProfileRequest,
    AuthUserResponse,
)
from ..request_context import get_current_user_id

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _serialize_user(user: UserTable) -> AuthUserResponse:
    return AuthUserResponse(
        id=user.id,
        username=user.username,
        created_at=user.created_at,
    )


async def get_authenticated_user(
    session: AsyncSession = Depends(get_session),
) -> UserTable:
    user_id = get_current_user_id()
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing access token",
        )
    result = await session.execute(select(UserTable).where(UserTable.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    return user


@router.post(
    "/register",
    response_model=AuthTokenResponse,
    status_code=status.HTTP_200_OK,
)
async def register_user(
    payload: AuthRegisterRequest,
    session: AsyncSession = Depends(get_session),
):
    total_users = await session.scalar(select(func.count()).select_from(UserTable))
    username = payload.username.strip()
    if len(username) < 3:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username must be at least 3 characters",
        )
    if len(payload.password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 6 characters",
        )

    existing = await session.execute(select(UserTable).where(UserTable.username == username))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already exists",
        )

    user = UserTable(
        id=str(uuid4()),
        username=username,
        password_hash=hash_password(payload.password),
        token_version=0,
        created_at=datetime.utcnow(),
    )
    session.add(user)
    await session.commit()
    if total_users == 0:
        await claim_unowned_projects(session, user.id)

    return AuthTokenResponse(
        access_token=create_access_token(user.id, user.token_version),
        user=_serialize_user(user),
    )


@router.post(
    "/login",
    response_model=AuthTokenResponse,
    status_code=status.HTTP_200_OK,
)
async def login_user(
    payload: AuthLoginRequest,
    session: AsyncSession = Depends(get_session),
):
    username = payload.username.strip()
    result = await session.execute(select(UserTable).where(UserTable.username == username))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )
    return AuthTokenResponse(
        access_token=create_access_token(user.id, user.token_version),
        user=_serialize_user(user),
    )


@router.get(
    "/me",
    response_model=AuthUserResponse,
    status_code=status.HTTP_200_OK,
)
async def current_user(
    user: UserTable = Depends(get_authenticated_user),
):
    return _serialize_user(user)


@router.post(
    "/outline-channel",
    response_model=AuthOutlineChannelResponse,
    status_code=status.HTTP_200_OK,
)
async def create_outline_channel(
    user: UserTable = Depends(get_authenticated_user),
):
    request_id = f"outline-{uuid4()}"
    return AuthOutlineChannelResponse(
        request_id=request_id,
        channel_token=create_channel_token(
            user.id,
            request_id,
            scope="outline_progress",
        ),
    )


@router.patch(
    "/me",
    response_model=AuthUserResponse,
    status_code=status.HTTP_200_OK,
)
async def update_current_user(
    payload: AuthUpdateProfileRequest,
    user: UserTable = Depends(get_authenticated_user),
    session: AsyncSession = Depends(get_session),
):
    username = payload.username.strip()
    if len(username) < 3:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username must be at least 3 characters",
        )
    if username != user.username:
        existing = await session.execute(select(UserTable).where(UserTable.username == username))
        if existing.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username already exists",
            )
        user.username = username
        await session.commit()
        await session.refresh(user)
    return _serialize_user(user)


@router.post(
    "/change-password",
    response_model=AuthTokenResponse,
    status_code=status.HTTP_200_OK,
)
async def change_password(
    payload: AuthChangePasswordRequest,
    user: UserTable = Depends(get_authenticated_user),
    session: AsyncSession = Depends(get_session),
):
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )
    if len(payload.new_password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 6 characters",
        )
    if verify_password(payload.new_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be different from the current password",
        )
    user.password_hash = hash_password(payload.new_password)
    user.token_version += 1
    await session.commit()
    await session.refresh(user)
    return AuthTokenResponse(
        access_token=create_access_token(user.id, user.token_version),
        user=_serialize_user(user),
    )


@router.post(
    "/logout-all",
    status_code=status.HTTP_200_OK,
)
async def logout_all_sessions(
    user: UserTable = Depends(get_authenticated_user),
    session: AsyncSession = Depends(get_session),
):
    user.token_version += 1
    await session.commit()
    return {"logged_out": True}
