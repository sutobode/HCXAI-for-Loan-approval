import pytest

from app.data_processing import encode_single_application
from app.explainer import get_explainer
from tests.conftest import SAMPLE_APPROVED_PAYLOAD, SAMPLE_REJECTED_PAYLOAD


@pytest.fixture(scope="module")
def explainer():
    return get_explainer()


def test_predict_approved_case(explainer):
    df = encode_single_application(SAMPLE_APPROVED_PAYLOAD, explainer.encoders)
    result = explainer.predict(df)
    assert result["prediction"] == "Approved"
    assert result["approval_probability"] > 0.5


def test_predict_rejected_case(explainer):
    df = encode_single_application(SAMPLE_REJECTED_PAYLOAD, explainer.encoders)
    result = explainer.predict(df)
    assert result["prediction"] == "Rejected"
    assert result["approval_probability"] < 0.5


def test_explain_returns_all_features_sorted_by_impact(explainer):
    df = encode_single_application(SAMPLE_REJECTED_PAYLOAD, explainer.encoders)
    result = explainer.explain(df)
    assert "base_value" in result
    contributions = result["contributions"]
    assert len(contributions) == len(SAMPLE_REJECTED_PAYLOAD)

    magnitudes = [abs(c["shap_contribution"]) for c in contributions]
    assert magnitudes == sorted(magnitudes, reverse=True)

    # cibil_score should be the dominant factor for this low-score rejected case
    assert contributions[0]["feature"] == "cibil_score"
    assert contributions[0]["direction"] == "decreases_approval"
