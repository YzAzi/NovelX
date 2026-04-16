from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..crud import (
    create_style_library,
    delete_style_library,
    get_style_library,
    list_style_libraries,
    update_style_library,
)
from ..database import get_session
from ..models import (
    StyleKnowledgeImportResponse,
    StyleKnowledgeUpdateRequest,
    StyleLibrary,
    StyleLibraryBundle,
    StyleLibraryCreateRequest,
    StyleLibraryUpdateRequest,
)
from ..request_context import get_current_user_id
from ..runtime import style_knowledge_manager
from ..style_importer import parse_cleaned_style_upload
from ..style_knowledge import StyleDocument

router = APIRouter(tags=["style_libraries"])


def _require_user_id() -> str:
    user_id = get_current_user_id()
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )
    return user_id


async def _get_library_or_404(
    session: AsyncSession,
    library_id: str,
) -> StyleLibrary:
    _require_user_id()
    library = await get_style_library(session, library_id)
    if library is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Style library not found",
        )
    return library


@router.get(
    "/api/style_libraries",
    response_model=list[StyleLibraryBundle],
    status_code=status.HTTP_200_OK,
)
async def list_style_library_records(
    session: AsyncSession = Depends(get_session),
):
    _require_user_id()
    libraries = await list_style_libraries(session)
    bundles: list[StyleLibraryBundle] = []
    for library in libraries:
        knowledge_base = await style_knowledge_manager.get_library_knowledge_base(library.id)
        bundles.append(
            StyleLibraryBundle(
                library=library,
                documents=knowledge_base.documents,
                total_chunks=knowledge_base.total_chunks,
                total_characters=knowledge_base.total_characters,
            )
        )
    return bundles


@router.post(
    "/api/style_libraries",
    response_model=StyleLibrary,
    status_code=status.HTTP_201_CREATED,
)
async def create_style_library_record(
    payload: StyleLibraryCreateRequest,
    session: AsyncSession = Depends(get_session),
):
    user_id = _require_user_id()
    library = StyleLibrary(
        owner_id=user_id,
        name=payload.name,
        description=(payload.description or "").strip(),
    )
    return await create_style_library(session, library, owner_id=user_id)


@router.put(
    "/api/style_libraries/{library_id}",
    response_model=StyleLibrary,
    status_code=status.HTTP_200_OK,
)
async def update_style_library_record(
    library_id: str,
    payload: StyleLibraryUpdateRequest,
    session: AsyncSession = Depends(get_session),
):
    _require_user_id()
    library = await _get_library_or_404(session, library_id)
    if payload.name is not None:
        next_name = payload.name.strip()
        if not next_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Library name cannot be empty",
            )
        library.name = next_name
    if payload.description is not None:
        library.description = payload.description.strip()
    library.updated_at = datetime.utcnow()
    try:
        return await update_style_library(session, library_id, library)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Style library not found",
        ) from exc


@router.delete(
    "/api/style_libraries/{library_id}",
    status_code=status.HTTP_200_OK,
)
async def delete_style_library_record(
    library_id: str,
    session: AsyncSession = Depends(get_session),
):
    await _get_library_or_404(session, library_id)
    await style_knowledge_manager.delete_library_data(library_id)
    deleted = await delete_style_library(session, library_id)
    return {"deleted": deleted}


@router.post(
    "/api/style_libraries/{library_id}/documents/import",
    response_model=StyleKnowledgeImportResponse,
    status_code=status.HTTP_200_OK,
)
async def import_library_style_documents(
    library_id: str,
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
):
    user_id = _require_user_id()
    await _get_library_or_404(session, library_id)
    raw = await file.read()
    filename = file.filename or ""
    try:
        imported_documents = parse_cleaned_style_upload(filename, raw)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    saved_documents: list[StyleDocument] = []
    for item in imported_documents:
        saved_documents.append(
            await style_knowledge_manager.add_library_document(
                library_id=library_id,
                title=item.title,
                category="style",
                content=item.content,
                owner_id=user_id,
                source_characters=item.source_characters,
                curated_characters=item.curated_characters,
                curated_segments=item.curated_segments,
            )
        )
    return StyleKnowledgeImportResponse(
        documents=saved_documents,
        imported_count=len(saved_documents),
        warnings=[],
    )


@router.put(
    "/api/style_libraries/{library_id}/documents/{doc_id}",
    response_model=StyleDocument,
    status_code=status.HTTP_200_OK,
)
async def rename_library_style_document(
    library_id: str,
    doc_id: str,
    payload: StyleKnowledgeUpdateRequest,
    session: AsyncSession = Depends(get_session),
):
    await _get_library_or_404(session, library_id)
    title = payload.title.strip()
    if not title:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Title cannot be empty",
        )
    try:
        return await style_knowledge_manager.update_document_title_in_library(
            library_id=library_id,
            doc_id=doc_id,
            title=title,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found",
        ) from exc


@router.delete(
    "/api/style_libraries/{library_id}/documents/{doc_id}",
    status_code=status.HTTP_200_OK,
)
async def delete_library_style_document(
    library_id: str,
    doc_id: str,
    session: AsyncSession = Depends(get_session),
):
    await _get_library_or_404(session, library_id)
    await style_knowledge_manager.delete_document_in_library(library_id, doc_id)
    return {"deleted": True}
