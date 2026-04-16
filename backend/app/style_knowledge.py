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
    project_id: str | None = None
    library_id: str | None = None
    owner_id: str | None = None
    scope: str = "project"
    title: str
    category: str
    content: str
    chunks: list[str] = Field(default_factory=list)
    source_characters: int = 0
    curated_characters: int = 0
    curated_segments: int = 0
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


def _library_storage_dir() -> Path:
    directory = Path(__file__).resolve().parent.parent / "data" / "style_library_knowledge"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _project_file(project_id: str) -> Path:
    return resolve_project_file(_storage_dir(), project_id, ".json")


def _library_file(library_id: str) -> Path:
    return resolve_project_file(_library_storage_dir(), library_id, ".json")


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


def _load_documents(path: Path) -> list[StyleDocument]:
    with _file_lock(path):
        if not path.exists():
            return []
        data = json.loads(path.read_text(encoding="utf-8"))
        return [StyleDocument.model_validate(item) for item in data]


def _save_documents(path: Path, documents: list[StyleDocument]) -> None:
    payload = [doc.model_dump(mode="json") for doc in documents]
    with _file_lock(path):
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )


def _load_project_documents(project_id: str) -> list[StyleDocument]:
    return _load_documents(_project_file(project_id))


def _load_library_documents(library_id: str) -> list[StyleDocument]:
    return _load_documents(_library_file(library_id))


def _save_project_documents(project_id: str, documents: list[StyleDocument]) -> None:
    _save_documents(_project_file(project_id), documents)


def _save_library_documents(library_id: str, documents: list[StyleDocument]) -> None:
    _save_documents(_library_file(library_id), documents)


def _build_chunk_metadata(
    doc: StyleDocument,
    chunk_index: int,
    start_index: int,
    end_index: int,
) -> dict:
    metadata = {
        "document_id": doc.id,
        "title": doc.title,
        "category": doc.category,
        "scope": doc.scope,
        "chunk_index": chunk_index,
        "start_index": start_index,
        "end_index": end_index,
    }
    if doc.project_id:
        metadata["project_id"] = doc.project_id
    if doc.library_id:
        metadata["library_id"] = doc.library_id
    if doc.owner_id:
        metadata["owner_id"] = doc.owner_id
    return metadata


def _build_snippet(document: StyleDocument, limit: int = 180) -> str:
    content = document.content.strip().replace("\n", " ")
    if len(content) > limit:
        content = f"{content[: limit - 3]}..."
    return f"{document.title}：{content}"


def _normalize_focus_values(preferred_focuses: list[str] | None) -> list[str]:
    if not preferred_focuses:
        return []
    mapping = {
        "dialogue": "对话型",
        "dialog": "对话型",
        "对话": "对话型",
        "对话型": "对话型",
        "environment": "环境型",
        "scene": "环境型",
        "环境": "环境型",
        "环境型": "环境型",
        "hybrid": "混合型",
        "mixed": "混合型",
        "混合": "混合型",
        "混合型": "混合型",
        "general": "通用型",
        "通用": "通用型",
        "通用型": "通用型",
    }
    normalized: list[str] = []
    for item in preferred_focuses:
        value = mapping.get((item or "").strip().lower())
        if value and value not in normalized:
            normalized.append(value)
    return normalized


def _focus_bonus(text: str, preferred_focuses: list[str]) -> float:
    if not text or not preferred_focuses:
        return 0.0
    bonus_map = {
        "对话型": 0.16,
        "环境型": 0.16,
        "混合型": 0.20,
        "通用型": 0.08,
    }
    matched = [focus for focus in preferred_focuses if f"类型：{focus}" in text]
    if not matched:
        return 0.0
    return max(bonus_map.get(focus, 0.0) for focus in matched)


def _extract_focus(text: str) -> str | None:
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("类型："):
            return stripped.removeprefix("类型：").strip() or None
    return None


def _extract_techniques(text: str) -> list[str]:
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("技法："):
            payload = stripped.removeprefix("技法：").strip()
            if not payload:
                return []
            return [item.strip() for item in payload.split("、") if item.strip()]
    return []


