# HCXAI for Loan Approval

Enterprise-style Human-Centered Explainable AI (HCXAI) platform for intelligent
loan approval decisions. The platform's primary focus is **HCXAI** (human-centered
explainability: trust calibration, adaptive explanations, cognitive load
management, human-in/on-the-loop feedback), followed by **XAI** (SHAP, LIME,
counterfactuals, global explainability), with the underlying loan-approval
CRUD application as supporting infrastructure.

This repository contains:

- `HCXAI_PLATFORM_DESIGN.md` — the full enterprise design blueprint (architecture,
  AI Model Center, XAI/HCXAI Centers, fairness, frontend/backend design, etc.)
  Note: some infrastructure choices in that design document (PostgreSQL, Kafka,
  Celery, Kubernetes) were deliberately substituted for lighter-weight, no-external-
  server equivalents in the actual implementation — see "Deviations from the design
  document" below.
- `backend/` — a FastAPI + SQLite implementation covering the AI Model Center,
  Explainability Center (XAI), and Human-Centered XAI Center end to end.
- `frontend/` — a Next.js 15 + React 19 + TypeScript + Tailwind v4 + shadcn/ui
  enterprise dashboard consuming the backend API.
- `loan_approval_dataset.csv` — the training dataset (4,269 loan applications).

## Deviations from the design document

The design document specifies a full enterprise infrastructure stack
(PostgreSQL, Kafka, Celery, Redis, MinIO, Kubernetes, MLflow, Evidently AI,
Captum). This implementation deliberately substitutes lighter-weight
equivalents that require no external servers, per project constraints:

| Design doc component | Implemented as | Rationale |
|---|---|---|
| PostgreSQL | SQLite (`backend/app/db.py`) | Single-file, zero-server persistence; same logical schema (users, applications, predictions, feedback, trust events, user profiles, model versions, audit log). |
| Kafka / Celery | Synchronous FastAPI request handling | No message queue needed at this scale; training and drift checks run in-process. |
| MLflow / Weights & Biases | `backend/app/model_registry.py` + SQLite `model_versions` table | Versioned artifact storage + full evaluation metrics (confusion matrix, ROC/PR/calibration curves) without a separate tracking server. |
| Evidently AI | `backend/app/monitoring.py` | Feature drift (KS-test) + prediction drift (KS-test), computed in-process against the SQLite store. |
| Kubernetes / Docker Swarm | Local `uvicorn` / `npm run dev` processes | Out of scope for this demo; the FastAPI app is stateless and would containerize normally if needed. |
| Captum | **Not implemented — architecturally not applicable.** | Captum is a PyTorch/deep-learning attribution library. The trained model is an XGBoost gradient-boosted tree ensemble, not a neural network, so Captum does not apply. SHAP's `TreeExplainer` (exact, not approximate, for tree ensembles) is used instead and is the correct tool for this model family. |
| dice-ml (counterfactuals) | Self-written greedy coordinate-descent search (`backend/app/counterfactual.py`) | `dice-ml` pins `pandas<2.0`, which conflicts with and downgrades this project's pandas 2.2.3 and breaks the rest of the stack. The self-written search also fits tree ensembles better (piecewise-constant decision surface) than dice-ml's gradient-based default. |
| `lime` (PyPI package) | Self-written LIME-style local surrogate (`backend/app/lime_explainer.py`) | The `lime` package is unmaintained and pulls in scikit-image/matplotlib unnecessarily for a tabular-only use case. The core algorithm (weighted local linear surrogate via closed-form ridge regression) is reimplemented directly with numpy. |

## Architecture (implemented)

