# Vấn Đề Phát Hiện & Kế Hoạch Tiếp Theo

Cập nhật theo yêu cầu: **tập trung vào HCXAI, XAI, và Model AI** — tạm gác lại
các vấn đề bảo mật/vận hành thuần tuý (gộp xuống mục cuối, không ưu tiên xử
lý). Phần chính bên dưới là kết quả đọc kỹ trực tiếp code của các module lõi
(`hcxai.py`, `explainer.py`, `lime_explainer.py`, `counterfactual.py`,
`explanation_quality.py`, `global_explainability.py`, `model_registry.py`,
`monitoring.py`, `fairness.py`, `similar_cases.py`, `whatif.py`) — không chỉ
kiểm tra vận hành (chạy được/không chạy được) mà xét cả tính đúng đắn của
thuật toán.

---

## Bảng tóm tắt (HCXAI / XAI / Model AI)

| # | Vấn đề | Cấu phần | Mức độ |
|---|---|---|---|
| 1 | `composite_quality_score` tính sai — cộng trung bình một giá trị có thể âm (-1..1) như thể nó đã chuẩn hoá 0..1 | XAI — Explanation Quality | 🔴 Bug thật, có thể verify |
| 2 | Fairness Report chạy trên **toàn bộ dataset** (bao gồm cả phần model đã học), không phải riêng tập test như docstring khai báo | XAI/Model AI — Fairness | 🟠 Sai lệch phương pháp luận |
| 3 | Trường `role` trong `/explain` (giọng văn narrative) và `role` thật của tài khoản (RBAC) dùng chung tên nhưng khác tập giá trị → Trust Dashboard hiển thị nhầm | HCXAI — User Modeler | 🟡 Gây hiểu nhầm, không phải bug logic |
| 4 | Các ngưỡng heuristic của HCXAI (cognitive load, trust calibration) đều là hằng số tay, chưa từng được hiệu chỉnh (calibrate) trên dữ liệu thật | HCXAI | 🟡 Cơ hội cải thiện, không phải lỗi |
| 5 | Fairness chỉ phân tích 2 thuộc tính (`education`, `self_employed`), chưa so sánh mức độ bất công của **model** với mức bất công vốn có trong **nhãn gốc** | XAI — Fairness | 🟡 Thiếu chiều phân tích |

---

## 1. 🔴 `composite_quality_score` tính sai (Explanation Quality)

