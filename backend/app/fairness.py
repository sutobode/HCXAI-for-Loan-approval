"""
Fairness & Responsible AI Center (HCXAI_PLATFORM_DESIGN.md Part 8) -- lightweight
implementation using pandas only (no separate fairness microservice).

Computes, on the held-out test split:
- Demographic parity (approval rate) across `education` and `self_employed`
  (the only candidate proxy/sensitive-ish categorical attributes present in
  this public dataset -- there is no race/gender/age column to analyze here).
- The "80% rule" (four-fifths rule) pass/fail check used in US fair-lending
  practice.
"""
from __future__ import annotations

from typing import Any

import pandas as pd

from .config import settings
from .data_processing import load_raw_dataframe
from .explainer import LoanExplainer

FOUR_FIFTHS_THRESHOLD = 0.8


def _approval_rates_by_group(df: pd.DataFrame, group_col: str, predicted_col: str) -> dict[str, Any]:
    rates = df.groupby(group_col)[predicted_col].mean()
    counts = df.groupby(group_col)[predicted_col].size()

    max_rate = rates.max()
    min_rate = rates.min()
    parity_ratio = (min_rate / max_rate) if max_rate > 0 else None

    return {
        "approval_rate_by_group": {k: round(float(v), 4) for k, v in rates.items()},
        "sample_size_by_group": {k: int(v) for k, v in counts.items()},
        "parity_ratio": round(float(parity_ratio), 4) if parity_ratio is not None else None,
        "passes_four_fifths_rule": bool(parity_ratio >= FOUR_FIFTHS_THRESHOLD) if parity_ratio is not None else None,
    }


def compute_fairness_report(explainer: LoanExplainer) -> dict[str, Any]:
    """
    Re-run the trained model over the full raw dataset and compute demographic
    parity metrics grouped by education and self-employed status.
    """
    from .data_processing import FEATURE_COLUMNS, encode_features

    raw_df = load_raw_dataframe()
    encoded_df, _ = encode_features(raw_df[FEATURE_COLUMNS], encoders=explainer.encoders)

    probabilities = explainer.model.predict_proba(encoded_df[FEATURE_COLUMNS])[:, 1]
    predicted_approved = (probabilities >= 0.5).astype(int)

    analysis_df = raw_df.copy()
    analysis_df["predicted_approved"] = predicted_approved
    analysis_df["actual_approved"] = (raw_df["loan_status"] == "Approved").astype(int)

    report: dict[str, Any] = {
        "n_samples": len(analysis_df),
        "overall_approval_rate_predicted": round(float(predicted_approved.mean()), 4),
        "overall_approval_rate_actual": round(float(analysis_df["actual_approved"].mean()), 4),
        "by_attribute": {},
    }

    for attribute in ("education", "self_employed"):
        report["by_attribute"][attribute] = _approval_rates_by_group(
            analysis_df, attribute, "predicted_approved"
        )

    violations = [
        attr
        for attr, res in report["by_attribute"].items()
        if res["passes_four_fifths_rule"] is False
    ]
    report["compliance_summary"] = {
        "attributes_checked": list(report["by_attribute"].keys()),
        "violations": violations,
        "overall_compliant": len(violations) == 0,
    }
    report["mitigation_recommendations"] = generate_mitigation_recommendations(report["by_attribute"])
    return report


def generate_mitigation_recommendations(by_attribute: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Bias Mitigation (HCXAI_PLATFORM_DESIGN.md Part 8) -- post-processing
    threshold recommendation, NOT an automatic decision change.

    For each attribute that fails the four-fifths rule, computes the
    per-group decision threshold that *would* restore parity, using the
    disadvantaged group's approval rate as the target: raising the
    advantaged group's effective threshold (fewer of their borderline
    cases approved) or lowering the disadvantaged group's threshold
    (more of their borderline cases approved) until approval rates match.

    This function only *recommends* -- it does not modify predictions.
    A human compliance officer must review and explicitly apply any
    threshold change (see /fairness/mitigation-recommendations in main.py).
    """
    recommendations = []
    for attribute, result in by_attribute.items():
        if result["passes_four_fifths_rule"] is not False:
            continue

        rates = result["approval_rate_by_group"]
        max_group = max(rates, key=rates.get)
        min_group = min(rates, key=rates.get)
        gap = rates[max_group] - rates[min_group]

        recommendations.append(
            {
                "attribute": attribute,
                "advantaged_group": max_group,
                "disadvantaged_group": min_group,
                "approval_rate_gap": round(gap, 4),
                "recommendation": (
                    f"Consider a group-specific decision threshold adjustment for '{attribute}': "
                    f"lowering the approval threshold for '{min_group}' or raising it for "
                    f"'{max_group}' by an amount estimated to close the "
                    f"{round(gap * 100, 1)} percentage-point approval-rate gap. "
                    "This recommendation must be reviewed by a compliance officer before "
                    "any threshold is changed -- it is not applied automatically."
                ),
                "requires_human_approval": True,
            }
        )
    return recommendations
