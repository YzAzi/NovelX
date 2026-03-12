from __future__ import annotations

import hashlib
import re
from pathlib import Path

_LEGACY_PROJECT_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")


def _normalize_project_id(project_id: str) -> str:
    normalized = project_id.strip()
    if not normalized:
        raise ValueError("project_id must not be empty")
    return normalized


def safe_project_storage_name(project_id: str) -> str:
    normalized = _normalize_project_id(project_id)
    slug = re.sub(r"[^A-Za-z0-9_-]+", "-", normalized).strip("-_") or "project"
    slug = slug[:40]
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]
    return f"{slug}-{digest}"


def _legacy_project_storage_name(project_id: str) -> str | None:
    normalized = _normalize_project_id(project_id)
    if _LEGACY_PROJECT_ID_PATTERN.fullmatch(normalized):
        return normalized
    return None


def project_file_candidates(base_dir: Path, project_id: str, suffix: str) -> list[Path]:
    safe_name = safe_project_storage_name(project_id)
    paths = [base_dir / f"{safe_name}{suffix}"]
    legacy_name = _legacy_project_storage_name(project_id)
    if legacy_name and legacy_name != safe_name:
        paths.append(base_dir / f"{legacy_name}{suffix}")
    return paths


def resolve_project_file(base_dir: Path, project_id: str, suffix: str) -> Path:
    for path in project_file_candidates(base_dir, project_id, suffix):
        if path.exists():
            return path
    return project_file_candidates(base_dir, project_id, suffix)[0]


def project_dir_candidates(base_dir: Path, project_id: str) -> list[Path]:
    safe_name = safe_project_storage_name(project_id)
    paths = [base_dir / safe_name]
    legacy_name = _legacy_project_storage_name(project_id)
    if legacy_name and legacy_name != safe_name:
        paths.append(base_dir / legacy_name)
    return paths


def resolve_project_dir(base_dir: Path, project_id: str) -> Path:
    for path in project_dir_candidates(base_dir, project_id):
        if path.exists():
            return path
    return project_dir_candidates(base_dir, project_id)[0]
