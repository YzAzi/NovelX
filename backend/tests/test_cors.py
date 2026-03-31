import httpx
import pytest
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings


def _build_test_app() -> FastAPI:
    app = FastAPI()

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allow_origins_list(),
        allow_origin_regex=settings.cors_allow_origin_regex,
        allow_credentials=settings.cors_allow_credentials,
        allow_methods=settings.cors_allow_methods_list(),
        allow_headers=settings.cors_allow_headers_list(),
    )

    @app.middleware("http")
    async def auth_middleware(request: Request, call_next):
        if request.method == "OPTIONS":
            return await call_next(request)
        if request.url.path.startswith("/api"):
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"error": "Unauthorized"},
            )
        return await call_next(request)

    @app.get("/api/models")
    async def list_models():
        return {"models": []}

    return app


@pytest.mark.asyncio
async def test_preflight_models_request_bypasses_auth_and_returns_cors_headers():
    app = _build_test_app()
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://testserver",
    ) as client:
        response = await client.options(
            "/api/models",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
