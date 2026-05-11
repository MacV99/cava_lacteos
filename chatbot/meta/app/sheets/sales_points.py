"""Puntos de venta desde Google Sheets."""
from app.config import settings
from app.sheets.client import get_spreadsheet


def get_sales_points_text() -> str:
    ws = get_spreadsheet().worksheet(settings.sheet_tab_sales_points)
    rows = ws.get_all_records()
    if not rows:
        return "Sin puntos de venta registrados."
    lines = []
    for row in rows:
        # TODO: ajustar columnas según el Sheet real
        name = row.get("Nombre") or row.get("nombre") or ""
        address = row.get("Direccion") or row.get("direccion") or ""
        schedule = row.get("Horario") or row.get("horario") or ""
        lines.append(f"- {name}: {address}. Horario: {schedule}".strip())
    return "\n".join(lines)
