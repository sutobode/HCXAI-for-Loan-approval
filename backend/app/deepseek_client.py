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


# Categorical features are stored as their encoded 0/1 value (see
# data_processing.encode_features), which is meaningless to show raw in a
# narrative ("Trình độ học vấn (0.0)") -- so the template omits the number
# for these and states the direction only.
_CATEGORICAL_TEMPLATE_FEATURES = {"education", "self_employed"}


def _format_template_value(feature: str, value: float) -> str | None:
    """Vietnamese-style number formatting (dot thousands separator, no
    trailing .0), matching how the same figures are shown in the input form.
    Returns None for categorical features, whose encoded value isn't
    meaningful to display."""
    if feature in _CATEGORICAL_TEMPLATE_FEATURES:
        return None
    return f"{round(value):,}".replace(",", ".")


def build_template_explanation(prediction: dict, shap_result: dict, role: str) -> str:
    """Deterministic, no-LLM fallback explanation built directly from SHAP values."""
    top = shap_result["contributions"][:3]
    decision_vi = "Được duyệt" if prediction["prediction"] == "Approved" else "Bị từ chối"

    reason_parts = []
    for c in top:
        direction = "hỗ trợ việc duyệt" if c["shap_contribution"] > 0 else "làm giảm khả năng duyệt"
        formatted_value = _format_template_value(c["feature"], c["value"])
        if formatted_value is not None:
            reason_parts.append(f"{c['display_name']} ({formatted_value}) {direction}")
        else:
            reason_parts.append(f"{c['display_name']} {direction}")
    reasons = "; ".join(reason_parts)

    return (
        f"Kết quả dự đoán: {decision_vi} "
        f"(xác suất duyệt {prediction['approval_probability']:.0%}). "
        f"Các yếu tố chính: {reasons}."
    )


