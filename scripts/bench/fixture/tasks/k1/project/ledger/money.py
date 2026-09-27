def format_cents(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    return f"{sign}${abs(cents) / 100:.2f}"


def parse_cents(text: str) -> int:
    cleaned = text.replace("$", "").replace(",", "").strip()
    if not cleaned:
        raise ValueError(f"Not an amount: {text}")
    try:
        value = float(cleaned)
    except ValueError as error:
        raise ValueError(f"Not an amount: {text}") from error
    return round(value * 100)
