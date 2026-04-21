from __future__ import annotations

from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..crud import (
    create_style_library,
    delete_style_library,
    get_style_library,
    list_projects,
    list_style_libraries,
    update_style_library,
)
from ..database import get_session
from ..models import (
    StyleKnowledgeUploadResponse,
    StyleKnowledgeImportResponse,
    StyleKnowledgeUpdateRequest,
    StyleLibrary,
    StyleLibraryBundle,
    StyleLibraryCreateRequest,
    StyleLibraryUpdateRequest,
)
from ..request_context import get_current_user_id
from ..runtime import style_curation_service, style_knowledge_manager
from ..style_importer import parse_cleaned_style_upload
from ..style_knowledge import StyleDocument

router = APIRouter(tags=["style_libraries"])

LEGACY_MIGRATION_LIBRARY_NAME = "历史项目迁移知识库"
LEGACY_MIGRATION_LIBRARY_DESCRIPTION = "系统自动迁移的旧项目文笔素材。"


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


def _content_signature(text: str) -> str:
    return "".join((text or "").split())


async def _touch_library(
    session: AsyncSession,
    library: StyleLibrary,
) -> StyleLibrary:
    library.updated_at = datetime.utcnow()
    return await update_style_library(
        session,
        library.id,
        library,
        owner_id=library.owner_id,
    )


async def _ensure_legacy_project_documents_migrated(
    session: AsyncSession,
    user_id: str,
) -> None:
    libraries = await list_style_libraries(session)
    project_summaries = await list_projects(session)

    legacy_documents: list[tuple[str, str, list[StyleDocument]]] = []
    for project in project_summaries:
        documents = await style_knowledge_manager.list_project_documents(project.id)
        if documents:
            legacy_documents.append((project.id, project.title, documents))

    if not legacy_documents:
        return

    migration_library = next(
        (
            library
            for library in libraries
            if library.description == LEGACY_MIGRATION_LIBRARY_DESCRIPTION
        ),
        None,
    )
    if migration_library is None:
        migration_library = await create_style_library(
            session,
            StyleLibrary(
                owner_id=user_id,
                name=LEGACY_MIGRATION_LIBRARY_NAME,
                description=LEGACY_MIGRATION_LIBRARY_DESCRIPTION,
            ),
            owner_id=user_id,
        )

    existing_library_docs = await style_knowledge_manager.list_library_documents(
        migration_library.id
    )
    known_signatures = {
        _content_signature(document.content) for document in existing_library_docs
    }
    migrated_any = False

    for project_id, project_title, documents in legacy_documents:
        for document in documents:
            signature = _content_signature(document.content)
            if signature in known_signatures:
                continue
            migrated_title = f"{project_title} / {document.title}".strip(" /")
            await style_knowledge_manager.add_library_document(
                library_id=migration_library.id,
                title=migrated_title or "未命名素材",
                category=document.category or "style",
                content=document.content,
                owner_id=user_id,
                source_characters=document.source_characters,
                curated_characters=document.curated_characters,
                curated_segments=document.curated_segments,
            )
            known_signatures.add(signature)
            migrated_any = True
        await style_knowledge_manager.delete_project_data(project_id)

    if migrated_any:
        await _touch_library(session, migration_library)


@router.get(
    "/api/style_libraries",
    response_model=list[StyleLibraryBundle],
    status_code=status.HTTP_200_OK,
)
async def list_style_library_records(
    session: AsyncSession = Depends(get_session),
):
    user_id = _require_user_id()
    await _ensure_legacy_project_documents_migrated(session, user_id)
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
    library = await _get_library_or_404(session, library_id)
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
    await _touch_library(session, library)
    return StyleKnowledgeImportResponse(
        documents=saved_documents,
        imported_count=len(saved_documents),
        warnings=[],
    )


@router.post(
    "/api/style_libraries/{library_id}/documents/upload",
    response_model=StyleKnowledgeUploadResponse,
    status_code=status.HTTP_200_OK,
)
async def upload_source_text_to_style_library(
    library_id: str,
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
):
    user_id = _require_user_id()
    library = await _get_library_or_404(session, library_id)
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

    title = Path(filename).stem or "未命名素材"
    try:
        curated = await style_curation_service.curate_text(title=title, raw_text=content)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    document = await style_knowledge_manager.add_library_document(
        library_id=library_id,
        title=title,
        category="style",
        content=curated.curated_content,
        owner_id=user_id,
        source_characters=curated.source_characters,
        curated_characters=curated.curated_characters,
        curated_segments=curated.curated_segments,
    )
    await _touch_library(session, library)
    return StyleKnowledgeUploadResponse(
        document=document,
        total_batches=curated.total_batches,
        successful_batches=curated.successful_batches,
        failed_batches=curated.failed_batches,
        warnings=curated.warnings,
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
    library = await _get_library_or_404(session, library_id)
    title = payload.title.strip()
    if not title:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Title cannot be empty",
        )
    try:
        document = await style_knowledge_manager.update_document_title_in_library(
            library_id=library_id,
            doc_id=doc_id,
            title=title,
        )
        await _touch_library(session, library)
        return document
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
    library = await _get_library_or_404(session, library_id)
    await style_knowledge_manager.delete_document_in_library(library_id, doc_id)
    await _touch_library(session, library)
    return {"deleted": True}
