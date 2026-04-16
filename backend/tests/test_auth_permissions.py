import importlib
import sys
from datetime import datetime

import pytest
import pytest_asyncio


def _reload_module(name: str):
    if name in sys.modules:
        return importlib.reload(sys.modules[name])
    return importlib.import_module(name)


@pytest.fixture
def auth_module(monkeypatch):
    monkeypatch.setenv("AUTH_SECRET_KEY", "test-secret-key")
    _reload_module("app.config")
    return _reload_module("app.auth")


@pytest_asyncio.fixture
async def db_modules(monkeypatch, tmp_path):
    db_path = tmp_path / "stories.db"
    monkeypatch.setenv("NOVEL_DATABASE_URL", f"sqlite+aiosqlite:///{db_path}")

    _reload_module("app.db_models")
    request_context = _reload_module("app.request_context")
    database = _reload_module("app.database")
    crud = _reload_module("app.crud")
    models = _reload_module("app.models")

    await database.init_db()
    try:
        yield database, crud, request_context, models
    finally:
        await database.engine.dispose()


def test_outline_channel_token_is_user_and_scope_bound(auth_module):
    token = auth_module.create_channel_token(
        "user-1",
        "outline-123",
        scope="outline_progress",
        ttl_seconds=60,
    )

    payload = auth_module.decode_channel_token(
        token,
        expected_user_id="user-1",
        expected_channel_id="outline-123",
        expected_scope="outline_progress",
    )

    assert payload is not None
    assert payload["sub"] == "user-1"
    assert auth_module.decode_channel_token(
        token,
        expected_user_id="user-2",
        expected_channel_id="outline-123",
        expected_scope="outline_progress",
    ) is None
    assert auth_module.decode_channel_token(
        token,
        expected_user_id="user-1",
        expected_channel_id="outline-456",
        expected_scope="outline_progress",
    ) is None
    assert auth_module.decode_access_token(token) is None


def test_access_token_cannot_be_reused_as_outline_channel_token(auth_module):
    access_token = auth_module.create_access_token("user-1")

    assert auth_module.decode_access_token(access_token) is not None
    assert auth_module.decode_channel_token(
        access_token,
        expected_user_id="user-1",
        expected_channel_id="outline-123",
        expected_scope="outline_progress",
    ) is None


@pytest.mark.asyncio
async def test_access_token_is_invalid_after_token_version_changes(db_modules, auth_module):
    database, _, _, _ = db_modules
    UserTable = _reload_module("app.db_models").UserTable

    async with database.AsyncSessionLocal() as session:
        user = UserTable(
            id="user-1",
            username="tester",
            password_hash=auth_module.hash_password("secret-123"),
            token_version=0,
            created_at=datetime.utcnow(),
        )
        session.add(user)
        await session.commit()

    token = auth_module.create_access_token("user-1", token_version=0)

    async with database.AsyncSessionLocal() as session:
        authenticated = await auth_module.authenticate_access_token(session, token)
        assert authenticated is not None
        authenticated.token_version = 1
        await session.commit()

    async with database.AsyncSessionLocal() as session:
        assert await auth_module.authenticate_access_token(session, token) is None


@pytest.mark.asyncio
async def test_first_user_can_claim_legacy_unowned_projects(db_modules):
    database, crud, request_context, models = db_modules
    StoryProject = models.StoryProject

    async with database.AsyncSessionLocal() as session:
        await crud.create_project(
            session,
            StoryProject(
                id="legacy-project",
                title="Legacy",
                world_view="old data",
                style_tags=[],
                nodes=[],
                chapters=[],
                characters=[],
            ),
            owner_id=None,
        )

    async with database.AsyncSessionLocal() as session:
        claimed = await crud.claim_unowned_projects(session, "user-1")

    assert claimed == 1

    context_token = request_context.set_current_user_id("user-1")
    try:
        async with database.AsyncSessionLocal() as session:
            projects = await crud.list_projects(session)
    finally:
        request_context.reset_current_user_id(context_token)

    assert [project.id for project in projects] == ["legacy-project"]


@pytest.mark.asyncio
async def test_cross_user_project_id_is_hidden_but_still_detectable_for_conflict(db_modules):
    database, crud, request_context, models = db_modules
    StoryProject = models.StoryProject

    async with database.AsyncSessionLocal() as session:
        await crud.create_project(
            session,
            StoryProject(
                id="shared-id",
                title="Owner A Project",
                world_view="world",
                style_tags=[],
                nodes=[],
                chapters=[],
                characters=[],
            ),
            owner_id="user-a",
        )

    context_token = request_context.set_current_user_id("user-b")
    try:
        async with database.AsyncSessionLocal() as session:
            project = await crud.get_project(session, "shared-id")
            exists = await crud.project_id_exists(session, "shared-id")
    finally:
        request_context.reset_current_user_id(context_token)

    assert project is None
    assert exists is True
