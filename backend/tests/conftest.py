"""Shared pytest fixtures."""
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

SAMPLE_APPROVED_PAYLOAD = {
    "no_of_dependents": 2,
    "education": "Graduate",
    "self_employed": "No",
    "income_annum": 9600000,
    "loan_amount": 29900000,
    "loan_term": 12,
    "cibil_score": 778,
    "residential_assets_value": 2400000,
    "commercial_assets_value": 17600000,
    "luxury_assets_value": 22700000,
    "bank_asset_value": 8000000,
}

SAMPLE_REJECTED_PAYLOAD = {
    "no_of_dependents": 0,
    "education": "Not Graduate",
    "self_employed": "Yes",
    "income_annum": 4100000,
    "loan_amount": 12200000,
    "loan_term": 8,
    "cibil_score": 417,
    "residential_assets_value": 2700000,
    "commercial_assets_value": 2200000,
    "luxury_assets_value": 8800000,
    "bank_asset_value": 3300000,
}
