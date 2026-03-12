from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Iterable

import chromadb
from chromadb.config import Settings as ChromaSettings
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

from .config import settings


class SearchResult(BaseModel):
    id: str
    content: str
    metadata: dict
    score: float


class SentenceTransformerEmbedding:
    def __init__(self, model_name: str) -> None:
        self._model = SentenceTransformer(model_name)

    def __call__(self, input: Iterable[str]) -> list[list[float]]:
        embeddings = self._model.encode(list(input), normalize_embeddings=True)
        return embeddings.tolist()


_CHROMA_PATH = Path(settings.chroma_persist_path)
_CHROMA_PATH.mkdir(parents=True, exist_ok=True)

_client = chromadb.PersistentClient(
    path=str(_CHROMA_PATH),
    settings=ChromaSettings(anonymized_telemetry=False),
)

_embedding_fn = SentenceTransformerEmbedding(settings.embedding_model)

_collections = {
    "world_knowledge": _client.get_or_create_collection(
        name="world_knowledge",
        embedding_function=_embedding_fn,
    ),
    "style_knowledge": _client.get_or_create_collection(
        name="style_knowledge",
        embedding_function=_embedding_fn,
    ),
    "story_nodes": _client.get_or_create_collection(
        name="story_nodes",
        embedding_function=_embedding_fn,
    ),
    "analysis_history": _client.get_or_create_collection(
        name="analysis_history",
        embedding_function=_embedding_fn,
    ),
}


def _get_collection(collection_name: str):
    collection = _collections.get(collection_name)
    if not collection:
        raise ValueError(f"Unknown collection: {collection_name}")
    return collection


async def add_documents(
    collection_name: str,
    documents: list[str],
    metadatas: list[dict],
    ids: list[str],
) -> None:
    if not (len(documents) == len(metadatas) == len(ids)):
        raise ValueError("documents, metadatas, and ids must have the same length")
    collection = _get_collection(collection_name)
    await asyncio.to_thread(
        collection.add,
        documents=documents,
        metadatas=metadatas,
        ids=ids,
    )


async def search_similar(
    collection_name: str,
    query: str,
    top_k: int = 5,
    filter_dict: dict | None = None,
) -> list[SearchResult]:
    collection = _get_collection(collection_name)
    result = await asyncio.to_thread(
        collection.query,
        query_texts=[query],
        n_results=top_k,
        where=filter_dict,
        include=["documents", "metadatas", "distances"],
    )

    ids = result.get("ids", [[]])[0]
    documents = result.get("documents", [[]])[0]
    metadatas = result.get("metadatas", [[]])[0]
    distances = result.get("distances", [[]])[0]

    results: list[SearchResult] = []
    for item_id, content, metadata, distance in zip(
        ids, documents, metadatas, distances
    ):
        if distance is None:
            score = 0.0
        else:
            score = 1 - float(distance)
        results.append(
            SearchResult(
                id=str(item_id),
                content=content,
                metadata=metadata or {},
                score=score,
            )
        )
    return results


async def delete_by_ids(
    collection_name: str,
    ids: list[str],
) -> None:
    collection = _get_collection(collection_name)
    await asyncio.to_thread(collection.delete, ids=ids)


async def delete_by_filter(
    collection_name: str,
    filter_dict: dict,
) -> None:
    collection = _get_collection(collection_name)
    await asyncio.to_thread(collection.delete, where=filter_dict)
