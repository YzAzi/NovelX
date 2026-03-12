from __future__ import annotations

import json
from contextlib import contextmanager
import fcntl
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from pydantic import BaseModel, Field

from .chunking import ChunkConfig, ChunkingStrategy, chunk_text
from .storage_paths import project_file_candidates, resolve_project_file
from .vectorstore import SearchResult, add_documents, delete_by_filter, delete_by_ids, search_similar
from .bm25 import BM25
from .text_utils import keyword_score, tokenize


class StyleDocument(BaseModel):
    id: str
    project_id: str
    title: str
    category: str
    content: str
    chunks: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class StyleKnowledgeBase(BaseModel):
    project_id: str
    documents: list[StyleDocument]
    total_chunks: int
    total_characters: int


def _default_chunking_config() -> ChunkConfig:
    return ChunkConfig(strategy=ChunkingStrategy.PARAGRAPH)


def _now() -> datetime:
    return datetime.utcnow()


def _storage_dir() -> Path:
    directory = Path(__file__).resolve().parent.parent / "data" / "style_knowledge"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _project_file(project_id: str) -> Path:
    return resolve_project_file(_storage_dir(), project_id, ".json")


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


def _load_project_documents(project_id: str) -> list[StyleDocument]:
    path = _project_file(project_id)
    with _file_lock(path):
        if not path.exists():
            return []
        data = json.loads(path.read_text(encoding="utf-8"))
        return [StyleDocument.model_validate(item) for item in data]


def _save_project_documents(project_id: str, documents: list[StyleDocument]) -> None:
    path = _project_file(project_id)
    payload = [doc.model_dump(mode="json") for doc in documents]
    with _file_lock(path):
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )


def _build_chunk_metadata(
    project_id: str,
    doc: StyleDocument,
    chunk_index: int,
    start_index: int,
    end_index: int,
) -> dict:
    return {
        "project_id": project_id,
        "document_id": doc.id,
        "title": doc.title,
        "category": doc.category,
        "chunk_index": chunk_index,
        "start_index": start_index,
        "end_index": end_index,
    }


def _build_snippet(document: StyleDocument, limit: int = 180) -> str:
    content = document.content.strip().replace("\n", " ")
    if len(content) > limit:
        content = f"{content[: limit - 3]}..."
    return f"{document.title}：{content}"


