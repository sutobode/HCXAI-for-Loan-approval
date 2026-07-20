"""
Tests for the Human-Centered XAI logic layer (backend/app/hcxai.py) -- the
core novel contribution of this platform. Uses an isolated SQLite DB per
test module so trust/feedback state from other test modules never leaks in.
"""
import importlib
import os

import pytest


@pytest.fixture()
def hcxai_env(tmp_path):
    """Isolated SQLite DB per test (function-scoped: fresh state every test)."""
    os.environ["SQLITE_PATH"] = str(tmp_path / "test.db")

    from app import config as config_module

    importlib.reload(config_module)

    from app import db as db_module

    importlib.reload(db_module)
    db_module.init_db()

    from app import hcxai as hcxai_module

    importlib.reload(hcxai_module)

    yield hcxai_module, db_module

    del os.environ["SQLITE_PATH"]


SAMPLE_SHAP_AGREEING = {
    "base_value": 0.5,
    "contributions": [
        {"feature": "cibil_score", "display_name": "Credit score", "shap_contribution": 4.0, "direction": "increases_approval"},
        {"feature": "income_annum", "display_name": "Income", "shap_contribution": 3.5, "direction": "increases_approval"},
        {"feature": "loan_term", "display_name": "Term", "shap_contribution": 0.02, "direction": "decreases_approval"},
    ],
}

SAMPLE_SHAP_CONFLICTING = {
    "base_value": 0.5,
    "contributions": [
        {"feature": "cibil_score", "display_name": "Credit score", "shap_contribution": 3.0, "direction": "increases_approval"},
        {"feature": "income_annum", "display_name": "Income", "shap_contribution": -2.9, "direction": "decreases_approval"},
        {"feature": "loan_term", "display_name": "Term", "shap_contribution": 2.8, "direction": "increases_approval"},
        {"feature": "loan_amount", "display_name": "Amount", "shap_contribution": -2.7, "direction": "decreases_approval"},
        {"feature": "residential_assets_value", "display_name": "Assets", "shap_contribution": 2.5, "direction": "increases_approval"},
        {"feature": "bank_asset_value", "display_name": "Bank assets", "shap_contribution": -2.4, "direction": "decreases_approval"},
    ],
}


# ---------------------------------------------------------------------------
# Progressive Disclosure
# ---------------------------------------------------------------------------

def test_progressive_explanation_summary_shows_only_top_reason(hcxai_env):
    hcxai_module, _ = hcxai_env
    prediction = {"prediction": "Approved", "confidence": 0.9, "approval_probability": 0.9, "risk_score": 0.1}
    result = hcxai_module.build_progressive_explanation(
        prediction, SAMPLE_SHAP_AGREEING, "test narrative", "summary"
    )
    assert result["level"] == "summary"
    assert "top_reason" in result
    assert "all_contributions" not in result


def test_progressive_explanation_technical_shows_all_contributions(hcxai_env):
    hcxai_module, _ = hcxai_env
    prediction = {"prediction": "Approved", "confidence": 0.9, "approval_probability": 0.9, "risk_score": 0.1}
    result = hcxai_module.build_progressive_explanation(
        prediction, SAMPLE_SHAP_AGREEING, "test narrative", "technical"
    )
    assert result["level"] == "technical"
    assert len(result["all_contributions"]) == len(SAMPLE_SHAP_AGREEING["contributions"])


# ---------------------------------------------------------------------------
# Cognitive Load Adaptation
# ---------------------------------------------------------------------------

def test_cognitive_load_low_for_agreeing_factors(hcxai_env):
    hcxai_module, _ = hcxai_env
    load = hcxai_module.estimate_cognitive_load(SAMPLE_SHAP_AGREEING, user_expertise=0.5)
    assert load["conflict_score"] < 0.5
    assert load["recommendation"] in ("can_show_full_detail", "standard")


def test_cognitive_load_high_for_conflicting_factors_and_novice_user(hcxai_env):
    hcxai_module, _ = hcxai_env
    load = hcxai_module.estimate_cognitive_load(SAMPLE_SHAP_CONFLICTING, user_expertise=0.1)
    assert load["conflict_score"] > 0.8
    assert load["recommendation"] == "simplify"


def test_cognitive_load_expert_tolerates_more_conflict_than_novice(hcxai_env):
    hcxai_module, _ = hcxai_env
    novice_load = hcxai_module.estimate_cognitive_load(SAMPLE_SHAP_CONFLICTING, user_expertise=0.1)
    expert_load = hcxai_module.estimate_cognitive_load(SAMPLE_SHAP_CONFLICTING, user_expertise=0.9)
    assert expert_load["perceived_load"] < novice_load["perceived_load"]