[explanation_quality.py:144-150](backend/app/explanation_quality.py#L144-L150):

```python
sub_scores = [
    stability["stability_score"] if stability["stability_score"] is not None else 0.5,
    1.0 if completeness["is_complete"] else 0.0,
    sparsity["concentration_ratio"],
]
composite = round(float(np.mean(sub_scores)), 4)
```

`stability_score` là **hệ số tương quan Spearman** giữa ranking gốc và ranking
sau nhiễu — miền giá trị hợp lệ là **`-1.0` đến `1.0`** (xem
[explanation_quality.py:75](backend/app/explanation_quality.py#L75) và các
ngưỡng phân loại `> 0.8` / `> 0.5` ở dòng 85-89, vốn giả định đúng thang -1..1
này). Nhưng khi ghép vào `composite_quality_score`, nó bị cộng trực tiếp với
hai giá trị *đã* chuẩn hoá 0..1 (`completeness`, `sparsity`) như thể cùng
thang đo. Hệ quả: nếu một giải thích bị đánh giá "unstable" với
`stability_score = -0.4`, composite có thể tụt xuống mức âm hoặc thấp bất
thường dù completeness/sparsity đều tốt — **điểm tổng hợp không phản ánh đúng
"trung bình 3 tiêu chí 0-1" như tên biến `composite_quality_score` ngụ ý**.

Test hiện tại ([test_xai_modules.py:124](backend/tests/test_xai_modules.py#L124))
assert `0.0 <= composite_quality_score <= 1.0` — assertion này **có thể fail**
với input khiến stability âm đủ mạnh; nó chỉ đang "may mắn" pass vì fixture
test hiện dùng không rơi vào trường hợp đó.

**Đề xuất fix**: chuẩn hoá về 0..1 trước khi đưa vào trung bình:
```python
normalized_stability = (stability["stability_score"] + 1) / 2 if stability["stability_score"] is not None else 0.5
```

---

## 2. 🟠 Fairness Report không thực sự chạy trên "held-out test split"

Docstring module ([fairness.py:5](backend/app/fairness.py#L5)):
> "Computes, **on the held-out test split**..."

Nhưng code thực tế ([fairness.py:41-51](backend/app/fairness.py#L41-L51)):
```python
raw_df = load_raw_dataframe()          # toàn bộ 4.269 dòng, KHÔNG lọc theo test split
encoded_df, _ = encode_features(raw_df[FEATURE_COLUMNS], encoders=explainer.encoders)
probabilities = explainer.model.predict_proba(encoded_df[FEATURE_COLUMNS])[:, 1]
```

`load_raw_dataframe()` nạp **toàn bộ dataset gốc**, bao gồm cả ~80% dữ liệu
model đã dùng để train. Điều này khiến:
- Tỷ lệ approval/fairness đo được bị ảnh hưởng bởi việc model đã "học thuộc"
  phần lớn dữ liệu này, không phản ánh đúng hành vi model trên dữ liệu chưa
  từng thấy.
- Không nhất quán với cách `model_registry._compute_rich_metrics` đánh giá
  accuracy/AUC/... (chỉ dùng `X_test`/`y_test`) — hai bộ số liệu "hiệu năng"
  và "công bằng" của cùng một model được đo trên hai tập dữ liệu khác nhau,
  không so sánh chéo được.

**Đề xuất fix**: đổi sang chỉ dùng phần test split (join lại `raw_df` với
`dataset.X_test.index` giống cách `similar_cases.py` đã làm), hoặc nếu việc
dùng toàn bộ dataset là cố ý (để có cỡ mẫu lớn hơn cho phân tích công bằng),
thì ít nhất cần sửa lại docstring cho khớp với thực tế và cân nhắc báo cáo cả
hai chỉ số (train-inclusive vs. test-only) để phân biệt rõ.

---

## 3. 🟡 Nhầm lẫn khái niệm "role" (narrative tone) vs "role" (RBAC)

`POST /explain` nhận một field `role` với 4 giá trị riêng
(`customer, loan_officer, risk_analyst, executive` — chỉ để chỉnh giọng văn
narrative), hoàn toàn khác với `role` thật của tài khoản trong RBAC (`admin,
risk_manager, loan_officer, customer`). Frontend mặc định luôn gửi
`role="loan_officer"` cho field này bất kể tài khoản đang đăng nhập là ai
([applications/new/page.tsx:57](frontend/src/app/(app)/applications/new/page.tsx#L57)).

Hệ quả quan sát được thực tế trong phiên demo: tài khoản
`bich.riskmanager@hcxai.local` (RBAC role = `risk_manager`) nhưng Trust
Dashboard hiển thị cognitive profile với `Role: Loan Officer` — vì
`user_profiles.role` được ghi từ field narrative-tone này (main.py gọi
`db.get_or_create_user_profile(user_id, role=request.role)` khi xử lý
`/explain`), không phải RBAC role thật. Không sai về mặt kỹ thuật (đúng như
code được viết ra), nhưng dễ gây hiểu nhầm khi đọc Trust Dashboard.

**Đề xuất**: hoặc (a) đổi tên field trong `ExplainRequest` từ `role` thành
`narrative_tone` để tránh trùng tên, hoặc (b) tự động lấy RBAC role của
`current_user` làm giá trị mặc định thay vì luôn "loan_officer".

---

## 4. 🟡 Ngưỡng heuristic HCXAI chưa được hiệu chỉnh trên dữ liệu thật

Cả `estimate_cognitive_load` ([hcxai.py:79-92](backend/app/hcxai.py#L79-L92))
và `get_trust_calibration` ([db.py:554-569](backend/app/db.py#L554-L569)) đều
tự thừa nhận trong comment: các hằng số (`SIMPLIFY_THRESHOLD=0.7`,
`OVER_TRUST_AGREEMENT_RATE=0.9`, v.v.) là "reasonable starting points", "chưa
tuned against real data". Đây không phải lỗi — là thiết kế minh bạch có chủ
đích (auditable heuristic thay vì black-box) — nhưng với 52+ hồ sơ demo vừa
seed, giờ đã có đủ dữ liệu thật đầu tiên để bắt đầu xem các ngưỡng này có tạo
ra hành vi hợp lý không (vd: `an.loanofficer` agreement 100% có thực sự nên
là "well_calibrated" thay vì "over_trust" không, khi agreement rate 100% >
ngưỡng 90%?).

**Gợi ý bước tiếp theo**: dùng chính dữ liệu 3 persona đã seed để viết một
vài "sanity check" thủ công — so khớp trust_state suy ra được với trực giác
(persona tin tưởng tuyệt đối có nên bị gắn cờ "over_trust" cảnh báo không,
thay vì mặc định "well_calibrated" nếu confidence trung bình các lần agree
>70%?).

---

## 5. 🟡 Fairness Report thiếu chiều so sánh với nhãn gốc

`compute_fairness_report` tính `overall_approval_rate_actual` nhưng **không
dùng nó** để so sánh — không trả lời được câu hỏi "model có khuếch đại thêm
bất công đã có sẵn trong nhãn gốc, hay chỉ tái tạo lại đúng mức bất công đó?"
Đây là một phân tích tiêu chuẩn trong fairness auditing (so `predicted parity
gap` với `actual/label parity gap`) mà hiện chưa có.

**Gợi ý**: thêm `parity_ratio` tính trên `actual_approved` song song với
`predicted_approved` cho mỗi attribute, để phân biệt rõ "bias từ dữ liệu" và
"bias model tự thêm vào".

---

## Kế hoạch đề xuất (ưu tiên HCXAI/XAI/Model AI)

1. **Fix chuẩn hoá `composite_quality_score`** (mục 1) — bug rõ ràng, effort
   nhỏ (~10 phút), nên làm trước tiên.
2. **Sửa Fairness Report dùng đúng test split** (mục 2) — hoặc sửa lại
   docstring nếu quyết định giữ nguyên hành vi dùng toàn bộ dataset; cả hai
   phương án đều effort nhỏ, nhưng cần bạn quyết định trước (giữ hành vi hiện
   tại có lý do gì không, hay đúng là sai sót).
3. **Thêm phân tích parity trên nhãn gốc** (mục 5) — mở rộng nhỏ, effort
   trung bình (~30-45 phút), nâng chất lượng Fairness Report.
4. **Đổi tên field `role` trong `ExplainRequest`** hoặc tự lấy RBAC role làm
   mặc định (mục 3) — effort nhỏ, cải thiện tính rõ ràng của Trust Dashboard.
5. **Sanity-check các ngưỡng HCXAI** với dữ liệu 3 persona đã seed (mục 4) —
   không phải "fix", mà là một buổi rà soát để quyết định có cần điều chỉnh
   ngưỡng hay không.

---

## Đã gác lại theo yêu cầu (không ưu tiên xử lý)

Các vấn đề bảo mật/vận hành đã phát hiện trước đó vẫn còn đó, chỉ tạm không
đưa vào kế hoạch chính:

- Thiếu kiểm tra quyền sở hữu ở 3 endpoint (`/trust/{user_id}`,
  `/hcxai/explanation-history/{user_id}`, `/hcxai/satisfaction`).
- DeepSeek API timeout ~60-70 giây mỗi lần gọi thật.
- `JWT_SECRET_KEY` chưa đặt trong `.env`.
- Audit Trail thiếu log cho 7 endpoint XAI/HCXAI.
- Console warning cosmetic (Base UI) trên Dashboard.
- Mật khẩu admin mặc định chưa đổi.

*(Nói khi nào muốn quay lại nhóm này.)*

---

## Việc đã hoàn thành trong phiên này (không cần lặp lại)

- Thêm `conda` vào PATH qua `conda init`.
- Viết `HUONG_DAN_SU_DUNG.md` — hướng dẫn sử dụng web đầy đủ theo từng trang.
- Seed 3 tài khoản demo hành vi khác nhau, 52 hồ sơ + feedback qua đúng API
  thật; kích hoạt dữ liệu thật cho toàn bộ 15 cấu phần XAI/HCXAI.
- Xác minh qua trình duyệt thật (Playwright).
- Đọc trực tiếp toàn bộ code các module HCXAI/XAI/Model AI, tìm ra 2 bug thật
  (mục 1, 2) + 3 điểm đáng cải thiện (mục 3-5).

**Lưu ý**: backend (`:8000`) và frontend (`:3000`) hiện đang chạy nền từ
phiên này.
