"""
Centralized configuration for the HCXAI backend.

All secrets (e.g. DEEPSEEK_API_KEY) are read from environment variables only.
Never hardcode secrets here or log their values.
"""
import os
from pathlib import Path
from dotenv import load_dotenv

# Load a local .env file if present (values already in the environment take precedence)
BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_DIR.parent
load_dotenv(PROJECT_ROOT / ".env")


class Settings:
    # Dataset & model artifacts
    DATASET_PATH: str = os.getenv(
        "DATASET_PATH",
        str(PROJECT_ROOT / "loan_approval_dataset.csv"),
    )
    MODEL_DIR: Path = BACKEND_DIR / "models"
    # Versioned model artifacts (AI Model Center / Model Registry):
    # each training run writes to VERSIONS_DIR/<version_label>/{model.joblib,encoders.joblib}
    # and registers itself in the SQLite `model_versions` table (see app/model_registry.py).
    VERSIONS_DIR: Path = MODEL_DIR / "versions"
    # Legacy flat paths kept only for the one-time migration check in model_registry.py.
    MODEL_PATH: Path = MODEL_DIR / "loan_model.joblib"
    ENCODERS_PATH: Path = MODEL_DIR / "encoders.joblib"
    METADATA_PATH: Path = MODEL_DIR / "metadata.json"

    # Local persistence (SQLite file, no DB server required)
    DATA_DIR: Path = BACKEND_DIR / "data"
    SQLITE_PATH: Path = Path(os.getenv("SQLITE_PATH", str(DATA_DIR / "hcxai.db")))

    # DeepSeek LLM configuration
    DEEPSEEK_API_KEY: str | None = os.getenv("DEEPSEEK_API_KEY")
    DEEPSEEK_BASE_URL: str = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    DEEPSEEK_MODEL: str = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
    DEEPSEEK_MAX_TOKENS: int = int(os.getenv("DEEPSEEK_MAX_TOKENS", "400"))
    DEEPSEEK_TEMPERATURE: float = float(os.getenv("DEEPSEEK_TEMPERATURE", "0.3"))
    DEEPSEEK_TIMEOUT_SECONDS: float = float(os.getenv("DEEPSEEK_TIMEOUT_SECONDS", "20"))

    # API
    API_TITLE: str = "HCXAI Loan Approval Backend"
    API_VERSION: str = "0.1.0"

    # CORS: comma-separated list of allowed origins (frontend dev server, prod domain)
    CORS_ORIGINS: list[str] = [
        origin.strip()
        for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
        if origin.strip()
    ]

    @property
    def deepseek_enabled(self) -> bool:
        return bool(self.DEEPSEEK_API_KEY)


settings = Settings()
