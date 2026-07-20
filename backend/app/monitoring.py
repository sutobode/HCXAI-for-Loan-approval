"""
Model Monitoring Center (HCXAI_PLATFORM_DESIGN.md Part 9) -- lightweight
implementation covering:

- Training-time metrics snapshot (from the active Model Registry version).
- Feature drift: two-sample Kolmogorov-Smirnov test (scipy.stats.ks_2samp)
  comparing recently served applications against the training distribution.
- Prediction drift: KS-test comparing the distribution of recent predicted
  approval probabilities against a reference window, tracked independently
  of feature drift (a model can drift in its outputs even if inputs look
  stable, e.g. after a version change).

No Prometheus/Grafana/Evidently service required -- this runs in-process
against the local SQLite store.
"""
from __future__ import annotations

import json
from typing import Any

import numpy as np
import pandas as pd
from scipy import stats

from . import db
from .data_processing import NUMERIC_COLUMNS, prepare_dataset

DRIFT_P_VALUE_THRESHOLD = 0.05  # below this, distributions are considered significantly different
PREDICTION_DRIFT_WINDOW = 50  # split recent snapshots into two halves of this size to compare


def get_training_metrics() -> dict[str, Any] | None:
    """Metrics for the currently active model version (from the Model Registry)."""
    active = db.get_active_model_version()
    if active is None:
        return None
    return {
        "feature_columns": None,  # not tracked per-version; see /model/versions for full record
        "model_type": active["algorithm"],
        "version_label": active["version_label"],
        "metrics": active["metrics"],
    }


def detect_feature_drift(recent_applications: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Compare the distribution of numeric features in `recent_applications`
    (e.g. the last N applications served in production, pulled from SQLite)
    against the original training set, using a KS two-sample test per feature.
    """
    if not recent_applications:
        return {"status": "no_data", "features": {}}

    training = prepare_dataset()
    reference_df = pd.concat([training.X_train, training.X_test])

    recent_df = pd.DataFrame(recent_applications)

    results = {}
    drifted_features = []
    for col in NUMERIC_COLUMNS:
        if col not in recent_df.columns or recent_df[col].dropna().empty:
            continue
        stat, p_value = stats.ks_2samp(reference_df[col], recent_df[col].astype(float))
        is_drifted = p_value < DRIFT_P_VALUE_THRESHOLD
        results[col] = {
            "ks_statistic": round(float(stat), 4),
            "p_value": round(float(p_value), 6),
            "drift_detected": bool(is_drifted),
        }
        if is_drifted:
            drifted_features.append(col)

    return {
        "status": "ok",
        "n_reference": len(reference_df),
        "n_recent": len(recent_df),
        "features": results,
        "drifted_features": drifted_features,
        "overall_drift_detected": len(drifted_features) > 0,
    }


def get_recent_applications_from_db(limit: int = 100) -> list[dict[str, Any]]:
    predictions = db.list_recent_predictions(limit=limit)
    applications = []
    with db.get_connection() as conn:
        for pred in predictions:
            row = conn.execute(
                "SELECT features_json FROM applications WHERE id = ?", (pred["application_id"],)
            ).fetchone()
            if row:
                applications.append(json.loads(row["features_json"]))
    return applications


def detect_prediction_drift(window_size: int = PREDICTION_DRIFT_WINDOW) -> dict[str, Any]:
    """
    Prediction Drift (distinct from Feature Drift): compares the distribution
    of recently predicted approval probabilities in two consecutive windows.
    A significant shift means the model's *outputs* are changing even if we
    don't (yet) know why -- an early warning independent of feature drift.
    """
    snapshots = db.get_prediction_snapshots(limit=window_size * 2)
    if len(snapshots) < window_size * 2:
        return {
            "status": "insufficient_data",
            "n_snapshots": len(snapshots),
            "required": window_size * 2,
        }

    # snapshots are ordered most-recent-first
    recent_window = np.array([s["approval_probability"] for s in snapshots[:window_size]])
    prior_window = np.array([s["approval_probability"] for s in snapshots[window_size : window_size * 2]])

    stat, p_value = stats.ks_2samp(prior_window, recent_window)
    drift_detected = bool(p_value < DRIFT_P_VALUE_THRESHOLD)

    return {
        "status": "ok",
        "ks_statistic": round(float(stat), 4),
        "p_value": round(float(p_value), 6),
        "drift_detected": drift_detected,
        "recent_window_mean": round(float(recent_window.mean()), 4),
        "prior_window_mean": round(float(prior_window.mean()), 4),
        "window_size": window_size,
    }


def get_monitoring_snapshot() -> dict[str, Any]:
    """Combined view for a Model Monitoring dashboard."""
    training_metrics = get_training_metrics()
    recent_apps = get_recent_applications_from_db(limit=200)
    feature_drift = detect_feature_drift(recent_apps) if recent_apps else {"status": "no_data", "features": {}}
    prediction_drift = detect_prediction_drift()

    return {
        "training_metrics": training_metrics,
        "n_predictions_served": len(db.list_recent_predictions(limit=10_000)),
        "drift_report": feature_drift,
        "prediction_drift": prediction_drift,
    }
