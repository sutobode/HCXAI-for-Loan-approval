"""
AI Model Center: Model Registry + Experiment Tracking (production-lite).

Responsibilities:
- Train a new model version with full evaluation (accuracy, F1, AUC,
  confusion matrix, ROC curve, precision-recall curve, calibration curve).
- Persist each version's artifacts under backend/models/versions/<label>/
  and register metadata in the SQLite `model_versions` table.
- Maintain a single "active" (champion) version pointer.
- Support listing versions, comparing two versions, and activating a
  version (champion-challenger switch), matching the Model Registry /
  Champion-Challenger concepts in HCXAI_PLATFORM_DESIGN.md Part 3.

This intentionally does not depend on MLflow: for a single tabular model
with a handful of versions, a SQLite table + versioned directory achieves
the same governance value (reproducibility, comparison, rollback) without
requiring a separate tracking server.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
    roc_curve,
)
from sklearn.calibration import calibration_curve
from xgboost import XGBClassifier

from . import db
from .config import settings
from .data_processing import FEATURE_COLUMNS, prepare_dataset

logger = logging.getLogger(__name__)

DEFAULT_HYPERPARAMETERS = {
    "n_estimators": 200,
    "max_depth": 4,
    "learning_rate": 0.1,
    "subsample": 0.9,
    "colsample_bytree": 0.9,
    "eval_metric": "logloss",
    "random_state": 42,
}


def _next_version_label() -> str:
    versions = db.list_model_versions()
    return f"v{len(versions) + 1}"


def _compute_rich_metrics(model: XGBClassifier, X_test, y_test) -> dict[str, Any]:
    """Full evaluation suite: point metrics + curves for dashboards."""
    y_pred = model.predict(X_test)
    y_proba = model.predict_proba(X_test)[:, 1]

    cm = confusion_matrix(y_test, y_pred).tolist()  # [[TN, FP], [FN, TP]]

    fpr, tpr, _ = roc_curve(y_test, y_proba)
    roc_points = [
        {"fpr": round(float(f), 4), "tpr": round(float(t), 4)}
        for f, t in zip(fpr[:: max(1, len(fpr) // 50)], tpr[:: max(1, len(tpr) // 50)])
    ]

    precision_arr, recall_arr, _ = precision_recall_curve(y_test, y_proba)
    pr_points = [
        {"precision": round(float(p), 4), "recall": round(float(r), 4)}
        for p, r in zip(
            precision_arr[:: max(1, len(precision_arr) // 50)],
            recall_arr[:: max(1, len(recall_arr) // 50)],
        )
    ]

    # Calibration curve: how well predicted probabilities match observed frequencies
    frac_pos, mean_pred = calibration_curve(y_test, y_proba, n_bins=10, strategy="quantile")
    calibration_points = [
        {"mean_predicted": round(float(mp), 4), "fraction_positive": round(float(fp), 4)}
        for mp, fp in zip(mean_pred, frac_pos)
    ]

    return {
        "accuracy": float(accuracy_score(y_test, y_pred)),
        "precision": float(precision_score(y_test, y_pred, zero_division=0)),
        "recall": float(recall_score(y_test, y_pred, zero_division=0)),
        "f1_score": float(f1_score(y_test, y_pred, zero_division=0)),
        "auc": float(roc_auc_score(y_test, y_proba)),
        "n_train": None,  # filled by caller
        "n_test": int(len(y_test)),
        "confusion_matrix": cm,
        "roc_curve": roc_points,
        "precision_recall_curve": pr_points,
        "calibration_curve": calibration_points,
    }


def train_new_version(
    hyperparameters: dict[str, Any] | None = None,
    trained_by: str = "system",
    notes: str | None = None,
    activate: bool = True,
) -> dict[str, Any]:
    """
    Train a new model version end-to-end: fit, evaluate, persist versioned
    artifacts, register in the Model Registry, and (by default) activate it
    as the new champion.
    """
    hyperparameters = hyperparameters or DEFAULT_HYPERPARAMETERS
    dataset = prepare_dataset()

    model = XGBClassifier(**hyperparameters)
    logger.info("Training XGBoost classifier (version=%s) on %d samples", _next_version_label(), len(dataset.X_train))
    model.fit(dataset.X_train, dataset.y_train)

    metrics = _compute_rich_metrics(model, dataset.X_test, dataset.y_test)
    metrics["n_train"] = int(len(dataset.X_train))

    version_label = _next_version_label()
    version_dir = settings.VERSIONS_DIR / version_label
    version_dir.mkdir(parents=True, exist_ok=True)

    joblib.dump(model, version_dir / "model.joblib")
    joblib.dump(dataset.encoders, version_dir / "encoders.joblib")
    (version_dir / "metadata.json").write_text(
        json.dumps(
            {"feature_columns": FEATURE_COLUMNS, "model_type": "XGBClassifier", "metrics": metrics},
            indent=2,
        )
    )

    record = db.create_model_version(
        version_label=version_label,
        algorithm="XGBClassifier",
        hyperparameters=hyperparameters,
        metrics=metrics,
        artifact_dir=str(version_dir.relative_to(settings.MODEL_DIR)),
        trained_by=trained_by,
        notes=notes,
    )

    if activate:
        db.activate_model_version(version_label)
        record = db.get_model_version_by_label(version_label)  # type: ignore[assignment]

    db.log_audit_event(
        user_id=trained_by,
        action="model.train",
        resource_type="model_version",
        resource_id=version_label,
        details={"metrics": {k: v for k, v in metrics.items() if k in ("accuracy", "f1_score", "auc")}},
    )

    logger.info("Registered model version %s (active=%s)", version_label, activate)
    return record


def get_active_version_artifacts() -> tuple[Any, dict[str, Any], dict[str, Any]]:
    """Load (model, encoders, version_record) for the currently active version."""
    version = db.get_active_model_version()
    if version is None:
        raise FileNotFoundError(
            "No active model version found. Train and activate a model first: "
            "python -m app.model_registry"
        )
    version_dir = settings.MODEL_DIR / version["artifact_dir"]
    model = joblib.load(version_dir / "model.joblib")
    encoders = joblib.load(version_dir / "encoders.joblib")
    return model, encoders, version


def compare_versions(label_a: str, label_b: str) -> dict[str, Any]:
    """Champion-Challenger style side-by-side metric comparison."""
    version_a = db.get_model_version_by_label(label_a)
    version_b = db.get_model_version_by_label(label_b)
    if version_a is None or version_b is None:
        missing = label_a if version_a is None else label_b
        raise ValueError(f"Model version '{missing}' not found")

    compare_keys = ["accuracy", "precision", "recall", "f1_score", "auc"]
    deltas = {
        key: round(version_b["metrics"].get(key, 0) - version_a["metrics"].get(key, 0), 4)
        for key in compare_keys
    }

    return {
        "version_a": version_a,
        "version_b": version_b,
        "metric_deltas": deltas,
        "recommendation": (
            f"{label_b} outperforms {label_a} on AUC and F1"
            if deltas["auc"] > 0 and deltas["f1_score"] > 0
            else f"{label_a} outperforms {label_b} on AUC and F1"
            if deltas["auc"] < 0 and deltas["f1_score"] < 0
            else "Mixed results across metrics; review individually before promoting"
        ),
    }


if __name__ == "__main__":
    import logging as _logging

    _logging.basicConfig(level=_logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    db.init_db()
    result = train_new_version(trained_by="cli")
    print(json.dumps({k: v for k, v in result.items() if k != "hyperparameters"}, indent=2, default=str))
