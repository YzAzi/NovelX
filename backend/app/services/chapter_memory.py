from __future__ import annotations

import re

from langchain_openai import ChatOpenAI

from ..config import get_api_key, get_base_url, get_model_name, get_reasoning_effort
from ..helpers import count_words
from ..models import StoryChapter, StoryProject

CHAPTER_SUMMARY_LIMIT = 100
TARGET_CHAPTER_WORDS = 4000
MIN_CHAPTER_WORDS = 2000
SUMMARY_PROMPT = (
    "请将下面的章节内容概括成不超过100字的中文剧情摘要。"
    "重点保留人物、事件推进、状态变化和关键冲突。"
    "只输出摘要正文，不要标题，不要分点，不要解释。"
)


def _normalize_summary(text: str, limit: int = CHAPTER_SUMMARY_LIMIT) -> str:
    collapsed = re.sub(r"\s+", " ", (text or "").strip())
    if not collapsed:
        return ""
    if len(collapsed) <= limit:
        return collapsed
    return collapsed[:limit].rstrip("，。；、,.!?！？ ") + "…"


def build_fallback_chapter_summary(
    title: str,
    content: str,
    limit: int = CHAPTER_SUMMARY_LIMIT,
) -> str:
    cleaned = re.sub(r"\s+", " ", (content or "").strip())
    if not cleaned:
        return ""

    parts = re.split(r"[。！？!?；;]\s*", cleaned)
    snippets = [segment.strip("，、 ") for segment in parts if segment.strip()]
    summary = "；".join(snippets[:2]) if snippets else cleaned[:limit]
    if title.strip():
        summary = f"{title.strip()}：{summary}"
    return _normalize_summary(summary, limit)


async def summarize_chapter(
    title: str,
    content: str,
    limit: int = CHAPTER_SUMMARY_LIMIT,
) -> str:
    cleaned = (content or "").strip()
    if not cleaned:
        return ""

    api_key = get_api_key("drafting") or get_api_key("default")
    if not api_key:
        return build_fallback_chapter_summary(title, cleaned, limit)

    llm = ChatOpenAI(
        api_key=api_key,
        base_url=get_base_url("drafting"),
        model=get_model_name("summary"),
        model_kwargs={"reasoning_effort": get_reasoning_effort("summary")},
        temperature=0.2,
    )
    try:
        result = await llm.ainvoke(
            [
                {"role": "system", "content": SUMMARY_PROMPT},
                {
                    "role": "user",
                    "content": f"章节标题：{title or '未命名章节'}\n章节正文：\n{cleaned}",
                },
            ]
        )
        content_text = getattr(result, "content", "") or ""
        return _normalize_summary(str(content_text), limit)
    except Exception:
        return build_fallback_chapter_summary(title, cleaned, limit)


def format_chapter_summaries_for_prompt(
    project: StoryProject,
    current_chapter_id: str | None = None,
    max_items: int = 10,
) -> str:
    chapters = sorted(project.chapters, key=lambda item: item.order)
    current_chapter = next(
        (chapter for chapter in chapters if chapter.id == current_chapter_id),
        None,
    )
    previous_chapters = [
        chapter
        for chapter in chapters
        if chapter.summary.strip()
        and (current_chapter is None or chapter.order < current_chapter.order)
    ]
    selected = previous_chapters[-max_items:]
    if current_chapter and current_chapter.summary.strip():
        selected.append(current_chapter)
    if not selected:
        return "无"

    lines = [
        f"- 第{chapter.order}章《{chapter.title or '未命名章节'}》：{chapter.summary.strip()}"
        for chapter in selected
    ]
    return "\n".join(lines)


def format_outline_context_for_chapter(
    project: StoryProject,
    chapter_id: str | None = None,
    max_nodes: int = 6,
) -> str:
    ordered_nodes = sorted(project.nodes, key=lambda item: item.narrative_order)
    if not ordered_nodes:
        return "无可用大纲节点。"

    current_chapter = next(
        (chapter for chapter in project.chapters if chapter.id == chapter_id),
        None,
    )
    if current_chapter is None:
        target_nodes = ordered_nodes[:max_nodes]
    else:
        center_index = min(max(current_chapter.order - 1, 0), len(ordered_nodes) - 1)
        start = max(0, center_index - 2)
        end = min(len(ordered_nodes), start + max_nodes)
        target_nodes = ordered_nodes[start:end]

    world_view = project.world_view.strip() or "未提供"
    style_tags = "、".join(tag.strip() for tag in project.style_tags if tag.strip()) or "未提供"
    lines = [
        f"项目标题：{project.title}",
        f"世界观：{world_view}",
        f"风格标签：{style_tags}",
        "相关大纲节点：",
    ]
    for node in target_nodes:
        snippet = re.sub(r"\s+", " ", node.content.strip())
        if len(snippet) > 120:
            snippet = snippet[:117] + "..."
        lines.append(f"- 第{node.narrative_order}节点 {node.title}：{snippet or '暂无内容'}")
    return "\n".join(lines)


def build_continue_instruction(
    project: StoryProject,
    chapter: StoryChapter | None,
    existing_text: str,
) -> str:
    chapter_title = chapter.title if chapter else "未命名章节"
    existing_words = count_words(existing_text)
    if existing_text.strip():
        remaining_min_words = max(0, MIN_CHAPTER_WORDS - existing_words)
        min_length_instruction = (
            f"当前章节尚未达到{MIN_CHAPTER_WORDS}字保底，本次续写至少补足约{remaining_min_words}字，"
            f"确保续写后整章正文不少于{MIN_CHAPTER_WORDS}字。"
            "即使补足字数，也要保持长篇小说节奏，慢写、细写，不要压缩过程。"
            if remaining_min_words
            else f"当前章节已达到{MIN_CHAPTER_WORDS}字保底，本次可按自然片段继续推进。"
        )
        return (
            "请直接续写当前章节正文，延续已给出的叙事视角、节奏和语气。"
            "不要重复已经写过的内容，不要输出解释，只返回紧接着的正文。"
            f"本章长期目标总字数约{TARGET_CHAPTER_WORDS}字，可上下浮动15%，"
            "这个目标只用于控制整章容量，不要求本次一次写满。"
            f"{min_length_instruction}"
            "本次只续写当前结尾后的一个自然片段或短场景，保持长篇小说节奏。"
            "可以慢写、细写，不要为了接近字数目标而快速跳过过程、提前解决冲突或写完整章剧情。"
            f"当前已写约{existing_words}字。"
            f"当前章节：第{chapter.order if chapter else '?'}章《{chapter_title}》。"
        )
    return (
        "当前章节还没有正文，请根据提供的大纲、前文章节摘要和风格参考，直接起草本章开头。"
        "不要写标题，不要解释设定，不要输出分点，只返回可直接落稿的正文。"
        f"本章长期目标总字数约{TARGET_CHAPTER_WORDS}字，可上下浮动15%，"
        f"这个目标用于控制整章容量，本次不要求一次写满，但首次起草正文不少于{MIN_CHAPTER_WORDS}字。"
        "本次写本章开篇的完整开场段落或开场短场景，保持长篇小说节奏。"
        "可以慢写、细写，不要为了接近字数目标而快速跳过铺垫或提前完成本章剧情。"
        f"当前章节：第{chapter.order if chapter else '?'}章《{chapter_title}》。"
    )


def estimate_summary_context_words(project: StoryProject) -> int:
    total = 0
    for chapter in project.chapters:
        total += count_words(chapter.summary or "")
    return total
