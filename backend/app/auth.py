from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .db_models import UserTable


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * ((4 - len(data) % 4) % 4)
    return base64.urlsafe_b64decode(data + padding)


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    iterations = 120_000
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations)
    return f"pbkdf2_sha256${iterations}${salt}${derived.hex()}"


def verify_password(password: str, password_hash: str) -> bool:
    try:
        algo, iteration_str, salt, expected_hex = password_hash.split("$", 3)
        if algo != "pbkdf2_sha256":
            return False
        iterations = int(iteration_str)
    except ValueError:
        return False

    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations)
    return hmac.compare_digest(derived.hex(), expected_hex)


def _encode_token(payload: dict[str, Any]) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    header_b64 = _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
    signature = hmac.new(settings.auth_secret_key.encode("utf-8"), signing_input, hashlib.sha256).digest()
    signature_b64 = _b64url_encode(signature)
    return f"{header_b64}.{payload_b64}.{signature_b64}"


def _decode_token(token: str) -> dict[str, Any] | None:
    try:
        header_b64, payload_b64, signature_b64 = token.split(".")
    except ValueError:
        return None

    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
    expected_signature = hmac.new(
        settings.auth_secret_key.encode("utf-8"), signing_input, hashlib.sha256
    ).digest()
    try:
        provided_signature = _b64url_decode(signature_b64)
    except Exception:
        return None

    if not hmac.compare_digest(expected_signature, provided_signature):
        return None

    try:
        payload = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
    except Exception:
        return None

    exp = payload.get("exp")
    if not isinstance(exp, int) or exp <= int(time.time()):
        return None
    return payload


def create_access_token(user_id: str, token_version: int = 0) -> str:
    now = int(time.time())
    payload = {
        "sub": user_id,
        "iat": now,
        "exp": now + settings.auth_token_ttl_hours * 3600,
        "scope": "access",
        "ver": token_version,
    }
    return _encode_token(payload)


def decode_access_token(token: str) -> dict[str, Any] | None:
    payload = _decode_token(token)
    if payload is None:
        return None
    if payload.get("scope") != "access":
        return None
    if not isinstance(payload.get("sub"), str):
        return None
    if not isinstance(payload.get("ver"), int):
        return None
    return payload


def create_channel_token(
    user_id: str,
    channel_id: str,
    *,
    scope: str,
    ttl_seconds: int = 300,
) -> str:
    now = int(time.time())
    payload = {
        "sub": user_id,
        "channel": channel_id,
        "scope": scope,
        "iat": now,
        "exp": now + ttl_seconds,
    }
    return _encode_token(payload)


def decode_channel_token(
    token: str,
    *,
    expected_user_id: str,
    expected_channel_id: str,
    expected_scope: str,
) -> dict[str, Any] | None:
    payload = _decode_token(token)
    if payload is None:
        return None
    if payload.get("scope") != expected_scope:
        return None
    if payload.get("sub") != expected_user_id:
        return None
    if payload.get("channel") != expected_channel_id:
        return None
    return payload


def parse_bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    parts = authorization.strip().split(" ", 1)
    if len(parts) != 2:
        return None
    scheme, token = parts
    if scheme.lower() != "bearer" or not token:
        return None
    return token


async def authenticate_access_token(
    session: AsyncSession,
    token: str | None,
) -> UserTable | None:
    if not token:
        return None
    payload = decode_access_token(token)
    if not payload:
        return None
    result = await session.execute(select(UserTable).where(UserTable.id == payload["sub"]))
    user = result.scalar_one_or_none()
    if user is None:
        return None
    if user.token_version != payload["ver"]:
        return None
    return user