def _content_signature(text: str) -> str:
    return "".join(text.split())


class StyleKnowledgeManager:
    async def list_project_documents(self, project_id: str) -> list[StyleDocument]:
        return _load_project_documents(project_id)

    async def list_library_documents(self, library_id: str) -> list[StyleDocument]:
        return _load_library_documents(library_id)

    async def add_document(
        self,
        project_id: str,
        title: str,
        category: str,
        content: str,
        source_characters: int = 0,
        curated_characters: int | None = None,
        curated_segments: int = 0,
        chunking_config: ChunkConfig | None = None,
    ) -> StyleDocument:
        config = chunking_config or _default_chunking_config()
        document = StyleDocument(
            id=str(uuid4()),
            project_id=project_id,
            scope="project",
            title=title,
            category=category,
            content=content,
            chunks=[],
            source_characters=max(source_characters, 0),
            curated_characters=max(curated_characters or len(content), 0),
            curated_segments=max(curated_segments, 0),
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

    async def add_library_document(
        self,
        library_id: str,
        title: str,
        category: str,
        content: str,
        owner_id: str | None = None,
        source_characters: int = 0,
        curated_characters: int | None = None,
        curated_segments: int = 0,
        chunking_config: ChunkConfig | None = None,
    ) -> StyleDocument:
        config = chunking_config or _default_chunking_config()
        document = StyleDocument(
            id=str(uuid4()),
            project_id=None,
            library_id=library_id,
            owner_id=owner_id,
            scope="library",
            title=title,
            category=category,
            content=content,
            chunks=[],
            source_characters=max(source_characters, 0),
            curated_characters=max(curated_characters or len(content), 0),
            curated_segments=max(curated_segments, 0),
            created_at=_now(),
            updated_at=_now(),
        )

        chunks = chunk_text(
            content,
            config,
            source_metadata={"library_id": library_id, "document_id": document.id},
        )
        if chunks:
            document.chunks = [chunk.id for chunk in chunks]
            await add_documents(
                collection_name="style_knowledge",
                documents=[chunk.content for chunk in chunks],
                metadatas=[
                    _build_chunk_metadata(
                        document,
                        index,
                        chunk.start_index,
                        chunk.end_index,
                    )
                    for index, chunk in enumerate(chunks)
                ],
                ids=[chunk.id for chunk in chunks],
            )

        documents = _load_library_documents(library_id)
        documents.append(document)
        _save_library_documents(library_id, documents)
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

    async def update_document_title_in_library(
        self,
        library_id: str,
        doc_id: str,
        title: str,
    ) -> StyleDocument:
        documents = _load_library_documents(library_id)
        document = next((item for item in documents if item.id == doc_id), None)
        if document is None:
            raise ValueError("Document not found")
        document.title = title
        document.updated_at = _now()
        for index, item in enumerate(documents):
            if item.id == doc_id:
                documents[index] = document
                break
        _save_library_documents(library_id, documents)
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

    async def delete_document_in_library(
        self,
        library_id: str,
        doc_id: str,
    ) -> None:
        documents = _load_library_documents(library_id)
        document = next((item for item in documents if item.id == doc_id), None)
        if document is None:
            return
        if document.chunks:
            await delete_by_ids("style_knowledge", document.chunks)
        documents = [item for item in documents if item.id != doc_id]
        _save_library_documents(library_id, documents)

    async def delete_library_data(self, library_id: str) -> None:
        documents = _load_library_documents(library_id)
        chunk_ids = [chunk_id for doc in documents for chunk_id in doc.chunks]
        if chunk_ids:
            await delete_by_ids("style_knowledge", chunk_ids)
        await delete_by_filter("style_knowledge", {"library_id": library_id})
        for path in project_file_candidates(_library_storage_dir(), library_id, ".json"):
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

    async def get_library_knowledge_base(self, library_id: str) -> StyleKnowledgeBase:
        documents = _load_library_documents(library_id)
        total_chunks = sum(len(doc.chunks) for doc in documents)
        total_characters = sum(len(doc.content) for doc in documents)
        return StyleKnowledgeBase(
            project_id=library_id,
            documents=documents,
            total_chunks=total_chunks,
            total_characters=total_characters,
        )

    async def replace_project_documents(
        self,
        project_id: str,
        documents: list[StyleDocument],
        chunking_config: ChunkConfig | None = None,
    ) -> list[StyleDocument]:
        await self.delete_project_data(project_id)
        if not documents:
            return []

        config = chunking_config or _default_chunking_config()
        restored: list[StyleDocument] = []
        for doc in documents:
            restored_doc = StyleDocument(
                id=doc.id,
                project_id=project_id,
                library_id=None,
                owner_id=doc.owner_id,
                scope=doc.scope or "project",
                title=doc.title,
                category=doc.category,
                content=doc.content,
                chunks=[],
                source_characters=doc.source_characters,
                curated_characters=doc.curated_characters or len(doc.content),
                curated_segments=doc.curated_segments,
                created_at=doc.created_at,
                updated_at=doc.updated_at,
            )
            chunks = chunk_text(
                doc.content,
                config,
                source_metadata={"project_id": project_id, "document_id": restored_doc.id},
            )
            if chunks:
                restored_doc.chunks = [chunk.id for chunk in chunks]
                await add_documents(
                    collection_name="style_knowledge",
                    documents=[chunk.content for chunk in chunks],
                    metadatas=[
                        _build_chunk_metadata(
                            restored_doc,
                            index,
                            chunk.start_index,
                            chunk.end_index,
                        )
                        for index, chunk in enumerate(chunks)
                    ],
                    ids=[chunk.id for chunk in chunks],
                )
            restored.append(restored_doc)

        _save_project_documents(project_id, restored)
        return restored

    async def replace_library_documents(
        self,
        library_id: str,
        documents: list[StyleDocument],
        owner_id: str | None = None,
        chunking_config: ChunkConfig | None = None,
    ) -> list[StyleDocument]:
        await self.delete_library_data(library_id)
        if not documents:
            return []

        config = chunking_config or _default_chunking_config()
        restored: list[StyleDocument] = []
        for doc in documents:
            restored_doc = StyleDocument(
                id=doc.id,
                project_id=None,
                library_id=library_id,
                owner_id=owner_id or doc.owner_id,
                scope="library",
                title=doc.title,
                category=doc.category,
                content=doc.content,
                chunks=[],
                source_characters=doc.source_characters,
                curated_characters=doc.curated_characters or len(doc.content),
                curated_segments=doc.curated_segments,
                created_at=doc.created_at,
                updated_at=doc.updated_at,
            )
            chunks = chunk_text(
                doc.content,
                config,
                source_metadata={"library_id": library_id, "document_id": restored_doc.id},
            )
            if chunks:
                restored_doc.chunks = [chunk.id for chunk in chunks]
                await add_documents(
                    collection_name="style_knowledge",
                    documents=[chunk.content for chunk in chunks],
                    metadatas=[
                        _build_chunk_metadata(
                            restored_doc,
                            index,
                            chunk.start_index,
                            chunk.end_index,
                        )
                        for index, chunk in enumerate(chunks)
                    ],
                    ids=[chunk.id for chunk in chunks],
                )
            restored.append(restored_doc)

        _save_library_documents(library_id, restored)
        return restored

    async def search_style_documents(
        self,
        query: str,
        documents: list[StyleDocument],
        top_k: int = 6,
        preferred_focuses: list[str] | None = None,
    ) -> list[SearchResult]:
        if not documents or not query.strip():
            return []
        normalized_focuses = _normalize_focus_values(preferred_focuses)
        document_ids = [doc.id for doc in documents]
        filter_dict = {"document_id": {"$in": document_ids}}

        vector_hits = await search_similar(
            collection_name="style_knowledge",
            query=query,
            top_k=top_k + 2,
            filter_dict=filter_dict,
        )

        tokens = tokenize(query)
        scores: dict[str, dict] = {}
        snippets: dict[str, tuple[str, dict]] = {}

        for hit in vector_hits:
            key = f"vec:{hit.id}"
            metadata = dict(hit.metadata or {})
            metadata.setdefault("focus", _extract_focus(hit.content))
            metadata.setdefault("techniques", _extract_techniques(hit.content))
            scores[key] = {
                "vector": float(hit.score),
                "keyword": 0.0,
                "bm25": 0.0,
                "focus": _focus_bonus(hit.content, normalized_focuses),
            }
            snippets[key] = (hit.content, metadata)

        if documents and tokens:
            for doc in documents:
                text = f"{doc.title}\n{doc.category}\n{doc.content}"
                score = keyword_score(tokens, text)
                if score > 0:
                    key = f"kw:{doc.id}"
                    entry = scores.setdefault(
                        key,
                        {
                            "vector": 0.0,
                            "keyword": 0.0,
                            "bm25": 0.0,
                            "focus": _focus_bonus(doc.content, normalized_focuses),
                        },
                    )
                    entry["keyword"] = max(entry["keyword"], float(score))
                    entry["focus"] = max(
                        entry.get("focus", 0.0),
                        _focus_bonus(doc.content, normalized_focuses),
                    )
                    snippets[key] = (
                        _build_snippet(doc),
                        {
                            "title": doc.title,
                            "category": doc.category,
                            "document_id": doc.id,
                            "scope": doc.scope,
                            "project_id": doc.project_id,
                            "library_id": doc.library_id,
                            "focus": _extract_focus(doc.content),
                            "techniques": _extract_techniques(doc.content),
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
                    key,
                    {
                        "vector": 0.0,
                        "keyword": 0.0,
                        "bm25": 0.0,
                        "focus": _focus_bonus(doc.content, normalized_focuses),
                    },
                )
                entry["bm25"] = max(entry["bm25"], float(score))
                entry["focus"] = max(
                    entry.get("focus", 0.0),
                    _focus_bonus(doc.content, normalized_focuses),
                )
                if key not in snippets:
                    snippets[key] = (
                        _build_snippet(doc),
                        {
                            "title": doc.title,
                            "category": doc.category,
                            "document_id": doc.id,
                            "scope": doc.scope,
                            "project_id": doc.project_id,
                            "library_id": doc.library_id,
                            "focus": _extract_focus(doc.content),
                            "techniques": _extract_techniques(doc.content),
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
            combined = (
                entry["vector"] * 0.55
                + keyword_norm * 0.2
                + bm25_norm * 0.15
                + entry.get("focus", 0.0) * 0.1
            )
            ranked.append((combined, key))

        ranked.sort(key=lambda item: item[0], reverse=True)
        results: list[SearchResult] = []
        seen_signatures: set[str] = set()
        document_counts: dict[str, int] = {}
        focus_counts: dict[str, int] = {}
        document_limit = 2 if top_k > 3 else 1
        focus_limit = max(2, top_k // 2 + 1)

        for score, key in ranked:
            content, metadata = snippets.get(key, ("", {}))
            if not content:
                continue
            signature = _content_signature(content)
            if signature in seen_signatures:
                continue
            document_id = str(metadata.get("document_id") or "")
            focus = str(metadata.get("focus") or "")
            if document_id and document_counts.get(document_id, 0) >= document_limit and len(results) + 1 < top_k:
                continue
            if focus and focus_counts.get(focus, 0) >= focus_limit and len(results) + 1 < top_k:
                continue
            seen_signatures.add(signature)
            if document_id:
                document_counts[document_id] = document_counts.get(document_id, 0) + 1
            if focus:
                focus_counts[focus] = focus_counts.get(focus, 0) + 1
            results.append(
                SearchResult(
                    id=key,
                    content=content,
                    metadata=metadata,
                    score=float(score),
                )
            )
            if len(results) >= top_k:
                break
        return results

    async def search_style(
        self,
        project_id: str,
        query: str,
        document_ids: list[str],
        top_k: int = 6,
        preferred_focuses: list[str] | None = None,
    ) -> list[SearchResult]:
        documents = [
            doc
            for doc in _load_project_documents(project_id)
            if doc.id in document_ids
        ]
        return await self.search_style_documents(
            query=query,
            documents=documents,
            top_k=top_k,
            preferred_focuses=preferred_focuses,
        )
