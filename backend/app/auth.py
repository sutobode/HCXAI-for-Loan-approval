"""
Authentication & Authorization (JWT + RBAC) for the HCXAI backend.

- Passwords are hashed with bcrypt (never stored or logged in plaintext).
- Access tokens are signed JWTs (HS256) with an expiration claim.
- The secret key is read from the JWT_SECRET_KEY environment variable; if
  unset, a random key is generated at process startup (dev convenience --
  tokens will not survive a restart, and this is logged as a warning).
- RBAC is enforced via FastAPI dependencies: `require_roles(...)`.

Roles (see db.VALID_ROLES): admin, risk_manager, loan_officer, customer.
"""
from __future__ import annotations

import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from . import db

logger = logging.getLogger(__name__)

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY")
if not JWT_SECRET_KEY:
    JWT_SECRET_KEY = secrets.token_urlsafe(32)
    logger.warning(
        "JWT_SECRET_KEY not set in environment; generated an ephemeral key for this "
        "process. Set JWT_SECRET_KEY in .env for stable sessions across restarts."
    )

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))  # 8 hours

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------

def hash_password(plain_password: str) -> str:
    return bcrypt.hashpw(plain_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))


# ---------------------------------------------------------------------------
# JWT tokens
# ---------------------------------------------------------------------------

def create_access_token(user: dict[str, Any]) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": str(user["id"]),
        "email": user["email"],
        "role": user["role"],
        "full_name": user["full_name"],
        "exp": expire,
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ---------------------------------------------------------------------------
# Authentication logic
# ---------------------------------------------------------------------------

def authenticate_user(email: str, password: str) -> dict[str, Any] | None:
    user = db.get_user_by_email(email)
    if not user or not user["is_active"]:
        return None
    if not verify_password(password, user["hashed_password"]):
        return None
    return user


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------

def get_current_user(token: str = Depends(oauth2_scheme)) -> dict[str, Any]:
    payload = decode_access_token(token)
    user = db.get_user_by_id(int(payload["sub"]))
    if not user or not user["is_active"]:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def require_roles(*allowed_roles: str):
    """Dependency factory for RBAC: restrict an endpoint to specific roles."""

    def dependency(current_user: dict = Depends(get_current_user)) -> dict:
        if current_user["role"] not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{current_user['role']}' is not permitted to access this resource "
                f"(requires one of: {', '.join(allowed_roles)})",
            )
        return current_user

    return dependency


# Convenience dependency: any authenticated user, regardless of role
require_authenticated = get_current_user
