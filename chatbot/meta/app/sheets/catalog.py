"""Lectura del catálogo de productos desde Google Sheets."""
from app.config import settings
from app.sheets.client import get_spreadsheet


def get_catalog_text() -> str:
    """Retorna el catálogo como texto plano para incluir en el system prompt."""
    ws = get_spreadsheet().worksheet(settings.sheet_tab_catalog)
    rows = ws.get_all_records()
    if not rows:
        return "Sin productos disponibles."
    lines = []
    for row in rows:
        # TODO: ajustar nombres de columnas según el Sheet real
        name = row.get("Nombre") or row.get("nombre") or ""
        price = row.get("Precio") or row.get("precio") or ""
        desc = row.get("Descripcion") or row.get("descripcion") or ""
        lines.append(f"- {name}: ${price}. {desc}".strip(". "))
    return "\n".join(lines)
