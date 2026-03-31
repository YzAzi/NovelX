from __future__ import annotations

from copy import deepcopy

from .knowledge_graph import (
    Entity,
    EntityType,
    KnowledgeGraph,
    Relation,
    RelationType,
    normalize_relation_type,
    new_entity_id,
    new_relation_id,
)


class GraphEditor:
    def __init__(self, knowledge_graph: KnowledgeGraph):
        self.graph = knowledge_graph

    async def update_entity(self, entity_id: str, updates: dict) -> Entity:
        snapshot = deepcopy(self.graph)
        try:
            entity = self._find_entity(entity_id)
            if entity is None:
                raise ValueError("Entity not found")
            normalized_updates = self._normalize_entity_updates(updates)
            for key, value in normalized_updates.items():
                setattr(entity, key, value)
            self._touch_graph()
            return entity
        except Exception:
            self.graph.entities = snapshot.entities
            self.graph.relations = snapshot.relations
            self.graph.last_updated = snapshot.last_updated
            raise

    async def delete_entity(self, entity_id: str) -> dict:
        snapshot = deepcopy(self.graph)
        try:
            entity = self._find_entity(entity_id)
            if entity is None:
                raise ValueError("Entity not found")
            before_count = len(self.graph.relations)
            self.graph.relations = [
                relation
                for relation in self.graph.relations
                if relation.source_id != entity_id and relation.target_id != entity_id
            ]
            deleted_relations = before_count - len(self.graph.relations)
            self.graph.entities = [
                item for item in self.graph.entities if item.id != entity_id
            ]
            self._touch_graph()
            return {"deleted_relations": deleted_relations}
        except Exception:
            self.graph.entities = snapshot.entities
            self.graph.relations = snapshot.relations
            self.graph.last_updated = snapshot.last_updated
            raise

    async def merge_entities(self, from_id: str, into_id: str) -> Entity:
        snapshot = deepcopy(self.graph)
        try:
            if from_id == into_id:
                raise ValueError("Cannot merge entity into itself")

            source = self._find_entity(from_id)
            target = self._find_entity(into_id)
            if source is None or target is None:
                raise ValueError("Entity not found")

            merged_aliases = set(target.aliases)
            merged_aliases.add(source.name)
            merged_aliases.update(source.aliases)
            merged_aliases.discard(target.name)
            target.aliases = list(merged_aliases)

            for relation in self.graph.relations:
                if relation.source_id == source.id:
                    relation.source_id = target.id
                if relation.target_id == source.id:
                    relation.target_id = target.id

            target.source_refs = list(set(target.source_refs + source.source_refs))
            self.graph.entities = [
                entity for entity in self.graph.entities if entity.id != source.id
            ]

            self._dedupe_relations()
            self._touch_graph()
            return target
        except Exception:
            self.graph.entities = snapshot.entities
            self.graph.relations = snapshot.relations
            self.graph.last_updated = snapshot.last_updated
            raise

    async def create_entity(self, payload: dict) -> Entity:
        snapshot = deepcopy(self.graph)
        try:
            normalized = self._normalize_entity_updates(payload)
            name = normalized.get("name")
            if not name:
                raise ValueError("Entity name is required")
            entity_type = normalized.get("type", EntityType.CHARACTER)
            description = normalized.get("description", "")
            entity = Entity(
                id=new_entity_id(),
                name=name,
                type=entity_type,
                description=description,
                aliases=normalized.get("aliases", []),
                properties=normalized.get("properties", {}),
                source_refs=normalized.get("source_refs", []),
            )
            self.graph.entities.append(entity)
            self._touch_graph()
            return entity
        except Exception:
            self.graph.entities = snapshot.entities
            self.graph.relations = snapshot.relations
            self.graph.last_updated = snapshot.last_updated
            raise

    def _find_entity(self, entity_id: str) -> Entity | None:
        for entity in self.graph.entities:
            if entity.id == entity_id:
                return entity
        return None

    def _normalize_entity_updates(self, updates: dict) -> dict:
        allowed_fields = {
            "name",
            "type",
            "description",
            "aliases",
            "properties",
            "source_refs",
        }
        normalized: dict = {}
        for key, value in updates.items():
            if key not in allowed_fields:
                raise ValueError(f"Unsupported field: {key}")
            if key == "type":
                if isinstance(value, EntityType):
                    normalized[key] = value
                elif isinstance(value, str):
                    normalized[key] = EntityType(value)
                else:
                    raise ValueError("Invalid entity type")
                continue
            if key in {"aliases", "source_refs"}:
                if not isinstance(value, list) or not all(
                    isinstance(item, str) for item in value
                ):
                    raise ValueError(f"Invalid {key} value")
                normalized[key] = value
                continue
            if key == "properties":
                if not isinstance(value, dict):
                    raise ValueError("Invalid properties value")
                normalized[key] = value
                continue
            if key in {"name", "description"}:
                if not isinstance(value, str):
                    raise ValueError(f"Invalid {key} value")
                normalized[key] = value
                continue
        return normalized

    def _dedupe_relations(self) -> None:
        unique: dict[tuple[str, str, str, str], Relation] = {}
        for relation in self.graph.relations:
            relation_type = (
                relation.relation_type.value
                if hasattr(relation.relation_type, "value")
                else str(relation.relation_type)
            )
            key = tuple(
                sorted([relation.source_id, relation.target_id])
                + [relation_type, relation.relation_name]
            )
            existing = unique.get(key)
            if not existing:
                unique[key] = relation
                continue
            keep = self._pick_relation(existing, relation)
            unique[key] = keep
        self.graph.relations = list(unique.values())

    def update_relation(self, relation_id: str, updates: dict) -> Relation:
        snapshot = deepcopy(self.graph)
        try:
            relation = next((r for r in self.graph.relations if r.id == relation_id), None)
            if relation is None:
                raise ValueError("Relation not found")
            
            if "relation_type" in updates:
                relation.relation_type = updates["relation_type"]
            if "relation_name" in updates:
                relation.relation_name = updates["relation_name"]
            if "description" in updates:
                relation.description = updates["description"]
            
            self._touch_graph()
            return relation
        except Exception:
            self.graph.entities = snapshot.entities
            self.graph.relations = snapshot.relations
            self.graph.last_updated = snapshot.last_updated
            raise

    def create_relation(self, payload: dict) -> Relation:
        snapshot = deepcopy(self.graph)
        try:
            source_id = payload.get("source_id")
            target_id = payload.get("target_id")
            if not source_id or not target_id:
                raise ValueError("Missing source_id or target_id")
            if source_id == target_id:
                raise ValueError("Source and target cannot be the same")

            source = next((e for e in self.graph.entities if e.id == source_id), None)
            target = next((e for e in self.graph.entities if e.id == target_id), None)
            if source is None or target is None:
                raise ValueError("Entity not found")
            if (
                source.type != EntityType.CHARACTER
                or target.type != EntityType.CHARACTER
            ):
                raise ValueError("Relation must connect character entities")

            raw_type = payload.get("relation_type") or RelationType.RELATED_TO
            relation_type = normalize_relation_type(raw_type)

            relation_name = payload.get("relation_name") or ""
            description = payload.get("description") or ""
            properties = payload.get("properties") or {}
            source_refs = payload.get("source_refs") or []
            if not isinstance(properties, dict):
                raise ValueError("Invalid properties value")
            if not isinstance(source_refs, list):
                raise ValueError("Invalid source_refs value")

            relation = Relation(
                id=new_relation_id(),
                source_id=source_id,
                target_id=target_id,
                relation_type=relation_type,
                relation_name=relation_name,
                description=description,
                properties=properties,
                source_refs=source_refs,
            )
            self.graph.relations.append(relation)
            self._dedupe_relations()
            self._touch_graph()
            return relation
        except Exception:
            self.graph.entities = snapshot.entities
            self.graph.relations = snapshot.relations
            self.graph.last_updated = snapshot.last_updated
            raise

    def delete_relation(self, relation_id: str) -> dict:
        snapshot = deepcopy(self.graph)
        try:
            original_count = len(self.graph.relations)
            self.graph.relations = [r for r in self.graph.relations if r.id != relation_id]
            if len(self.graph.relations) == original_count:
                raise ValueError("Relation not found")
            self._touch_graph()
            return {"success": True}
        except Exception:
            self.graph.entities = snapshot.entities
            self.graph.relations = snapshot.relations
            self.graph.last_updated = snapshot.last_updated
            raise

    def _pick_relation(self, first: Relation, second: Relation) -> Relation:
        first_score = self._relation_score(first)
        second_score = self._relation_score(second)
        if second_score > first_score:
            return second
        return first

    def _relation_score(self, relation: Relation) -> float:
        weight = 0.0
        if isinstance(relation.properties, dict):
            weight = float(relation.properties.get("strength", 0.0) or 0.0)
        description_score = len(relation.description or "")
        return weight * 1000 + description_score

    def _touch_graph(self) -> None:
        from datetime import datetime

        self.graph.last_updated = datetime.utcnow()
