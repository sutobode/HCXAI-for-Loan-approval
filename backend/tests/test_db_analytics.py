"""
Tests for the HCXAI analytics read-path functions added to backend/app/db.py:
override direction, feedback stats, trust trend, override-by-confidence
analysis, satisfaction metrics, explanation history, and decision provenance.
"""
import importlib
import os

import pytest


@pytest.fixture()
def db_env(tmp_path):
    os.environ["SQLITE_PATH"] = str(tmp_path / "test.db")

    from app import config as config_module

    importlib.reload(config_module)

    from app import db as db_module

    importlib.reload(db_module)
    db_module.init_db()

    yield db_module

    del os.environ["SQLITE_PATH"]


def _make_prediction(db_module, decision="Approved", proba=0.85, model_version="v1"):
    app_id = db_module.save_application({"cibil_score": 700})
    return db_module.save_prediction(
        app_id,
        {"prediction": decision, "approval_probability": proba, "risk_score": 1 - proba, "confidence": max(proba, 1 - proba)},
        {"base_value": 0.5, "contributions": []},
        model_version=model_version,
    )


def test_override_direction_stats_detects_lenient_pattern(db_env):
    db_module = db_env
    pred_id = _make_prediction(db_module, decision="Rejected")
    db_module.save_feedback(pred_id, "alice", "override", human_decision="Approved")

    stats = db_module.get_override_direction_stats("alice")
    assert stats["total_overrides"] == 1
    assert stats["reject_to_approve_count"] == 1
    assert stats["approve_to_reject_count"] == 0
    assert stats["risk_tolerance"] == 1.0


def test_override_direction_stats_detects_conservative_pattern(db_env):
    db_module = db_env
    pred_id = _make_prediction(db_module, decision="Approved")
    db_module.save_feedback(pred_id, "bob", "override", human_decision="Rejected")

    stats = db_module.get_override_direction_stats("bob")
    assert stats["approve_to_reject_count"] == 1
    assert stats["risk_tolerance"] == -1.0


def test_feedback_stats_computes_override_rate(db_env):
    db_module = db_env
    pred_id = _make_prediction(db_module)
    db_module.save_feedback(pred_id, "carol", "approve", trust_rating=5, confidence_rating=5)
    db_module.save_feedback(pred_id, "carol", "override", human_decision="Rejected", trust_rating=3)

    stats = db_module.get_feedback_stats_for_user("carol")
    assert stats["n_feedback_events"] == 2
    assert stats["override_rate"] == 0.5


def test_trust_trend_insufficient_data_for_new_user(db_env):
    db_module = db_env
    trend = db_module.get_trust_trend("dave")
    assert trend["trend"] == "insufficient_data"


def test_trust_trend_detects_increasing_agreement(db_env):
    db_module = db_env
    pred_id = _make_prediction(db_module)
    # Prior window (older, indices later in DESC order): mostly disagreements
    for _ in range(10):
        db_module.save_trust_event("erin", pred_id, "Approved", 0.8, "Rejected")
    # Recent window: mostly agreements
    for _ in range(10):
        db_module.save_trust_event("erin", pred_id, "Approved", 0.8, "Approved")

    trend = db_module.get_trust_trend("erin", recent_window=10)
    assert trend["trend"] == "increasing"
    assert trend["recent_agreement_rate"] == 1.0
    assert trend["prior_agreement_rate"] == 0.0


def test_override_analysis_by_confidence_buckets_correctly(db_env):
    db_module = db_env
    pred_id = _make_prediction(db_module)
    db_module.save_trust_event("frank", pred_id, "Approved", 0.55, "Rejected")  # low conf, disagree
    db_module.save_trust_event("frank", pred_id, "Approved", 0.95, "Approved")  # high conf, agree

    analysis = db_module.get_override_analysis_by_confidence("frank")
    low_bucket = next(b for b in analysis["buckets"] if b["confidence_range"] == "50-60%")
    high_bucket = next(b for b in analysis["buckets"] if b["confidence_range"] == "90-100%")
    assert low_bucket["disagreement_rate"] == 1.0
    assert high_bucket["disagreement_rate"] == 0.0


def test_satisfaction_metrics_aggregates_by_action(db_env):
    db_module = db_env
    pred_id = _make_prediction(db_module)
    db_module.save_feedback(pred_id, "grace", "approve", trust_rating=5, confidence_rating=4)
    db_module.save_feedback(pred_id, "grace", "reject", trust_rating=3, confidence_rating=2)

    metrics = db_module.get_satisfaction_metrics("grace")
    assert metrics["n_ratings"] == 2
    assert metrics["avg_trust_rating"] == 4.0
    actions = {b["action"]: b["avg_trust_rating"] for b in metrics["by_action"]}
    assert actions["approve"] == 5.0
    assert actions["reject"] == 3.0


def test_explanation_history_returns_predictions_user_interacted_with(db_env):
    db_module = db_env
    pred_id = _make_prediction(db_module)
    other_pred_id = _make_prediction(db_module)
    db_module.save_feedback(pred_id, "henry", "approve")

    history = db_module.get_explanation_history("henry")
    ids = [h["id"] for h in history]
    assert pred_id in ids
    assert other_pred_id not in ids


def test_decision_provenance_includes_application_model_version_and_feedback(db_env):
    db_module = db_env
    pred_id = _make_prediction(db_module, model_version="v5")
    db_module.save_feedback(pred_id, "irene", "approve", trust_rating=5)

    # Register the model version so provenance can resolve it
    db_module.create_model_version(
        version_label="v5",
        algorithm="XGBClassifier",
        hyperparameters={},
        metrics={"accuracy": 0.9},
        artifact_dir="versions/v5",
    )

    provenance = db_module.get_decision_provenance(pred_id)
    assert provenance["application"]["features"]["cibil_score"] == 700
    assert provenance["model_version"]["version_label"] == "v5"
    assert len(provenance["feedback_events"]) == 1


def test_decision_provenance_returns_none_for_missing_prediction(db_env):
    db_module = db_env
    assert db_module.get_decision_provenance(99999) is None
