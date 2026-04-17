from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, JSON, String, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class ProjectTable(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    owner_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    world_view: Mapped[str] = mapped_column(String, nullable=False)
    style_tags: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    data_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class UserTable(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    username: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    token_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class VersionIndex(Base):
    __tablename__ = "version_index"
    __table_args__ = (UniqueConstraint("project_id", "version", name="uq_version_project"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    snapshot_type: Mapped[str] = mapped_column(String, nullable=False)
    name: Mapped[str | None] = mapped_column(String, nullable=True)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    node_count: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    file_path: Mapped[str] = mapped_column(String, nullable=False)
    is_compressed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class StyleLibraryTable(Base):
    __tablename__ = "style_libraries"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    owner_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(String, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class AsyncTaskTable(Base):
    __tablename__ = "async_tasks"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    owner_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String, nullable=False, index=True)
    title: Mapped[str | None] = mapped_column(String, nullable=True)
    request_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    result_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error_message: Mapped[str | None] = mapped_column(String, nullable=True)
    progress_stage: Mapped[str | None] = mapped_column(String, nullable=True)
    progress_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
