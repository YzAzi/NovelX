from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from uuid import uuid4

from langchain_openai import ChatOpenAI
from pydantic import BaseModel

from .config import settings
from .schema_utils import pydantic_to_openai_function_inline


class ChunkingStrategy(Enum):
    FIXED_SIZE = "fixed_size"
    SEMANTIC = "semantic"
    PARAGRAPH = "paragraph"
    CHAPTER = "chapter"


@dataclass
class ChunkConfig:
    strategy: ChunkingStrategy
    chunk_size: int = 500
    chunk_overlap: int = 100
    separators: list[str] | None = None


class DocumentChunk(BaseModel):
    id: str
    content: str
    metadata: dict
    start_index: int
    end_index: int


DEFAULT_SEPARATORS = ["\n\n", "。\n", "。", "！", "？", "\n"]


def _normalize_separators(separators: list[str] | None) -> list[str]:
    if separators:
        return separators
    return DEFAULT_SEPARATORS


def _split_with_separators(text: str, separators: list[str]) -> list[tuple[str, int, int]]:
    if not text:
        return []
    ordered = sorted(separators, key=len, reverse=True)
    pattern = "|".join(re.escape(item) for item in ordered)
    if not pattern:
        return [(text, 0, len(text))]

    segments: list[tuple[str, int, int]] = []
    last_index = 0
    for match in re.finditer(pattern, text):
        end = match.end()
        if end <= last_index:
            continue
        segments.append((text[last_index:end], last_index, end))
        last_index = end
    if last_index < len(text):
        segments.append((text[last_index:], last_index, len(text)))
    return segments


def _split_by_paragraphs(text: str) -> list[tuple[str, int, int]]:
    if "\n\n" not in text:
        return _split_with_separators(text, ["\n"])
    return _split_with_separators(text, ["\n\n"])


def _split_by_chapters(text: str) -> list[tuple[str, int, int]]:
    pattern = re.compile(r"(?:^|\n)第.{1,20}章[^\n]*")
    matches = list(pattern.finditer(text))
    if not matches:
        return _split_by_paragraphs(text)

    segments: list[tuple[str, int, int]] = []
    for index, match in enumerate(matches):
        start = match.start()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        segments.append((text[start:end], start, end))
    return segments


def _split_long_segment(
    segment: tuple[str, int, int], separators: list[str]
) -> list[tuple[str, int, int]]:
    content, start, _end = segment
    parts = _split_with_separators(content, separators)
    return [(text, start + part_start, start + part_end) for text, part_start, part_end in parts]


def _build_chunks_from_segments(
    text: str,
    segments: list[tuple[str, int, int]],
    config: ChunkConfig,
    source_metadata: dict | None,
) -> list[DocumentChunk]:
    chunks: list[DocumentChunk] = []
    current_segments: list[tuple[str, int, int]] = []
    current_length = 0
    chunk_index = 0
    segments_to_process = list(segments)

    def finalize_chunk() -> None:
        nonlocal chunk_index, current_segments, current_length
        if not current_segments:
            return
        start_index = current_segments[0][1]
        end_index = current_segments[-1][2]
        content = text[start_index:end_index]
        metadata = dict(source_metadata or {})
        metadata["strategy"] = config.strategy.value
        metadata["chunk_index"] = chunk_index
        chunks.append(
            DocumentChunk(
                id=str(uuid4()),
                content=content,
                metadata=metadata,
                start_index=start_index,
                end_index=end_index,
            )
        )
        chunk_index += 1

        if config.chunk_overlap <= 0:
            current_segments = []
            current_length = 0
            return

        overlap_segments: list[tuple[str, int, int]] = []
        overlap_length = 0
        for segment in reversed(current_segments):
            segment_length = len(segment[0])
            if overlap_length + segment_length > config.chunk_overlap and overlap_segments:
                break
            overlap_segments.append(segment)
            overlap_length += segment_length
            if overlap_length >= config.chunk_overlap:
                break
        overlap_segments.reverse()
        current_segments = overlap_segments
        current_length = sum(len(segment[0]) for segment in overlap_segments)

    index = 0
    while index < len(segments_to_process):
        segment = segments_to_process[index]
        if len(segment[0]) > config.chunk_size and config.chunk_size > 0:
            if current_segments:
                finalize_chunk()
            parts = _split_long_segment(segment, _normalize_separators(None))
            segments_to_process[index:index + 1] = parts
            continue

        if current_segments and current_length + len(segment[0]) > config.chunk_size:
            finalize_chunk()

        current_segments.append(segment)
        current_length += len(segment[0])
        index += 1

    finalize_chunk()
    return chunks


def _semantic_split(text: str, config: ChunkConfig) -> list[tuple[str, int, int]]:
    paragraphs = _split_by_paragraphs(text)
    if not settings.openai_api_key:
        return paragraphs

    class SemanticSplitResult(BaseModel):
        starts: list[int]

    numbered = "\n".join(
        f"{index + 1}. {segment[0].strip()}" for index, segment in enumerate(paragraphs)
    )
    prompt = (
        "请根据段落的语义边界，将段落分成若干块。"
        f"目标块大小约 {config.chunk_size} 字符。"
        "返回 JSON，格式为 {\"starts\": [1, ...]}，"
        "表示每个块的起始段落序号（从 1 开始），必须包含 1。"
        "\n\n段落如下：\n"
        f"{numbered}"
    )

    try:
        model_name = settings.model_name or "gpt-4o"
        schema = pydantic_to_openai_function_inline(SemanticSplitResult)
        llm = ChatOpenAI(
            api_key=settings.openai_api_key,
            base_url=settings.openai_base_url,
            model=model_name,
        ).with_structured_output(schema)
        result = llm.invoke(prompt)
        starts = sorted({max(1, value) for value in result.starts})
    except Exception:
        return paragraphs

    if not starts or starts[0] != 1:
        starts = [1] + starts

    chunks: list[tuple[str, int, int]] = []
    for index, start in enumerate(starts):
        start_index = start - 1
        end_index = (starts[index + 1] - 1) if index + 1 < len(starts) else len(paragraphs)
        segment_start = paragraphs[start_index][1]
        segment_end = paragraphs[end_index - 1][2]
        chunks.append((text[segment_start:segment_end], segment_start, segment_end))
    return chunks


def chunk_text(
    text: str,
    config: ChunkConfig,
    source_metadata: dict | None = None,
) -> list[DocumentChunk]:
    if not text:
        return []

    separators = _normalize_separators(config.separators)

    if config.strategy == ChunkingStrategy.CHAPTER:
        segments = _split_by_chapters(text)
    elif config.strategy == ChunkingStrategy.PARAGRAPH:
        segments = _split_by_paragraphs(text)
    elif config.strategy == ChunkingStrategy.SEMANTIC:
        segments = _semantic_split(text, config)
    else:
        segments = _split_with_separators(text, separators)

    return _build_chunks_from_segments(text, segments, config, source_metadata)
