from __future__ import annotations

import gzip
import json
import shutil
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.sqlite import insert

from .database import AsyncSessionLocal
from .db_models import VersionIndex
from .storage_paths import project_dir_candidates, resolve_project_dir
from .versioning import IndexSnapshot


class VersionStorage:
    def __init__(self, base_dir: Path | None = None) -> None:
        self._base_dir = base_dir or (Path(__file__).resolve().parent.parent / "data" / "versions")

    def _project_dir(self, project_id: str) -> Path:
        path = resolve_project_dir(self._base_dir, project_id)
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _snapshot_path(self, project_id: str, version: int) -> Path:
        return self._project_dir(project_id) / f"v{version:06d}.json"

    async def save_snapshot(self, snapshot: IndexSnapshot) -> None:
        path = self._snapshot_path(snapshot.story_project.id, snapshot.version)
        temp_path = path.with_suffix(".json.tmp")
        payload = snapshot.model_dump(mode="json")
        temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        temp_path.replace(path)

        async with AsyncSessionLocal() as session:
            record_data = {
                "project_id": snapshot.story_project.id,
                "version": snapshot.version,
                "snapshot_type": snapshot.snapshot_type.value,
                "name": snapshot.name,
                "description": snapshot.description,
                "node_count": snapshot.node_count,
                "created_at": snapshot.created_at,
                "file_path": str(path),
                "is_compressed": False,
            }
            stmt = insert(VersionIndex).values(**record_data)
            stmt = stmt.on_conflict_do_update(
                index_elements=["project_id", "version"],
                set_={
                    "snapshot_type": record_data["snapshot_type"],
                    "name": record_data["name"],
                    "description": record_data["description"],
                    "node_count": record_data["node_count"],
                    "created_at": record_data["created_at"],
                    "file_path": record_data["file_path"],
                    "is_compressed": record_data["is_compressed"],
                },
            )
            await session.execute(stmt)
            await session.commit()

    async def load_snapshot(self, project_id: str, version: int) -> IndexSnapshot:
        path = self._snapshot_path(project_id, version)
        if not path.exists():
            compressed = path.with_suffix(".json.gz")
            if not compressed.exists():
                raise FileNotFoundError("Snapshot not found")
            with gzip.open(compressed, "rt", encoding="utf-8") as handle:
                payload = json.load(handle)
            return IndexSnapshot.model_validate(payload)

        payload = json.loads(path.read_text(encoding="utf-8"))
        return IndexSnapshot.model_validate(payload)

    async def list_snapshots(self, project_id: str) -> list[dict]:
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(VersionIndex)
                .where(VersionIndex.project_id == project_id)
                .order_by(VersionIndex.version.desc())
            )
            records = result.scalars().all()
            return [
                {
                    "id": record.id,
                    "project_id": record.project_id,
                    "version": record.version,
                    "snapshot_type": record.snapshot_type,
                    "name": record.name,
                    "description": record.description,
                    "node_count": record.node_count,
                    "created_at": record.created_at,
                    "file_path": record.file_path,
                    "is_compressed": record.is_compressed,
                }
                for record in records
            ]

    async def delete_snapshot(self, project_id: str, version: int) -> None:
        path = self._snapshot_path(project_id, version)
        compressed = path.with_suffix(".json.gz")
        if path.exists():
            path.unlink()
        if compressed.exists():
            compressed.unlink()

        async with AsyncSessionLocal() as session:
            await session.execute(
                delete(VersionIndex).where(
                    VersionIndex.project_id == project_id,
                    VersionIndex.version == version,
                )
            )
            await session.commit()

    async def compress_old_snapshots(self, project_id: str, older_than_days: int) -> int:
        cutoff = datetime.utcnow() - timedelta(days=older_than_days)
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(VersionIndex).where(
                    VersionIndex.project_id == project_id,
                    VersionIndex.created_at < cutoff,
                    VersionIndex.is_compressed.is_(False),
                )
            )
            records = result.scalars().all()
            compressed_count = 0
            for record in records:
                path = Path(record.file_path)
                if not path.exists():
                    continue
                compressed_path = path.with_suffix(".json.gz")
                with path.open("rb") as src, gzip.open(compressed_path, "wb") as dst:
                    dst.write(src.read())
                path.unlink()
                record.file_path = str(compressed_path)
                record.is_compressed = True
                compressed_count += 1
            await session.commit()
            return compressed_count

    async def update_snapshot_metadata(
        self,
        project_id: str,
        version: int,
        name: str | None = None,
        snapshot_type: str | None = None,
        description: str | None = None,
    ) -> IndexSnapshot:
        snapshot = await self.load_snapshot(project_id, version)
        if name is not None:
            snapshot.name = name
        if description is not None:
            snapshot.description = description
        if snapshot_type is not None:
            snapshot.snapshot_type = snapshot.snapshot_type.__class__(snapshot_type)

        path = self._snapshot_path(project_id, version)
        compressed = path.with_suffix(".json.gz")
        payload = snapshot.model_dump(mode="json")
        if compressed.exists():
            with gzip.open(compressed, "wt", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=2)
        else:
            path.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
            )

        async with AsyncSessionLocal() as session:
            await session.execute(
                update(VersionIndex)
                .where(
                    VersionIndex.project_id == project_id,
                    VersionIndex.version == version,
                )
                .values(
                    snapshot_type=snapshot.snapshot_type.value,
                    name=snapshot.name,
                    description=snapshot.description,
                )
            )
            await session.commit()
        return snapshot

    async def delete_project_data(self, project_id: str) -> None:
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(VersionIndex).where(VersionIndex.project_id == project_id)
            )
            records = result.scalars().all()
            await session.execute(
                delete(VersionIndex).where(VersionIndex.project_id == project_id)
            )
            await session.commit()

        for record in records:
            path = Path(record.file_path)
            if path.exists():
                path.unlink()

        for project_dir in project_dir_candidates(self._base_dir, project_id):
            if project_dir.exists():
                shutil.rmtree(project_dir, ignore_errors=True)
