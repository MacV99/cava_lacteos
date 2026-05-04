"""Registro de pedidos en la hoja 'pedidos'.

Columnas: fecha | sender_id | nombre | telefono | direccion | pago | pedido | total
"""
from datetime import datetime, timezone, timedelta

from app.sheets.client import get_spreadsheet

_TAB = "pedidos"
_BOGOTA_OFFSET = timedelta(hours=-5)


def register_order(
    sender_id: str,
    nombre: str,
    telefono: str,
    direccion: str,
    pago: str,
    pedido: str,
    total: str,
) -> None:
    """Agrega una fila en pedidos. NO despacha — un asesor confirma después."""
    bogota_now = datetime.now(timezone.utc).astimezone(timezone(_BOGOTA_OFFSET))
    fecha = bogota_now.strftime("%-d/%-m/%Y, %-I:%M:%S %p").lower()

    ws = get_spreadsheet().worksheet(_TAB)
    ws.append_row(
        [fecha, sender_id, nombre, telefono, direccion, pago, pedido, total],
        value_input_option="USER_ENTERED",
    )
