"""Pedidos del panel — persistencia SOLO en Supabase (tabla `pedidos`).

La IA concreta una venta → se escribe la tabla `pedidos` de Supabase, que es lo que
lee y edita el panel. Ya NO se escribe la hoja de Sheets (puente de migración retirado):
Supabase es la única fuente de verdad de los pedidos.

Tabla (en la Supabase de Cava):
  pedidos(id bigserial pk, created_at timestamptz default now(), sender_id, nombre,
          telefono, direccion, pago, pedido, total numeric, plataforma,
          estado text default 'pendiente', origen_key text)  -- estado ∈ {pendiente, despachado}
"""
import asyncio
import logging
import uuid

from app.whatsapp import supabase as sb

logger = logging.getLogger(__name__)

ESTADOS = {"pendiente", "despachado"}

# Campos que el panel puede editar de un pedido (los demás son inmutables).
CAMPOS_EDITABLES = {"nombre", "telefono", "direccion", "pago", "pedido", "total"}

# El free tier (Render/Supabase) puede dar timeouts transitorios por cold-start.
# Un insert perdido = pedido perdido, así que reintentamos con backoff.
_SAVE_RETRIES = 3


def _num_total(total) -> str | None:
    """Normaliza el total a algo que la columna `numeric` acepte.

    El LLM/panel manda cosas como "$41,000", "41.000", "$ 41000 COP". La columna es
    numeric → hay que dejar solo dígitos (COP no usa decimales). '' / sin dígitos → None (null).
    """
    dig = "".join(ch for ch in str(total or "") if ch.isdigit())
    return dig or None


def origen_key(plataforma: str, sender_id: str, fecha: str) -> str:
    """Llave natural de un pedido (idempotencia entre Sheets y Supabase).

    fecha (timestamp de Bogotá) + sender_id es único por pedido: un mismo cliente no
    concreta dos ventas en el mismo segundo. La comparten el write vivo y la reconciliación.
    """
    return f"{(plataforma or 'messenger').strip()}:{sender_id.strip()}:{fecha.strip()}"


async def save_order(
    sender_id: str,
    nombre: str,
    telefono: str,
    direccion: str,
    pago: str,
    pedido: str,
    total: str,
    plataforma: str = "messenger",
    key: str | None = None,
) -> bool:
    """Inserta un pedido en Supabase (best-effort, con reintentos). Sin Supabase, no-op.

    `key` es el origen_key (ver origen_key()); permite que la reconciliación no duplique
    este pedido después. Devuelve True si se guardó, False si se agotaron los reintentos.
    """
    if not sb.enabled:
        return False
    row = {
        "sender_id": sender_id, "nombre": nombre, "telefono": telefono,
        "direccion": direccion, "pago": pago, "pedido": pedido,
        "total": _num_total(total), "plataforma": plataforma, "estado": "pendiente",
    }
    if key:
        row["origen_key"] = key
    for attempt in range(1, _SAVE_RETRIES + 1):
        try:
            if await sb.insert("pedidos", row):
                return True
        except Exception as exc:  # httpx timeout/conexión (cold-start, etc.)
            logger.warning("save_order intento %d/%d falló: %s", attempt, _SAVE_RETRIES, exc)
        if attempt < _SAVE_RETRIES:
            await asyncio.sleep(0.6 * attempt)
    logger.error("save_order: pedido NO guardado en Supabase tras %d intentos: %s", _SAVE_RETRIES, row)
    return False


async def create_order(data: dict) -> bool:
    """Crea un pedido MANUAL desde el panel (no viene de la IA). Sin Supabase, no-op.

    plataforma='manual' y un origen_key único (uuid) para excluirlo de la adopción por
    contenido de reconcile_from_sheets (que solo debe tocar filas viejas sin key de Sheets).
    Devuelve True si se insertó.
    """
    if not sb.enabled:
        return False
    total = _num_total(data.get("total"))  # columna numérica: '' → null
    row = {
        "sender_id": "",  # pedido manual: no hay chat de origen
        "nombre": (data.get("nombre") or "").strip(),
        "telefono": (data.get("telefono") or "").strip(),
        "direccion": (data.get("direccion") or "").strip(),
        "pago": (data.get("pago") or "").strip(),
        "pedido": (data.get("pedido") or "").strip(),
        "total": total,
        "plataforma": "manual",
        "estado": "pendiente",
        "origen_key": "manual:" + uuid.uuid4().hex,
    }
    try:
        return await sb.insert("pedidos", row)
    except Exception as exc:
        logger.error("create_order: no se pudo crear pedido manual: %s", exc)
        return False


def _norm_estado(v) -> str:
    """Solo 2 estados. Filas viejas ('nuevo', 'cancelado') se pliegan a 'pendiente'."""
    return "despachado" if str(v or "").strip().lower() == "despachado" else "pendiente"


def _to_client(r: dict) -> dict:
    return {
        "id": r.get("id"), "createdAt": r.get("created_at"),
        "senderId": r.get("sender_id"), "nombre": r.get("nombre"),
        "telefono": r.get("telefono"), "direccion": r.get("direccion"),
        "pago": r.get("pago"), "pedido": r.get("pedido"), "total": r.get("total"),
        "plataforma": r.get("plataforma"), "estado": _norm_estado(r.get("estado")),
    }


async def list_orders(limit: int = 300) -> list[dict]:
    """Pedidos más recientes primero (para el panel). Sin Supabase, lista vacía."""
    if not sb.enabled:
        return []
    rows = await sb.select("pedidos", {"order": "created_at.desc", "limit": str(limit)})
    return [_to_client(r) for r in rows]


async def set_estado(order_id, estado: str) -> bool:
    """Cambia el estado de un pedido (pendiente/despachado)."""
    if not sb.enabled or estado not in ESTADOS:
        return False
    return await sb.update("pedidos", {"estado": estado}, {"id": order_id})


async def update_order(order_id, patch: dict) -> bool:
    """Edita campos de un pedido (nombre/telefono/direccion/pago/pedido/total).

    Filtra a CAMPOS_EDITABLES para no dejar tocar id/estado/plataforma/origen_key.
    """
    clean = {k: v for k, v in (patch or {}).items() if k in CAMPOS_EDITABLES}
    if "total" in clean:
        clean["total"] = _num_total(clean["total"])  # columna numeric: no aceptar "$41,000"
    if not sb.enabled or not clean:
        return False
    return await sb.update("pedidos", clean, {"id": order_id})


async def delete_order(order_id) -> bool:
    """Borra un pedido de Supabase. Sin Supabase, no-op."""
    if not sb.enabled:
        return False
    return await sb.delete("pedidos", {"id": order_id})
