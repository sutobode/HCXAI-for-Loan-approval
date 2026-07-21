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

# All prompts require the response to be written in Vietnamese, since the
# platform's frontend is fully localized to Vietnamese. Domain-specific
# technical terms (SHAP, LIME, model/metric names, etc.) are explicitly
# allowed to stay in English within the Vietnamese text, matching the same
# convention used throughout the UI (Vietnamese prose, English jargon).
_VI_INSTRUCTION = (
    "Trả lời hoàn toàn bằng tiếng Việt. Các thuật ngữ chuyên ngành (ví dụ: SHAP, "
    "LIME, Counterfactual, CIBIL, tên các chỉ số mô hình) có thể giữ nguyên tiếng Anh, "
    "phần diễn giải còn lại phải bằng tiếng Việt tự nhiên, dễ hiểu."
)

ROLE_PROMPTS = {
    "customer": (
        "Bạn đang giải thích một quyết định vay cho khách hàng không có chuyên môn kỹ thuật. "
        "Dùng ngôn ngữ đơn giản, gần gũi, dễ hiểu, tránh thuật ngữ phức tạp. Tập trung vào "
        "2-3 yếu tố quan trọng nhất và đưa ra một gợi ý cụ thể, khả thi nếu hồ sơ bị từ chối. "
        + _VI_INSTRUCTION
    ),
    "loan_officer": (
        "Bạn đang báo cáo tóm tắt cho một chuyên viên tín dụng cần thông tin nhanh, tập trung "
        "vào rủi ro để hỗ trợ ra quyết định. Viết ngắn gọn và trích dẫn số liệu cụ thể. "
        + _VI_INSTRUCTION
    ),
    "risk_analyst": (
        "Bạn đang viết cho một chuyên viên phân tích rủi ro. Cung cấp tóm tắt chính xác, mang "
        "tính kỹ thuật, có trích dẫn độ lớn của SHAP contribution và cách các yếu tố tương tác "
        "với rủi ro. " + _VI_INSTRUCTION
    ),
    "executive": (
        "Bạn đang viết một đoạn tóm tắt ngắn cho cấp lãnh đạo. Tập trung vào tác động kinh "
        "doanh, không đi sâu vào chi tiết kỹ thuật. " + _VI_INSTRUCTION
    ),
}

_client: OpenAI | None = None


def _get_client() -> OpenAI | None:
    global _client
    if not settings.deepseek_enabled:
        return None
    if _client is None:
        # max_retries=0: the OpenAI SDK retries transient errors (including
        # connection/read timeouts) twice by default, which meant a single
        # unreachable-network call could block a request for
        # ~3 x DEEPSEEK_TIMEOUT_SECONDS before falling back to the template
        # explanation. We want a fast, predictable fallback instead.
        _client = OpenAI(
            api_key=settings.DEEPSEEK_API_KEY,
            base_url=settings.DEEPSEEK_BASE_URL,
            max_retries=0,
        )
    return _client


def build_template_explanation(prediction: dict, shap_result: dict, role: str) -> str:
    """Deterministic, no-LLM fallback explanation built directly from SHAP values."""
    top = shap_result["contributions"][:3]
    decision_vi = "Được duyệt" if prediction["prediction"] == "Approved" else "Bị từ chối"
    reasons = "; ".join(
        f"{c['display_name']} ({c['value']}) "
        f"{'hỗ trợ việc duyệt' if c['shap_contribution'] > 0 else 'làm giảm khả năng duyệt'}"
        for c in top
    )
    return (
        f"Kết quả dự đoán: {decision_vi} "
        f"(xác suất duyệt {prediction['approval_probability']:.0%}). "
        f"Các yếu tố chính: {reasons}."
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
        f"Kết quả dự đoán của mô hình: {prediction['prediction']} "
        f"(xác suất duyệt: {prediction['approval_probability']:.2%}, "
        f"độ tin cậy: {prediction['confidence']:.2%}).\n"
        "Các yếu tố ảnh hưởng chính (tên yếu tố, giá trị, mức ảnh hưởng SHAP, chiều ảnh hưởng):\n"
        + "\n".join(
            f"- {f['display_name']}: value={f['value']}, "
            f"shap={f['shap_contribution']:.3f}, direction={f['direction']}"
            for f in top_factors
        )
        + "\n\nViết một đoạn giải thích ngắn (tối đa 120 từ) CHỈ dựa trên các số liệu trên. "
        "Không tự thêm số liệu nào không được cung cấp."
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