```
loan_approval_dataset.csv
        │
        ▼
data_processing.py  (clean + encode)
        │
        ▼
model_registry.py  ──►  backend/models/versions/<label>/  (versioned XGBoost model + encoders)
        │                        │
        │                        ▼
        │                SQLite: model_versions table (metrics, champion pointer)
        ▼
explainer.py  (SHAP TreeExplainer, loads active version from registry)
        │
        ├──► global_explainability.py   (aggregate SHAP feature importance)
        ├──► lime_explainer.py           (independent local linear surrogate)
        ├──► counterfactual.py           (self-written minimal-perturbation search)
        ├──► explanation_quality.py      (stability / completeness / sparsity metrics)
        ├──► fairness.py                 (demographic parity + 4/5 rule + mitigation recs)
        ├──► monitoring.py               (feature drift + prediction drift, KS-test)
        │
        ▼
hcxai.py  (Human-Centered XAI logic layer -- the core novel contribution)
        │  - User Modeler (cognitive profile from feedback history)
        │  - Trust Calibrator (agreement rate, trust state, trust trend)
        │  - Cognitive Load Adaptation (conflict/complexity-aware load estimate)
        │  - Explanation Recommendation Engine (detail level + modality + trust intervention)
        │  - Progressive Disclosure (summary / detailed / technical)
        ▼
deepseek_client.py  (DeepSeek LLM narrative, role-aware, with template fallback)
        │
        ▼
main.py  (FastAPI: ~35 endpoints across auth, predictions, XAI, HCXAI, fairness, monitoring, model registry, audit)
        │
        ▼
frontend/  (Next.js dashboard: Loan Queue, Explain flow, Trust Dashboard, Override
            Analysis, Fairness, Monitoring, AI Model Center, Audit Trail, What-If Lab,
            Similar Cases, Admin)
```

## Prerequisites

