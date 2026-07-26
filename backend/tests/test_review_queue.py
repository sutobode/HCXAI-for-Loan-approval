"""Tests for Human-in-the-loop review-trigger logic (backend/app/main.py::evaluate_review_triggers)."""
from app.main import evaluate_review_triggers


def test_low_confidence_triggers_review(monkeypatch):
    from app import config as config_module

    monkeypatch.setattr(config_module.settings, "REVIEW_CONFIDENCE_THRESHOLD", 0.75)
    prediction = {"prediction": "Approved", "confidence": 0.6, "approval_probability": 0.6}
    application = {"loan_amount": 1000000, "education": "Graduate", "self_employed": "No"}
    needs_review, reasons = evaluate_review_triggers(prediction, application, explainer=None)
    assert needs_review is True
    assert "low_confidence" in reasons


def test_high_loan_amount_triggers_review(monkeypatch):
    from app import config as config_module

    monkeypatch.setattr(config_module.settings, "REVIEW_LOAN_AMOUNT_THRESHOLD", 30_000_000)
    prediction = {"prediction": "Approved", "confidence": 0.95, "approval_probability": 0.95}
    application = {"loan_amount": 35_000_000, "education": "Graduate", "self_employed": "No"}
    needs_review, reasons = evaluate_review_triggers(prediction, application, explainer=None)
    assert needs_review is True
    assert "high_loan_amount" in reasons


def test_clear_case_does_not_trigger_review(monkeypatch):
    from app import config as config_module

    monkeypatch.setattr(config_module.settings, "REVIEW_CONFIDENCE_THRESHOLD", 0.75)
    monkeypatch.setattr(config_module.settings, "REVIEW_LOAN_AMOUNT_THRESHOLD", 30_000_000)
    prediction = {"prediction": "Approved", "confidence": 0.95, "approval_probability": 0.95}
    application = {"loan_amount": 1_000_000, "education": "Graduate", "self_employed": "No"}
    needs_review, reasons = evaluate_review_triggers(prediction, application, explainer=None)
    assert needs_review is False
    assert reasons == []
