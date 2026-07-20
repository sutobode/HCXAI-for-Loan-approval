"""Tests for Bias Mitigation recommendations (backend/app/fairness.py)."""
from app.fairness import generate_mitigation_recommendations


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
