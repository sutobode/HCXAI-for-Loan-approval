"""Tests for the /model/train/algorithms and algorithm-aware /model/train endpoints."""
from fastapi.testclient import TestClient


def test_list_algorithms_requires_admin_or_risk_manager(client_as_loan_officer: TestClient):
    resp = client_as_loan_officer.get("/model/train/algorithms")
    assert resp.status_code == 403


def test_list_algorithms_returns_at_least_xgboost(client_as_admin: TestClient):
    resp = client_as_admin.get("/model/train/algorithms")
    assert resp.status_code == 200
    assert "xgboost" in resp.json()["algorithms"]


def test_train_rejects_unknown_algorithm(client_as_admin: TestClient):
    resp = client_as_admin.post("/model/train", json={"algorithm": "not_a_real_algorithm"})
    assert resp.status_code == 400
