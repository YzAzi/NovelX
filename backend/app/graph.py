from __future__ import annotations

from datetime import datetime
import logging
from pathlib import Path
from typing import Awaitable, Callable, TypedDict

from langchain.prompts import PromptTemplate
from langchain_openai import ChatOpenAI

from langgraph.graph import END, START, StateGraph

from .config import get_api_key, get_base_url, get_model_name, settings
from .graph_extractor import GraphExtractor
from .graph_retriever import RetrievalContext, GraphRetriever
from .knowledge_graph import KnowledgeGraph, load_graph, save_graph
from .models import CreateOutlineRequest, PromptOverrides, StoryNode, StoryProject, SyncAnalysisResult
from .node_indexer import NodeIndexer
from .schema_utils import pydantic_to_openai_function_inline
from .sync_strategy import DEFAULT_SYNC_CONFIG, SyncMode

LOG_DIR = Path(__file__).resolve().parent.parent / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / "app.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    handlers=[logging.StreamHandler(), logging.FileHandler(LOG_FILE, encoding="utf-8")],
)
logger = logging.getLogger(__name__)

DRAFT_PROMPT_PATH = Path(__file__).parent / "prompts" / "drafting_prompt.txt"
REVERSE_SYNC_PROMPT_PATH = Path(__file__).parent / "prompts" / "reverse_sync_prompt.txt"
DRAFT_PROMPT_TEMPLATE = PromptTemplate.from_template(DRAFT_PROMPT_PATH.read_text(encoding="utf-8"))
REVERSE_SYNC_PROMPT_TEMPLATE = PromptTemplate.from_template(
    REVERSE_SYNC_PROMPT_PATH.read_text(encoding="utf-8")
)


class AgentState(TypedDict):
    user_input: str
    world_view: str
    style_tags: list[str]
    drafting_prompt: str | None
    base_project_id: str | None
    current_project: StoryProject | None
    modified_node: StoryNode | None
    sync_result: dict | None
    retrieved_context: RetrievalContext | None
    knowledge_graph: KnowledgeGraph | None
    error: str | None
    progress_reporter: "ProgressReporter | None"


ProgressReporter = Callable[[str, dict | None], Awaitable[None]]


async def report_progress(
    state: AgentState, stage: str, details: dict | None = None
) -> None:
    reporter = state.get("progress_reporter")
    if not reporter:
        return
    try:
        await reporter(stage, details)
    except Exception:
        logger.warning("Failed to report outline progress: %s", stage)


class LLMGenerationError(Exception):
    pass


class ValidationError(Exception):
    pass


class WorkflowError(Exception):
    pass


async def retrieval_node(state: AgentState) -> AgentState:
    print("[retrieval_node] start")
    try:
        await report_progress(state, "retrieval", {"status": "started"})
        project = state.get("current_project")
        base_project_id = state.get("base_project_id")
        if project is None and not base_project_id:
            return {**state, "retrieved_context": None, "knowledge_graph": None}

        retrieval_project_id = project.id if project else base_project_id
        if not retrieval_project_id:
            return {**state, "retrieved_context": None, "knowledge_graph": None}

        knowledge_graph = load_graph(retrieval_project_id)
        retriever = GraphRetriever(
            knowledge_graph=knowledge_graph,
            node_indexer=NodeIndexer(),
        )

        if state.get("modified_node"):
            query = state["modified_node"].content
        else:
            query = state["user_input"]

        context = await retriever.retrieve_context(
            query=query,
            project_id=retrieval_project_id,
            max_tokens=4000,
        )
        print("[retrieval_node] complete")
        return {**state, "retrieved_context": context, "knowledge_graph": knowledge_graph}
    except Exception as exc:
        state["error"] = str(exc)
        return state


