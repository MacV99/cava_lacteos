"""Registro de pedidos en la hoja 'pedidos'.

Columnas: fecha | sender_id | nombre | telefono | direccion | pago | pedido | total | plataforma
"""
from app.sheets.client import get_spreadsheet
from app.utils import bogota_time

_TAB = "pedidos"
_COLS = ["fecha", "sender_id", "nombre", "telefono", "direccion", "pago", "pedido", "total", "plataforma"]


def register_order(
    sender_id: str,
    nombre: str,
    telefono: str,
    direccion: str,
    pago: str,
    pedido: str,
    total: str,
    plataforma: str = "messenger",
    fecha: str | None = None,
) -> str:
    """Agrega una fila en pedidos. NO despacha — un asesor confirma después.

    `fecha` se puede pasar para compartir el MISMO timestamp con el write a Supabase
    (así la reconciliación deduplica por fecha+sender_id). Devuelve la fecha usada.
    """
    fecha = fecha or bogota_time.format()
    ws = get_spreadsheet().worksheet(_TAB)
    ws.append_row(
        [fecha, sender_id, nombre, telefono, direccion, pago, pedido, total, plataforma],
        value_input_option="USER_ENTERED",
    )
    return fecha


def read_all() -> list[dict]:
    """Lee todos los pedidos de la hoja (para reconciliar hacia Supabase).

    Tolera una fila de encabezado ('fecha' en la col 0) y filas con columnas faltantes.
    """
    ws = get_spreadsheet().worksheet(_TAB)
    rows: list[dict] = []
    for raw in ws.get_all_values():
        if not raw or not any(c.strip() for c in raw):
            continue
        if raw[0].strip().lower() == "fecha":  # encabezado
            continue
        vals = (raw + [""] * len(_COLS))[: len(_COLS)]
        row = dict(zip(_COLS, (v.strip() for v in vals)))
        if not row["sender_id"]:
            continue
        row["plataforma"] = row["plataforma"] or "messenger"  # filas viejas sin la col
        rows.append(row)
    return rows
