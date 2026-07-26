"""Tests for Bias Mitigation recommendations (backend/app/fairness.py)."""
from app import db
from app.fairness import generate_mitigation_recommendations
from app.model_registry import train_new_version


def test_no_recommendations_when_all_attributes_pass():
    by_attribute = {
        "education": {
            "passes_four_fifths_rule": True,
            "approval_rate_by_group": {"Graduate": 0.6, "Not Graduate": 0.55},
        },
        "self_employed": {
            "passes_four_fifths_rule": True,
            "approval_rate_by_group": {"Yes": 0.58, "No": 0.6},
        },
    }
    assert generate_mitigation_recommendations(by_attribute) == []


def test_recommendation_generated_for_failing_attribute():
    by_attribute = {
        "education": {
            "passes_four_fifths_rule": False,
            "approval_rate_by_group": {"Graduate": 0.9, "Not Graduate": 0.5},
        },
    }
    recs = generate_mitigation_recommendations(by_attribute)
    assert len(recs) == 1
    rec = recs[0]
    assert rec["attribute"] == "education"
    assert rec["advantaged_group"] == "Graduate"
    assert rec["disadvantaged_group"] == "Not Graduate"
    assert rec["approval_rate_gap"] == 0.4
    assert rec["requires_human_approval"] is True
    assert "compliance officer" in rec["recommendation"]


def test_recommendation_skipped_when_parity_ratio_is_none():
    by_attribute = {
        "education": {"passes_four_fifths_rule": None, "approval_rate_by_group": {}},
    }
    assert generate_mitigation_recommendations(by_attribute) == []


def test_multiple_failing_attributes_each_get_a_recommendation():
    by_attribute = {
        "education": {
            "passes_four_fifths_rule": False,
            "approval_rate_by_group": {"Graduate": 0.9, "Not Graduate": 0.5},
        },
        "self_employed": {
            "passes_four_fifths_rule": False,
            "approval_rate_by_group": {"Yes": 0.4, "No": 0.85},
        },
    }
    recs = generate_mitigation_recommendations(by_attribute)
    assert {r["attribute"] for r in recs} == {"education", "self_employed"}


def test_cached_fairness_report_reuses_result(monkeypatch):
    from app import fairness as fairness_module

    call_count = {"n": 0}
    original = fairness_module.compute_fairness_report

    def counting_wrapper(explainer):
        call_count["n"] += 1
        return original(explainer)

    monkeypatch.setattr(fairness_module, "compute_fairness_report", counting_wrapper)
    fairness_module.invalidate_fairness_cache()

    # compute_fairness_report() re-runs the real model over the held-out test
    # split (explainer.model.predict_proba(...)), so the fake explainer needs
    # a minimal stub model rather than a bare object -- what matters for this
    # test is only that compute_fairness_report is invoked at most once, not
    # the resulting report's content.
    class FakeModel:
        def predict_proba(self, X):
            import numpy as np

            return np.tile([0.4, 0.6], (len(X), 1))

    class FakeExplainer:
        model = FakeModel()

    try:
        fairness_module.get_cached_fairness_report(FakeExplainer())
        fairness_module.get_cached_fairness_report(FakeExplainer())
        assert call_count["n"] == 1
    finally:
        # The module-level cache is global process state that outlives
        # monkeypatch's automatic teardown -- clear it so this test's fake
        # (stubbed-model) report can't leak into other tests that rely on
        # a real compute_fairness_report() result later in the session.
        fairness_module.invalidate_fairness_cache()


# /fairness/* endpoints run compute_fairness_report() against the active
# Model Registry version. The `client` fixture (via client_as_risk_manager)
# spins up a fresh, isolated SQLite DB per test with no active model version
# yet, so an active version must be trained first -- same pattern used by
# tests/test_xai_modules.py's `_ensure_active_model` for the /explain/*
# interpret endpoints.
def _ensure_active_model():
    if db.get_active_model_version() is None:
        train_new_version(trained_by="pytest", notes="auto-trained by test_fairness_mitigation.py")


def test_fairness_interpret_endpoint(client_as_risk_manager):
    _ensure_active_model()
    resp = client_as_risk_manager.post("/fairness/interpret")
    assert resp.status_code == 200
    assert "narrative" in resp.json()


def test_mitigation_recommendations_with_elaborate_flag(client_as_risk_manager):
    _ensure_active_model()
    resp = client_as_risk_manager.get("/fairness/mitigation-recommendations?elaborate=true")
    assert resp.status_code == 200
    body = resp.json()
    for rec in body:
        assert "llm_detailed_writeup" in rec


_FAKE_REPORT_WITH_RECOMMENDATION = {
    "mitigation_recommendations": [
        {
            "attribute": "education",
            "advantaged_group": "Graduate",
            "disadvantaged_group": "Not Graduate",
            "approval_rate_gap": 0.4,
            "requires_human_approval": True,
            "recommendation": "Escalate to a compliance officer for threshold review.",
        }
    ]
}


def test_mitigation_recommendations_default_has_null_writeup(client_as_risk_manager, monkeypatch):
    """
    The real held-out dataset currently passes the four-fifths rule for both
    tracked attributes (no recommendations at all), so this monkeypatches
    compute_fairness_report to force a non-empty recommendation and verifies
    the *existing* (non-elaborate) behavior is preserved: the recommendation
    fields are unchanged, and the new llm_detailed_writeup field is present
    but null when elaborate is not requested.
    """
    _ensure_active_model()
    monkeypatch.setattr("app.main.compute_fairness_report", lambda explainer: _FAKE_REPORT_WITH_RECOMMENDATION)

    resp = client_as_risk_manager.get("/fairness/mitigation-recommendations")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    rec = body[0]
    assert rec["attribute"] == "education"
    assert rec["recommendation"] == "Escalate to a compliance officer for threshold review."
    assert rec["llm_detailed_writeup"] is None


def test_mitigation_recommendations_elaborate_true_populates_writeup(client_as_risk_manager, monkeypatch):
    _ensure_active_model()
    monkeypatch.setattr("app.main.compute_fairness_report", lambda explainer: _FAKE_REPORT_WITH_RECOMMENDATION)

    resp = client_as_risk_manager.get("/fairness/mitigation-recommendations?elaborate=true")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    writeup = body[0]["llm_detailed_writeup"]
    assert isinstance(writeup, str)
    assert len(writeup) > 0
