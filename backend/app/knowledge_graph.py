from __future__ import annotations

import json
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator

from .storage_paths import project_file_candidates, resolve_project_file


class EntityType(str, Enum):
    CHARACTER = "character"
    LOCATION = "location"
    ITEM = "item"
    EVENT = "event"
    ORGANIZATION = "organization"
    CONCEPT = "concept"


class Entity(BaseModel):
    id: str
    name: str
    type: EntityType
    description: str
    aliases: list[str] = Field(default_factory=list)
    properties: dict = Field(default_factory=dict)
    source_refs: list[str] = Field(default_factory=list)


class RelationType(str, Enum):
    FAMILY = "family"
    FRIEND = "friend"
    ENEMY = "enemy"
    LOVER = "lover"
    MASTER_STUDENT = "master_student"
    COLLEAGUE = "colleague"
    BELONGS_TO = "belongs_to"
    LOCATED_AT = "located_at"
    PARTICIPATES_IN = "participates_in"
    RELATED_TO = "related_to"


_RELATION_TYPE_ALIASES = {
    "contains": RelationType.RELATED_TO,
    "include": RelationType.RELATED_TO,
    "includes": RelationType.RELATED_TO,
    "has": RelationType.RELATED_TO,
    "owns": RelationType.RELATED_TO,
    "part_of": RelationType.BELONGS_TO,
    "member_of": RelationType.BELONGS_TO,
    "in": RelationType.LOCATED_AT,
    "inside": RelationType.LOCATED_AT,
    "located_in": RelationType.LOCATED_AT,
    "location": RelationType.LOCATED_AT,
    "participates": RelationType.PARTICIPATES_IN,
}


def normalize_relation_type(value: Any) -> RelationType:
    if isinstance(value, RelationType):
        return value
    if value is None:
        return RelationType.RELATED_TO
    if isinstance(value, str):
        cleaned = value.strip().lower()
        if not cleaned:
            return RelationType.RELATED_TO
        try:
            return RelationType(cleaned)
        except ValueError:
            return _RELATION_TYPE_ALIASES.get(cleaned, RelationType.RELATED_TO)
    return RelationType.RELATED_TO


class Relation(BaseModel):
    id: str
    source_id: str
    target_id: str
    relation_type: RelationType
    relation_name: str
    description: str
    properties: dict = Field(default_factory=dict)
    source_refs: list[str] = Field(default_factory=list)

    @field_validator("relation_type", mode="before")
    @classmethod
    def normalize_relation_type_field(cls, value: Any) -> RelationType:
        return normalize_relation_type(value)


class KnowledgeGraph(BaseModel):
    project_id: str
    entities: list[Entity]
    relations: list[Relation]
    last_updated: datetime


def _storage_dir() -> Path:
    directory = Path(__file__).resolve().parent.parent / "data" / "knowledge_graph"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _graph_file(project_id: str) -> Path:
    return resolve_project_file(_storage_dir(), project_id, ".json")


def load_graph(project_id: str) -> KnowledgeGraph:
    path = _graph_file(project_id)
    if not path.exists():
        return KnowledgeGraph(
            project_id=project_id,
            entities=[],
            relations=[],
            last_updated=datetime.utcnow(),
        )
    payload = json.loads(path.read_text(encoding="utf-8"))
    return KnowledgeGraph.model_validate(payload)


def save_graph(graph: KnowledgeGraph) -> None:
    graph.last_updated = datetime.utcnow()
    path = _graph_file(graph.project_id)
    payload = graph.model_dump(mode="json")
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def delete_graph(project_id: str) -> None:
    for path in project_file_candidates(_storage_dir(), project_id, ".json"):
        if path.exists():
            path.unlink()


def new_entity_id() -> str:
    return str(uuid4())


def new_relation_id() -> str:
    return str(uuid4())
