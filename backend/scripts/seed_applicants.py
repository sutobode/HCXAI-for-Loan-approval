"""
Seed script: populates the `applicants` table (and one `applications` row
per applicant) from real rows of loan_approval_dataset.csv, so the frontend
Loan Queue has actual people to browse instead of forcing every loan
officer to hand-type a full application from scratch every time.

This directly closes the BA gap identified in review: the platform had no
persisted Applicant/Customer entity, so there was nothing to "load" into a
queue UI. Fictional Vietnamese names/phones/occupations are generated
locally (no PII, no external service) and attached to real historical
feature rows, so resulting predictions/explanations stay meaningful.

A configurable fraction of seeded applicants are immediately scored (their
application already has a prediction on file, like a returning customer),
while the rest are left un-scored ("Chờ chấm điểm") so the queue also shows
realistic pending work for a loan officer to act on.

Usage (from backend/ directory, inside the 'hcxai' conda env):
    python scripts/seed_applicants.py
    python scripts/seed_applicants.py --count 80 --scored-ratio 0.3
    python scripts/seed_applicants.py --reset          # wipe previously seeded demo data first
"""
from __future__ import annotations

import argparse
import random
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import db  # noqa: E402
from app.data_processing import FEATURE_COLUMNS, load_raw_dataframe  # noqa: E402

SURNAMES = [
    "Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Huỳnh", "Vũ", "Võ", "Phan",
    "Trương", "Bùi", "Đặng", "Đỗ", "Ngô", "Dương",
]
MIDDLE_MALE = ["Văn", "Hữu", "Đức", "Minh", "Quang", "Thành", "Công", "Anh", "Xuân"]
MIDDLE_FEMALE = ["Thị", "Ngọc", "Thu", "Kim", "Mỹ", "Thanh", "Diệu", "Bích"]
GIVEN_MALE = [
    "Nam", "Hùng", "Dũng", "Tuấn", "Long", "Phong", "Khải", "Bảo", "Hải",
    "Tùng", "Trung", "Kiên", "Quân", "Việt", "Sơn",
]
GIVEN_FEMALE = [
    "Lan", "Hương", "Trang", "Linh", "Mai", "Hoa", "Nga", "Nhi", "Anh",
    "Thảo", "Yến", "Vy", "Hạnh", "Phương", "Quỳnh",
]

OCCUPATIONS_SALARIED_GRAD = [
    "Kỹ sư phần mềm", "Kế toán viên", "Giáo viên trung học", "Chuyên viên ngân hàng",
    "Dược sĩ", "Kỹ sư xây dựng", "Chuyên viên nhân sự", "Chuyên viên marketing",
]
OCCUPATIONS_SALARIED_NONGRAD = [
    "Nhân viên bán hàng", "Thợ điện", "Lái xe công nghệ", "Nhân viên phục vụ",
    "Công nhân may", "Nhân viên kho vận", "Thợ sửa xe",
]
OCCUPATIONS_SELFEMPLOYED_GRAD = [
    "Chủ phòng khám tư", "Kiến trúc sư tự do", "Chủ văn phòng luật",
    "Chủ đại lý bảo hiểm", "Nhà thiết kế tự do",
]
OCCUPATIONS_SELFEMPLOYED_NONGRAD = [
    "Chủ tiệm tạp hóa", "Chủ quán ăn", "Buôn bán tự do", "Chủ tiệm sửa xe",
    "Chủ trang trại nhỏ",
]

PHONE_PREFIXES = [
    "032", "033", "034", "035", "036", "037", "038", "039",
    "070", "076", "077", "078", "079",
    "081", "082", "083", "084", "085", "086", "088", "089",
    "090", "091", "092", "093", "094", "096", "097", "098", "099",
]


def _random_name(rng: random.Random) -> str:
    surname = rng.choice(SURNAMES)
    is_female = rng.random() < 0.5
    middle = rng.choice(MIDDLE_FEMALE if is_female else MIDDLE_MALE)
    given = rng.choice(GIVEN_FEMALE if is_female else GIVEN_MALE)
    return f"{surname} {middle} {given}"


