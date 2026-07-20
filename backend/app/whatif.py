"""
Interactive What-If Lab (HCXAI_PLATFORM_DESIGN.md Part 6).

Given a base loan application and a dict of feature overrides, recompute
the model prediction and report the delta vs. the original, plus a basic
local sensitivity sweep for one chosen feature.
"""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from .data_processing import FEATURE_COLUMNS, NUMERIC_COLUMNS, encode_single_application
from .explainer import LoanExplainer

MAX_SWEEP_POINTS = 15


def apply_overrides(base_application: dict[str, Any], overrides: dict[str, Any]) -> dict[str, Any]:
    updated = dict(base_application)
    for key, value in overrides.items():
        if key not in FEATURE_COLUMNS:
            raise ValueError(f"Unknown feature override: {key}")
        updated[key] = value
    return updated


def run_whatif(
    explainer: LoanExplainer,
    base_application: dict[str, Any],
    overrides: dict[str, Any],
) -> dict[str, Any]:
    """Compare the base application's prediction against the overridden scenario."""
    base_df = encode_single_application(base_application, explainer.encoders)
    base_prediction = explainer.predict(base_df)

    updated_application = apply_overrides(base_application, overrides)
    updated_df = encode_single_application(updated_application, explainer.encoders)
    updated_prediction = explainer.predict(updated_df)

    return {
        "base_prediction": base_prediction,
        "updated_prediction": updated_prediction,
        "decision_changed": base_prediction["prediction"] != updated_prediction["prediction"],
        "probability_delta": round(
            updated_prediction["approval_probability"] - base_prediction["approval_probability"], 4
        ),
        "overrides_applied": overrides,
    }


def sensitivity_sweep(
    explainer: LoanExplainer,
    base_application: dict[str, Any],
    feature: str,
    n_points: int = 10,
) -> dict[str, Any]:
    """
    Sweep one numeric feature across a reasonable range (based on the value's
    own magnitude when no dataset-wide bounds are available) and report how
    the approval probability changes -- this is the "sensitivity analysis" /
    "decision boundary" visualization data source for the frontend.
    """
    if feature not in NUMERIC_COLUMNS:
        raise ValueError(f"Sensitivity sweep only supported for numeric features, got: {feature}")

    n_points = min(n_points, MAX_SWEEP_POINTS)
    base_value = float(base_application[feature])

    if feature == "cibil_score":
        low, high = 300, 900
    elif feature == "loan_term":
        low, high = 4, 20
    elif feature == "no_of_dependents":
        low, high = 0, 5
    else:
        # Monetary features: sweep 0.2x - 2x of the base value
        low, high = base_value * 0.2, base_value * 2.0

    sweep_values = np.linspace(low, high, n_points)

    points = []
    for value in sweep_values:
        scenario = dict(base_application)
        scenario[feature] = float(value)
        df = encode_single_application(scenario, explainer.encoders)
        result = explainer.predict(df)
        points.append(
            {
                "value": round(float(value), 2),
                "approval_probability": result["approval_probability"],
                "prediction": result["prediction"],
            }
        )

    return {
        "feature": feature,
        "base_value": base_value,
        "points": points,
    }
