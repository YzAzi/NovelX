from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import (
    create_access_token,
    decode_access_token,
    hash_password,
    parse_bearer_token,
    verify_password,
)
from ..database import get_session
from ..db_models import UserTable
from ..models import (
    AuthLoginRequest,
    AuthRegisterRequest,
    AuthTokenResponse,
    AuthUserResponse,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post(
    "/register",
    response_model=AuthTokenResponse,
    status_code=status.HTTP_200_OK,
)
async def register_user(
    payload: AuthRegisterRequest,
    session: AsyncSession = Depends(get_session),
):
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
        created_at=datetime.utcnow(),
    )
    session.add(user)
    await session.commit()

    return AuthTokenResponse(
        access_token=create_access_token(user.id),
        user=AuthUserResponse(id=user.id, username=user.username),
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
        access_token=create_access_token(user.id),
        user=AuthUserResponse(id=user.id, username=user.username),
    )


@router.get(
    "/me",
    response_model=AuthUserResponse,
    status_code=status.HTTP_200_OK,
)
async def current_user(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    token = parse_bearer_token(request.headers.get("Authorization"))
    payload = decode_access_token(token) if token else None
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing access token",
        )
    result = await session.execute(select(UserTable).where(UserTable.id == payload["sub"]))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    return AuthUserResponse(id=user.id, username=user.username)
