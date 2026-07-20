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
    MODEL_PATH: Path = MODEL_DIR / "loan_model.joblib"
    ENCODERS_PATH: Path = MODEL_DIR / "encoders.joblib"
    METADATA_PATH: Path = MODEL_DIR / "metadata.json"

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

    @property
    def deepseek_enabled(self) -> bool:
        return bool(self.DEEPSEEK_API_KEY)


settings = Settings()
