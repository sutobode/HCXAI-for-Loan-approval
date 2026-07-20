"""
DeepSeek LLM client for generating human-readable, role-aware explanations
from SHAP feature attributions.

Security notes:
- The API key is read exclusively from the DEEPSEEK_API_KEY environment
  variable via `settings.DEEPSEEK_API_KEY`. It is never logged or returned
  in any API response.
- Only anonymized feature names/values and SHAP numbers are sent to the
  LLM. No applicant PII (name, id, address, etc.) is included in prompts.
- If the API key is missing or the call fails, callers should fall back to
  `build_template_explanation` so the system keeps working without DeepSeek.
"""
from __future__ import annotations

import logging

from openai import APIError, APITimeoutError, OpenAI

from .config import settings

logger = logging.getLogger(__name__)

ROLE_PROMPTS = {
    "customer": (
        "You are explaining a loan decision to a non-technical bank customer. "
        "Use simple, warm, plain language. Avoid jargon. Focus on the top 2-3 "
        "factors and give one concrete, actionable suggestion if the loan was rejected."
    ),
    "loan_officer": (
        "You are briefing a loan officer who needs a quick, risk-focused summary "
        "to support their decision. Be concise and reference the concrete numbers."
    ),
    "risk_analyst": (
        "You are writing for a risk analyst. Provide a precise, technical summary "
        "referencing SHAP contribution magnitudes and how features interact with risk."
    ),
    "executive": (
        "You are writing a one-paragraph executive summary. Focus on business impact, "
        "not technical detail."
    ),
}

_client: OpenAI | None = None


def _get_client() -> OpenAI | None:
    global _client
    if not settings.deepseek_enabled:
        return None
    if _client is None:
        _client = OpenAI(api_key=settings.DEEPSEEK_API_KEY, base_url=settings.DEEPSEEK_BASE_URL)
    return _client


def build_template_explanation(prediction: dict, shap_result: dict, role: str) -> str:
    """Deterministic, no-LLM fallback explanation built directly from SHAP values."""
    top = shap_result["contributions"][:3]
    reasons = "; ".join(
        f"{c['display_name']} ({c['value']}) {'helped' if c['shap_contribution'] > 0 else 'hurt'} approval"
        for c in top
    )
    return (
        f"Prediction: {prediction['prediction']} "
        f"(approval probability {prediction['approval_probability']:.0%}). "
        f"Main factors: {reasons}."
    )


def generate_narrative_explanation(prediction: dict, shap_result: dict, role: str = "loan_officer") -> dict:
    """
    Call DeepSeek to turn SHAP contributions into a natural-language explanation.
    Falls back to a deterministic template if DeepSeek is unavailable or errors.
    """
    client = _get_client()
    if client is None:
        logger.info("DEEPSEEK_API_KEY not set; using template fallback explanation")
        return {
            "narrative": build_template_explanation(prediction, shap_result, role),
            "model": "template-fallback",
            "cached": False,
        }

    system_prompt = ROLE_PROMPTS.get(role, ROLE_PROMPTS["loan_officer"])
    top_factors = shap_result["contributions"][:5]

    user_prompt = (
        f"Model prediction: {prediction['prediction']} "
        f"(approval probability: {prediction['approval_probability']:.2%}, "
        f"confidence: {prediction['confidence']:.2%}).\n"
        "Top contributing factors (feature, value, SHAP contribution, direction):\n"
        + "\n".join(
            f"- {f['display_name']}: value={f['value']}, "
            f"shap={f['shap_contribution']:.3f}, direction={f['direction']}"
            for f in top_factors
        )
        + "\n\nWrite a short explanation (max 120 words) using ONLY the numbers above. "
        "Do not invent any figures not provided."
    )

    try:
        response = client.chat.completions.create(
            model=settings.DEEPSEEK_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=settings.DEEPSEEK_MAX_TOKENS,
            temperature=settings.DEEPSEEK_TEMPERATURE,
            timeout=settings.DEEPSEEK_TIMEOUT_SECONDS,
        )
        narrative = response.choices[0].message.content.strip()
        return {"narrative": narrative, "model": settings.DEEPSEEK_MODEL, "cached": False}

    except (APIError, APITimeoutError) as exc:
        logger.warning("DeepSeek API call failed (%s); using template fallback", exc.__class__.__name__)
        return {
            "narrative": build_template_explanation(prediction, shap_result, role),
            "model": "template-fallback",
            "cached": False,
        }
