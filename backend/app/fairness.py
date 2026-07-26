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
from .data_processing import FEATURE_COLUMNS, load_raw_dataframe, prepare_dataset
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
    Re-run the trained model over the held-out test split (never seen during
    training -- consistent with how model_registry._compute_rich_metrics
    evaluates accuracy/AUC/etc.) and compute demographic parity metrics
    grouped by education and self-employed status.

    Evaluating on the full dataset (including the ~80% the model was
    trained on) would let the model "look" fairer/more accurate than it
    would generalize to be, since it has memorized most of those rows.
    """
    dataset = prepare_dataset()
    test_raw = load_raw_dataframe().loc[dataset.X_test.index].reset_index(drop=True)
    X_test = dataset.X_test.reset_index(drop=True)

    probabilities = explainer.model.predict_proba(X_test[FEATURE_COLUMNS])[:, 1]
    predicted_approved = (probabilities >= 0.5).astype(int)

    analysis_df = test_raw.copy()
    analysis_df["predicted_approved"] = predicted_approved
    analysis_df["actual_approved"] = (test_raw["loan_status"] == "Approved").astype(int)

    report: dict[str, Any] = {
        "n_samples": len(analysis_df),
        "evaluated_on": "held_out_test_split",
        "overall_approval_rate_predicted": round(float(predicted_approved.mean()), 4),
        "overall_approval_rate_actual": round(float(analysis_df["actual_approved"].mean()), 4),
        "by_attribute": {},
    }

    for attribute in ("education", "self_employed"):
        predicted_stats = _approval_rates_by_group(analysis_df, attribute, "predicted_approved")
        label_stats = _approval_rates_by_group(analysis_df, attribute, "actual_approved")

        # Does the model's decision parity match, narrow, or widen the parity
        # gap that was already present in the original labels? A negative
        # delta means the model is *less* fair than the historical data it
        # was trained on (it amplified an existing bias); positive means the
        # model narrowed it.
        predicted_stats["label_parity_ratio"] = label_stats["parity_ratio"]
        if predicted_stats["parity_ratio"] is not None and label_stats["parity_ratio"] is not None:
            predicted_stats["model_vs_label_parity_delta"] = round(
                predicted_stats["parity_ratio"] - label_stats["parity_ratio"], 4
            )
        else:
            predicted_stats["model_vs_label_parity_delta"] = None

        report["by_attribute"][attribute] = predicted_stats

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


_cached_report: dict[str, Any] | None = None


def get_cached_fairness_report(explainer: LoanExplainer) -> dict[str, Any]:
    """
    Cache đơn giản, dùng lại kết quả compute_fairness_report() cho tới khi bị
    invalidate (khi model được train/activate lại -- xem model_registry.py).
    Tránh việc mỗi lượt /explain (kiểm tra trigger review) phải tính lại toàn
    bộ báo cáo fairness (vốn re-evaluate model trên cả tập test).
    """
    global _cached_report
    if _cached_report is None:
        _cached_report = compute_fairness_report(explainer)
    return _cached_report


def invalidate_fairness_cache() -> None:
    global _cached_report
    _cached_report = None


def is_group_flagged(explainer: LoanExplainer, attribute: str, group_value: str) -> bool:
    """True nếu `group_value` (vd 'Not Graduate') thuộc thuộc tính `attribute`
    (vd 'education') hiện đang bị Fairness Report gắn cờ vi phạm Four-Fifths Rule."""
    report = get_cached_fairness_report(explainer)
    attr_result = report["by_attribute"].get(attribute)
    if not attr_result or attr_result["passes_four_fifths_rule"] is not False:
        return False
    rates = attr_result["approval_rate_by_group"]
    if not rates:
        return False
    disadvantaged_group = min(rates, key=rates.get)
    return group_value == disadvantaged_group
