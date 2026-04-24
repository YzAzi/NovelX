from fastapi import APIRouter, status

from ..config import (
    set_api_key_override,
    set_base_url_override,
    set_model_override,
    set_reasoning_effort_override,
)
from ..helpers import build_model_config_response
from ..models import HealthResponse, ModelConfigResponse, ModelConfigUpdateRequest

router = APIRouter(tags=["system"])


@router.get(
    "/api/health",
    response_model=HealthResponse,
    status_code=status.HTTP_200_OK,
)
def health():
    return {"status": "ok", "version": "0.1.0"}


@router.get(
    "/api/models",
    response_model=ModelConfigResponse,
    status_code=status.HTTP_200_OK,
)
def get_model_config():
    return build_model_config_response()


@router.post(
    "/api/models",
    response_model=ModelConfigResponse,
    status_code=status.HTTP_200_OK,
)
def update_model_config(payload: ModelConfigUpdateRequest):
    if payload.base_url is not None:
        set_base_url_override("default", payload.base_url)
    if payload.drafting_base_url is not None:
        set_base_url_override("drafting", payload.drafting_base_url)
    if payload.writing_base_url is not None:
        set_base_url_override("writing", payload.writing_base_url)
    if payload.default_api_key is not None:
        set_api_key_override("default", payload.default_api_key)
    if payload.drafting_api_key is not None:
        set_api_key_override("drafting", payload.drafting_api_key)
    if payload.writing_api_key is not None:
        set_api_key_override("writing", payload.writing_api_key)
    if payload.sync_api_key is not None:
        set_api_key_override("sync", payload.sync_api_key)
    if payload.extraction_api_key is not None:
        set_api_key_override("extraction", payload.extraction_api_key)
    if payload.drafting_model is not None:
        set_model_override("drafting", payload.drafting_model)
    if payload.writing_model is not None:
        set_model_override("writing", payload.writing_model)
    if payload.sync_model is not None:
        set_model_override("sync", payload.sync_model)
    if payload.extraction_model is not None:
        set_model_override("extraction", payload.extraction_model)
    if payload.drafting_reasoning_effort is not None:
        set_reasoning_effort_override("drafting", payload.drafting_reasoning_effort)
    if payload.writing_reasoning_effort is not None:
        set_reasoning_effort_override("writing", payload.writing_reasoning_effort)
    if payload.sync_reasoning_effort is not None:
        set_reasoning_effort_override("sync", payload.sync_reasoning_effort)
    if payload.extraction_reasoning_effort is not None:
        set_reasoning_effort_override("extraction", payload.extraction_reasoning_effort)
    return build_model_config_response()
