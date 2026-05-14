"""Operaciones sobre la hoja 'actividad'.

Columnas (en orden):
  A: sender_id | B: nombre | C: ultima_vez | D: historial | E: procesando | F: buffer | G: activado
"""
import json
import logging

import gspread

from app.sheets.client import get_spreadsheet

logger = logging.getLogger(__name__)

_TAB = "actividad"

# Índices de columna (1-based para gspread)
COL_SENDER_ID  = 1
COL_NOMBRE     = 2
COL_ULTIMA_VEZ = 3
COL_HISTORIAL  = 4
COL_PROCESANDO = 5
COL_BUFFER     = 6
COL_ACTIVADO   = 7

_ws_cache: gspread.Worksheet | None = None


def _ws() -> gspread.Worksheet:
    global _ws_cache
    if _ws_cache is None:
        _ws_cache = get_spreadsheet().worksheet(_TAB)
    return _ws_cache


def _find_row(ws: gspread.Worksheet, sender_id: str) -> int | None:
    """Retorna el número de fila (1-based) del sender_id, o None si no existe."""
    cell = ws.find(sender_id, in_column=COL_SENDER_ID)
    return cell.row if cell else None


def get_contact(sender_id: str) -> dict:
    """Retorna la fila como dict, o {} si no existe."""
    ws = _ws()
    row_num = _find_row(ws, sender_id)
    if row_num is None:
        return {}
    values = ws.row_values(row_num)
    # Pad to 7 cols
    while len(values) < 7:
        values.append("")
    return {
        "sender_id":  values[0],
        "nombre":     values[1],
        "ultima_vez": values[2],
        "historial":  values[3] or "[]",
        "procesando": values[4],
        "buffer":     values[5] or "[]",
        "activado":   values[6],
    }


def save_buffer(
    sender_id: str,
    nombre: str,
    buffer: list[str],
    procesando: str,
    ultima_vez: str = "",
    historial_json: str = "[]",
) -> None:
    """Actualiza (o crea) la fila con el buffer acumulado y el timestamp de procesando.

    Recibe ultima_vez e historial_json del caller (ya disponibles desde get_contact)
    para evitar releer la fila desde Sheets.
    """
    ws = _ws()
    row_num = _find_row(ws, sender_id)
    buffer_json = json.dumps(buffer, ensure_ascii=False)

    if row_num is not None:
        ws.update(
            [[sender_id, nombre, ultima_vez, historial_json, procesando, buffer_json, "TRUE"]],
            range_name=f"A{row_num}:G{row_num}",
        )
    else:
        ws.append_row(
            [sender_id, nombre, "", "[]", procesando, buffer_json, "TRUE"],
            value_input_option="USER_ENTERED",
        )


def update_after_response(
    sender_id: str,
    nombre: str,
    historial_json: str,
    ultima_vez: str,
) -> None:
    """Después de responder: guarda historial, limpia procesando y buffer."""
    ws = _ws()
    row_num = _find_row(ws, sender_id)
    if row_num is None:
        logger.warning("update_after_response: sender_id %s no encontrado", sender_id)
        return
    ws.update(
        [[sender_id, nombre, ultima_vez, historial_json, "", "[]", "TRUE"]],
        range_name=f"A{row_num}:G{row_num}",
    )


def clear_state(sender_id: str) -> None:
    """En caso de error: limpia procesando y buffer para no bloquear al usuario."""
    ws = _ws()
    row_num = _find_row(ws, sender_id)
    if row_num is None:
        return
    ws.batch_update([
        {"range": f"E{row_num}", "values": [[""]]},
        {"range": f"F{row_num}", "values": [["[]"]]},
    ])
