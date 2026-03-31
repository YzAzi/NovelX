from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_session
from ..helpers import get_project_or_404
from ..knowledge_graph import load_graph, save_graph
from ..models import StoryProject, VersionCreateRequest
from ..node_indexer import NodeIndexer
from ..runtime import style_knowledge_manager, version_manager
from ..versioning import IndexSnapshot, SnapshotType, VersionDiff

router = APIRouter(tags=["versions"])


@router.get(
    "/api/projects/{project_id}/versions",
    response_model=list[dict],
    status_code=status.HTTP_200_OK,
)
async def list_project_versions(
    project_id: str,
    session: AsyncSession = Depends(get_session),
):
    await get_project_or_404(session, project_id)
    return await version_manager.list_versions(project_id)


@router.get(
    "/api/projects/{project_id}/versions/{version}",
    response_model=IndexSnapshot,
    status_code=status.HTTP_200_OK,
)
async def get_project_version(
    project_id: str,
    version: int,
    session: AsyncSession = Depends(get_session),
):
    await get_project_or_404(session, project_id)
    try:
        return await version_manager.load_snapshot(project_id, version)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Snapshot not found",
        ) from exc


@router.get(
    "/api/projects/{project_id}/versions/{from_ver}/diff/{to_ver}",
    response_model=VersionDiff,
    status_code=status.HTTP_200_OK,
)
async def compare_project_versions(
    project_id: str,
    from_ver: int,
    to_ver: int,
    session: AsyncSession = Depends(get_session),
):
    await get_project_or_404(session, project_id)
    return await version_manager.compare_versions(project_id, from_ver, to_ver)


@router.post(
    "/api/projects/{project_id}/versions",
    response_model=IndexSnapshot,
    status_code=status.HTTP_200_OK,
)
async def create_project_version(
    project_id: str,
    payload: VersionCreateRequest,
    session: AsyncSession = Depends(get_session),
):
    project = await get_project_or_404(session, project_id)
    return await version_manager.create_snapshot(
        project=project,
        graph=load_graph(project_id),
        snapshot_type=SnapshotType.MANUAL,
        name=payload.name,
        description=payload.description,
    )


@router.post(
    "/api/projects/{project_id}/versions/{version}/restore",
    response_model=StoryProject,
    status_code=status.HTTP_200_OK,
)
async def restore_project_version(
    project_id: str,
    version: int,
    session: AsyncSession = Depends(get_session),
):
    await get_project_or_404(session, project_id)
    try:
        restored_project, restored_graph, restored_docs = await version_manager.restore_snapshot(
            project_id,
            version,
        )
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Snapshot not found",
        ) from exc
    from ..crud import update_project

    await update_project(session, restored_project.id, restored_project)
    save_graph(restored_graph)
    node_indexer = NodeIndexer()
    await node_indexer.clear_project(project_id)
    await node_indexer.index_project(restored_project)
    await style_knowledge_manager.replace_project_documents(project_id, restored_docs)
    return restored_project


@router.delete(
    "/api/projects/{project_id}/versions/{version}",
    status_code=status.HTTP_200_OK,
)
async def delete_project_version(
    project_id: str,
    version: int,
    session: AsyncSession = Depends(get_session),
):
    await get_project_or_404(session, project_id)
    try:
        await version_manager.delete_version(project_id, version)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Snapshot not found",
        ) from exc
    return {"deleted": True}
