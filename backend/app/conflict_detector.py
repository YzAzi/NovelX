from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Iterable

from pydantic import BaseModel, Field

from .knowledge_graph import Entity, EntityType, KnowledgeGraph, RelationType
from .models import StoryNode, StoryProject


class ConflictType(str, Enum):
    TIMELINE_INCONSISTENCY = "timeline"
    CHARACTER_CONTRADICTION = "character"
    RELATION_CONFLICT = "relation"
    WORLD_RULE_VIOLATION = "world_rule"


class Conflict(BaseModel):
    type: ConflictType
    severity: str
    description: str
    node_ids: list[str] = Field(default_factory=list)
    entity_ids: list[str] = Field(default_factory=list)
    suggestion: str | None = None


@dataclass
class CharacterRecord:
    name: str
    aliases: set[str] = field(default_factory=set)
    profile_ids: set[str] = field(default_factory=set)
    entity_ids: set[str] = field(default_factory=set)
    baseline_parts: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class RuleSpec:
    label: str
    source_terms: tuple[str, ...]
    contradiction_terms: tuple[str, ...]
    suggestion: str


GENERIC_LOCATION_TAGS = {
    "",
    "主线",
    "支线",
    "未标记",
    "回忆",
    "梦境",
    "闪回",
}

CHARACTER_STATE_RULES: tuple[RuleSpec, ...] = (
    RuleSpec(
        label="失明",
        source_terms=("失明", "目盲", "看不见", "双目失明", "盲眼"),
        contradiction_terms=("看见", "看清", "望见", "目光扫过", "看向"),
        suggestion="若角色恢复视觉或使用感知替代视力，请在节点里明确交代原因。",
    ),
    RuleSpec(
        label="失忆",
        source_terms=("失忆", "记忆全失", "想不起", "不记得"),
        contradiction_terms=("想起一切", "恢复记忆", "记得当年", "回忆起全部"),
        suggestion="若角色恢复记忆，请补充触发契机，避免像设定漂移。",
    ),
    RuleSpec(
        label="失声",
        source_terms=("失声", "不能说话", "无法开口", "哑了"),
        contradiction_terms=("开口说道", "他说", "她说", "回答道", "出声"),
        suggestion="若角色重新开口，请在情节里补充恢复过程或替代解释。",
    ),
)

ABILITY_RULES: tuple[RuleSpec, ...] = (
    RuleSpec(
        label="施法能力受限",
        source_terms=("不会法术", "无法施法", "没有灵力", "不能使用法术", "从未学过法术"),
        contradiction_terms=("施法", "结印", "催动法术", "释放灵力", "发动术式"),
        suggestion="若角色突破能力上限，请补充训练、代价或外力来源。",
    ),
    RuleSpec(
        label="战斗能力受限",
        source_terms=("不会武功", "不懂剑术", "不会用剑", "手无缚鸡之力"),
        contradiction_terms=("挥剑", "剑招", "刀法", "拳法", "轻松击倒"),
        suggestion="若角色突然具备战斗力，请补充成长来源或降低动作强度。",
    ),
    RuleSpec(
        label="水下行动能力受限",
        source_terms=("不会游泳", "畏水", "怕水", "不能下水"),
        contradiction_terms=("潜入水底", "游向深处", "在水下呼吸", "跃入海中"),
        suggestion="若角色克服了水下限制，请在前文或本章明确交代。",
    ),
)

RELATION_CONTRADICTION_KEYWORDS: dict[RelationType, tuple[str, ...]] = {
    RelationType.FRIEND: ("仇人", "敌人", "死敌", "追杀", "恨不得杀"),
    RelationType.LOVER: ("仇人", "死敌", "陌生人", "素不相识", "毫无感情"),
    RelationType.FAMILY: ("毫无血缘", "不是亲人", "陌生人", "素不相识"),
    RelationType.ENEMY: ("挚友", "好友", "恋人", "相爱", "夫妻", "亲人"),
    RelationType.MASTER_STUDENT: ("从未拜师", "不是弟子", "不认这个师父"),
}


