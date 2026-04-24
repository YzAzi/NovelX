from __future__ import annotations

import asyncio
from pathlib import Path
import re

from langchain.prompts import PromptTemplate
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

from .config import get_api_key, get_base_url, get_model_name, get_reasoning_effort
from .schema_utils import (
    build_json_only_prompt,
    parse_pydantic_response,
    provider_supports_native_structured_output,
    pydantic_json_schema_inline,
)

CURATION_PROMPT_PATH = Path(__file__).parent / "prompts" / "style_curation_prompt.txt"
CURATION_PROMPT = PromptTemplate.from_template(
    CURATION_PROMPT_PATH.read_text(encoding="utf-8")
)

_BATCH_CHAR_LIMIT = 5000
_BATCH_OVERLAP = 400
_BATCH_TIMEOUT_SECONDS = 60
_BATCH_MAX_RETRIES = 2
_SENTENCE_SPLIT_PATTERN = re.compile(r"(?<=[。！？!?；;])")


class CuratedStylePassage(BaseModel):
    label: str
    text: str = Field(min_length=60)
    techniques: list[str] = Field(default_factory=list)
    focus: str = "general"


class CuratedStyleBatch(BaseModel):
    passages: list[CuratedStylePassage] = Field(default_factory=list)


class StyleCurationResult(BaseModel):
    curated_content: str
    source_characters: int
    curated_characters: int
    curated_segments: int
    total_batches: int = 0
    successful_batches: int = 0
    failed_batches: int = 0
    warnings: list[str] = Field(default_factory=list)


def _slice_batch_by_chars(text: str) -> list[str]:
    stripped = text.strip()
    if not stripped:
        return []
    if len(stripped) <= _BATCH_CHAR_LIMIT:
        return [stripped]

    batches: list[str] = []
    start = 0
    text_length = len(stripped)
    step = max(1, _BATCH_CHAR_LIMIT - _BATCH_OVERLAP)
    while start < text_length:
        end = min(text_length, start + _BATCH_CHAR_LIMIT)
        batch = stripped[start:end].strip()
        if batch:
            batches.append(batch)
        if end >= text_length:
            break
        start += step
    return batches


def _split_long_paragraph(paragraph: str) -> list[str]:
    stripped = paragraph.strip()
    if not stripped:
        return []
    if len(stripped) <= _BATCH_CHAR_LIMIT:
        return [stripped]

    sentences = [item.strip() for item in _SENTENCE_SPLIT_PATTERN.split(stripped) if item.strip()]
    if len(sentences) <= 1:
        return _slice_batch_by_chars(stripped)

    batches: list[str] = []
    current: list[str] = []
    current_len = 0

    for sentence in sentences:
        sentence_len = len(sentence)
        if sentence_len > _BATCH_CHAR_LIMIT:
            if current:
                batches.append("".join(current).strip())
                current = []
                current_len = 0
            batches.extend(_slice_batch_by_chars(sentence))
            continue

        if current and current_len + sentence_len > _BATCH_CHAR_LIMIT:
            batches.append("".join(current).strip())
            overlap = batches[-1][-_BATCH_OVERLAP :].strip()
            current = [overlap] if overlap else []
            current_len = len(overlap)

        current.append(sentence)
        current_len += sentence_len

    if current:
        batches.append("".join(current).strip())

    return [batch for batch in batches if batch]


def _split_batches(text: str) -> list[str]:
    stripped = text.strip()
    if not stripped:
        return []

    paragraphs = [part.strip() for part in stripped.split("\n\n") if part.strip()]
    if not paragraphs:
        return [stripped]

    normalized_paragraphs: list[str] = []
    for paragraph in paragraphs:
        normalized_paragraphs.extend(_split_long_paragraph(paragraph))

    batches: list[str] = []
    current: list[str] = []
    current_len = 0
    for paragraph in normalized_paragraphs:
        paragraph_len = len(paragraph)
        if current and current_len + paragraph_len + 2 > _BATCH_CHAR_LIMIT:
            batches.append("\n\n".join(current))
            overlap = "\n\n".join(current)[-_BATCH_OVERLAP :].strip()
            overlap_len = len(overlap)
            if paragraph_len + (overlap_len + 2 if overlap else 0) > _BATCH_CHAR_LIMIT:
                current = [paragraph]
                current_len = paragraph_len
                continue
            current = [overlap] if overlap else []
            current_len = overlap_len
        current.append(paragraph)
        current_len += paragraph_len + 2

    if current:
        batches.append("\n\n".join(current))
    return batches


