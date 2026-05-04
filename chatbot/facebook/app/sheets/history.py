"""Historial de conversación por cliente (PSID) en Google Sheets."""
from datetime import datetime

from app.config import settings
from app.sheets.client import get_spreadsheet

MAX_HISTORY_TURNS = 10  # turnos (user + assistant = 1 turno)


def get_history(psid: str) -> list[dict]:
    """Retorna lista de mensajes [{role, content}, ...] para la llamada al LLM."""
    ws = get_spreadsheet().worksheet(settings.sheet_tab_history)
    rows = ws.get_all_records()
    # TODO: ajustar columnas según el Sheet real
    # Se asume: PSID | Rol | Contenido | Timestamp
    turns = [
        {"role": str(r.get("Rol", "")), "content": str(r.get("Contenido", ""))}
        for r in rows
        if str(r.get("PSID", "")) == psid
    ]
    return turns[-MAX_HISTORY_TURNS * 2 :]  # últimos N turnos completos


def append_turn(psid: str, role: str, content: str) -> None:
    """Agrega un turno al historial."""
    ws = get_spreadsheet().worksheet(settings.sheet_tab_history)
    ws.append_row(
        [psid, role, content, datetime.utcnow().isoformat()],
        value_input_option="USER_ENTERED",
    )
