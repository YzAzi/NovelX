import logging
import time
from pathlib import Path

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    FastAPI,
    HTTPException,
    Request,
    WebSocket,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from langchain.prompts import PromptTemplate

from .analysis_history import append_messages, load_history
from .auth import decode_access_token, parse_bearer_token
from .config import settings
from .conflict_detector import SyncNodeResponse
from .database import get_session, init_db
from .helpers import get_project_or_404
from .models import (
    AnalysisHistoryRequest,
    AnalysisHistoryResponse,
    CreateOutlineRequest,
    InsertNodeRequest,
    OutlineAnalysisRequest,
    OutlineImportRequest,
    StoryProject,
    SyncNodeRequest,
    WritingAssistantRequest,
)
from .request_context import reset_current_user_id, set_current_user_id
from .routers.auth import router as auth_router
from .routers.graph import router as graph_router
from .routers.projects import router as projects_router
from .routers.style import router as style_router
from .routers.system import router as system_router
from .routers.versions import router as versions_router
from .services.ai_stream import (
    outline_analysis_stream_response,
    writing_assistant_stream_response,
)
from .services.node_sync import insert_node_request, sync_node_request
from .services.outline import create_outline_project, import_outline_into_project
from .services.ws import (
    outline_progress_websocket_channel,
    project_websocket,
)
from .vectorstore import add_documents

logger = logging.getLogger(__name__)

ANALYSIS_PROMPT_PATH = Path(__file__).parent / "prompts" / "outline_analysis_prompt.txt"
ANALYSIS_PROMPT_TEMPLATE = ANALYSIS_PROMPT_PATH.read_text(encoding="utf-8")
OUTLINE_IMPORT_PROMPT_PATH = Path(__file__).parent / "prompts" / "outline_import_prompt.txt"
OUTLINE_IMPORT_PROMPT_TEMPLATE = PromptTemplate.from_template(
    OUTLINE_IMPORT_PROMPT_PATH.read_text(encoding="utf-8")
)

app = FastAPI(
    title="Novel Outline Service",
    description="FastAPI service for drafting and syncing story outlines.",
    version="0.1.0",
)

for router in (
    auth_router,
    system_router,
    projects_router,
    style_router,
    versions_router,
    graph_router,
):
    app.include_router(router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins_list(),
    allow_origin_regex=settings.cors_allow_origin_regex,
    allow_credentials=settings.cors_allow_credentials,
    allow_methods=settings.cors_allow_methods_list(),
    allow_headers=settings.cors_allow_headers_list(),
)


@app.on_event("startup")
async def startup() -> None:
    await init_db()


def _is_auth_exempt_path(path: str) -> bool:
    if path in {"/api/health", "/openapi.json", "/docs", "/redoc", "/docs/oauth2-redirect"}:
        return True
    if path.startswith("/api/auth/"):
        return True
    return False


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    if request.method == "OPTIONS":
        return await call_next(request)
    if not path.startswith("/api") or _is_auth_exempt_path(path):
        return await call_next(request)

    token = parse_bearer_token(request.headers.get("Authorization"))
    payload = decode_access_token(token) if token else None
    if not payload:
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"error": "Unauthorized", "detail": "Invalid or missing access token"},
        )

    user_id = payload["sub"]
    context_token = set_current_user_id(user_id)
    try:
        return await call_next(request)
    finally:
        reset_current_user_id(context_token)


@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    start_time = time.perf_counter()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - start_time) * 1000
    logger.info("%s %s %.2fms", request.method, request.url.path, duration_ms)
    return response


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path, exc_info=exc)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": "InternalServerError",
            "detail": "服务器内部出现异常，请稍后重试。",
        },
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.__class__.__name__, "detail": str(exc.detail)},
    )


@app.post(
    "/api/create_outline",
    response_model=StoryProject,
    status_code=status.HTTP_200_OK,
)
async def create_outline(
    payload: CreateOutlineRequest,
    session: AsyncSession = Depends(get_session),
):
    return await create_outline_project(payload, session)


@app.post(
    "/api/projects/{project_id}/outline/import",
    response_model=StoryProject,
    status_code=status.HTTP_200_OK,
)
async def import_outline(
    project_id: str,
    payload: OutlineImportRequest,
    session: AsyncSession = Depends(get_session),
):
    return await import_outline_into_project(
        project_id=project_id,
        payload=payload,
        session=session,
        outline_import_prompt_template=OUTLINE_IMPORT_PROMPT_TEMPLATE,
    )


@app.post(
    "/api/sync_node",
    response_model=SyncNodeResponse,
    status_code=status.HTTP_200_OK,
)
async def sync_node(
    payload: SyncNodeRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
):
    return await sync_node_request(payload, background_tasks, session)


@app.post(
    "/api/insert_node",
    response_model=SyncNodeResponse,
    status_code=status.HTTP_200_OK,
)
async def insert_node(
    payload: InsertNodeRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
):
    return await insert_node_request(payload, background_tasks, session)


@app.post("/api/outline_analysis_stream")
async def outline_analysis_stream(
    payload: OutlineAnalysisRequest,
    session: AsyncSession = Depends(get_session),
):
    return await outline_analysis_stream_response(
        payload=payload,
        session=session,
        analysis_prompt_template=ANALYSIS_PROMPT_TEMPLATE,
    )


@app.post("/api/writing_assistant")
async def writing_assistant(
    payload: WritingAssistantRequest,
    session: AsyncSession = Depends(get_session),
):
    return await writing_assistant_stream_response(payload, session)


analysis_router = APIRouter(tags=["analysis"])


@analysis_router.get(
    "/api/analysis_history/{project_id}",
    response_model=AnalysisHistoryResponse,
    status_code=status.HTTP_200_OK,
)
async def get_analysis_history(
    project_id: str,
    session: AsyncSession = Depends(get_session),
):
    await get_project_or_404(session, project_id)
    return AnalysisHistoryResponse(messages=load_history(project_id))


@analysis_router.post(
    "/api/analysis_history/save",
    response_model=AnalysisHistoryResponse,
    status_code=status.HTTP_200_OK,
)
async def save_analysis_history(
    payload: AnalysisHistoryRequest,
    session: AsyncSession = Depends(get_session),
):
    await get_project_or_404(session, payload.project_id)
    stored = append_messages(
        payload.project_id,
        [message.model_dump() for message in payload.messages],
    )
    if stored:
        await add_documents(
            collection_name="analysis_history",
            documents=[f"{item['role']}: {item['content']}" for item in stored],
            metadatas=[
                {
                    "project_id": payload.project_id,
                    "role": item["role"],
                    "created_at": item["created_at"],
                    "source": "outline_analysis",
                }
                for item in stored
            ],
            ids=[item["id"] for item in stored],
        )
    return AnalysisHistoryResponse(messages=stored)


app.include_router(analysis_router)


@app.websocket("/ws/{project_id}")
async def websocket_endpoint(websocket: WebSocket, project_id: str):
    await project_websocket(websocket, project_id)


@app.websocket("/ws/outline/{request_id}")
async def outline_progress_websocket(websocket: WebSocket, request_id: str):
    await outline_progress_websocket_channel(websocket, request_id)
