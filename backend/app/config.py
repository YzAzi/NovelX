from pathlib import Path
from threading import Lock

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")
    openai_api_key: str | None = None
    openai_api_key_drafting: str | None = None
    openai_api_key_sync: str | None = None
    openai_api_key_extraction: str | None = None
    openai_base_url: str | None = None
    model_name: str | None = None
    model_name_drafting: str | None = None
    model_name_sync: str | None = None
    model_name_extraction: str | None = None
    embedding_model: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    chroma_persist_path: str = str(
        Path(__file__).resolve().parent.parent / "data" / "chroma_db"
    )
    cors_allow_origins: str = ""
    cors_allow_origin_regex: str | None = r"https?://.*"
    cors_allow_credentials: bool = True
    cors_allow_methods: str = "*"
    cors_allow_headers: str = "*"

    def cors_allow_origins_list(self) -> list[str]:
        return _split_csv(self.cors_allow_origins)

    def cors_allow_methods_list(self) -> list[str]:
        return _split_csv(self.cors_allow_methods)

    def cors_allow_headers_list(self) -> list[str]:
        return _split_csv(self.cors_allow_headers)


def _split_csv(value: str | None) -> list[str]:
    if not value:
        return []
    stripped = value.strip()
    if not stripped:
        return []
    return [item.strip() for item in stripped.split(",") if item.strip()]


settings = Settings()

_override_lock = Lock()
_model_overrides: dict[str, str | None] = {
    "drafting": None,
    "sync": None,
    "extraction": None,
}
_api_key_overrides: dict[str, str | None] = {
    "default": None,
    "drafting": None,
    "sync": None,
    "extraction": None,
}
_base_url_override: str | None = None


def get_model_name(role: str) -> str:
    with _override_lock:
        override = _model_overrides.get(role)
    if override:
        return override
    if role == "drafting":
        return settings.model_name_drafting or settings.model_name or "gpt-4o"
    if role == "sync":
        return settings.model_name_sync or settings.model_name or "gpt-4o"
    if role == "extraction":
        return settings.model_name_extraction or settings.model_name or "gpt-4o"
    return settings.model_name or "gpt-4o"


def set_model_override(role: str, model_name: str | None) -> None:
    cleaned = model_name.strip() if model_name else ""
    with _override_lock:
        _model_overrides[role] = cleaned or None


def get_api_key(role: str) -> str | None:
    with _override_lock:
        override = _api_key_overrides.get(role)
    if override:
        return override
    if role == "drafting":
        return settings.openai_api_key_drafting or settings.openai_api_key
    if role == "sync":
        return settings.openai_api_key_sync or settings.openai_api_key
    if role == "extraction":
        return settings.openai_api_key_extraction or settings.openai_api_key
    return settings.openai_api_key


def set_api_key_override(role: str, api_key: str | None) -> None:
    cleaned = api_key.strip() if api_key else ""
    with _override_lock:
        _api_key_overrides[role] = cleaned or None


def get_base_url() -> str | None:
    with _override_lock:
        override = _base_url_override
    return override or settings.openai_base_url


def set_base_url_override(base_url: str | None) -> None:
    cleaned = base_url.strip() if base_url else ""
    with _override_lock:
        global _base_url_override
        _base_url_override = cleaned or None
