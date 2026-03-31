from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_session
from ..helpers import get_project_or_404, resolve_style_preview
from ..models import (
    StyleKnowledgeUpdateRequest,
    StyleKnowledgeUploadResponse,
    StyleRetrievalPreviewRequest,
    StyleRetrievalPreviewResponse,
)
from ..runtime import style_curation_service, style_knowledge_manager
from ..style_knowledge import StyleDocument, StyleKnowledgeBase

router = APIRouter(tags=["style"])


@router.get(
    "/api/projects/{project_id}/style_knowledge",
    response_model=StyleKnowledgeBase,
    status_code=status.HTTP_200_OK,
)
async def get_style_knowledge_base(
    project_id: str,
    session: AsyncSession = Depends(get_session),
):
    await get_project_or_404(session, project_id)
    return await style_knowledge_manager.get_knowledge_base(project_id)


@router.post(
    "/api/projects/{project_id}/style_knowledge/upload",
    response_model=StyleKnowledgeUploadResponse,
    status_code=status.HTTP_200_OK,
)
async def upload_style_knowledge(
    project_id: str,
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
):
    await get_project_or_404(session, project_id)
    filename = file.filename or ""
    if not (filename.endswith(".md") or filename.endswith(".txt")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported file type",
        )

    raw = await file.read()
    try:
        content = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported file encoding (expected UTF-8)",
        ) from exc

    title = Path(filename).stem or "未命名风格"
    try:
        curated = await style_curation_service.curate_text(title=title, raw_text=content)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    document = await style_knowledge_manager.add_document(
        project_id=project_id,
        title=title,
        category="style",
        content=curated.curated_content,
        source_characters=curated.source_characters,
        curated_characters=curated.curated_characters,
        curated_segments=curated.curated_segments,
    )
    return StyleKnowledgeUploadResponse(
        document=document,
        total_batches=curated.total_batches,
        successful_batches=curated.successful_batches,
        failed_batches=curated.failed_batches,
        warnings=curated.warnings,
    )


@router.delete(
    "/api/projects/{project_id}/style_knowledge/{doc_id}",
    status_code=status.HTTP_200_OK,
)
async def delete_style_knowledge(
    project_id: str,
    doc_id: str,
    session: AsyncSession = Depends(get_session),
):
    await get_project_or_404(session, project_id)
    await style_knowledge_manager.delete_document_in_project(project_id, doc_id)
    return {"deleted": True}


@router.put(
    "/api/projects/{project_id}/style_knowledge/{doc_id}",
    response_model=StyleDocument,
    status_code=status.HTTP_200_OK,
)
async def update_style_knowledge(
    project_id: str,
    doc_id: str,
    payload: StyleKnowledgeUpdateRequest,
    session: AsyncSession = Depends(get_session),
):
    await get_project_or_404(session, project_id)
    title = payload.title.strip()
    if not title:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Title cannot be empty",
        )
    try:
        return await style_knowledge_manager.update_document_title_in_project(
            project_id=project_id,
            doc_id=doc_id,
            title=title,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found",
        ) from exc


@router.post(
    "/api/projects/{project_id}/style_knowledge/preview",
    response_model=StyleRetrievalPreviewResponse,
    status_code=status.HTTP_200_OK,
)
async def preview_style_references(
    project_id: str,
    payload: StyleRetrievalPreviewRequest,
    session: AsyncSession = Depends(get_session),
):
    await get_project_or_404(session, project_id)
    return await resolve_style_preview(
        project_id=project_id,
        instruction=payload.instruction,
        text=payload.text,
        style_document_ids=payload.style_document_ids,
        top_k=max(1, min(payload.top_k, 8)),
    )
