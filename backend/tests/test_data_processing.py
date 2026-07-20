from app.data_processing import (
    FEATURE_COLUMNS,
    encode_single_application,
    prepare_dataset,
)
from tests.conftest import SAMPLE_APPROVED_PAYLOAD


def test_prepare_dataset_shapes():
    dataset = prepare_dataset()
    assert len(dataset.X_train) > 0
    assert len(dataset.X_test) > 0
    assert set(dataset.X_train.columns) == set(FEATURE_COLUMNS)
    assert set(dataset.y_train.unique()) <= {0, 1}


def test_encode_single_application_uses_existing_encoders():
    dataset = prepare_dataset()
    df = encode_single_application(SAMPLE_APPROVED_PAYLOAD, dataset.encoders)
    assert list(df.columns) == FEATURE_COLUMNS
    assert df.iloc[0]["education"] == dataset.encoders["education"]["Graduate"]
    assert df.iloc[0]["self_employed"] == dataset.encoders["self_employed"]["No"]
