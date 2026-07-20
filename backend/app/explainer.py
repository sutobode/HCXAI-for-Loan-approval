"""
SHAP-based local explanation for individual loan predictions.

Loads the currently active model version from the Model Registry
(app.model_registry) once (module-level singleton pattern via get_explainer)
and produces per-feature attribution values for a single application.
"""
from __future__ import annotations

import logging
from functools import lru_cache

import pandas as pd
import shap

from .data_processing import FEATURE_COLUMNS

logger = logging.getLogger(__name__)

READABLE_FEATURE_NAMES = {
    "no_of_dependents": "Number of dependents",
    "income_annum": "Annual income",
    "loan_amount": "Loan amount requested",
    "loan_term": "Loan term (months)",
    "cibil_score": "Credit score (CIBIL)",
    "residential_assets_value": "Residential assets value",
    "commercial_assets_value": "Commercial assets value",
    "luxury_assets_value": "Luxury assets value",
    "bank_asset_value": "Bank asset value",
    "education": "Education level",
    "self_employed": "Self-employed status",
}


class LoanExplainer:
    def __init__(self):
        from .model_registry import get_active_version_artifacts

        self.model, self.encoders, self.version = get_active_version_artifacts()
        self.tree_explainer = shap.TreeExplainer(self.model)

    @property
    def version_label(self) -> str:
        return self.version["version_label"]

    def predict(self, features_df: pd.DataFrame) -> dict:
        proba = float(self.model.predict_proba(features_df[FEATURE_COLUMNS])[0, 1])
        prediction_label = "Approved" if proba >= 0.5 else "Rejected"
        return {
            "approval_probability": proba,
            "risk_score": round(1 - proba, 4),
            "prediction": prediction_label,
            "confidence": round(max(proba, 1 - proba), 4),
        }

    def explain(self, features_df: pd.DataFrame) -> dict:
        """Return SHAP values for a single-row feature DataFrame, sorted by impact."""
        shap_values = self.tree_explainer.shap_values(features_df[FEATURE_COLUMNS])

        # XGBoost binary classifier via TreeExplainer returns a single array of
        # log-odds contributions towards the positive class (Approved).
        row_values = shap_values[0]

        contributions = []
        for feature, value in zip(FEATURE_COLUMNS, row_values):
            contributions.append(
                {
                    "feature": feature,
                    "display_name": READABLE_FEATURE_NAMES.get(feature, feature),
                    "value": float(features_df.iloc[0][feature]),
                    "shap_contribution": float(value),
                    "direction": "increases_approval" if value > 0 else "decreases_approval",
                }
            )

        contributions.sort(key=lambda c: abs(c["shap_contribution"]), reverse=True)
        return {
            "base_value": float(self.tree_explainer.expected_value),
            "contributions": contributions,
        }


@lru_cache(maxsize=1)
def get_explainer() -> LoanExplainer:
    logger.info("Loading LoanExplainer (model + SHAP TreeExplainer)")
    return LoanExplainer()
