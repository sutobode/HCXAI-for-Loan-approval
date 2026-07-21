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


# ---------------------------------------------------------------------------
# Write-path ownership checks: /explain and /feedback accept a free-text
# `user_id` field (so staff can act on behalf of a customer). A 'customer'
# account must not be able to pass another user's email as `user_id` and
# pollute that user's HCXAI cognitive profile / trust calibration history.
# Staff roles (admin/risk_manager/loan_officer) are exempt -- see
# main._require_matching_user_id_for_customers.
# ---------------------------------------------------------------------------

SAMPLE_APPLICATION_PAYLOAD = {
    "no_of_dependents": 2,
    "education": "Graduate",
    "self_employed": "No",
    "income_annum": 9600000,
    "loan_amount": 29900000,
    "loan_term": 12,
    "cibil_score": 778,
    "residential_assets_value": 2400000,
    "commercial_assets_value": 17600000,
    "luxury_assets_value": 22700000,
    "bank_asset_value": 8000000,
}


def _ensure_active_model(client):
    """/explain and /predict need an active Model Registry version; train
    one directly against this test's isolated SQLite DB if none exists yet."""
    from app import db as db_module
    from app.model_registry import train_new_version

    if db_module.get_active_model_version() is None:
        train_new_version(trained_by="pytest", notes="auto-trained for test_auth.py")


def test_customer_cannot_explain_on_behalf_of_another_user(client):
    _ensure_active_model(client)
    admin_headers = _admin_headers(client)
    _register_and_login(client, admin_headers, "explain_victim@test.local")
    attacker_headers = _register_and_login(client, admin_headers, "explain_attacker@test.local")

    resp = client.post(
        "/explain",
        json={
            "application": SAMPLE_APPLICATION_PAYLOAD,
            "role": "customer",
            "user_id": "explain_victim@test.local",
        },
        headers=attacker_headers,
    )
    assert resp.status_code == 403


def test_customer_can_explain_under_their_own_user_id(client):
    _ensure_active_model(client)
    admin_headers = _admin_headers(client)
    own_headers = _register_and_login(client, admin_headers, "explain_self@test.local")

    resp = client.post(
        "/explain",
        json={
            "application": SAMPLE_APPLICATION_PAYLOAD,
            "role": "customer",
            "user_id": "explain_self@test.local",
        },
        headers=own_headers,
    )
    assert resp.status_code == 200


def test_loan_officer_can_explain_on_behalf_of_a_customer(client):
    _ensure_active_model(client)
    admin_headers = _admin_headers(client)
    officer_headers = _register_and_login(
        client, admin_headers, "officer1@test.local", role="loan_officer"
    )

    resp = client.post(
        "/explain",
        json={
            "application": SAMPLE_APPLICATION_PAYLOAD,
            "role": "loan_officer",
            "user_id": "some.customer@test.local",
        },
        headers=officer_headers,
    )
    assert resp.status_code == 200


def test_customer_cannot_submit_feedback_on_behalf_of_another_user(client):
    _ensure_active_model(client)
    admin_headers = _admin_headers(client)
    attacker_headers = _register_and_login(client, admin_headers, "feedback_attacker@test.local")

    explain_resp = client.post(
        "/explain",
        json={
            "application": SAMPLE_APPLICATION_PAYLOAD,
            "role": "customer",
            "user_id": "feedback_attacker@test.local",
        },
        headers=attacker_headers,
    )
    prediction_id = explain_resp.json()["prediction_id"]

    resp = client.post(
        "/feedback",
        json={
            "prediction_id": prediction_id,
            "user_id": "feedback_victim@test.local",
            "action": "approve",
        },
        headers=attacker_headers,
    )
    assert resp.status_code == 403


def test_customer_can_submit_feedback_under_their_own_user_id(client):
    _ensure_active_model(client)
    admin_headers = _admin_headers(client)
    own_headers = _register_and_login(client, admin_headers, "feedback_self@test.local")

    explain_resp = client.post(
        "/explain",
        json={
            "application": SAMPLE_APPLICATION_PAYLOAD,
            "role": "customer",
            "user_id": "feedback_self@test.local",
        },
        headers=own_headers,
    )
    prediction_id = explain_resp.json()["prediction_id"]

    resp = client.post(
        "/feedback",
        json={
            "prediction_id": prediction_id,
            "user_id": "feedback_self@test.local",
            "action": "approve",
        },
        headers=own_headers,
    )
    assert resp.status_code == 200


def test_feedback_action_is_recorded_in_audit_log(client):
    """Item #2 from the review: POST /feedback must now write an audit_log entry."""
    _ensure_active_model(client)
    admin_headers = _admin_headers(client)
    own_headers = _register_and_login(client, admin_headers, "audit_feedback_user@test.local")

    explain_resp = client.post(
        "/explain",
        json={
            "application": SAMPLE_APPLICATION_PAYLOAD,
            "role": "customer",
            "user_id": "audit_feedback_user@test.local",
        },
        headers=own_headers,
    )
    prediction_id = explain_resp.json()["prediction_id"]

    client.post(
        "/feedback",
        json={
            "prediction_id": prediction_id,
            "user_id": "audit_feedback_user@test.local",
            "action": "approve",
        },
        headers=own_headers,
    )

    audit_resp = client.get("/audit?action=feedback", headers=admin_headers)
    items = audit_resp.json()["items"]
    assert any(item["resource_id"] == str(prediction_id) for item in items)


def test_register_action_is_recorded_in_audit_log(client):
    """Item #3 from the review: POST /auth/register must now write an audit_log entry."""
    admin_headers = _admin_headers(client)
    _register_and_login(client, admin_headers, "audit_register_user@test.local")

    audit_resp = client.get("/audit?action=auth.register", headers=admin_headers)
    items = audit_resp.json()["items"]
    assert any(item["resource_id"] == "audit_register_user@test.local" for item in items)
