from __future__ import annotations

import os
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from .db_models import Base

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DEFAULT_DB_PATH = DATA_DIR / "stories.db"

DATABASE_URL = os.getenv("NOVEL_DATABASE_URL") or f"sqlite+aiosqlite:///{DEFAULT_DB_PATH}"

engine = create_async_engine(DATABASE_URL, future=True)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def init_db() -> None:
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
        result = await connection.execute(text("PRAGMA table_info(projects)"))
        columns = {row[1] for row in result.fetchall()}
        if "owner_id" not in columns:
            await connection.execute(text("ALTER TABLE projects ADD COLUMN owner_id VARCHAR"))
            await connection.execute(
                text("CREATE INDEX IF NOT EXISTS ix_projects_owner_id ON projects(owner_id)")
            )
        user_result = await connection.execute(text("PRAGMA table_info(users)"))
        user_columns = {row[1] for row in user_result.fetchall()}
        if "token_version" not in user_columns:
            await connection.execute(
                text("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0")
            )


async def get_session() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
