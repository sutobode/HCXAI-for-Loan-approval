"""
Tests for the XAI modules: global explainability, counterfactuals, LIME,
and explanation quality metrics (backend/app/*.py).

Reuses tests/test_explainer.py's `explainer` fixture pattern (self-contained
model training) via the local `explainer` fixture below.
"""
import pytest

from app import db
from app.data_processing import encode_single_application
from app.explainer import get_explainer
from app.model_registry import train_new_version
from tests.conftest import SAMPLE_APPROVED_PAYLOAD, SAMPLE_REJECTED_PAYLOAD


@pytest.fixture(scope="module")
def explainer():
    db.init_db()
    if db.get_active_model_version() is None:
        train_new_version(trained_by="pytest", notes="auto-trained by test_xai_modules.py fixture")
    get_explainer.cache_clear()
    return get_explainer()


# ---------------------------------------------------------------------------
# Global Explainability
# ---------------------------------------------------------------------------

def test_global_importance_ranks_cibil_score_highest(explainer):
    from app.global_explainability import compute_global_importance

    result = compute_global_importance(explainer, sample_size=150)
    assert result["feature_importance"][0]["feature"] == "cibil_score"
    # relative importances should sum to ~100%
    total_pct = sum(f["relative_importance_pct"] for f in result["feature_importance"])
    assert 99.0 <= total_pct <= 101.0


def test_global_importance_directions_are_valid(explainer):
    from app.global_explainability import compute_global_importance

    result = compute_global_importance(explainer, sample_size=150)
    for feature in result["feature_importance"]:
        assert feature["overall_direction"] in ("increases_approval", "decreases_approval")


# ---------------------------------------------------------------------------
# Counterfactual Explanation Engine
# ---------------------------------------------------------------------------

def test_counterfactual_flips_rejected_case_to_approved(explainer):
    from app.counterfactual import find_counterfactuals

    result = find_counterfactuals(explainer, SAMPLE_REJECTED_PAYLOAD, n_results=2)
    assert result["original_decision"] == "Rejected"
    assert result["target_decision"] == "Approved"
    assert len(result["counterfactuals"]) > 0
    for cf in result["counterfactuals"]:
        assert cf["resulting_decision"] == "Approved"
        assert cf["n_features_changed"] > 0
        assert cf["normalized_distance"] > 0


def test_counterfactual_changes_are_within_actionable_bounds(explainer):
    from app.counterfactual import ACTIONABLE_FEATURE_BOUNDS, find_counterfactuals

    result = find_counterfactuals(explainer, SAMPLE_REJECTED_PAYLOAD, n_results=1)
    for cf in result["counterfactuals"]:
        for change in cf["changes"]:
            low, high = ACTIONABLE_FEATURE_BOUNDS[change["feature"]]
            assert low <= change["suggested_value"] <= high


# ---------------------------------------------------------------------------
# LIME-style local surrogate
# ---------------------------------------------------------------------------

def test_lime_explanation_ranks_cibil_score_high_for_low_score_case(explainer):
    from app.lime_explainer import get_lime_explainer

    df = encode_single_application(SAMPLE_REJECTED_PAYLOAD, explainer.encoders)
    lime = get_lime_explainer()
    result = lime.explain(df)

    assert len(result["contributions"]) == len(SAMPLE_REJECTED_PAYLOAD)
    feature_order = [c["feature"] for c in result["contributions"]]
    # cibil_score (417, far below average) should be a top-2 driver for this case
    assert "cibil_score" in feature_order[:2]


def test_lime_explanation_is_deterministic(explainer):
    from app.lime_explainer import LimeTabularExplainer

    df = encode_single_application(SAMPLE_APPROVED_PAYLOAD, explainer.encoders)
    lime_a = LimeTabularExplainer(explainer)
    lime_b = LimeTabularExplainer(explainer)

    result_a = lime_a.explain(df)
    result_b = lime_b.explain(df)

    weights_a = {c["feature"]: c["lime_weight"] for c in result_a["contributions"]}
    weights_b = {c["feature"]: c["lime_weight"] for c in result_b["contributions"]}
    for feature in weights_a:
        assert weights_a[feature] == pytest.approx(weights_b[feature], abs=1e-9)


# ---------------------------------------------------------------------------
# Explanation Quality / Fidelity
# ---------------------------------------------------------------------------

def test_explanation_quality_completeness_holds_to_high_precision(explainer):
    from app.explanation_quality import compute_explanation_quality_report

    report = compute_explanation_quality_report(explainer, SAMPLE_APPROVED_PAYLOAD)
    assert report["completeness"]["is_complete"] is True
    assert report["completeness"]["reconstruction_error"] < 1e-3


def test_explanation_quality_composite_score_in_valid_range(explainer):
    from app.explanation_quality import compute_explanation_quality_report

    report = compute_explanation_quality_report(explainer, SAMPLE_REJECTED_PAYLOAD)
    assert 0.0 <= report["composite_quality_score"] <= 1.0
    assert report["stability"]["interpretation"] in (
        "highly_stable",
        "moderately_stable",
        "unstable",
        "insufficient_data",
    )
