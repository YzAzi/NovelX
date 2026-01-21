from __future__ import annotations

import json
from contextlib import contextmanager
import fcntl
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from .bm25 import BM25
from .text_utils import keyword_score, tokenize
from .vectorstore import search_similar


def _storage_dir() -> Path:
    directory = Path(__file__).resolve().parent.parent / "data" / "analysis_history"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _project_file(project_id: str) -> Path:
    return _storage_dir() / f"{project_id}.json"


@contextmanager
def _file_lock(path: Path):
    lock_path = path.with_suffix(f"{path.suffix}.lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a", encoding="utf-8") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def _now() -> str:
    return datetime.utcnow().isoformat()


def load_history(project_id: str) -> list[dict]:
    path = _project_file(project_id)
    with _file_lock(path):
        if not path.exists():
            return []
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            return []
        return data


def append_messages(project_id: str, messages: list[dict]) -> list[dict]:
    if not messages:
        return []
    path = _project_file(project_id)
    stored = load_history(project_id)
    records: list[dict] = []
    for message in messages:
        content = (message.get("content") or "").strip()
        role = (message.get("role") or "user").strip()
        if not content:
            continue
        records.append(
            {
                "id": str(uuid4()),
                "role": role,
                "content": content,
                "created_at": _now(),
            }
        )
    if not records:
        return []
    stored.extend(records)
    with _file_lock(path):
        path.write_text(
            json.dumps(stored, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    return records


async def search_history(
    project_id: str,
    query: str,
    top_k: int = 6,
) -> list[dict]:
    if not query.strip():
        return []
    history = load_history(project_id)
    if not history:
        return []

    queries = [query.strip()]
    tokens = [token for token in tokenize(query) if len(token) > 1]
    if tokens:
        queries.append(" ".join(tokens[:6]))

    corpus = [tokenize(f"{item['role']}: {item['content']}") for item in history]
    bm25 = BM25(corpus)
    by_id = {item["id"]: item for item in history if "id" in item}
    scores: dict[str, dict] = {}

    for q in queries:
        vector_hits = await search_similar(
            collection_name="analysis_history",
            query=q,
            top_k=top_k + 2,
            filter_dict={"project_id": project_id},
        )
        for hit in vector_hits:
            item_id = str(hit.id)
            if item_id not in by_id:
                continue
            entry = scores.setdefault(
                item_id, {"vector": 0.0, "keyword": 0.0, "bm25": 0.0}
            )
            entry["vector"] = max(entry["vector"], float(hit.score))

        keyword_tokens = tokenize(q)
        for item in history:
            item_id = item.get("id")
            if not item_id:
                continue
            text = f"{item.get('role', 'user')}: {item.get('content', '')}"
            score = keyword_score(keyword_tokens, text)
            if score <= 0:
                continue
            entry = scores.setdefault(
                item_id, {"vector": 0.0, "keyword": 0.0, "bm25": 0.0}
            )
            entry["keyword"] = max(entry["keyword"], float(score))

        if keyword_tokens:
            bm25_scores = [
                bm25.score(keyword_tokens, index) for index in range(len(history))
            ]
            for idx, score in enumerate(bm25_scores):
                if score <= 0:
                    continue
                item_id = history[idx].get("id")
                if not item_id:
                    continue
                entry = scores.setdefault(
                    item_id, {"vector": 0.0, "keyword": 0.0, "bm25": 0.0}
                )
                entry["bm25"] = max(entry["bm25"], float(score))

    if not scores:
        return []

    max_keyword = max((entry["keyword"] for entry in scores.values()), default=0.0)
    max_bm25 = max((entry["bm25"] for entry in scores.values()), default=0.0)

    ranked: list[tuple[float, dict]] = []
    for item_id, entry in scores.items():
        keyword_norm = entry["keyword"] / max(1.0, max_keyword) if max_keyword else 0.0
        bm25_norm = entry["bm25"] / max(1.0, max_bm25) if max_bm25 else 0.0
        combined = entry["vector"] * 0.6 + keyword_norm * 0.2 + bm25_norm * 0.2
        item = by_id.get(item_id)
        if item:
            ranked.append((combined, item))

    ranked.sort(key=lambda item: item[0], reverse=True)
    return [item for _score, item in ranked[:top_k]]
