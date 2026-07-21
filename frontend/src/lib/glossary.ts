/**
 * Từ điển thuật ngữ chuyên ngành AI/XAI/HCXAI dùng trong toàn bộ giao diện.
 *
 * Nguyên tắc: mỗi thuật ngữ kỹ thuật (SHAP, LIME, Model Registry, ...) vẫn
 * hiển thị đúng tên gốc bằng tiếng Anh (để người am hiểu nhận ra ngay và có
 * thể tra cứu tài liệu bên ngoài), nhưng đi kèm một chú giải ngắn bằng tiếng
 * Việt dễ hiểu, hiển thị qua tooltip khi hover/chạm vào (xem GlossaryTerm).
 * Đây là cách để một giao diện vừa "đúng chuẩn" với người chuyên môn, vừa
 * "không gây choáng" với người không có nền tảng kỹ thuật.
 */

export interface GlossaryEntry {
  /** Giải thích ngắn, 1-2 câu, không dùng thuật ngữ khác chưa giải thích. */
  short: string;
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  SHAP: {
    short:
      "Một phương pháp tính xem mỗi thông tin của hồ sơ (thu nhập, điểm tín dụng...) đã kéo quyết định về phía Duyệt hay Từ chối bao nhiêu.",
  },
  LIME: {
    short:
      "Một phương pháp giải thích độc lập khác, dùng để đối chiếu với SHAP — nếu hai phương pháp cho kết quả giống nhau, ta càng tin tưởng giải thích đó đúng.",
  },
  Counterfactual: {
    short:
      "Gợi ý những thay đổi nhỏ nhất trong hồ sơ (ví dụ tăng điểm tín dụng, giảm số tiền vay) có thể lật ngược kết quả từ Từ chối sang Được duyệt.",
  },
  CIBIL: {
    short:
      "Thang điểm tín dụng cá nhân (300–900), điểm càng cao thể hiện lịch sử trả nợ càng tốt.",
  },
  Stability: {
    short:
      "Đo xem giải thích có ổn định không — nếu số liệu hồ sơ chỉ thay đổi rất nhỏ mà giải thích thay đổi nhiều thì độ ổn định thấp, kém đáng tin.",
  },
  Completeness: {
    short:
      "Kiểm tra xem tổng mức ảnh hưởng của tất cả yếu tố có cộng lại đúng bằng chênh lệch giữa dự đoán và mức trung bình hay không — đảm bảo giải thích không thiếu sót.",
  },
  Sparsity: {
    short:
      "Đo xem giải thích có cô đọng không — một giải thích chỉ cần vài yếu tố chính dễ hiểu hơn một giải thích liệt kê hàng chục yếu tố nhỏ nhặt.",
  },
  "Model Registry": {
    short:
      "Nơi lưu trữ mọi phiên bản mô hình đã huấn luyện, kèm chỉ số đánh giá, để có thể so sánh và khôi phục phiên bản cũ khi cần.",
  },
  "Champion-Challenger": {
    short:
      "Cách so sánh mô hình đang dùng thật (Champion) với một mô hình mới thử nghiệm (Challenger) trước khi quyết định thay thế.",
  },
  "Trust Calibrator": {
    short:
      "Theo dõi xem một người dùng có đang tin AI đúng mức không — tin quá nhiều dù AI không chắc, hoặc luôn nghi ngờ dù AI rất chắc, đều là dấu hiệu cần điều chỉnh.",
  },
  "User Modeler": {
    short:
      "Xây dựng hồ sơ hiểu biết/kinh nghiệm của từng người dùng theo thời gian, để điều chỉnh cách hiển thị giải thích cho phù hợp.",
  },
  "Explanation Recommendation Engine": {
    short:
      "Bộ quy tắc quyết định nên hiển thị giải thích ở mức đơn giản hay chi tiết, có cần gợi ý thêm Counterfactual/hồ sơ tương tự hay không, dựa trên hồ sơ người dùng và độ phức tạp của quyết định.",
  },
  "Feature Drift": {
    short:
      "Cảnh báo khi các hồ sơ vay gần đây có đặc điểm khác đáng kể so với dữ liệu đã dùng để huấn luyện mô hình — có thể khiến mô hình kém chính xác hơn.",
  },
  "Prediction Drift": {
    short:
      "Cảnh báo khi kết quả dự đoán của mô hình gần đây (tỷ lệ duyệt/từ chối) thay đổi khác biệt so với trước, dù đặc điểm hồ sơ đầu vào có vẻ vẫn ổn định.",
  },
  "Four-Fifths Rule": {
    short:
      "Quy tắc kiểm tra công bằng: tỷ lệ duyệt của một nhóm không được thấp hơn 80% tỷ lệ duyệt của nhóm cao nhất, nếu không sẽ bị coi là có dấu hiệu thiên lệch.",
  },
  AUC: {
    short:
      "Một chỉ số đo khả năng phân biệt hồ sơ Được duyệt và Bị từ chối của mô hình, từ 0.5 (đoán ngẫu nhiên) đến 1.0 (phân biệt hoàn hảo).",
  },
  F1: {
    short:
      "Một chỉ số đánh giá tổng hợp giữa độ chính xác và độ đầy đủ của mô hình, càng gần 1.0 càng tốt.",
  },
  "Decision Provenance": {
    short:
      "Toàn bộ lịch sử nguồn gốc của một quyết định: hồ sơ gốc, phiên bản mô hình đã dùng, và mọi phản hồi con người đã ghi nhận sau đó.",
  },
};

export type GlossaryKey = keyof typeof GLOSSARY;
