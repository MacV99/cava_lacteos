"""Registro de pedidos en la hoja 'pedidos'.

Columnas: fecha | sender_id | nombre | telefono | direccion | pago | pedido | total
"""
from app.sheets.client import get_spreadsheet
from app.utils import bogota_time

_TAB = "pedidos"


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
    ws = get_spreadsheet().worksheet(_TAB)
    ws.append_row(
        [bogota_time.format(), sender_id, nombre, telefono, direccion, pago, pedido, total],
        value_input_option="USER_ENTERED",
    )
