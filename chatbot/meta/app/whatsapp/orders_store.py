"""Pedidos del panel — persistencia en Supabase (migración gradual desde Sheets).

Primer paso de la migración Sheets → Supabase: los pedidos que la IA concreta se
muestran en el panel. El bot SIGUE escribiendo en la hoja `pedidos`
(`app/sheets/orders.py`); además hace write-through a la tabla `pedidos` de Supabase,
que es lo que lee el panel. Cuando Sheets se retire, esta será la única fuente.

Tabla (crear en la Supabase de Cava, SQL en el README/instrucciones):
  pedidos(id bigserial pk, created_at timestamptz default now(), sender_id, nombre,
          telefono, direccion, pago, pedido, total numeric, plataforma,
          estado text default 'pendiente')  -- estado ∈ {pendiente, despachado}
"""
import asyncio
import logging
import uuid

from app.sheets import orders as sheets_orders
from app.whatsapp import supabase as sb

logger = logging.getLogger(__name__)

ESTADOS = {"pendiente", "despachado"}

# Campos que el panel puede editar de un pedido (los demás son inmutables).
CAMPOS_EDITABLES = {"nombre", "telefono", "direccion", "pago", "pedido", "total"}

# El free tier (Render/Supabase) puede dar timeouts transitorios por cold-start.
# Un pedido perdido diverge el panel de Sheets, así que reintentamos con backoff.
_SAVE_RETRIES = 3


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
        "total": total, "plataforma": plataforma, "estado": "pendiente",
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
    total = (str(data.get("total") or "").strip()) or None  # columna numérica: '' → null
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


def _tuple(sender_id, telefono, pedido, total) -> tuple:
    """Firma de contenido para adoptar filas viejas (pre-origen_key) sin duplicarlas.

    No incluye plataforma: el sender_id (PSID) ya es único por plataforma, y así se
    evita un falso duplicado si el valor de plataforma difiere entre Sheets y Supabase.
    """
    dig = "".join(ch for ch in str(total) if ch.isdigit())
    return (str(sender_id).strip(), str(telefono).strip(), str(pedido).strip(), dig)


async def reconcile_from_sheets() -> int:
    """Red de seguridad: reintegra a Supabase cualquier pedido que quedó solo en Sheets.

    Idempotente por origen_key. Corre en un job del scheduler. Devuelve cuántos pedidos
    backfilleó (insertó o adoptó).

    ⚠️ PUENTE DE MIGRACIÓN — BORRAR junto con la hoja `pedidos` de Sheets (ver CLAUDE.md,
    Fase 2). Sin Sheets, esta red de seguridad ya no aplica.
    """
    if not sb.enabled:
        return 0
    sheet_rows = await asyncio.to_thread(sheets_orders.read_all)
    if not sheet_rows:
        return 0
    existing = await sb.select("pedidos", {
        "select": "id,sender_id,telefono,pedido,total,plataforma,origen_key", "limit": "10000",
    })
    have_keys = {r["origen_key"] for r in existing if r.get("origen_key")}
    # Pool de filas viejas (sin key) agrupadas por contenido → para adoptar sin duplicar.
    # Solo-migración: el write vivo ya setea origen_key, así que estas filas solo existen
    # de ANTES de este deploy. Tras la 1ª reconciliación queda vacío y la rama de adopción
    # no vuelve a dispararse (auto-dormante).
    legacy: dict[tuple, list] = {}
    for r in existing:
        if not r.get("origen_key"):
            legacy.setdefault(_tuple(r.get("sender_id"), r.get("telefono"), r.get("pedido"),
                                     r.get("total")), []).append(r["id"])

    backfilled = 0
    for row in sheet_rows:
        key = origen_key(row["plataforma"], row["sender_id"], row["fecha"])
        if key in have_keys:
            continue
        sig = _tuple(row["sender_id"], row["telefono"], row["pedido"], row["total"])
        if legacy.get(sig):
            adopt_id = legacy[sig].pop()  # adopta una fila vieja equivalente
            try:
                await sb.update("pedidos", {"origen_key": key}, {"id": adopt_id})
                have_keys.add(key)
                backfilled += 1
            except Exception as exc:
                logger.warning("reconcile: no se pudo adoptar id=%s: %s", adopt_id, exc)
            continue
        ok = await save_order(
            row["sender_id"], row["nombre"], row["telefono"], row["direccion"],
            row["pago"], row["pedido"], row["total"], row["plataforma"], key=key,
        )
        if ok:
            have_keys.add(key)
            backfilled += 1
    if backfilled:
        logger.info("reconcile: %d pedido(s) reintegrados desde Sheets a Supabase", backfilled)
    return backfilled


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
    if not sb.enabled or not clean:
        return False
    return await sb.update("pedidos", clean, {"id": order_id})


async def delete_order(order_id) -> bool:
    """Borra un pedido de Supabase. Sin Supabase, no-op."""
    if not sb.enabled:
        return False
    return await sb.delete("pedidos", {"id": order_id})
