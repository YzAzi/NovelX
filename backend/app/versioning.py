from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field, model_validator

from .knowledge_graph import KnowledgeGraph
from .models import StoryProject
from .style_knowledge import StyleDocument


class SnapshotType(str, Enum):
    # Legacy values are kept for backward-compatible loading of old snapshots.
    AUTO = "auto"
    MANUAL = "manual"
    MILESTONE = "milestone"
    PRE_SYNC = "pre_sync"


class IndexSnapshot(BaseModel):
    version: int
    snapshot_type: SnapshotType
    name: str | None = None
    description: str | None = None
    story_project: StoryProject
    knowledge_graph: KnowledgeGraph
    style_documents: list[StyleDocument] = Field(default_factory=list)
    node_count: int
    entity_count: int
    created_at: datetime = Field(default_factory=datetime.utcnow)

    @model_validator(mode="before")
    @classmethod
    def normalize_legacy_snapshot_fields(cls, value):
        if not isinstance(value, dict):
            return value
        if "style_documents" not in value and "world_documents" in value:
            value = dict(value)
            value["style_documents"] = value.pop("world_documents")
        return value


class VersionDiff(BaseModel):
    nodes_added: list[str] = Field(default_factory=list)
    nodes_modified: list[str] = Field(default_factory=list)
    nodes_deleted: list[str] = Field(default_factory=list)
    entities_added: list[str] = Field(default_factory=list)
    entities_deleted: list[str] = Field(default_factory=list)
    relations_added: list[str] = Field(default_factory=list)
    relations_deleted: list[str] = Field(default_factory=list)
    words_added: int = 0
    words_removed: int = 0