def _random_phone(rng: random.Random) -> str:
    prefix = rng.choice(PHONE_PREFIXES)
    rest = "".join(str(rng.randint(0, 9)) for _ in range(7))
    return f"{prefix}{rest}"


def _occupation_for(education: str, self_employed: str, rng: random.Random) -> str:
    if self_employed.strip() == "Yes":
        pool = OCCUPATIONS_SELFEMPLOYED_GRAD if education.strip() == "Graduate" else OCCUPATIONS_SELFEMPLOYED_NONGRAD
    else:
        pool = OCCUPATIONS_SALARIED_GRAD if education.strip() == "Graduate" else OCCUPATIONS_SALARIED_NONGRAD
    return rng.choice(pool)


def _strip_diacritics(text: str) -> str:
    text = text.replace("đ", "d").replace("Đ", "D")
    normalized = unicodedata.normalize("NFD", text)
    return "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")


def _email_for(full_name: str, index: int) -> str:
    ascii_name = _strip_diacritics(full_name).lower().replace(" ", ".")
    return f"{ascii_name}.{index}@example.com"


def _to_native(value):
    """Convert numpy scalar types to plain Python types for JSON serialization."""
    return value.item() if hasattr(value, "item") else value


def reset_seeded_data() -> None:
    """
    Remove previously seeded demo applicants + their applications/predictions
    only. Ad-hoc applications submitted manually (applicant_id IS NULL) are
    never touched by this, so re-running the seed script is always safe for
    real usage data accumulated during a demo session.
    """
    with db.get_connection() as conn:
        conn.execute(
            """DELETE FROM predictions WHERE application_id IN (
                   SELECT id FROM applications WHERE applicant_id IS NOT NULL
               )"""
        )
        conn.execute("DELETE FROM applications WHERE applicant_id IS NOT NULL")
        conn.execute("DELETE FROM applicants")
    print("Cleared previously seeded applicants, their applications, and predictions.")


def seed(count: int, scored_ratio: float, seed_value: int) -> None:
    db.init_db()
    rng = random.Random(seed_value)

    df = load_raw_dataframe()
    if count > len(df):
        raise ValueError(f"Requested {count} applicants but the dataset only has {len(df)} rows")

    sample = df.sample(n=count, random_state=seed_value).reset_index(drop=True)

    explainer = None
    encode_single_application = None
    n_scored = 0

    for i, row in sample.iterrows():
        full_name = _random_name(rng)
        phone = _random_phone(rng)
        occupation = _occupation_for(row["education"], row["self_employed"], rng)
        email = _email_for(full_name, i)

        applicant = db.create_applicant(
            full_name=full_name,
            phone=phone,
            email=email,
            occupation=occupation,
        )

        features = {col: _to_native(row[col]) for col in FEATURE_COLUMNS}
        application_id = db.save_application(features, applicant_id=applicant["id"])

        if rng.random() < scored_ratio:
            if explainer is None:
                from app.explainer import get_explainer
                from app.data_processing import encode_single_application as _encode

                explainer = get_explainer()
                encode_single_application = _encode

            features_df = encode_single_application(features, explainer.encoders)
            prediction = explainer.predict(features_df)
            shap_result = explainer.explain(features_df)
            db.save_prediction(
                application_id,
                prediction,
                shap_result,
                model_version=explainer.version_label,
            )
            n_scored += 1

    print(
        f"Seeded {count} applicants: {n_scored} already scored (returning customer), "
        f"{count - n_scored} pending review (chờ chấm điểm)."
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--count", type=int, default=60, help="Number of applicants to seed (default: 60)")
    parser.add_argument(
        "--scored-ratio",
        type=float,
        default=0.35,
        help="Fraction of applicants to score immediately, as if returning customers (default: 0.35)",
    )
    parser.add_argument("--seed", type=int, default=42, help="Random seed for reproducibility (default: 42)")
    parser.add_argument(
        "--reset", action="store_true", help="Delete previously seeded applicants/applications/predictions first"
    )
    args = parser.parse_args()

    if args.reset:
        reset_seeded_data()

    seed(args.count, args.scored_ratio, args.seed)


if __name__ == "__main__":
    main()
