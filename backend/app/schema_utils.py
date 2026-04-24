from __future__ import annotations

import json
from typing import Any, Type

from pydantic import BaseModel


def _inline_json_schema(schema: dict[str, Any]) -> dict[str, Any]:
    defs = schema.get("$defs") or schema.get("definitions") or {}

    def resolve(node: Any) -> Any:
        if isinstance(node, dict):
            if "$ref" in node:
                ref = node["$ref"]
                if ref.startswith("#/$defs/"):
                    key = ref.split("/")[-1]
                    if key in defs:
                        resolved = resolve(defs[key])
                        merged = {**resolved, **{k: v for k, v in node.items() if k != "$ref"}}
                        return merged
                if ref.startswith("#/definitions/"):
                    key = ref.split("/")[-1]
                    if key in defs:
                        resolved = resolve(defs[key])
                        merged = {**resolved, **{k: v for k, v in node.items() if k != "$ref"}}
                        return merged
            return {k: resolve(v) for k, v in node.items() if k not in ("$defs", "definitions")}
        if isinstance(node, list):
            return [resolve(item) for item in node]
        return node

    inlined = resolve(schema.copy())
    if isinstance(inlined, dict):
        inlined.pop("$defs", None)
        inlined.pop("definitions", None)
    return inlined


def pydantic_json_schema_inline(model: Type[BaseModel]) -> dict[str, Any]:
    return _inline_json_schema(model.model_json_schema())


def pydantic_to_openai_function_inline(model: Type[BaseModel]) -> dict[str, Any]:
    schema = pydantic_json_schema_inline(model)
    name = schema.pop("title", model.__name__)
    description = schema.pop("description", None) or (model.__doc__ or "").strip()
    return {
        "name": name,
        "description": description or name,
        "parameters": schema,
    }


def provider_supports_native_structured_output(
    base_url: str | None,
    model_name: str | None = None,
) -> bool:
    normalized_url = (base_url or "").strip().lower()
    normalized_model = (model_name or "").strip().lower()
    if "deepseek.com" in normalized_url:
        return False
    if normalized_model.startswith("deepseek"):
        return False
    return True


def _coerce_message_content(raw_result: Any) -> str:
    content = getattr(raw_result, "content", raw_result)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "\n".join(part for part in parts if part).strip()
    return str(content)


def _candidate_json_payloads(text: str) -> list[str]:
    stripped = text.strip()
    if not stripped:
        return []

    candidates: list[str] = [stripped]
    if stripped.startswith("```"):
        cleaned = stripped.removeprefix("```json").removeprefix("```").strip()
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3].strip()
        if cleaned:
            candidates.append(cleaned)

    for start_char, end_char in (("{", "}"), ("[", "]")):
        start = stripped.find(start_char)
        end = stripped.rfind(end_char)
        if start != -1 and end != -1 and end > start:
            candidates.append(stripped[start : end + 1].strip())

    unique: list[str] = []
    for item in candidates:
        if item and item not in unique:
            unique.append(item)
    return unique


def parse_pydantic_response(model: Type[BaseModel], raw_result: Any) -> BaseModel:
    if isinstance(raw_result, model):
        return raw_result
    if isinstance(raw_result, dict):
        return model.model_validate(raw_result)
    if hasattr(raw_result, "model_dump"):
        return model.model_validate(raw_result.model_dump())

    text = _coerce_message_content(raw_result)
    errors: list[str] = []
    for candidate in _candidate_json_payloads(text):
        try:
            return model.model_validate_json(candidate)
        except Exception as exc:
            errors.append(str(exc))
            try:
                return model.model_validate(json.loads(candidate))
            except Exception as nested_exc:
                errors.append(str(nested_exc))

    raise ValueError(
        f"Failed to parse {model.__name__} from LLM output. Raw content: {text[:300]} | "
        f"errors: {' | '.join(errors[:4])}"
    )


def build_json_only_prompt(prompt_text: str, model: Type[BaseModel]) -> str:
    schema = json.dumps(pydantic_json_schema_inline(model), ensure_ascii=False, indent=2)
    return (
        f"{prompt_text.strip()}\n\n"
        "最终输出要求：\n"
        "1. 你必须只输出一个合法 JSON 对象。\n"
        "2. 不要输出 markdown，不要输出标题，不要输出解释，不要输出代码块标记。\n"
        "3. 不要输出 schema 说明文本，不要输出示例，不要补充 JSON 之外的任何字符。\n"
        "4. 所有字段必须符合下面给定的 JSON Schema。\n\n"
        f"JSON Schema:\n{schema}"
    )
