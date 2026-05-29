from decimal import Decimal, ROUND_HALF_UP


def serialize_score(value: int | None) -> str | None:
    if value is None:
        return None
    return str(value)


def average_score_value(total_score: int, total_matches: int) -> Decimal:
    if total_matches <= 0:
        return Decimal(0)
    return Decimal(total_score) / Decimal(total_matches)


def serialize_average_score(total_score: int, total_matches: int) -> str:
    value = average_score_value(total_score, total_matches).quantize(
        Decimal("0.001"),
        rounding=ROUND_HALF_UP,
    )
    text = format(value, "f").rstrip("0").rstrip(".")
    if text in {"", "-0"}:
        return "0"
    return text
