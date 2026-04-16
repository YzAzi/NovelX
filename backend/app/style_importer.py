from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from .style_curation import CuratedStylePassage, format_curated_passages


class ImportedStyleDocument(BaseModel):
    title: str
    content: str
    source_characters: int = 0
    curated_characters: int = 0
    curated_segments: int = 0


def _clean_title(filename: str) -> str:
    return Path(filename).stem.strip() or "未命名风格"


def _decode_upload(filename: str, raw: bytes) -> str:
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError(f"{filename} 编码不受支持，需使用 UTF-8。") from exc


def _coerce_passages(value: Any) -> list[CuratedStylePassage]:
    passages: list[CuratedStylePassage] = []
    if not isinstance(value, list):
        return passages
    for index, item in enumerate(value, start=1):
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        label = str(item.get("label") or item.get("title") or f"风格片段{index}").strip()
        passages.append(
            CuratedStylePassage(
                label=label or f"风格片段{index}",
                text=text,
                techniques=[
                    str(entry).strip()
                    for entry in (item.get("techniques") or [])
                    if str(entry).strip()
                ],
                focus=str(item.get("focus") or "general"),
            )
        )
    return passages


def _build_document_from_passages(
    title: str,
    passages: list[CuratedStylePassage],
) -> ImportedStyleDocument:
    content = format_curated_passages(passages)
    return ImportedStyleDocument(
        title=title,
        content=content,
        source_characters=len(content),
        curated_characters=len(content),
        curated_segments=len(passages),
    )


def _coerce_document(item: Any, default_title: str) -> ImportedStyleDocument | None:
    if not isinstance(item, dict):
        return None

    title = str(item.get("title") or default_title).strip() or default_title
    content = str(item.get("content") or "").strip()
    if content:
        return ImportedStyleDocument(
            title=title,
            content=content,
            source_characters=max(int(item.get("source_characters") or len(content)), 0),
            curated_characters=max(int(item.get("curated_characters") or len(content)), 0),
            curated_segments=max(int(item.get("curated_segments") or 0), 0),
        )

    passages = _coerce_passages(item.get("passages") or item.get("segments"))
    if passages:
        return _build_document_from_passages(title, passages)
    return None


def _parse_json_documents(filename: str, text: str) -> list[ImportedStyleDocument]:
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{filename} 不是合法 JSON。") from exc

    default_title = _clean_title(filename)
    if isinstance(payload, list):
        documents = [
            item
            for item in (
                _coerce_document(entry, f"{default_title}-{index}")
                for index, entry in enumerate(payload, start=1)
            )
            if item is not None
        ]
        if documents:
            return documents
        passages = _coerce_passages(payload)
        if passages:
            return [_build_document_from_passages(default_title, passages)]
        raise ValueError("JSON 中没有可导入的文笔文档。")

    if isinstance(payload, dict):
        if isinstance(payload.get("documents"), list):
            documents = [
                item
                for item in (
                    _coerce_document(entry, f"{default_title}-{index}")
                    for index, entry in enumerate(payload["documents"], start=1)
                )
                if item is not None
            ]
            if documents:
                return documents
            raise ValueError("JSON 的 documents 字段里没有可导入的文笔文档。")

        document = _coerce_document(payload, default_title)
        if document is not None:
            return [document]

    raise ValueError("JSON 格式不支持。请提供 {title, content}、documents[] 或 passages[]。")


def parse_cleaned_style_upload(
    filename: str,
    raw: bytes,
) -> list[ImportedStyleDocument]:
    if not filename:
        raise ValueError("缺少文件名。")

    lower_name = filename.lower()
    text = _decode_upload(filename, raw)
    if lower_name.endswith(".json"):
        return _parse_json_documents(filename, text)
    if lower_name.endswith(".txt") or lower_name.endswith(".md"):
        content = text.strip()
        if not content:
            raise ValueError("上传内容为空")
        return [
            ImportedStyleDocument(
                title=_clean_title(filename),
                content=content,
                source_characters=len(content),
                curated_characters=len(content),
                curated_segments=0,
            )
        ]
    raise ValueError("仅支持导入 .json / .txt / .md 文件")
