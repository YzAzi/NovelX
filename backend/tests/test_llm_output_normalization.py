from app.graph_extractor import ExtractionResult
from app.knowledge_graph import RelationType
from app.models import OutlineImportResult, StoryProject, SyncAnalysisResult
from app.schema_utils import parse_pydantic_response


def test_story_project_accepts_stringified_list_fields():
    project = StoryProject.model_validate(
        {
            "title": "测试项目",
            "world_view": "测试世界",
            "style_tags": '["悬疑", "奇幻"]',
            "nodes": '[{"title":"节点1","content":"内容","narrative_order":1,"timeline_order":1.0,"location_tag":"主线","characters":["c-1"]}]',
            "chapters": '[{"title":"第一章","content":"章节内容","order":1}]',
            "characters": '[{"name":"角色A","tags":["主角"],"bio":"简介"}]',
        }
    )

    assert project.style_tags == ["悬疑", "奇幻"]
    assert len(project.nodes) == 1
    assert len(project.chapters) == 1
    assert len(project.characters) == 1


def test_story_project_accepts_double_encoded_list_fields():
    project = StoryProject.model_validate(
        {
            "title": "测试项目",
            "world_view": "测试世界",
            "nodes": '"[{\\"title\\":\\"节点1\\",\\"content\\":\\"内容\\",\\"narrative_order\\":1,\\"timeline_order\\":1.0,\\"location_tag\\":\\"主线\\",\\"characters\\":[]}] "',
            "chapters": '"[{\\"title\\":\\"第一章\\",\\"content\\":\\"章节内容\\",\\"order\\":1}]"',
            "characters": '"[{\\"name\\":\\"角色A\\",\\"tags\\":[\\"主角\\"],\\"bio\\":\\"简介\\"}]"',
        }
    )

    assert len(project.nodes) == 1
    assert len(project.chapters) == 1
    assert len(project.characters) == 1


def test_extraction_result_accepts_stringified_lists():
    result = ExtractionResult.model_validate(
        {
            "new_entities": '[{"id":"char-1","name":"角色A","type":"character","description":"描述","aliases":[],"properties":{},"source_refs":[]}]',
            "new_relations": '[{"id":"rel-1","source_id":"char-1","target_id":"char-2","relation_type":"contains","relation_name":"相关","description":"描述","properties":{},"source_refs":[]}]',
            "alias_mappings": '[{"alias":"阿A","entity_id":"char-1"}]',
            "confidence_notes": '["note-1"]',
        }
    )

    assert len(result.new_entities) == 1
    assert len(result.new_relations) == 1
    assert result.new_relations[0].relation_type == RelationType.RELATED_TO
    assert result.alias_mappings == [{"alias": "阿A", "entity_id": "char-1"}]
    assert result.confidence_notes == ["note-1"]


def test_other_llm_models_accept_stringified_lists():
    sync = SyncAnalysisResult.model_validate(
        {
            "new_characters": '[{"name":"角色B","tags":["配角"],"bio":"简介"}]',
            "timeline_updates": '[{"node_id":"node-1","new_timeline_order":2.0}]',
            "conflicts": '[{"description":"冲突","affected_nodes":["node-1"]}]',
        }
    )
    imported = OutlineImportResult.model_validate(
        {
            "nodes": '[{"title":"导入节点","content":"内容","characters":["角色B"]}]',
            "characters": '[{"name":"角色B","tags":["配角"],"bio":"简介"}]',
        }
    )

    assert len(sync.new_characters) == 1
    assert len(sync.timeline_updates) == 1
    assert len(sync.conflicts) == 1
    assert len(imported.nodes) == 1
    assert len(imported.characters) == 1


def test_parse_pydantic_response_accepts_fenced_json():
    raw = """```json
    {
      "directions": [
        {
          "title": "方向一",
          "logline": "一句话",
          "world_view": "世界观",
          "style_tags": ["悬疑"],
          "initial_prompt": "开头"
        }
      ]
    }
    ```"""

    from app.models import StoryDirectionResponse

    parsed = parse_pydantic_response(StoryDirectionResponse, raw)

    assert parsed.directions[0].title == "方向一"
