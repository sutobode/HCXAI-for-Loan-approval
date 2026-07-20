"""Tests for Prediction Drift detection (backend/app/monitoring.py)."""
import importlib
import os

import pytest


@pytest.fixture()
def monitoring_env(tmp_path):
    os.environ["SQLITE_PATH"] = str(tmp_path / "test.db")

    from app import config as config_module

    importlib.reload(config_module)

    from app import db as db_module

    importlib.reload(db_module)
    db_module.init_db()

    from app import monitoring as monitoring_module

    importlib.reload(monitoring_module)

    yield monitoring_module, db_module

    del os.environ["SQLITE_PATH"]


def test_prediction_drift_insufficient_data_when_too_few_snapshots(monitoring_env):
    monitoring_module, db_module = monitoring_env
    db_module.save_prediction_snapshot("v1", 0.8)

    result = monitoring_module.detect_prediction_drift(window_size=50)
    assert result["status"] == "insufficient_data"


def test_prediction_drift_not_detected_for_stable_distribution(monitoring_env):
    monitoring_module, db_module = monitoring_env
    # Same distribution in both windows -> no drift
    for _ in range(20):
        db_module.save_prediction_snapshot("v1", 0.5)
        db_module.save_prediction_snapshot("v1", 0.52)

    result = monitoring_module.detect_prediction_drift(window_size=20)
    assert result["status"] == "ok"
    assert result["drift_detected"] is False


def test_prediction_drift_detected_for_shifted_distribution(monitoring_env):
    monitoring_module, db_module = monitoring_env
    # Prior window (older / second half inserted first): low probabilities
    for _ in range(20):
        db_module.save_prediction_snapshot("v1", 0.1)
    # Recent window (newer / most recent 20 rows): high probabilities
    for _ in range(20):
        db_module.save_prediction_snapshot("v2", 0.95)

    result = monitoring_module.detect_prediction_drift(window_size=20)
    assert result["status"] == "ok"
    assert result["drift_detected"] is True
    assert result["recent_window_mean"] > result["prior_window_mean"]
