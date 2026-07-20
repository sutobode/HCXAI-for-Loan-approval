"""
Train the loan approval risk model on loan_approval_dataset.csv and persist
the model + encoders + metadata to backend/models/.

Run with:
    conda run -n hcxai python -m app.train_model
(from inside the backend/ directory, or use scripts/train.py at repo root)
"""
from __future__ import annotations

import json
import logging

import joblib
from sklearn.metrics import accuracy_score, f1_score, roc_auc_score
from xgboost import XGBClassifier

from .config import settings
from .data_processing import FEATURE_COLUMNS, prepare_dataset

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


def train_and_save() -> dict:
    settings.MODEL_DIR.mkdir(parents=True, exist_ok=True)

    logger.info("Loading and preparing dataset from %s", settings.DATASET_PATH)
    dataset = prepare_dataset()

    model = XGBClassifier(
        n_estimators=200,
        max_depth=4,
        learning_rate=0.1,
        subsample=0.9,
        colsample_bytree=0.9,
        eval_metric="logloss",
        random_state=42,
    )

    logger.info("Training XGBoost classifier on %d samples", len(dataset.X_train))
    model.fit(dataset.X_train, dataset.y_train)

    y_pred = model.predict(dataset.X_test)
    y_proba = model.predict_proba(dataset.X_test)[:, 1]

    metrics = {
        "accuracy": float(accuracy_score(dataset.y_test, y_pred)),
        "f1_score": float(f1_score(dataset.y_test, y_pred)),
        "auc": float(roc_auc_score(dataset.y_test, y_proba)),
        "n_train": int(len(dataset.X_train)),
        "n_test": int(len(dataset.X_test)),
    }
    logger.info("Evaluation metrics: %s", metrics)

    joblib.dump(model, settings.MODEL_PATH)
    joblib.dump(dataset.encoders, settings.ENCODERS_PATH)

    metadata = {
        "feature_columns": FEATURE_COLUMNS,
        "model_type": "XGBClassifier",
        "metrics": metrics,
    }
    settings.METADATA_PATH.write_text(json.dumps(metadata, indent=2))

    logger.info("Saved model to %s", settings.MODEL_PATH)
    logger.info("Saved encoders to %s", settings.ENCODERS_PATH)
    logger.info("Saved metadata to %s", settings.METADATA_PATH)

    return metadata


if __name__ == "__main__":
    train_and_save()
