"""Pedidos del panel — persistencia en Supabase (migración gradual desde Sheets).

Primer paso de la migración Sheets → Supabase: los pedidos que la IA concreta se
muestran en el panel. El bot SIGUE escribiendo en la hoja `pedidos`
(`app/sheets/orders.py`); además hace write-through a la tabla `pedidos` de Supabase,
que es lo que lee el panel. Cuando Sheets se retire, esta será la única fuente.

Tabla (crear en la Supabase de Cava, SQL en el README/instrucciones):
  pedidos(id bigserial pk, created_at timestamptz default now(), sender_id, nombre,
          telefono, direccion, pago, pedido, total numeric, plataforma,
          estado text default 'nuevo')  -- estado ∈ {nuevo, despachado, cancelado}
"""
import logging

from app.whatsapp import supabase as sb

logger = logging.getLogger(__name__)

ESTADOS = {"nuevo", "despachado", "cancelado"}


async def save_order(
    sender_id: str,
    nombre: str,
    telefono: str,
    direccion: str,
    pago: str,
    pedido: str,
    total: str,
    plataforma: str = "messenger",
) -> None:
    """Inserta un pedido en Supabase (best-effort). Sin Supabase, no-op."""
    if not sb.enabled:
        return
    await sb.insert("pedidos", {
        "sender_id": sender_id, "nombre": nombre, "telefono": telefono,
        "direccion": direccion, "pago": pago, "pedido": pedido,
        "total": total, "plataforma": plataforma,
    })


def _to_client(r: dict) -> dict:
    return {
        "id": r.get("id"), "createdAt": r.get("created_at"),
        "senderId": r.get("sender_id"), "nombre": r.get("nombre"),
        "telefono": r.get("telefono"), "direccion": r.get("direccion"),
        "pago": r.get("pago"), "pedido": r.get("pedido"), "total": r.get("total"),
        "plataforma": r.get("plataforma"), "estado": r.get("estado") or "nuevo",
    }


async def list_orders(limit: int = 300) -> list[dict]:
    """Pedidos más recientes primero (para el panel). Sin Supabase, lista vacía."""
    if not sb.enabled:
        return []
    rows = await sb.select("pedidos", {"order": "created_at.desc", "limit": str(limit)})
    return [_to_client(r) for r in rows]


async def set_estado(order_id, estado: str) -> bool:
    """Cambia el estado de un pedido (nuevo/despachado/cancelado)."""
    if not sb.enabled or estado not in ESTADOS:
        return False
    await sb.update("pedidos", {"estado": estado}, {"id": order_id})
    return True
