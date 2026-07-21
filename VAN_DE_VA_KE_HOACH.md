# Vấn Đề Phát Hiện & Kế Hoạch Tiếp Theo

Tổng hợp từ quá trình chạy thử, seed dữ liệu demo, và kiểm tra qua trình duyệt
thật trong phiên làm việc này. Xếp theo mức độ ưu tiên.

---

## Bảng tóm tắt

| # | Vấn đề | Mức độ | Effort ước tính |
|---|---|---|---|
| 1 | Thiếu kiểm tra quyền sở hữu ở 3 endpoint HCXAI (xem được dữ liệu cá nhân của user khác) | 🔴 Cao — lỗ hổng bảo mật | Nhỏ (~30-60 phút) |
| 2 | DeepSeek API timeout ~60-70 giây mỗi lần trước khi fallback | 🟠 Trung bình — ảnh hưởng trực tiếp UX | Cần điều tra trước, fix nhỏ |
| 3 | `JWT_SECRET_KEY` chưa đặt trong `.env` → mất phiên đăng nhập mỗi lần restart backend | 🟠 Trung bình | Rất nhỏ (~2 phút) |
| 4 | Audit Trail thiếu log cho 7 endpoint XAI/HCXAI | 🟡 Thấp — ảnh hưởng governance/compliance | Trung bình (~1-2 giờ) |
| 5 | Console warning `nativeButton` trên trang Dashboard | ⚪ Rất thấp — cosmetic | Nhỏ |
| 6 | Mật khẩu admin mặc định chưa đổi | 🟠 Trung bình — chỉ khi lên production | Tức thì |

---

## 1. 🔴 Thiếu kiểm tra quyền sở hữu (ownership check)

**3 endpoint cùng một lỗi**: chỉ yêu cầu "đã đăng nhập" (`require_authenticated`),
không kiểm tra `user_id` trong URL/query có phải là chính người gọi hay không.
Nghĩa là **bất kỳ ai đăng nhập** (kể cả role `customer`) đều gõ được email của
người khác và xem trọn dữ liệu cá nhân của họ.