async def graph_update_node(state: AgentState) -> AgentState:
    print("[graph_update_node] start")
    try:
        await report_progress(state, "graph_update", {"status": "started"})
        project = state.get("current_project")
        if project is None:
            return state

        if state.get("modified_node") and DEFAULT_SYNC_CONFIG.graph_sync_mode != SyncMode.IMMEDIATE:
            return state

        project_prompt = project.prompt_overrides if project else PromptOverrides()
        extraction_prompt = project_prompt.extraction
        prompt_template = (
            PromptTemplate.from_template(extraction_prompt)
            if extraction_prompt
            else None
        )
        extractor = GraphExtractor(prompt_template=prompt_template)
        node_indexer = NodeIndexer()
        knowledge_graph = state.get("knowledge_graph") or load_graph(project.id)

        if state.get("modified_node"):
            updated_node = next(
                (node for node in project.nodes if node.id == state["modified_node"].id),
                state["modified_node"],
            )
            updated_graph = await extractor.incremental_update(
                project_id=project.id,
                modified_node=updated_node,
                current_graph=knowledge_graph,
            )
            await node_indexer.index_node(project.id, updated_node)
        else:
            updated_graph = await extractor.build_full_graph(project)
            await node_indexer.index_project(project)

        save_graph(updated_graph)
        print("[graph_update_node] complete")
        return {**state, "knowledge_graph": updated_graph}
    except Exception as exc:
        state["error"] = str(exc)
        return state


def _route_on_error(state: AgentState) -> str:
    return "error_handler_node" if state.get("error") else "next"


async def drafting_node(state: AgentState) -> AgentState:
    print("[drafting_node] start")
    try:
        await report_progress(state, "drafting", {"status": "started"})
        api_key = get_api_key("drafting")
        if not api_key:
            raise ValidationError("OPENAI_API_KEY is not configured")

        model_name = get_model_name("drafting")
        schema = pydantic_to_openai_function_inline(StoryProject)
        llm = ChatOpenAI(
            api_key=api_key,
            base_url=get_base_url(),
            model=model_name,
        ).with_structured_output(schema)

        retrieved_context = state.get("retrieved_context")
        retrieved_text = (
            retrieved_context.to_prompt_text()
            if retrieved_context
            else "无"
        )
        base_inputs = {
            "world_view": state["world_view"],
            "style_tags": ", ".join(state["style_tags"]),
            "user_input": state["user_input"],
            "retrieved_context": retrieved_text,
        }
        custom_prompt = state.get("drafting_prompt")
        prompt_template = (
            PromptTemplate.from_template(custom_prompt)
            if custom_prompt
            else DRAFT_PROMPT_TEMPLATE
        )

        last_error: Exception | None = None
        for attempt in range(1, 4):
            print(f"[drafting_node] attempt {attempt}")
            try:
                prompt_text = prompt_template.format(**base_inputs)
                if attempt > 1:
                    prompt_text = f"{prompt_text}\n\n请严格按照要求的格式输出"
                result = await llm.ainvoke(prompt_text)
                if isinstance(result, StoryProject):
                    project = result
                elif isinstance(result, dict):
                    project = StoryProject.model_validate(result)
                elif hasattr(result, "model_dump"):
                    project = StoryProject.model_validate(result.model_dump())
                else:
                    project = StoryProject.model_validate(result)
                state["current_project"] = project
                state["error"] = None
                print("[drafting_node] complete")
                return state
            except Exception as exc:  # pragma: no cover - network or provider errors
                last_error = exc
                print(f"[drafting_node] attempt {attempt} failed: {exc}")

        raise LLMGenerationError(f"LLM drafting failed after 3 attempts: {last_error}")
    except Exception as exc:
        state["current_project"] = None
        if isinstance(exc, KeyError):
            state["error"] = "自定义 Prompt 缺少必要变量：world_view、style_tags、user_input、retrieved_context"
        else:
            state["error"] = str(exc)
        return state


