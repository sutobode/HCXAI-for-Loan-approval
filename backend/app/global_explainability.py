"""
Global Explainability (HCXAI_PLATFORM_DESIGN.md Part 4).

Local explanations (SHAP per-instance, in explainer.py) tell you why one
specific applicant got their decision. Global explanations tell you how
the model behaves *overall* -- which features matter most across the whole
population, and in which direction, on average.

Computed via mean absolute SHAP value per feature over the held-out test
set (the standard "SHAP summary" global importance measure), plus the mean
signed contribution (to show whether a feature is *systematically* pushing
decisions up or down).
"""
from __future__ import annotations

from functools import lru_cache
from typing import Any

import numpy as np
import pandas as pd
import shap

from .data_processing import FEATURE_COLUMNS, prepare_dataset
from .explainer import READABLE_FEATURE_NAMES, LoanExplainer


def compute_global_importance(explainer: LoanExplainer, sample_size: int = 500) -> dict[str, Any]:
    """
    Aggregate SHAP values across a sample of the dataset to produce global
    feature importance rankings (mean |SHAP|) and average directionality
    (mean signed SHAP) for each feature.
    """
    dataset = prepare_dataset()
    combined = pd.concat([dataset.X_train, dataset.X_test])[FEATURE_COLUMNS]

    sample = combined.sample(n=min(sample_size, len(combined)), random_state=42)

    shap_values = explainer.tree_explainer.shap_values(sample)

    mean_abs = np.abs(shap_values).mean(axis=0)
    mean_signed = shap_values.mean(axis=0)
    std_abs = np.abs(shap_values).std(axis=0)

    rows = []
    for i, feature in enumerate(FEATURE_COLUMNS):
        rows.append(
            {
                "feature": feature,
                "display_name": READABLE_FEATURE_NAMES.get(feature, feature),
                "mean_abs_shap": round(float(mean_abs[i]), 4),
                "mean_signed_shap": round(float(mean_signed[i]), 4),
                "std_abs_shap": round(float(std_abs[i]), 4),
                "overall_direction": "increases_approval" if mean_signed[i] > 0 else "decreases_approval",
            }
        )

    rows.sort(key=lambda r: r["mean_abs_shap"], reverse=True)

    total_importance = sum(r["mean_abs_shap"] for r in rows) or 1.0
    for r in rows:
        r["relative_importance_pct"] = round(100 * r["mean_abs_shap"] / total_importance, 2)

    return {
        "sample_size": len(sample),
        "feature_importance": rows,
        "base_value": float(explainer.tree_explainer.expected_value),
    }


@lru_cache(maxsize=1)
def get_cached_global_importance() -> dict[str, Any]:
    from .explainer import get_explainer

    return compute_global_importance(get_explainer())