def generate_narrative_explanation(
    prediction: dict,
    shap_result: dict,
    role: str = "loan_officer",
    trust_intervention: str = "none",
) -> dict:
    """
    Call DeepSeek to turn SHAP contributions into a natural-language explanation.
    Falls back to a deterministic template if DeepSeek is unavailable or errors.

    If `trust_intervention` is not "none", an additional instruction is appended
    to the system prompt so the *content* of the explanation actually reflects
    the HCXAI Trust Calibrator's recommendation (not just a UI label).
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

    # HCXAI Trust Intervention: modify the LLM system prompt to produce
    # content that addresses the user's calibration gap, not just a UI nudge.
    if trust_intervention == "highlight_uncertainty":
        system_prompt += (
            "\n\nQUAN TRỌNG (Trust Calibrator): Người dùng này có xu hướng quá tin tưởng vào AI. "
            "Hãy NHẤN MẠNH giới hạn và mức độ không chắc chắn của mô hình trong giải thích: "
            "đề cập rõ ràng rằng mô hình có thể sai, chỉ ra trường hợp nào kết quả kém tin cậy, "
            "và khuyến khích người dùng xem xét thêm bằng chứng trước khi đồng ý."
        )
    elif trust_intervention == "highlight_evidence":
        system_prompt += (
            "\n\nQUAN TRỌNG (Trust Calibrator): Người dùng này thường không tin tưởng AI ngay cả "
            "khi độ tin cậy cao. Hãy BỔ SUNG thêm minh chứng hỗ trợ quyết định: trích dẫn "
            "nhiều yếu tố cùng chiều, nhấn mạnh mức độ rõ ràng của tín hiệu, và giúp người "
            "dùng thấy tại sao mô hình đáng tin cậy trong trường hợp cụ thể này."
        )

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


_INTERPRET_FALLBACK_NARRATIVE = (
    "Chưa thể tạo diễn giải bằng AI cho phần này lúc này (dịch vụ LLM không khả dụng). "
    "Vui lòng xem trực tiếp các số liệu kỹ thuật ở trên; các badge/chú thích (hình dấu hỏi) "
    "vẫn giải nghĩa từng thuật ngữ."
)


def interpret_technical_output(
    instruction: str,
    data_summary: str,
    max_tokens: int = 200,
) -> dict:
    """
    LLM như lớp dịch (KHÔNG phải tác nhân ra quyết định): nhận một `instruction`
    mô tả cần diễn giải gì, và `data_summary` là số liệu/kết quả kỹ thuật ĐÃ
    tính toán sẵn (không để LLM tự tính lại hay suy đoán ngoài phạm vi này).
    Dùng chung cho mọi endpoint "Diễn giải bằng AI" (LIME, Explanation Quality,
    Counterfactual, Fairness, Monitoring, Trust Dashboard, Override Analysis).

    Trả về cùng khuôn dạng với generate_narrative_explanation: {"narrative", "model"},
    fallback về một câu template tiếng Việt cố định nếu DeepSeek không khả dụng/lỗi.
    """
    client = _get_client()
    if client is None:
        return {"narrative": _INTERPRET_FALLBACK_NARRATIVE, "model": "template-fallback"}

    system_prompt = (
        "Bạn là trợ lý diễn giải kỹ thuật cho nhân viên ngân hàng không chuyên sâu về AI. "
        "Nhiệm vụ DUY NHẤT của bạn là dịch số liệu kỹ thuật đã cho thành 2-4 câu tiếng Việt "
        "dễ hiểu, KHÔNG tự suy luận thêm thông tin ngoài số liệu được cung cấp, KHÔNG đưa ra "
        "quyết định hay khuyến nghị nghiệp vụ mới. " + _VI_INSTRUCTION
    )
    user_prompt = f"{instruction}\n\nSố liệu:\n{data_summary}"

    try:
        response = client.chat.completions.create(
            model=settings.DEEPSEEK_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=max_tokens,
            temperature=settings.DEEPSEEK_TEMPERATURE,
            timeout=settings.DEEPSEEK_TIMEOUT_SECONDS,
        )
        narrative = response.choices[0].message.content.strip()
        return {"narrative": narrative, "model": settings.DEEPSEEK_MODEL}
    except (APIError, APITimeoutError) as exc:
        logger.warning("DeepSeek interpret call failed (%s); using template fallback", exc.__class__.__name__)
        return {"narrative": _INTERPRET_FALLBACK_NARRATIVE, "model": "template-fallback"}


def answer_question_about_prediction(
    prediction: dict,
    shap_result: dict,
    narrative: str,
    question: str,
) -> dict:
    """
    Chat hỏi-đáp theo ngữ cảnh: LLM CHỈ được trả lời dựa trên dữ liệu của
    chính hồ sơ này (prediction/shap/narrative đã lưu) -- không tự suy đoán
    thông tin ngoài phạm vi. Stateless theo từng câu hỏi (không lưu lịch sử
    hội thoại phía server).
    """
    client = _get_client()
    if client is None:
        return {
            "answer": "Chưa thể trả lời bằng AI lúc này (dịch vụ LLM không khả dụng). Vui lòng xem lại phần SHAP/narrative ở trên.",
            "model": "template-fallback",
        }

    contributions_text = "\n".join(
        f"- {c['display_name']}: value={c['value']}, shap={c['shap_contribution']:.3f}, direction={c['direction']}"
        for c in shap_result["contributions"]
    )
    system_prompt = (
        "Bạn là trợ lý trả lời câu hỏi về MỘT hồ sơ vay cụ thể, CHỈ dựa trên dữ liệu SHAP/"
        "narrative được cung cấp dưới đây. KHÔNG tự suy đoán thông tin không có trong dữ "
        "liệu, KHÔNG đưa ra quyết định hay khuyến nghị nghiệp vụ mới ngoài việc giải thích "
        "số liệu đã có. " + _VI_INSTRUCTION
    )
    user_prompt = (
        f"Kết quả: {prediction['prediction']} (xác suất {prediction['approval_probability']:.2%})\n"
        f"Narrative đã sinh trước đó: {narrative}\n"
        f"Toàn bộ yếu tố SHAP:\n{contributions_text}\n\n"
        f"Câu hỏi của nhân viên: {question}\n\n"
        "Trả lời trong tối đa 100 từ, chỉ dựa trên số liệu trên."
    )

    try:
        response = client.chat.completions.create(
            model=settings.DEEPSEEK_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=250,
            temperature=settings.DEEPSEEK_TEMPERATURE,
            timeout=settings.DEEPSEEK_TIMEOUT_SECONDS,
        )
        return {"answer": response.choices[0].message.content.strip(), "model": settings.DEEPSEEK_MODEL}
    except (APIError, APITimeoutError) as exc:
        logger.warning("DeepSeek ask call failed (%s); using template fallback", exc.__class__.__name__)
        return {
            "answer": "Chưa thể trả lời bằng AI lúc này (dịch vụ LLM không khả dụng). Vui lòng xem lại phần SHAP/narrative ở trên.",
            "model": "template-fallback",
        }