async def validation_node(state: AgentState) -> AgentState:
    print("[validation_node] start")
    try:
        await report_progress(state, "validation", {"status": "started"})
        project = state.get("current_project")
        if project is None:
            raise ValidationError("Drafting failed: project is missing")
        state["error"] = None
        print("[validation_node] complete")
        return state
    except Exception as exc:
        state["error"] = str(exc)
        return state


async def reverse_sync_node(state: AgentState) -> AgentState:
    print("[reverse_sync_node] start")
    try:
        api_key = get_api_key("sync")
        if not api_key:
            raise ValidationError("OPENAI_API_KEY is not configured")

        project = state.get("current_project")
        modified_node = state.get("modified_node")
        if project is None or modified_node is None:
            raise ValidationError("Sync failed: missing project or modified node")

        model_name = get_model_name("sync")
        schema = pydantic_to_openai_function_inline(SyncAnalysisResult)
        llm = ChatOpenAI(
            api_key=api_key,
            base_url=get_base_url(),
            model=model_name,
        ).with_structured_output(schema)

        retrieved_context = state.get("retrieved_context")
        retrieved_text = (
            retrieved_context.to_prompt_text()
            if retrieved_context
            else "无"
        )
        base_inputs = {
            "modified_node": modified_node.model_dump_json(indent=2),
            "retrieved_context": retrieved_text,
        }
        prompt_override = project.prompt_overrides.sync
        prompt_template = (
            PromptTemplate.from_template(prompt_override)
            if prompt_override
            else REVERSE_SYNC_PROMPT_TEMPLATE
        )

        last_error: Exception | None = None
        for attempt in range(1, 4):
            print(f"[reverse_sync_node] attempt {attempt}")
            try:
                prompt_text = prompt_template.format(**base_inputs)
                if attempt > 1:
                    prompt_text = f"{prompt_text}\n\n请严格按照要求的格式输出"
                result = await llm.ainvoke(prompt_text)
                state["sync_result"] = result.model_dump()
                state["error"] = None
                print("[reverse_sync_node] complete")
                return apply_sync_node(state)
            except Exception as exc:  # pragma: no cover - network or provider errors
                last_error = exc
                print(f"[reverse_sync_node] attempt {attempt} failed: {exc}")

        raise LLMGenerationError(f"LLM sync analysis failed after 3 attempts: {last_error}")
    except Exception as exc:
        state["sync_result"] = None
        if isinstance(exc, KeyError):
            state["error"] = "自定义 Prompt 缺少必要变量：modified_node、retrieved_context"
        else:
            state["error"] = str(exc)
        return state


def apply_sync_node(state: AgentState) -> AgentState:
    print("[apply_sync_node] start")
    try:
        project = state.get("current_project")
        modified_node = state.get("modified_node")
        sync_result = state.get("sync_result")
        if project is None or modified_node is None or sync_result is None:
            raise ValidationError("Apply sync failed: missing inputs")

        try:
            analysis = SyncAnalysisResult.model_validate(sync_result)
        except Exception as exc:
            raise ValidationError(f"Apply sync failed: invalid analysis result: {exc}") from exc

        existing_ids = {node.id for node in project.nodes}
        if modified_node.id in existing_ids:
            project.nodes = [
                modified_node if node.id == modified_node.id else node for node in project.nodes
            ]
        else:
            project.nodes.append(modified_node)

        timeline_updates = {
            update.node_id: update.new_timeline_order for update in analysis.timeline_updates
        }
        if timeline_updates:
            for node in project.nodes:
                if node.id in timeline_updates:
                    node.timeline_order = timeline_updates[node.id]

        character_ids = {character.id for character in project.characters}
        for character in analysis.new_characters:
            if character.id not in character_ids:
                project.characters.append(character)
                character_ids.add(character.id)

        project.updated_at = datetime.utcnow()
        state["current_project"] = project
        state["error"] = None
        print("[apply_sync_node] complete")
        return state
    except Exception as exc:
        state["error"] = str(exc)
        return state