# ---------------------------------------------------------------------------
# Explanation Recommendation Engine
# ---------------------------------------------------------------------------

def test_recommendation_engine_suggests_counterfactual_for_rejected_case(hcxai_env):
    hcxai_module, _ = hcxai_env
    prediction = {"prediction": "Rejected", "confidence": 0.6, "approval_probability": 0.4, "risk_score": 0.6}
    strategy = hcxai_module.recommend_explanation_strategy("test_user", prediction, SAMPLE_SHAP_AGREEING)
    assert strategy.suggest_counterfactual is True


def test_recommendation_engine_suggests_similar_cases_for_low_confidence(hcxai_env):
    hcxai_module, _ = hcxai_env
    prediction = {"prediction": "Approved", "confidence": 0.55, "approval_probability": 0.55, "risk_score": 0.45}
    strategy = hcxai_module.recommend_explanation_strategy("test_user", prediction, SAMPLE_SHAP_AGREEING)
    assert strategy.suggest_similar_cases is True


def test_recommendation_engine_downgrades_technical_under_high_cognitive_load(hcxai_env):
    hcxai_module, db_module = hcxai_env
    # Force user's preferred detail level to 'technical'
    db_module.get_or_create_user_profile("expert_user")
    with db_module.get_connection() as conn:
        conn.execute(
            "UPDATE user_profiles SET preferred_detail_level = 'technical', expertise_level = 0.2 WHERE user_id = ?",
            ("expert_user",),
        )

    prediction = {"prediction": "Rejected", "confidence": 0.5, "approval_probability": 0.5, "risk_score": 0.5}
    strategy = hcxai_module.recommend_explanation_strategy(
        "expert_user", prediction, SAMPLE_SHAP_CONFLICTING
    )
    assert strategy.detail_level == "detailed"
    assert any("Downgraded" in r for r in strategy.rationale)


def test_recommendation_engine_respects_explicit_override(hcxai_env):
    hcxai_module, _ = hcxai_env
    prediction = {"prediction": "Approved", "confidence": 0.9, "approval_probability": 0.9, "risk_score": 0.1}
    strategy = hcxai_module.recommend_explanation_strategy(
        "test_user", prediction, SAMPLE_SHAP_AGREEING, detail_override="summary"
    )
    assert strategy.detail_level == "summary"


# ---------------------------------------------------------------------------
# Trust Calibrator + Trust Dashboard
# ---------------------------------------------------------------------------

def test_trust_dashboard_has_all_sections_for_new_user(hcxai_env):
    hcxai_module, _ = hcxai_env
    dashboard = hcxai_module.get_trust_dashboard("new_user")
    assert set(dashboard.keys()) == {
        "profile",
        "trust_calibration",
        "trust_trend",
        "override_direction",
        "satisfaction",
    }
    assert dashboard["trust_calibration"]["trust_state"] == "insufficient_data"


def test_record_human_decision_updates_trust_calibration(hcxai_env):
    hcxai_module, db_module = hcxai_env
    app_id = db_module.save_application({"cibil_score": 700})
    pred_id = db_module.save_prediction(
        app_id,
        {"prediction": "Approved", "approval_probability": 0.9, "risk_score": 0.1, "confidence": 0.9},
        {"base_value": 0.5, "contributions": []},
    )

    calibration = hcxai_module.record_human_decision(
        user_id="alice", prediction_id=pred_id, ai_prediction="Approved", ai_confidence=0.9, human_decision="Approved"
    )
    assert calibration["events"] == 1
    assert calibration["agreement_rate"] == 1.0


# ---------------------------------------------------------------------------
# record_prediction_and_context (Decision Provenance input)
# ---------------------------------------------------------------------------

def test_record_prediction_and_context_persists_model_version_and_snapshot(hcxai_env):
    hcxai_module, db_module = hcxai_env
    prediction = {"prediction": "Approved", "approval_probability": 0.77, "risk_score": 0.23, "confidence": 0.77}
    application_id, prediction_id = hcxai_module.record_prediction_and_context(
        features={"cibil_score": 650},
        prediction=prediction,
        shap_result={"base_value": 0.5, "contributions": []},
        narrative="narrative text",
        narrative_model="deepseek-chat",
        model_version="v3",
    )

    stored = db_module.get_prediction(prediction_id)
    assert stored["model_version"] == "v3"

    snapshots = db_module.get_prediction_snapshots(limit=10)
    assert len(snapshots) == 1
    assert snapshots[0]["model_version"] == "v3"
    assert snapshots[0]["approval_probability"] == pytest.approx(0.77)
