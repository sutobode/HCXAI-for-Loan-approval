"""Tests for JWT authentication and RBAC (backend/app/auth.py)."""
import os

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """Spin up the FastAPI app against an isolated temp SQLite DB per test."""
    monkeypatch.setenv("SQLITE_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret-key-for-pytest")
    monkeypatch.setenv("DEFAULT_ADMIN_EMAIL", "admin@test.local")
    monkeypatch.setenv("DEFAULT_ADMIN_PASSWORD", "TestAdmin123!")

    # Reload settings/db modules so they pick up the monkeypatched env vars
    import importlib

    from app import config as config_module

    importlib.reload(config_module)

    from app import db as db_module

    importlib.reload(db_module)

    from app import main as main_module

    importlib.reload(main_module)

    with TestClient(main_module.app) as test_client:
        yield test_client


def test_health_is_public(client):
    resp = client.get("/health")
    assert resp.status_code == 200


def test_default_admin_created_on_startup(client):
    resp = client.post(
        "/auth/login", json={"email": "admin@test.local", "password": "TestAdmin123!"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["user"]["role"] == "admin"
    assert "access_token" in body


def test_protected_endpoint_requires_token(client):
    resp = client.get("/auth/me")
    assert resp.status_code == 401


def test_login_with_wrong_password_fails(client):
    resp = client.post(
        "/auth/login", json={"email": "admin@test.local", "password": "wrong-password"}
    )
    assert resp.status_code == 401


def test_admin_can_register_new_user_and_rbac_enforced(client):
    login_resp = client.post(
        "/auth/login", json={"email": "admin@test.local", "password": "TestAdmin123!"}
    )
    admin_token = login_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {admin_token}"}

    register_resp = client.post(
        "/auth/register",
        json={
            "email": "customer1@test.local",
            "full_name": "Test Customer",
            "password": "Customer123!",
            "role": "customer",
        },
        headers=headers,
    )
    assert register_resp.status_code == 201
    assert register_resp.json()["role"] == "customer"

    # Non-admin cannot register users
    customer_login = client.post(
        "/auth/login", json={"email": "customer1@test.local", "password": "Customer123!"}
    )
    customer_token = customer_login.json()["access_token"]
    customer_headers = {"Authorization": f"Bearer {customer_token}"}

    forbidden_resp = client.post(
        "/auth/register",
        json={
            "email": "another@test.local",
            "full_name": "Another",
            "password": "Password123!",
            "role": "loan_officer",
        },
        headers=customer_headers,
    )
    assert forbidden_resp.status_code == 403


def test_duplicate_email_registration_rejected(client):
    login_resp = client.post(
        "/auth/login", json={"email": "admin@test.local", "password": "TestAdmin123!"}
    )
    headers = {"Authorization": f"Bearer {login_resp.json()['access_token']}"}

    payload = {
        "email": "dupe@test.local",
        "full_name": "Dupe",
        "password": "Password123!",
        "role": "loan_officer",
    }
    first = client.post("/auth/register", json=payload, headers=headers)
    assert first.status_code == 201

    second = client.post("/auth/register", json=payload, headers=headers)
    assert second.status_code == 409


def test_customer_forbidden_from_predict(client):
    login_resp = client.post(
        "/auth/login", json={"email": "admin@test.local", "password": "TestAdmin123!"}
    )
    admin_headers = {"Authorization": f"Bearer {login_resp.json()['access_token']}"}

    client.post(
        "/auth/register",
        json={
            "email": "cust2@test.local",
            "full_name": "Customer Two",
            "password": "Customer123!",
            "role": "customer",
        },
        headers=admin_headers,
    )
    cust_login = client.post(
        "/auth/login", json={"email": "cust2@test.local", "password": "Customer123!"}
    )
    cust_headers = {"Authorization": f"Bearer {cust_login.json()['access_token']}"}

    resp = client.post("/predict", json={}, headers=cust_headers)
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Ownership checks on per-user HCXAI endpoints (Trust Dashboard, Explanation
# History, Explanation Satisfaction): any authenticated user may view their
# own data, but viewing another user's requires admin/risk_manager.
# ---------------------------------------------------------------------------

def _register_and_login(client, admin_headers, email, role="customer"):
    client.post(
        "/auth/register",
        json={"email": email, "full_name": email, "password": "Customer123!", "role": role},
        headers=admin_headers,
    )
    login_resp = client.post("/auth/login", json={"email": email, "password": "Customer123!"})
    token = login_resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _admin_headers(client):
    login_resp = client.post(
        "/auth/login", json={"email": "admin@test.local", "password": "TestAdmin123!"}
    )
    return {"Authorization": f"Bearer {login_resp.json()['access_token']}"}


def test_customer_can_view_own_trust_dashboard(client):
    admin_headers = _admin_headers(client)
    alice_headers = _register_and_login(client, admin_headers, "alice.owner@test.local")

    resp = client.get("/trust/alice.owner@test.local", headers=alice_headers)
    assert resp.status_code == 200


def test_customer_cannot_view_another_users_trust_dashboard(client):
    admin_headers = _admin_headers(client)
    _register_and_login(client, admin_headers, "victim@test.local")
    attacker_headers = _register_and_login(client, admin_headers, "attacker@test.local")

    resp = client.get("/trust/victim@test.local", headers=attacker_headers)
    assert resp.status_code == 403


def test_admin_can_view_any_users_trust_dashboard(client):
    admin_headers = _admin_headers(client)
    _register_and_login(client, admin_headers, "someone@test.local")

    resp = client.get("/trust/someone@test.local", headers=admin_headers)
    assert resp.status_code == 200


def test_customer_cannot_view_another_users_explanation_history(client):
    admin_headers = _admin_headers(client)
    _register_and_login(client, admin_headers, "victim2@test.local")
    attacker_headers = _register_and_login(client, admin_headers, "attacker2@test.local")

    resp = client.get("/hcxai/explanation-history/victim2@test.local", headers=attacker_headers)
    assert resp.status_code == 403


def test_customer_cannot_view_another_users_satisfaction_but_can_view_platform_wide(client):
    admin_headers = _admin_headers(client)
    _register_and_login(client, admin_headers, "victim3@test.local")
    attacker_headers = _register_and_login(client, admin_headers, "attacker3@test.local")

    scoped_resp = client.get("/hcxai/satisfaction?user_id=victim3@test.local", headers=attacker_headers)
    assert scoped_resp.status_code == 403

    # Platform-wide (no user_id) aggregate must remain accessible to any authenticated user
    platform_resp = client.get("/hcxai/satisfaction", headers=attacker_headers)
    assert platform_resp.status_code == 200


# ---------------------------------------------------------------------------
# Change password
# ---------------------------------------------------------------------------

def test_change_password_succeeds_with_correct_current_password(client):
    admin_headers = _admin_headers(client)
    user_headers = _register_and_login(client, admin_headers, "pwuser@test.local")

    resp = client.post(
        "/auth/change-password",
        json={"current_password": "Customer123!", "new_password": "NewPassword456!"},
        headers=user_headers,
    )
    assert resp.status_code == 204

    # Old password no longer works, new one does
    old_login = client.post(
        "/auth/login", json={"email": "pwuser@test.local", "password": "Customer123!"}
    )
    assert old_login.status_code == 401

    new_login = client.post(
        "/auth/login", json={"email": "pwuser@test.local", "password": "NewPassword456!"}
    )
    assert new_login.status_code == 200


def test_change_password_rejects_wrong_current_password(client):
    admin_headers = _admin_headers(client)
    user_headers = _register_and_login(client, admin_headers, "pwuser2@test.local")

    resp = client.post(
        "/auth/change-password",
        json={"current_password": "WrongPassword!", "new_password": "NewPassword456!"},
        headers=user_headers,
    )
    assert resp.status_code == 401
