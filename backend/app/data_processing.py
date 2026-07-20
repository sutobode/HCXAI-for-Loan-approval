"""
Data loading and preprocessing for the loan_approval_dataset.csv dataset.

The raw CSV has leading whitespace in column names and string values
(e.g. " Graduate", " Approved"), so everything is stripped on load.
"""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd
from sklearn.model_selection import train_test_split

from .config import settings

TARGET_COLUMN = "loan_status"
ID_COLUMN = "loan_id"
CATEGORICAL_COLUMNS = ["education", "self_employed"]
NUMERIC_COLUMNS = [
    "no_of_dependents",
    "income_annum",
    "loan_amount",
    "loan_term",
    "cibil_score",
    "residential_assets_value",
    "commercial_assets_value",
    "luxury_assets_value",
    "bank_asset_value",
]
FEATURE_COLUMNS = NUMERIC_COLUMNS + CATEGORICAL_COLUMNS


@dataclass
class Dataset:
    X_train: pd.DataFrame
    X_test: pd.DataFrame
    y_train: pd.Series
    y_test: pd.Series
    encoders: dict


def load_raw_dataframe(path: str | None = None) -> pd.DataFrame:
    """Load the CSV and normalize column names / string values."""
    csv_path = path or settings.DATASET_PATH
    df = pd.read_csv(csv_path)
    df.columns = [c.strip() for c in df.columns]

    for col in df.select_dtypes(include="object").columns:
        df[col] = df[col].astype(str).str.strip()

    return df


def encode_features(df: pd.DataFrame, encoders: dict | None = None) -> tuple[pd.DataFrame, dict]:
    """One-hot/ordinal-encode categorical columns. Reuses encoders if provided (inference time)."""
    encoders = encoders or {}
    df = df.copy()

    for col in CATEGORICAL_COLUMNS:
        if col not in encoders:
            categories = sorted(df[col].unique().tolist())
            encoders[col] = {cat: i for i, cat in enumerate(categories)}
        mapping = encoders[col]
        df[col] = df[col].map(mapping).fillna(-1).astype(int)

    return df, encoders


def prepare_dataset(path: str | None = None, test_size: float = 0.2, random_state: int = 42) -> Dataset:
    """Load, clean, encode, and split the dataset for training."""
    df = load_raw_dataframe(path)

    y = df[TARGET_COLUMN].map({"Approved": 1, "Rejected": 0})
    if y.isna().any():
        raise ValueError(f"Unexpected values in '{TARGET_COLUMN}' column, expected 'Approved'/'Rejected'")

    X = df[FEATURE_COLUMNS]
    X_encoded, encoders = encode_features(X)

    X_train, X_test, y_train, y_test = train_test_split(
        X_encoded, y, test_size=test_size, random_state=random_state, stratify=y
    )

    return Dataset(X_train=X_train, X_test=X_test, y_train=y_train, y_test=y_test, encoders=encoders)


def encode_single_application(payload: dict, encoders: dict) -> pd.DataFrame:
    """Turn a single API request payload into a model-ready single-row DataFrame."""
    row = {col: payload[col] for col in FEATURE_COLUMNS}
    df = pd.DataFrame([row])
    df, _ = encode_features(df, encoders=encoders)
    return df[FEATURE_COLUMNS]
