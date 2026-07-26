"""Shared pytest fixtures."""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

SAMPLE_APPROVED_PAYLOAD = {
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

SAMPLE_REJECTED_PAYLOAD = {
    "no_of_dependents": 0,
    "education": "Not Graduate",
    "self_employed": "Yes",
    "income_annum": 4100000,
    "loan_amount": 12200000,
    "loan_term": 8,
    "cibil_score": 417,
    "residential_assets_value": 2700000,
    "commercial_assets_value": 2200000,
    "luxury_assets_value": 8800000,
    "bank_asset_value": 3300000,
}


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


@pytest.fixture()
def admin_token(client):
    """Get JWT token for the default admin user."""
    resp = client.post(
        "/auth/login", json={"email": "admin@test.local", "password": "TestAdmin123!"}
    )
    return resp.json()["access_token"]


@pytest.fixture()
def loan_officer_token(client, admin_token):
    """Get JWT token for a loan_officer user created by admin."""
    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = client.post(
        "/auth/register",
        json={
            "email": "officer@test.local",
            "full_name": "Loan Officer",
            "password": "Officer123!",
            "role": "loan_officer",
        },
        headers=headers,
    )
    login_resp = client.post(
        "/auth/login", json={"email": "officer@test.local", "password": "Officer123!"}
    )
    return login_resp.json()["access_token"]


@pytest.fixture()
def risk_manager_token(client, admin_token):
    """Get JWT token for a risk_manager user created by admin."""
    headers = {"Authorization": f"Bearer {admin_token}"}
    client.post(
        "/auth/register",
        json={
            "email": "riskmanager@test.local",
            "full_name": "Risk Manager",
            "password": "RiskManager123!",
            "role": "risk_manager",
        },
        headers=headers,
    )
    login_resp = client.post(
        "/auth/login", json={"email": "riskmanager@test.local", "password": "RiskManager123!"}
    )
    return login_resp.json()["access_token"]


@pytest.fixture()
def client_as_admin(client, admin_token):
    """TestClient with admin authorization header."""
    client.headers.update({"Authorization": f"Bearer {admin_token}"})
    return client


@pytest.fixture()
def client_as_risk_manager(client, risk_manager_token):
    """TestClient with risk_manager authorization header."""
    client.headers.update({"Authorization": f"Bearer {risk_manager_token}"})
    return client


@pytest.fixture()
def client_as_loan_officer(client, loan_officer_token):
    """TestClient with loan_officer authorization header."""
    client.headers.update({"Authorization": f"Bearer {loan_officer_token}"})
    return client


@pytest.fixture
def sample_application_payload():
    return {
        "no_of_dependents": 2,
        "education": "Graduate",
        "self_employed": "No",
        "income_annum": 9600000,
        "loan_amount": 29900000,
        "loan_term": 12,
        "cibil_score": 550,
        "residential_assets_value": 2400000,
        "commercial_assets_value": 17600000,
        "luxury_assets_value": 22700000,
        "bank_asset_value": 8000000,
    }


@pytest.fixture
def seeded_prediction_id(client, loan_officer_token, sample_application_payload):
    """A real prediction created via /explain, guaranteed to land in the review
    queue because its loan_amount comfortably exceeds REVIEW_LOAN_AMOUNT_THRESHOLD.

    Uses an explicit Authorization header (instead of the `client_as_loan_officer`
    fixture) so it doesn't clobber default headers a sibling `client_as_*` fixture
    may have already set on this same shared TestClient instance within one test
    (e.g. `test(client_as_risk_manager, seeded_prediction_id)` -- both fixtures
    mutate the same underlying `client.headers`, so whichever ran last would win)."""
    from app import db as db_module
    from app.model_registry import train_new_version

    if db_module.get_active_model_version() is None:
        train_new_version(trained_by="pytest", notes="auto-trained for test_review_queue.py")

    payload = dict(sample_application_payload)
    payload["loan_amount"] = 40_000_000  # vượt REVIEW_LOAN_AMOUNT_THRESHOLD mặc định
    resp = client.post(
        "/explain",
        json={"application": payload, "role": "loan_officer", "user_id": "test_loan_officer@hcxai.local"},
        headers={"Authorization": f"Bearer {loan_officer_token}"},
    )
    return resp.json()["prediction_id"]
