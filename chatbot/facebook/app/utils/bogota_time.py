"""Helpers de fecha/hora en zona horaria de Bogotá (UTC-5).

Formato canónico para guardar en Sheets: "d/m/YYYY, h:MM:SS am/pm"
(p. ej. "4/5/2026, 10:58:52 am") — sin ceros a la izquierda en día/mes/hora.
"""
from datetime import datetime, timedelta, timezone

BOGOTA_TZ = timezone(timedelta(hours=-5))


def now() -> datetime:
    """Datetime actual en zona Bogotá (aware)."""
    return datetime.now(timezone.utc).astimezone(BOGOTA_TZ)


def format(dt: datetime | None = None) -> str:
    """Formatea un datetime al formato canónico Bogotá. Si dt es None usa ahora."""
    if dt is None:
        dt = now()
    elif dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc).astimezone(BOGOTA_TZ)
    else:
        dt = dt.astimezone(BOGOTA_TZ)
    # Construido manualmente para ser portable (Windows no soporta %-d/%-m/%-I).
    hour12 = dt.hour % 12 or 12
    am_pm = "am" if dt.hour < 12 else "pm"
    return f"{dt.day}/{dt.month}/{dt.year}, {hour12}:{dt.minute:02d}:{dt.second:02d} {am_pm}"


def parse(s: str) -> datetime | None:
    """Parsea el formato canónico ('d/m/YYYY, h:MM:SS a. m.'). Aware en BOGOTA_TZ."""
    if not s:
        return None
    try:
        # Normalizar variantes: "a. m.", "a.m.", "am" → "AM" (y "p. *" → "PM").
        marker = s.strip().lower()
        marker = marker.replace(" ", "").replace(".", "")
        if marker.endswith("am"):
            am_pm = "AM"
        elif marker.endswith("pm"):
            am_pm = "PM"
        else:
            return None
        # Quitar el sufijo del original para parsear la fecha+hora limpia.
        idx = s.lower().rfind(am_pm[0].lower())
        date_part = s[:idx].strip().rstrip(",").strip()
        if date_part.endswith(","):
            date_part = date_part[:-1].strip()
        dt = datetime.strptime(f"{date_part} {am_pm}", "%d/%m/%Y, %I:%M:%S %p")
        return dt.replace(tzinfo=BOGOTA_TZ)
    except (ValueError, TypeError):
        return None