- [main.py:356-359](backend/app/main.py#L356-L359) — `GET /trust/{user_id}`
- [main.py:507-513](backend/app/main.py#L507-L513) — `GET /hcxai/explanation-history/{user_id}`
- [main.py:498-504](backend/app/main.py#L498-L504) — `GET /hcxai/satisfaction?user_id=`

**Rủi ro thực tế**: một khách hàng (`customer`) có thể xem trust profile, lịch
sử giải thích, và rating hài lòng của một khách hàng khác chỉ bằng cách biết
email của họ.

**Đề xuất fix**: thêm điều kiện — cho phép nếu `current_user["role"] in
("admin", "risk_manager")` **hoặc** `current_user["email"] == user_id`; nếu
không, trả `403`.

---

## 2. 🟠 DeepSeek API timeout ~60-70 giây

Xác nhận trong log backend: mỗi lần gọi thật đến DeepSeek đều gặp
`httpcore.ReadTimeout` / `APIConnectionError`, retry 2 lần theo cơ chế mặc định
của OpenAI SDK, rồi mới fallback về template — tổng cộng **~60-70 giây chờ**
trước khi người dùng thấy kết quả trên trang **Submit Application**.

**Cần làm rõ trước khi fix**: đây là do mạng (không có đường ra internet tới
`api.deepseek.com` từ máy/mạng hiện tại), do `DEEPSEEK_API_KEY` sai/hết hạn,
hay do proxy/firewall công ty chặn. → Kiểm tra bằng `curl https://api.deepseek.com`
hoặc thử gọi trực tiếp bằng key trong `.env`.

**Fix tạm thời (không cần chờ điều tra mạng)**: giảm
`DEEPSEEK_TIMEOUT_SECONDS` (hiện mặc định 20s) và/hoặc giảm số lần retry của
OpenAI SDK (`max_retries=0` hoặc `1`) trong `deepseek_client.py`, để nếu
DeepSeek không phản hồi được thì fallback về template trong ~5-10s thay vì
60-70s — trải nghiệm người dùng tốt hơn nhiều ngay cả khi mạng vẫn có vấn đề.

---

## 3. 🟠 `JWT_SECRET_KEY` chưa đặt

Log backend mỗi lần khởi động đều cảnh báo:
> `JWT_SECRET_KEY not set in environment; generated an ephemeral key for this
> process.`

Hệ quả: **mỗi lần restart backend, toàn bộ user đang đăng nhập bị đăng xuất**
(token ký bằng key cũ không còn hợp lệ) — kể cả khi chưa hết hạn 8 giờ.

**Fix**: thêm 1 dòng vào `backend/.env`:
```
JWT_SECRET_KEY=<một chuỗi ngẫu nhiên dài, cố định>
```

---

## 4. 🟡 Audit Trail thiếu 7 endpoint

Sau khi chạy thử toàn bộ tính năng XAI (LIME, counterfactual, quality,
similar-cases, what-if, model compare, fairness mitigation), kiểm tra lại
`audit_log` chỉ thấy action `explain`, `login.*`, `model.train` — **7 endpoint
này không ghi audit log dù chạy thành công**:

`POST /explain/lime`, `POST /explain/counterfactual`, `POST /explain/quality`,
`POST /similar-cases`, `POST /whatif`, `POST /whatif/sensitivity`,
`POST /model/compare`, `GET /fairness/mitigation-recommendations`

Với một platform nhấn mạnh "AI Governance" (theo README), đây là khoảng trống
đáng vá trước khi coi Audit Trail là "đầy đủ".

**Fix**: thêm lời gọi `db.log_audit_event(...)` (pattern đã có sẵn ở các
endpoint khác trong `main.py`) vào 7 endpoint trên.

---

## 5. ⚪ Console warning cosmetic

Trang `/dashboard` phát sinh 3 warning từ thư viện Base UI:
> `A component that acts as a button expected a native <button>`

Không ảnh hưởng chức năng, chỉ là vấn đề accessibility nhỏ (nên dùng `<button>`
thật thay vì `render` prop tuỳ chỉnh). Ưu tiên thấp nhất trong danh sách.

---

## 6. 🟠 Mật khẩu admin mặc định

`admin@hcxai.local` / `ChangeMe123!` — README đã cảnh báo, chỉ cần lưu ý đổi
trước khi dùng ngoài môi trường demo/local.

---

## Kế hoạch đề xuất (theo thứ tự làm)

1. **Đặt `JWT_SECRET_KEY`** — 2 phút, không phụ thuộc gì, nên làm ngay.
2. **Vá 3 endpoint thiếu ownership check** (mục 1) — lỗ hổng bảo mật rõ ràng,
   nên ưu tiên trước khi chia sẻ demo cho người khác dùng thử.
3. **Điều tra + giảm timeout/retry DeepSeek** (mục 2) — ảnh hưởng trực tiếp
   trải nghiệm mỗi lần submit hồ sơ, nên xử lý sớm.
4. **Bổ sung audit log cho 7 endpoint** (mục 4) — không gấp, làm khi rảnh.
5. **Đổi mật khẩu admin** — làm ngay trước khi ngừng dùng tài khoản mặc định.
6. **(Tuỳ chọn) Sửa warning Base UI** — làm sau cùng, không ảnh hưởng chức năng.

---

## Việc đã hoàn thành trong phiên này (không cần lặp lại)

- Thêm `conda` vào PATH qua `conda init` (PowerShell, cmd, Bash).
- Viết `HUONG_DAN_SU_DUNG.md` — hướng dẫn sử dụng web đầy đủ theo từng trang.
- Seed 3 tài khoản demo với hành vi khác nhau (`an.loanofficer`,
  `bich.riskmanager`, `chi.customer` — mật khẩu chung `Demo12345!`), tổng 52
  hồ sơ + feedback qua đúng API thật.
- Kích hoạt dữ liệu thật cho toàn bộ 15 cấu phần XAI/HCXAI (SHAP, LIME,
  counterfactual, quality, similar-cases, what-if, global explainability,
  fairness, monitoring, model registry/compare, trust calibrator, user
  modeler, cognitive load, progressive disclosure, audit trail).
- Xác minh trực tiếp qua trình duyệt (Playwright): Trust Dashboard, Override
  Analysis, Loan Queue, Model Monitoring, Application Detail (LIME/CF/Quality)
  đều hiển thị đúng dữ liệu thật.

**Lưu ý**: backend (`:8000`) và frontend (`:3000`) hiện đang chạy nền từ
phiên này để phục vụ việc thử nghiệm trên.
