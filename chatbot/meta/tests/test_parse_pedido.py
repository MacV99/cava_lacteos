"""Tests del parser de PEDIDO_CONFIRMADO (_parse_reply del orchestrator).

Cubre las variaciones que suele meter el LLM y que antes descartaban la orden en
silencio: tildes en las claves, markdown/viñetas, mayúsculas y total con formato.
"""
from app.bot.orchestrator import _parse_reply

_MSG = "¡Listo Miguel, pedido confirmado! 🙌\n\n🛒 Pedido:\n- 1 x Yogurt de Café 1 Litro"


def _block(nombre="miguel cuellar", tel="3172366425", dire="villa rosa cra43#20a-57",
           pago="efectivo", pedido="1 Yogurt de Café 1 Litro", total="29000",
           kt="telefono", kd="direccion", bullet="", msg=_MSG):
    return (
        f"PEDIDO_CONFIRMADO\n"
        f"{bullet}nombre: {nombre}\n"
        f"{bullet}{kt}: {tel}\n"
        f"{bullet}{kd}: {dire}\n"
        f"{bullet}pago: {pago}\n"
        f"{bullet}pedido: {pedido}\n"
        f"{bullet}total: {total}\n\n"
        f"{msg}"
    )


def test_bloque_limpio():
    es, datos, visible = _parse_reply(_block())
    assert es is True
    assert datos["nombre"] == "miguel cuellar"
    assert datos["telefono"] == "3172366425"
    assert datos["total"] == "29000"
    assert "PEDIDO_CONFIRMADO" not in visible
    assert visible.startswith("¡Listo Miguel")


def test_claves_con_tilde():
    # teléfono / dirección con tilde — el caso que descartaba la orden
    es, datos, _ = _parse_reply(_block(kt="teléfono", kd="dirección"))
    assert datos is not None
    assert datos["telefono"] == "3172366425"
    assert datos["direccion"] == "villa rosa cra43#20a-57"


def test_total_con_simbolo_y_miles():
    es, datos, _ = _parse_reply(_block(total="$29.000 COP"))
    assert datos["total"] == "29000"


def test_markdown_y_mayusculas():
    es, datos, visible = _parse_reply(_block(bullet="**", kt="Teléfono"))
    assert datos is not None
    assert datos["telefono"] == "3172366425"
    assert "PEDIDO_CONFIRMADO" not in visible


def test_sin_bloque_no_es_pedido():
    es, datos, visible = _parse_reply("¡Hola! ¿En qué te ayudo?")
    assert es is False
    assert datos is None
    assert visible == "¡Hola! ¿En qué te ayudo?"


def test_total_no_numerico_no_registra():
    es, datos, _ = _parse_reply(_block(total="pendiente"))
    assert es is True
    assert datos is None  # no se registra un pedido con total inválido
