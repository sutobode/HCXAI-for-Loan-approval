"""Tests for Human-in-the-loop review-trigger logic (backend/app/main.py::evaluate_review_triggers)."""
import json

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


def test_fairness_group_flag_triggers_review(monkeypatch):
    """
    Exercises the `explainer is not None` branch of evaluate_review_triggers, which
    is otherwise never touched by the explainer=None tests above. main.py does
    `from . import fairness as fairness_module` (a local import of the shared,
    cached `app.fairness` module singleton), so monkeypatching the attribute on
    `app.fairness` directly affects what that local import sees.
    """
    from app import config as config_module
    from app import fairness as fairness_module

    monkeypatch.setattr(config_module.settings, "REVIEW_CONFIDENCE_THRESHOLD", 0.75)
    monkeypatch.setattr(config_module.settings, "REVIEW_LOAN_AMOUNT_THRESHOLD", 30_000_000)

    def fake_is_group_flagged(explainer, attribute, group_value):
        return attribute == "education" and group_value == "Not Graduate"

    monkeypatch.setattr(fairness_module, "is_group_flagged", fake_is_group_flagged)

    prediction = {"prediction": "Approved", "confidence": 0.95, "approval_probability": 0.95}
    application = {"loan_amount": 1_000_000, "education": "Not Graduate", "self_employed": "No"}
    # explainer just needs to be non-None; is_group_flagged is mocked so it's never
    # actually dereferenced.
    needs_review, reasons = evaluate_review_triggers(prediction, application, explainer=object())
    assert needs_review is True
    assert reasons == ["fairness_group_flag"]


def test_low_confidence_and_fairness_group_flag_combine(monkeypatch):
    """Two independent triggers firing at once should both land in `reasons`,
    and the fairness loop must correctly continue past a non-matching attribute
    (education, checked first) to find the matching one (self_employed)."""
    from app import config as config_module
    from app import fairness as fairness_module

    monkeypatch.setattr(config_module.settings, "REVIEW_CONFIDENCE_THRESHOLD", 0.75)
    monkeypatch.setattr(config_module.settings, "REVIEW_LOAN_AMOUNT_THRESHOLD", 30_000_000)

    def fake_is_group_flagged(explainer, attribute, group_value):
        return attribute == "self_employed" and group_value == "Yes"

    monkeypatch.setattr(fairness_module, "is_group_flagged", fake_is_group_flagged)

    prediction = {"prediction": "Rejected", "confidence": 0.6, "approval_probability": 0.4}
    application = {"loan_amount": 1_000_000, "education": "Graduate", "self_employed": "Yes"}
    needs_review, reasons = evaluate_review_triggers(prediction, application, explainer=object())
    assert needs_review is True
    assert reasons == ["low_confidence", "fairness_group_flag"]


def test_flag_for_review_sets_self_flagged_reason(client_as_loan_officer, seeded_prediction_id):
    resp = client_as_loan_officer.post(f"/predictions/{seeded_prediction_id}/flag-for-review")
    assert resp.status_code == 200
    detail = client_as_loan_officer.get(f"/predictions/{seeded_prediction_id}").json()
    assert detail["needs_review"] == 1
    assert "self_flagged" in json.loads(detail["review_reasons"])


def test_review_queue_lists_only_unresolved(client_as_risk_manager, seeded_prediction_id):
    resp = client_as_risk_manager.get("/review-queue")
    assert resp.status_code == 200
    ids = [item["id"] for item in resp.json()["items"]]
    assert seeded_prediction_id in ids


def test_resolve_review_removes_from_queue(client_as_risk_manager, seeded_prediction_id):
    resp = client_as_risk_manager.post(
        f"/review-queue/{seeded_prediction_id}/resolve",
        json={"decision": "confirmed", "note": "Đã xem xét, giữ nguyên quyết định."},
    )
    assert resp.status_code == 200
    remaining = client_as_risk_manager.get("/review-queue").json()["items"]
    assert seeded_prediction_id not in [item["id"] for item in remaining]