class StyleKnowledgeManager:
    async def list_project_documents(self, project_id: str) -> list[StyleDocument]:
        return _load_project_documents(project_id)

    async def add_document(
        self,
        project_id: str,
        title: str,
        category: str,
        content: str,
        chunking_config: ChunkConfig | None = None,
    ) -> StyleDocument:
        config = chunking_config or _default_chunking_config()
        document = StyleDocument(
            id=str(uuid4()),
            project_id=project_id,
            title=title,
            category=category,
            content=content,
            chunks=[],
            created_at=_now(),
            updated_at=_now(),
        )

        chunks = chunk_text(
            content,
            config,
            source_metadata={"project_id": project_id, "document_id": document.id},
        )
        if chunks:
            document.chunks = [chunk.id for chunk in chunks]
            await add_documents(
                collection_name="style_knowledge",
                documents=[chunk.content for chunk in chunks],
                metadatas=[
                    _build_chunk_metadata(
                        project_id,
                        document,
                        index,
                        chunk.start_index,
                        chunk.end_index,
                    )
                    for index, chunk in enumerate(chunks)
                ],
                ids=[chunk.id for chunk in chunks],
            )

        documents = _load_project_documents(project_id)
        documents.append(document)
        _save_project_documents(project_id, documents)
        return document

    async def delete_document_in_project(
        self,
        project_id: str,
        doc_id: str,
    ) -> None:
        documents = _load_project_documents(project_id)
        document = next((item for item in documents if item.id == doc_id), None)
        if document is None:
            return
        if document.chunks:
            await delete_by_ids("style_knowledge", document.chunks)
        documents = [item for item in documents if item.id != doc_id]
        _save_project_documents(project_id, documents)

    async def update_document_title_in_project(
        self,
        project_id: str,
        doc_id: str,
        title: str,
    ) -> StyleDocument:
        documents = _load_project_documents(project_id)
        document = next((item for item in documents if item.id == doc_id), None)
        if document is None:
            raise ValueError("Document not found")
        document.title = title
        document.updated_at = _now()
        for index, item in enumerate(documents):
            if item.id == doc_id:
                documents[index] = document
                break
        _save_project_documents(project_id, documents)
        return document

    async def delete_project_data(self, project_id: str) -> None:
        documents = _load_project_documents(project_id)
        chunk_ids = [chunk_id for doc in documents for chunk_id in doc.chunks]
        if chunk_ids:
            await delete_by_ids("style_knowledge", chunk_ids)
        await delete_by_filter("style_knowledge", {"project_id": project_id})
        for path in project_file_candidates(_storage_dir(), project_id, ".json"):
            with _file_lock(path):
                if path.exists():
                    path.unlink()

    async def get_knowledge_base(self, project_id: str) -> StyleKnowledgeBase:
        documents = _load_project_documents(project_id)
        total_chunks = sum(len(doc.chunks) for doc in documents)
        total_characters = sum(len(doc.content) for doc in documents)
        return StyleKnowledgeBase(
            project_id=project_id,
            documents=documents,
            total_chunks=total_chunks,
            total_characters=total_characters,
        )

    async def search_style(
        self,
        project_id: str,
        query: str,
        document_ids: list[str],
        top_k: int = 6,
    ) -> list[SearchResult]:
        if not document_ids or not query.strip():
            return []
        filter_dict = {
            "$and": [
                {"project_id": project_id},
                {"document_id": {"$in": document_ids}},
            ]
        }

        vector_hits = await search_similar(
            collection_name="style_knowledge",
            query=query,
            top_k=top_k + 2,
            filter_dict=filter_dict,
        )

        documents = [
            doc
            for doc in _load_project_documents(project_id)
            if doc.id in document_ids
        ]

        tokens = tokenize(query)
        scores: dict[str, dict] = {}
        snippets: dict[str, tuple[str, dict]] = {}

        for hit in vector_hits:
            key = f"vec:{hit.id}"
            scores[key] = {"vector": float(hit.score), "keyword": 0.0, "bm25": 0.0}
            snippets[key] = (hit.content, hit.metadata or {})

        if documents and tokens:
            for doc in documents:
                text = f"{doc.title}\n{doc.category}\n{doc.content}"
                score = keyword_score(tokens, text)
                if score > 0:
                    key = f"kw:{doc.id}"
                    entry = scores.setdefault(
                        key, {"vector": 0.0, "keyword": 0.0, "bm25": 0.0}
                    )
                    entry["keyword"] = max(entry["keyword"], float(score))
                    snippets[key] = (
                        _build_snippet(doc),
                        {
                            "title": doc.title,
                            "category": doc.category,
                            "document_id": doc.id,
                        },
                    )

            corpus = [
                tokenize(f"{doc.title}\n{doc.category}\n{doc.content}")
                for doc in documents
            ]
            bm25 = BM25(corpus)
            for index, doc in enumerate(documents):
                score = bm25.score(tokens, index)
                if score <= 0:
                    continue
                key = f"bm25:{doc.id}"
                entry = scores.setdefault(
                    key, {"vector": 0.0, "keyword": 0.0, "bm25": 0.0}
                )
                entry["bm25"] = max(entry["bm25"], float(score))
                if key not in snippets:
                    snippets[key] = (
                        _build_snippet(doc),
                        {
                            "title": doc.title,
                            "category": doc.category,
                            "document_id": doc.id,
                        },
                    )

        if not scores:
            return []

        max_keyword = max((entry["keyword"] for entry in scores.values()), default=0.0)
        max_bm25 = max((entry["bm25"] for entry in scores.values()), default=0.0)

        ranked: list[tuple[float, str]] = []
        for key, entry in scores.items():
            keyword_norm = entry["keyword"] / max(1.0, max_keyword) if max_keyword else 0.0
            bm25_norm = entry["bm25"] / max(1.0, max_bm25) if max_bm25 else 0.0
            combined = entry["vector"] * 0.6 + keyword_norm * 0.2 + bm25_norm * 0.2
            ranked.append((combined, key))

        ranked.sort(key=lambda item: item[0], reverse=True)
        results: list[SearchResult] = []
        for score, key in ranked[:top_k]:
            content, metadata = snippets.get(key, ("", {}))
            results.append(
                SearchResult(
                    id=key,
                    content=content,
                    metadata=metadata,
                    score=float(score),
                )
            )
        return results
