"""
Tests for the DeepSeek client fallback behavior.

These tests do NOT call the real DeepSeek API (no network dependency in CI).
The real integration was manually verified against the live API separately.
"""
from unittest.mock import patch

from app.deepseek_client import build_template_explanation, generate_narrative_explanation

FAKE_PREDICTION = {
    "approval_probability": 0.85,
    "risk_score": 0.15,
    "prediction": "Approved",
    "confidence": 0.85,
}

FAKE_SHAP_RESULT = {
    "base_value": 0.5,
    "contributions": [
        {
            "feature": "cibil_score",
            "display_name": "Credit score (CIBIL)",
            "value": 780,
            "shap_contribution": 3.2,
            "direction": "increases_approval",
        },
        {
            "feature": "loan_term",
            "display_name": "Loan term (months)",
            "value": 12,
            "shap_contribution": -1.1,
            "direction": "decreases_approval",
        },
    ],
}


def test_build_template_explanation_uses_only_provided_numbers():
    narrative = build_template_explanation(FAKE_PREDICTION, FAKE_SHAP_RESULT, role="loan_officer")
    assert "Được duyệt" in narrative
    assert "Credit score (CIBIL)" in narrative
    assert "780" in narrative


def test_generate_narrative_falls_back_when_no_api_key():
    with patch("app.deepseek_client.settings") as mock_settings:
        mock_settings.deepseek_enabled = False
        result = generate_narrative_explanation(FAKE_PREDICTION, FAKE_SHAP_RESULT, role="customer")

    assert result["model"] == "template-fallback"
    assert "Được duyệt" in result["narrative"]
