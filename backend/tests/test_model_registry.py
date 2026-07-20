"""Tests for the AI Model Center's Model Registry (backend/app/model_registry.py)."""
import importlib

import pytest


@pytest.fixture(scope="module")
def registry_env(tmp_path_factory):
    """
    Isolated SQLite DB + model artifact dir for this test module, so training
    here does not interfere with other test modules' active model version.
    """
    tmp_path = tmp_path_factory.mktemp("model_registry_test")
    import os

    os.environ["SQLITE_PATH"] = str(tmp_path / "test.db")

    from app import config as config_module

    importlib.reload(config_module)
    # Redirect versioned artifact storage into the same isolated tmp dir
    config_module.settings.VERSIONS_DIR = tmp_path / "versions"
    config_module.settings.MODEL_DIR = tmp_path

    from app import db as db_module

    importlib.reload(db_module)
    db_module.init_db()

    from app import model_registry as registry_module

    importlib.reload(registry_module)

    yield registry_module, db_module

    del os.environ["SQLITE_PATH"]


def test_train_new_version_creates_registry_entry(registry_env):
    registry_module, db_module = registry_env
    result = registry_module.train_new_version(trained_by="pytest")

    assert result["version_label"] == "v1"
    assert result["is_active"] is True
    assert result["algorithm"] == "XGBClassifier"
    assert 0.0 <= result["metrics"]["accuracy"] <= 1.0
    assert "confusion_matrix" in result["metrics"]
    assert "roc_curve" in result["metrics"]
    assert "calibration_curve" in result["metrics"]


def test_second_version_gets_incremented_label_and_can_be_activated(registry_env):
    registry_module, db_module = registry_env
    v2 = registry_module.train_new_version(trained_by="pytest", activate=False)
    assert v2["version_label"] == "v2"
    assert v2["is_active"] is False

    # v1 should still be active since we passed activate=False
    active = db_module.get_active_model_version()
    assert active["version_label"] == "v1"

    activated = db_module.activate_model_version("v2")
    assert activated["is_active"] is True
    assert db_module.get_active_model_version()["version_label"] == "v2"
    # v1 should now be deactivated (champion-challenger switch is exclusive)
    v1_after = db_module.get_model_version_by_label("v1")
    assert v1_after["is_active"] is False


def test_compare_versions_reports_metric_deltas(registry_env):
    registry_module, _ = registry_env
    comparison = registry_module.compare_versions("v1", "v2")
    assert set(comparison["metric_deltas"].keys()) == {
        "accuracy",
        "precision",
        "recall",
        "f1_score",
        "auc",
    }
    assert "recommendation" in comparison


def test_compare_versions_raises_for_unknown_label(registry_env):
    registry_module, _ = registry_env
    with pytest.raises(ValueError):
        registry_module.compare_versions("v1", "v999")


def test_get_active_version_artifacts_loads_model_and_encoders(registry_env):
    registry_module, _ = registry_env
    model, encoders, version = registry_module.get_active_version_artifacts()
    assert model is not None
    assert isinstance(encoders, dict)
    assert version["version_label"] == "v2"
