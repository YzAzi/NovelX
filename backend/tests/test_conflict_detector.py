import asyncio
from datetime import datetime

from app.conflict_detector import ConflictDetector, ConflictType
from app.knowledge_graph import Entity, EntityType, KnowledgeGraph, Relation, RelationType
from app.models import CharacterProfile, StoryNode, StoryProject


def make_project(nodes: list[StoryNode]) -> StoryProject:
    return StoryProject(
        id="project-1",
        title="测试项目",
        world_view="测试世界",
        nodes=nodes,
        characters=[
            CharacterProfile(
                id="char-1",
                name="陆沉",
                tags=["失明", "不会法术"],
                bio="天生失明，从未学过法术。",
            ),
            CharacterProfile(
                id="char-2",
                name="顾尧",
                tags=["同伴"],
                bio="陆沉多年的同行者。",
            ),
        ],
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )


def make_graph() -> KnowledgeGraph:
    return KnowledgeGraph(
        project_id="project-1",
        entities=[
            Entity(
                id="entity-char-1",
                name="陆沉",
                type=EntityType.CHARACTER,
                description="失明，无法施法。",
                aliases=[],
                properties={},
                source_refs=[],
            ),
            Entity(
                id="entity-char-2",
                name="顾尧",
                type=EntityType.CHARACTER,
                description="陆沉的好友。",
                aliases=[],
                properties={},
                source_refs=[],
            ),
            Entity(
                id="loc-1",
                name="王都",
                type=EntityType.LOCATION,
                description="王都城区。",
                aliases=[],
                properties={},
                source_refs=[],
            ),
            Entity(
                id="loc-2",
                name="黑塔",
                type=EntityType.LOCATION,
                description="王都外的高塔。",
                aliases=[],
                properties={},
                source_refs=[],
            ),
        ],
        relations=[
            Relation(
                id="rel-1",
                source_id="entity-char-1",
                target_id="entity-char-2",
                relation_type=RelationType.FRIEND,
                relation_name="好友",
                description="长期并肩作战",
                properties={},
                source_refs=[],
            )
        ],
        last_updated=datetime.utcnow(),
    )


def test_detects_profile_drift_and_ability_ceiling_conflicts():
    project = make_project(
        [
            StoryNode(
                id="node-1",
                title="突变",
                content="陆沉抬眼看清墙上的血字，又催动法术点燃了烛火。",
                narrative_order=1,
                timeline_order=1.0,
                location_tag="王都",
                characters=["char-1"],
            )
        ]
    )
    detector = ConflictDetector()

    conflicts = asyncio.run(
        detector.detect_conflicts(project, make_graph(), project.nodes[0])
    )

    conflict_types = {conflict.type for conflict in conflicts}
    descriptions = "\n".join(conflict.description for conflict in conflicts)
    assert ConflictType.CHARACTER_CONTRADICTION in conflict_types
    assert ConflictType.WORLD_RULE_VIOLATION in conflict_types
    assert "失明" in descriptions
    assert "能力上限" in descriptions


def test_detects_location_conflicts():
    project = make_project(
        [
            StoryNode(
                id="node-1",
                title="塔顶",
                content="陆沉在黑塔顶端等着风停。",
                narrative_order=1,
                timeline_order=2.0,
                location_tag="王都",
                characters=["char-1"],
            ),
            StoryNode(
                id="node-2",
                title="城门",
                content="同一时刻，陆沉已经站在王都城门前。",
                narrative_order=2,
                timeline_order=2.0,
                location_tag="黑塔",
                characters=["char-1"],
            ),
        ]
    )
    detector = ConflictDetector()

    conflicts = asyncio.run(
        detector.detect_conflicts(project, make_graph(), project.nodes[-1])
    )

    descriptions = "\n".join(conflict.description for conflict in conflicts)
    assert "地点信息可能不一致" in descriptions
    assert "同时出现在多个地点" in descriptions


def test_detects_relation_conflicts_against_graph():
    project = make_project(
        [
            StoryNode(
                id="node-1",
                title="决裂",
                content="陆沉与顾尧如今已成死敌，见面只想拔刀相向。",
                narrative_order=1,
                timeline_order=1.0,
                location_tag="王都",
                characters=["char-1", "char-2"],
            )
        ]
    )
    detector = ConflictDetector()

    conflicts = asyncio.run(
        detector.detect_conflicts(project, make_graph(), project.nodes[0])
    )

    assert any(conflict.type == ConflictType.RELATION_CONFLICT for conflict in conflicts)
    assert any("好友" in conflict.description for conflict in conflicts)


def test_builds_generation_guardrails_for_relevant_characters():
    detector = ConflictDetector()
    guardrails = detector.build_generation_guardrails(
        make_project([]),
        make_graph(),
        "陆沉看着顾尧，准备继续这段剧情。",
    )

    joined = "\n".join(guardrails)
    assert "角色 陆沉" in joined
    assert "关系 陆沉 / 顾尧" in joined