def format_curated_passages(passages: list[CuratedStylePassage]) -> str:
    sections: list[str] = []
    for item in passages:
        label = item.label.strip() or "风格片段"
        text = item.text.strip()
        if not text:
            continue
        focus = normalize_style_focus(item.focus)
        techniques = "、".join(tech for tech in item.techniques if tech.strip())
        header = f"【{label}】"
        header = f"{header}\n类型：{focus}"
        if techniques:
            header = f"{header}\n技法：{techniques}"
        sections.append(f"{header}\n{text}")
    return "\n\n".join(sections).strip()


def normalize_style_focus(value: str | None) -> str:
    normalized = (value or "").strip().lower()
    mapping = {
        "dialogue": "对话型",
        "dialog": "对话型",
        "conversation": "对话型",
        "对话": "对话型",
        "对话型": "对话型",
        "environment": "环境型",
        "scene": "环境型",
        "描写": "环境型",
        "环境": "环境型",
        "环境型": "环境型",
        "hybrid": "混合型",
        "mixed": "混合型",
        "blend": "混合型",
        "mixed_mode": "混合型",
        "对话+环境": "混合型",
        "混合": "混合型",
        "混合型": "混合型",
        "general": "通用型",
        "narrative": "通用型",
        "通用": "通用型",
        "通用型": "通用型",
    }
    return mapping.get(normalized, "通用型")


class StyleCurationService:
    async def curate_text(
        self,
        title: str,
        raw_text: str,
    ) -> StyleCurationResult:
        source_text = raw_text.strip()
        if not source_text:
            raise ValueError("上传内容为空")

        api_key = get_api_key("extraction") or get_api_key("default") or get_api_key("drafting")
        if not api_key:
            raise ValueError("未配置用于文笔清洗的 API Key，请先在模型设置中填写。")

        base_url = get_base_url()
        model_name = get_model_name("extraction")
        llm = ChatOpenAI(
            api_key=api_key,
            base_url=base_url,
            model=model_name,
            model_kwargs={"reasoning_effort": get_reasoning_effort("extraction")},
        )
        structured_llm = (
            llm.with_structured_output(CuratedStyleBatch)
            if provider_supports_native_structured_output(base_url, model_name)
            else llm
        )

        batches = _split_batches(source_text)
        output_schema = pydantic_json_schema_inline(CuratedStyleBatch)

        curated_passages: list[CuratedStylePassage] = []
        seen_texts: set[str] = set()
        warnings: list[str] = []
        successful_batches = 0
        failed_batches = 0
        for index, batch in enumerate(batches, start=1):
            prompt = CURATION_PROMPT.format(
                title=title,
                batch_index=index,
                total_batches=len(batches),
                source_text=batch,
                output_schema=output_schema,
            )
            parsed: CuratedStyleBatch | None = None
            last_error: Exception | None = None
            for attempt in range(1, _BATCH_MAX_RETRIES + 2):
                try:
                    final_prompt = prompt
                    if not provider_supports_native_structured_output(base_url, model_name):
                        final_prompt = build_json_only_prompt(prompt, CuratedStyleBatch)
                    result = await asyncio.wait_for(
                        structured_llm.ainvoke(final_prompt),
                        timeout=_BATCH_TIMEOUT_SECONDS,
                    )
                    parsed = parse_pydantic_response(CuratedStyleBatch, result)
                    break
                except Exception as exc:
                    last_error = exc
                    if attempt > _BATCH_MAX_RETRIES:
                        break
            if parsed is None:
                failed_batches += 1
                error_text = str(last_error) if last_error else "unknown error"
                warnings.append(
                    f"第 {index} 批清洗失败，已跳过。原因：{error_text[:160]}"
                )
                continue
            successful_batches += 1

            for passage in parsed.passages:
                cleaned = passage.text.strip()
                if not cleaned or cleaned in seen_texts:
                    continue
                seen_texts.add(cleaned)
                curated_passages.append(
                    CuratedStylePassage(
                        label=passage.label.strip() or "风格片段",
                        text=cleaned,
                        techniques=[item.strip() for item in passage.techniques if item.strip()],
                        focus=passage.focus,
                    )
                )

        if not curated_passages:
            if warnings:
                raise ValueError(
                    "AI 未提取到可用于文笔学习的有效片段。"
                    f" 批次失败情况：{'；'.join(warnings[:3])}"
                )
            raise ValueError("AI 未提取到可用于文笔学习的有效片段，请尝试更换文本。")

        curated_content = format_curated_passages(curated_passages)
        if failed_batches > 0:
            warnings.append(
                f"共有 {failed_batches} / {len(batches)} 个批次清洗失败，系统已用其余批次成功构建知识库。"
            )
        return StyleCurationResult(
            curated_content=curated_content,
            source_characters=len(source_text),
            curated_characters=len(curated_content),
            curated_segments=len(curated_passages),
            total_batches=len(batches),
            successful_batches=successful_batches,
            failed_batches=failed_batches,
            warnings=warnings,
        )