- [Miniconda/Anaconda](https://docs.conda.io/en/latest/miniconda.html)
- Node.js 20+ and npm (for the frontend)
- A DeepSeek API key (optional — the API gracefully falls back to a
  deterministic template explanation if not provided)

## Setup

### Backend

```powershell
# 1. Create the conda environment
#    IMPORTANT: this installs numpy/pandas/scipy/scikit-learn all via pip
#    wheels (not conda-forge) to avoid a BLAS/LAPACK backend conflict --
#    see the comments in environment.yml.
conda env create -f environment.yml
conda activate hcxai

# 2. Configure secrets
copy .env.example .env
# edit .env and set DEEPSEEK_API_KEY=sk-...
# (Alternatively, set DEEPSEEK_API_KEY as a system/user environment variable.)

# 3. Train the first model version (writes backend/models/versions/v1/,
#    registers it in the SQLite Model Registry, and activates it as champion)
cd backend
python -m app.model_registry

# 4. Run the API server
uvicorn app.main:app --reload --port 8000
```

The API docs are available at `http://127.0.0.1:8000/docs` (Swagger UI).

On first run, if no users exist, a default admin account is created
(`admin@hcxai.local` / `ChangeMe123!` by default, or from `DEFAULT_ADMIN_EMAIL`
/ `DEFAULT_ADMIN_PASSWORD` env vars). **Change this password immediately.**

### Frontend

```powershell
cd frontend
npm install
copy .env.local.example .env.local

npm run dev
```

Open `http://localhost:3000`.

## API overview

Full request/response schemas are in `backend/app/schemas.py` and browsable
live at `/docs`. Grouped by capability:

**Auth & RBAC**: `/auth/register`, `/auth/login`, `/auth/me`, `/auth/users`
(roles: `admin`, `risk_manager`, `loan_officer`, `customer`)

**Predictions**: `/predict`, `/explain`, `/predictions`, `/predictions/{id}`

**XAI (Explainability Center)**:
- `/explain/lime` — LIME-style local surrogate (independent cross-check vs. SHAP)
- `/explain/counterfactual` — minimal-change counterfactual search
- `/explain/global` — aggregate SHAP feature importance across the dataset
- `/explain/quality` — stability / completeness / sparsity metrics for one explanation

**HCXAI (Human-Centered XAI Center)**:
- `/trust/{user_id}` — Trust Dashboard (cognitive profile, trust calibration,
  trust trend, override direction, satisfaction)
- `/feedback` — Human Feedback Center (approve/reject/override + trust/confidence ratings)
- `/hcxai/override-analysis` — disagreement rate bucketed by AI confidence
- `/hcxai/satisfaction` — aggregate explanation satisfaction ratings
- `/hcxai/explanation-history/{user_id}` — every prediction a user has interacted with
- `/hcxai/provenance/{prediction_id}` — full decision lineage (application, model version, feedback)

**Fairness & Responsible AI**:
- `/fairness/report` — demographic parity + four-fifths rule check
- `/fairness/mitigation-recommendations` — threshold-adjustment recommendations
  (recommendation-only; requires human/compliance-officer approval to apply)

**Model Monitoring**:
- `/monitoring/snapshot` — training metrics + feature drift + prediction drift

**AI Model Center (Model Registry)**:
- `/model/versions`, `/model/versions/active` — list / get active model version
- `/model/train` (admin) — train a new version (Continuous Learning trigger)
- `/model/activate` (admin) — Champion-Challenger switch
- `/model/compare` — side-by-side metric comparison between two versions

**AI Governance**:
- `/audit` (admin) — paginated audit trail of platform actions

**Interactive tools**: `/whatif`, `/whatif/sensitivity`, `/similar-cases`

Example:
```powershell
curl -X POST http://127.0.0.1:8000/explain -H "Content-Type: application/json" -d "{\"application\": {\"no_of_dependents\":2,\"education\":\"Graduate\",\"self_employed\":\"No\",\"income_annum\":9600000,\"loan_amount\":29900000,\"loan_term\":12,\"cibil_score\":778,\"residential_assets_value\":2400000,\"commercial_assets_value\":17600000,\"luxury_assets_value\":22700000,\"bank_asset_value\":8000000}, \"role\": \"customer\", \"user_id\": \"demo@test.local\"}"
```

## Model performance

Trained on an 80/20 split of `loan_approval_dataset.csv` (XGBoost classifier):

| Metric   | Value  |
|----------|--------|
| Accuracy | 0.984  |
| F1 Score | 0.987  |
| AUC      | 0.998  |

Full metrics (confusion matrix, ROC curve, precision-recall curve, calibration
curve) are stored per model version and available via `GET /model/versions`.

## Testing

```powershell
cd backend
pytest -v
```

56 tests covering: auth/RBAC, data processing, the DeepSeek client (mocked,
no network dependency), the SHAP explainer, the Model Registry, all XAI
modules (global explainability, counterfactuals, LIME, explanation quality),
the HCXAI logic layer (cognitive load, explanation recommendation, trust
dashboard), the new database analytics functions, fairness mitigation, and
prediction drift detection.

The DeepSeek integration itself was additionally verified manually against
the live API; the test suite mocks it to avoid a network dependency in CI.

## Security notes

- `DEEPSEEK_API_KEY` and `JWT_SECRET_KEY` are read only from the environment
  (`.env` or system env var). Neither is ever logged, hardcoded, or returned
  in any API response.
- Only anonymized feature names/values and SHAP numbers are sent to the LLM —
  no applicant PII.
- Passwords are hashed with bcrypt; sessions use JWT bearer tokens with
  role-based access control enforced per-endpoint.
- `.env` is gitignored; only `.env.example` (with empty values) is committed.

## Repository layout

```
demo_seminar1/
├── HCXAI_PLATFORM_DESIGN.md   # Full design document (see "Deviations" above for scope actually implemented)
├── loan_approval_dataset.csv  # Dataset
├── environment.yml            # Conda environment spec (pip-only numeric stack -- see comments)
├── .env.example                # Environment variable template
├── backend/
│   ├── app/
│   │   ├── config.py               # Settings (reads env vars)
│   │   ├── db.py                   # SQLite persistence + HCXAI analytics queries
│   │   ├── auth.py                 # JWT auth + RBAC
│   │   ├── data_processing.py      # Load/clean/encode dataset
│   │   ├── model_registry.py       # AI Model Center: train/version/activate/compare
│   │   ├── explainer.py            # SHAP TreeExplainer (loads active model version)
│   │   ├── global_explainability.py# Aggregate SHAP feature importance
│   │   ├── lime_explainer.py       # Self-written LIME-style local surrogate
│   │   ├── counterfactual.py       # Self-written counterfactual search
│   │   ├── explanation_quality.py  # Stability / completeness / sparsity metrics
│   │   ├── hcxai.py                # Human-Centered XAI logic layer (core contribution)
│   │   ├── fairness.py             # Fairness report + bias mitigation recommendations
│   │   ├── monitoring.py           # Feature drift + prediction drift
│   │   ├── similar_cases.py        # Case-Based Reasoning / Similar Case Explorer
│   │   ├── whatif.py               # Interactive What-If Lab
│   │   ├── deepseek_client.py      # DeepSeek LLM narrative generation
│   │   ├── schemas.py              # Pydantic request/response models
│   │   └── main.py                 # FastAPI app (~35 endpoints)
│   ├── tests/                      # pytest suite (56 tests)
│   ├── models/                     # Trained model artifacts (gitignored)
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── app/(app)/               # Next.js pages: dashboard, applications, trust,
    │   │                            # hcxai/override-analysis, fairness, monitoring,
    │   │                            # model-center, admin/users, admin/audit, whatif,
    │   │                            # similar-cases
    │   ├── components/              # shadcn/ui-based component library + charts
    │   ├── lib/                     # api.ts, endpoints.ts, types.ts (typed API client)
    │   └── stores/                  # Zustand auth store
    └── package.json
```