def error_handler_node(state: AgentState) -> AgentState:
    error_message = state.get("error") or "Unknown error"
    logger.exception("Workflow error: %s", error_message)
    state["error"] = "工作流执行失败，请稍后重试。"
    return state


graph = StateGraph(AgentState)
graph.add_node("retrieval_node", retrieval_node)
graph.add_node("drafting_node", drafting_node)
graph.add_node("graph_update_node", graph_update_node)
graph.add_node("validation_node", validation_node)
graph.add_node("error_handler_node", error_handler_node)
graph.add_edge(START, "retrieval_node")
graph.add_edge("retrieval_node", "drafting_node")
graph.add_conditional_edges(
    "drafting_node", _route_on_error, {"error_handler_node": "error_handler_node", "next": "validation_node"}
)
graph.add_conditional_edges(
    "validation_node", _route_on_error, {"error_handler_node": "error_handler_node", "next": "graph_update_node"}
)
graph.add_conditional_edges(
    "graph_update_node",
    _route_on_error,
    {"error_handler_node": "error_handler_node", "next": END},
)
graph.add_edge("error_handler_node", END)

compiled_graph = graph.compile()

sync_graph = StateGraph(AgentState)
sync_graph.add_node("retrieval_node", retrieval_node)
sync_graph.add_node("reverse_sync_node", reverse_sync_node)
sync_graph.add_node("graph_update_node", graph_update_node)
sync_graph.add_node("error_handler_node", error_handler_node)
sync_graph.add_edge(START, "retrieval_node")
sync_graph.add_edge("retrieval_node", "reverse_sync_node")
sync_graph.add_conditional_edges(
    "reverse_sync_node",
    _route_on_error,
    {"error_handler_node": "error_handler_node", "next": "graph_update_node"},
)
sync_graph.add_conditional_edges(
    "graph_update_node",
    _route_on_error,
    {"error_handler_node": "error_handler_node", "next": END},
)
sync_graph.add_edge("error_handler_node", END)

compiled_sync_graph = sync_graph.compile()


async def run_drafting_workflow(
    input: CreateOutlineRequest,
    progress_reporter: ProgressReporter | None = None,
) -> StoryProject:
    initial_state: AgentState = {
        "user_input": input.initial_prompt,
        "world_view": input.world_view,
        "style_tags": input.style_tags,
        "drafting_prompt": input.drafting_prompt,
        "base_project_id": input.base_project_id,
        "current_project": None,
        "modified_node": None,
        "sync_result": None,
        "retrieved_context": None,
        "knowledge_graph": None,
        "error": None,
        "progress_reporter": progress_reporter,
    }
    result = await compiled_graph.ainvoke(initial_state)
    if result.get("error"):
        await report_progress(result, "failed", {"error": result["error"]})
        raise WorkflowError(result["error"])
    if result.get("current_project") is None:
        await report_progress(result, "failed", {"error": "Drafting failed"})
        raise WorkflowError("Drafting failed: no project generated")
    if input.drafting_prompt:
        project = result["current_project"]
        project.prompt_overrides.drafting = input.drafting_prompt
        result["current_project"] = project
    await report_progress(result, "completed", {})
    return result["current_project"]


async def run_sync_workflow(project: StoryProject, modified_node: StoryNode) -> StoryProject:
    initial_state: AgentState = {
        "user_input": "",
        "world_view": project.world_view,
        "style_tags": project.style_tags,
        "base_project_id": None,
        "current_project": project,
        "modified_node": modified_node,
        "sync_result": None,
        "retrieved_context": None,
        "knowledge_graph": None,
        "error": None,
        "progress_reporter": None,
    }
    result = await compiled_sync_graph.ainvoke(initial_state)
    if result.get("error"):
        raise WorkflowError(result["error"])
    if result.get("current_project") is None:
        raise WorkflowError("Sync failed: no project returned")
    return result["current_project"]
