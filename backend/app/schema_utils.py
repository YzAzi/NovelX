from __future__ import annotations

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