class ConflictDetector:
    async def detect_conflicts(
        self,
        project: StoryProject,
        graph: KnowledgeGraph,
        modified_node: StoryNode,
    ) -> list[Conflict]:
        nodes = project.nodes or [modified_node]
        conflicts: list[Conflict] = []
        conflicts.extend(await self.check_timeline_consistency(nodes))

        character_records = self._build_character_records(project, graph)
        for record in character_records:
            mentions = self._find_character_mentions(record, nodes)
            if not mentions:
                continue
            conflicts.extend(await self.check_character_consistency(record, mentions))
            conflicts.extend(await self.check_profile_drift(record, mentions))
            conflicts.extend(await self.check_ability_consistency(record, mentions))

        conflicts.extend(self.check_location_consistency(nodes, graph, character_records))
        conflicts.extend(self.check_relation_consistency(nodes, graph, character_records))
        return self._dedupe_conflicts(conflicts)

    def build_generation_guardrails(
        self,
        project: StoryProject,
        graph: KnowledgeGraph,
        text: str,
        max_items: int = 8,
    ) -> list[str]:
        probe = StoryNode(
            title="写作助手上下文",
            content=text,
            narrative_order=1,
            timeline_order=1.0,
            location_tag="未标记",
            characters=[],
        )
        character_records = self._build_character_records(project, graph)
        relevant_records = [
            record
            for record in character_records
            if self._node_mentions_character_record(probe, record)
        ]
        if not relevant_records:
            relevant_records = character_records[:3]

        lines: list[str] = []
        for record in relevant_records[:max_items]:
            summary = "；".join(
                part.strip() for part in record.baseline_parts if part and part.strip()
            )
            if summary:
                lines.append(f"- 角色 {record.name}：{summary[:120]}")

        entity_map = {entity.id: entity for entity in graph.entities}
        relevant_entity_ids = {
            entity_id
            for record in relevant_records
            for entity_id in record.entity_ids
        }
        for relation in graph.relations:
            if (
                relation.source_id not in relevant_entity_ids
                or relation.target_id not in relevant_entity_ids
            ):
                continue
            source = entity_map.get(relation.source_id)
            target = entity_map.get(relation.target_id)
            if not source or not target:
                continue
            relation_label = relation.relation_name or relation.relation_type.value
            lines.append(f"- 关系 {source.name} / {target.name}：当前为 {relation_label}")
            if len(lines) >= max_items:
                break
        return lines[:max_items]

    async def check_timeline_consistency(
        self,
        nodes: list[StoryNode],
    ) -> list[Conflict]:
        if len(nodes) < 2:
            return []

        sorted_nodes = sorted(nodes, key=lambda node: node.narrative_order)
        conflicts: list[Conflict] = []
        for previous, current in zip(sorted_nodes, sorted_nodes[1:]):
            if current.timeline_order < previous.timeline_order:
                conflicts.append(
                    Conflict(
                        type=ConflictType.TIMELINE_INCONSISTENCY,
                        severity="warning",
                        description=(
                            f"叙事顺序 {current.narrative_order} 的时间线早于上一节点，"
                            "可能存在时间线逆序。"
                        ),
                        node_ids=[previous.id, current.id],
                        suggestion="请检查时间轴位置是否需要调整。",
                    )
                )
        return conflicts

    async def check_character_consistency(
        self,
        record: CharacterRecord,
        mentions: list[StoryNode],
    ) -> list[Conflict]:
        death_keywords = ("死亡", "死去", "身亡", "葬", "牺牲")
        alive_keywords = ("出现", "现身", "活着", "归来", "重逢")

        death_nodes: list[StoryNode] = []
        alive_nodes: list[StoryNode] = []
        for node in mentions:
            content = self._node_text(node)
            if self._contains_any(content, death_keywords):
                death_nodes.append(node)
            if self._contains_any(content, alive_keywords):
                alive_nodes.append(node)

        if not death_nodes or not alive_nodes:
            return []

        earliest_death = min(death_nodes, key=lambda node: node.timeline_order)
        conflicting_nodes = [
            node
            for node in alive_nodes
            if node.timeline_order > earliest_death.timeline_order
        ]

        if not conflicting_nodes:
            return []

        return [
            Conflict(
                type=ConflictType.CHARACTER_CONTRADICTION,
                severity="warning",
                description=(
                    f"角色 {record.name} 在时间线 {earliest_death.timeline_order} "
                    "之后仍有出场记录，可能与死亡描述冲突。"
                ),
                node_ids=[earliest_death.id] + [node.id for node in conflicting_nodes],
                entity_ids=sorted(record.entity_ids),
                suggestion="若角色复活、回忆或误导叙述，请在节点说明中标注。",
            )
        ]

    async def check_profile_drift(
        self,
        record: CharacterRecord,
        mentions: list[StoryNode],
    ) -> list[Conflict]:
        return self._check_rule_family(
            record=record,
            mentions=mentions,
            rules=CHARACTER_STATE_RULES,
            conflict_type=ConflictType.CHARACTER_CONTRADICTION,
            description_template="角色 {name} 与既有设定“{label}”冲突，当前节点出现了相反表现。",
        )

    async def check_ability_consistency(
        self,
        record: CharacterRecord,
        mentions: list[StoryNode],
    ) -> list[Conflict]:
        return self._check_rule_family(
            record=record,
            mentions=mentions,
            rules=ABILITY_RULES,
            conflict_type=ConflictType.WORLD_RULE_VIOLATION,
            description_template="角色 {name} 可能突破了既有能力上限“{label}”，请确认是否已有铺垫。",
        )

    def check_location_consistency(
        self,
        nodes: list[StoryNode],
        graph: KnowledgeGraph,
        character_records: list[CharacterRecord],
    ) -> list[Conflict]:
        conflicts: list[Conflict] = []
        location_entities = [
            entity for entity in graph.entities if entity.type == EntityType.LOCATION
        ]
        if not location_entities:
            return conflicts

        for node in nodes:
            explicit_locations = self._find_explicit_locations(node, location_entities)
            if len(explicit_locations) == 1:
                explicit_name = explicit_locations[0].name
                if self._tag_conflicts_with_location(node.location_tag, explicit_locations[0]):
                    conflicts.append(
                        Conflict(
                            type=ConflictType.WORLD_RULE_VIOLATION,
                            severity="warning",
                            description=(
                                f"节点《{node.title}》的位置标签为“{node.location_tag}”，"
                                f"正文却明确指向“{explicit_name}”，地点信息可能不一致。"
                            ),
                            node_ids=[node.id],
                            entity_ids=[explicit_locations[0].id],
                            suggestion="统一节点位置标签与正文地点，避免后续检索或续写拿到错误场景。",
                        )
                    )

        for record in character_records:
            mentions = self._find_character_mentions(record, nodes)
            same_time_groups: dict[float, list[StoryNode]] = {}
            for node in mentions:
                same_time_groups.setdefault(node.timeline_order, []).append(node)
            for timeline_order, group in same_time_groups.items():
                if len(group) < 2:
                    continue
                location_names = {
                    node.location_tag.strip()
                    for node in group
                    if node.location_tag.strip() and node.location_tag.strip() not in GENERIC_LOCATION_TAGS
                }
                if len(location_names) < 2:
                    continue
                conflicts.append(
                    Conflict(
                        type=ConflictType.WORLD_RULE_VIOLATION,
                        severity="warning",
                        description=(
                            f"角色 {record.name} 在同一时间点 {timeline_order} "
                            f"同时出现在多个地点：{'、'.join(sorted(location_names))}。"
                        ),
                        node_ids=[node.id for node in group],
                        entity_ids=sorted(record.entity_ids),
                        suggestion="若是并行视角或误导叙事，请在节点中明确标记；否则应统一地点。",
                    )
                )
        return conflicts

    def check_relation_consistency(
        self,
        nodes: list[StoryNode],
        graph: KnowledgeGraph,
        character_records: list[CharacterRecord],
    ) -> list[Conflict]:
        conflicts: list[Conflict] = []
        entity_to_record = {
            entity_id: record
            for record in character_records
            for entity_id in record.entity_ids
        }
        for relation in graph.relations:
            contradiction_terms = RELATION_CONTRADICTION_KEYWORDS.get(relation.relation_type)
            if not contradiction_terms:
                continue
            source_record = entity_to_record.get(relation.source_id)
            target_record = entity_to_record.get(relation.target_id)
            if not source_record or not target_record:
                continue

            for node in nodes:
                if not self._node_mentions_character_record(node, source_record):
                    continue
                if not self._node_mentions_character_record(node, target_record):
                    continue
                if not self._contains_any(self._node_text(node), contradiction_terms):
                    continue
                relation_label = relation.relation_name or relation.relation_type.value
                conflicts.append(
                    Conflict(
                        type=ConflictType.RELATION_CONFLICT,
                        severity="warning",
                        description=(
                            f"节点《{node.title}》对 {source_record.name} 与 {target_record.name} "
                            f"的描述，可能与当前关系“{relation_label}”相冲突。"
                        ),
                        node_ids=[node.id],
                        entity_ids=[relation.source_id, relation.target_id],
                        suggestion="若关系已发生变化，请先在图谱或剧情节点中补足转折。",
                    )
                )
        return conflicts

    def _check_rule_family(
        self,
        record: CharacterRecord,
        mentions: list[StoryNode],
        rules: Iterable[RuleSpec],
        conflict_type: ConflictType,
        description_template: str,
    ) -> list[Conflict]:
        baseline_text = " ".join(record.baseline_parts)
        sorted_mentions = sorted(mentions, key=lambda node: node.timeline_order)
        conflicts: list[Conflict] = []
        for rule in rules:
            baseline_hit = self._contains_any(baseline_text, rule.source_terms)
            source_nodes = [
                node for node in sorted_mentions if self._contains_any(self._node_text(node), rule.source_terms)
            ]
            source_point = min((node.timeline_order for node in source_nodes), default=None)
            conflicting_nodes = [
                node
                for node in sorted_mentions
                if self._contains_any(self._node_text(node), rule.contradiction_terms)
                and (
                    baseline_hit
                    or source_point is None
                    or node.timeline_order >= source_point
                )
            ]
            if not conflicting_nodes or (not baseline_hit and not source_nodes):
                continue
            node_ids = [node.id for node in source_nodes[:1]] + [node.id for node in conflicting_nodes]
            conflicts.append(
                Conflict(
                    type=conflict_type,
                    severity="warning",
                    description=description_template.format(name=record.name, label=rule.label),
                    node_ids=node_ids,
                    entity_ids=sorted(record.entity_ids),
                    suggestion=rule.suggestion,
                )
            )
        return conflicts

    def _build_character_records(
        self,
        project: StoryProject,
        graph: KnowledgeGraph,
    ) -> list[CharacterRecord]:
        records: list[CharacterRecord] = []
        for profile in project.characters:
            record = self._get_or_create_record(records, profile.name)
            record.profile_ids.add(profile.id)
            record.baseline_parts.extend(profile.tags)
            if profile.bio:
                record.baseline_parts.append(profile.bio)
        for entity in graph.entities:
            if entity.type != EntityType.CHARACTER:
                continue
            record = self._get_or_create_record(records, entity.name, entity.aliases)
            record.entity_ids.add(entity.id)
            record.aliases.update(alias for alias in entity.aliases if alias and alias.strip())
            if entity.description:
                record.baseline_parts.append(entity.description)
            property_text = self._serialize_properties(entity.properties)
            if property_text:
                record.baseline_parts.append(property_text)
        return records

    def _get_or_create_record(
        self,
        records: list[CharacterRecord],
        name: str,
        aliases: Iterable[str] | None = None,
    ) -> CharacterRecord:
        names = {self._normalize(name)}
        for alias in aliases or []:
            normalized = self._normalize(alias)
            if normalized:
                names.add(normalized)
        for record in records:
            record_names = {self._normalize(record.name)} | {
                self._normalize(alias) for alias in record.aliases
            }
            if names & record_names:
                record.aliases.update(alias for alias in aliases or [] if alias and alias.strip())
                return record
        record = CharacterRecord(name=name)
        record.aliases.update(alias for alias in aliases or [] if alias and alias.strip())
        records.append(record)
        return record

    def _serialize_properties(self, properties: dict) -> str:
        if not isinstance(properties, dict):
            return ""
        parts: list[str] = []
        for key, value in properties.items():
            if key == "appearances":
                continue
            if isinstance(value, str):
                parts.append(value)
            elif isinstance(value, list):
                parts.extend(str(item) for item in value if item)
            elif value not in (None, "", {}):
                parts.append(str(value))
        return " ".join(parts)

    def _find_character_mentions(
        self,
        record: CharacterRecord,
        nodes: list[StoryNode],
    ) -> list[StoryNode]:
        return [node for node in nodes if self._node_mentions_character_record(node, record)]

    def _node_mentions_character_record(
        self,
        node: StoryNode,
        record: CharacterRecord,
    ) -> bool:
        if record.profile_ids and any(profile_id in node.characters for profile_id in record.profile_ids):
            return True
        content = self._node_text(node)
        terms = [record.name, *record.aliases]
        return any(self._normalize(term) in content for term in terms if self._normalize(term))

    def _find_explicit_locations(
        self,
        node: StoryNode,
        location_entities: list[Entity],
    ) -> list[Entity]:
        content = self._normalize(" ".join([node.title or "", node.content or ""]))
        matches: list[Entity] = []
        for entity in location_entities:
            names = [entity.name, *entity.aliases]
            if any(self._normalize(name) in content for name in names if self._normalize(name)):
                matches.append(entity)
        unique: dict[str, Entity] = {}
        for entity in matches:
            unique[entity.id] = entity
        return list(unique.values())

    def _tag_conflicts_with_location(self, location_tag: str, entity: Entity) -> bool:
        normalized_tag = self._normalize(location_tag)
        if not normalized_tag or location_tag.strip() in GENERIC_LOCATION_TAGS:
            return False
        allowed = {self._normalize(entity.name)} | {
            self._normalize(alias) for alias in entity.aliases
        }
        return normalized_tag not in allowed

    def _dedupe_conflicts(self, conflicts: list[Conflict]) -> list[Conflict]:
        unique: dict[tuple, Conflict] = {}
        for conflict in conflicts:
            key = (
                conflict.type.value,
                conflict.description,
                tuple(sorted(conflict.node_ids)),
                tuple(sorted(conflict.entity_ids)),
            )
            unique[key] = conflict
        return list(unique.values())

    def _contains_any(self, text: str, terms: Iterable[str]) -> bool:
        normalized_text = self._normalize(text)
        return any(self._normalize(term) in normalized_text for term in terms if self._normalize(term))

    def _node_text(self, node: StoryNode) -> str:
        return self._normalize(
            " ".join(
                [
                    node.title or "",
                    node.content or "",
                    node.location_tag or "",
                ]
            )
        )

    def _normalize(self, text: str) -> str:
        return (text or "").strip().lower()


class SyncNodeResponse(BaseModel):
    project: StoryProject
    sync_result: "SyncResult"
    conflicts: list[Conflict] = Field(default_factory=list)
    sync_status: str = "pending"


from .index_sync import SyncResult  # noqa: E402

SyncNodeResponse.model_rebuild()
