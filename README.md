# HCXAI for Loan Approval

Enterprise-style Human-Centered Explainable AI (HCXAI) platform for intelligent
loan approval decisions. This repository contains:

- `HCXAI_PLATFORM_DESIGN.md` — the full enterprise design blueprint (architecture,
  AI Model Center, XAI/HCXAI Centers, fairness, frontend/backend design, etc.)
- `backend/` — a working FastAPI implementation: trains an XGBoost model on the
  provided dataset, explains individual predictions with SHAP, and generates
  natural-language, role-aware explanations via the **DeepSeek** LLM API.
- `loan_approval_dataset.csv` — the training dataset (4,269 loan applications).

## Architecture (implemented slice)

```
loan_approval_dataset.csv
        │
        ▼
data_processing.py  (clean + encode)
        │
        ▼
train_model.py  ──►  backend/models/*.joblib  (XGBoost model + encoders)
        │
        ▼
explainer.py  (SHAP TreeExplainer)
        │
        ▼
deepseek_client.py  (DeepSeek LLM narrative, role-aware, with template fallback)
        │
        ▼
main.py  (FastAPI: /health, /predict, /explain)
```

## Prerequisites

- [Miniconda/Anaconda](https://docs.conda.io/en/latest/miniconda.html)
- A DeepSeek API key (optional — the API gracefully falls back to a
  deterministic template explanation if not provided)

## Setup

```powershell
# 1. Create the conda environment
conda env create -f environment.yml
conda activate hcxai

# 2. Configure secrets
copy .env.example .env
# edit .env and set DEEPSEEK_API_KEY=sk-...
# (Alternatively, set DEEPSEEK_API_KEY as a system/user environment variable.)

# 3. Train the model (reads loan_approval_dataset.csv, writes backend/models/)
cd backend
python -m app.train_model

# 4. Run the API server
uvicorn app.main:app --reload --port 8000
```

The API docs are available at `http://127.0.0.1:8000/docs` (Swagger UI).

## API

### `GET /health`
Returns server status, whether the model is loaded, and whether DeepSeek is enabled.

### `POST /predict`
Body: loan application fields (see `backend/app/schemas.py::LoanApplicationRequest`).
Returns `approval_probability`, `risk_score`, `prediction`, `confidence`.

### `POST /explain`
Body: `{ "application": {...}, "role": "customer" | "loan_officer" | "risk_analyst" | "executive" }`
Returns the prediction, ranked SHAP feature contributions, and a DeepSeek-generated
natural-language narrative tailored to the requested role.

Example:
```powershell
curl -X POST http://127.0.0.1:8000/explain -H "Content-Type: application/json" -d "{\"application\": {\"no_of_dependents\":2,\"education\":\"Graduate\",\"self_employed\":\"No\",\"income_annum\":9600000,\"loan_amount\":29900000,\"loan_term\":12,\"cibil_score\":778,\"residential_assets_value\":2400000,\"commercial_assets_value\":17600000,\"luxury_assets_value\":22700000,\"bank_asset_value\":8000000}, \"role\": \"customer\"}"
```

## Model performance

Trained on an 80/20 split of `loan_approval_dataset.csv` (XGBoost classifier):

| Metric   | Value  |
|----------|--------|
| Accuracy | 0.984  |
| F1 Score | 0.987  |
| AUC      | 0.998  |

(See `backend/models/metadata.json` after training for the current run's numbers.)

## Testing

```powershell
cd backend
pytest -v
```

DeepSeek API calls are mocked in the test suite (no network dependency in CI).
The integration was manually verified against the live DeepSeek API.

## Security notes

- `DEEPSEEK_API_KEY` is read only from the environment (`.env` or system env var).
  It is never logged, hardcoded, or returned in any API response.
- Only anonymized feature names/values and SHAP numbers are sent to the LLM —
  no applicant PII.
- `.env` is gitignored; only `.env.example` (with empty values) is committed.

## Repository layout

```
demo_seminar1/
├── HCXAI_PLATFORM_DESIGN.md   # Full design document
├── loan_approval_dataset.csv  # Dataset
├── environment.yml            # Conda environment spec
├── .env.example                # Environment variable template
└── backend/
    ├── app/
    │   ├── config.py           # Settings (reads env vars)
    │   ├── data_processing.py  # Load/clean/encode dataset
    │   ├── train_model.py      # Model training script
    │   ├── explainer.py        # SHAP explanations
    │   ├── deepseek_client.py  # DeepSeek LLM narrative generation
    │   ├── schemas.py          # Pydantic request/response models
    │   └── main.py             # FastAPI app
    ├── tests/                  # pytest suite
    ├── models/                 # Trained model artifacts (gitignored)
    └── requirements.txt
```
