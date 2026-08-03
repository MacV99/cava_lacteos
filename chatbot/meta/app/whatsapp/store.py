"""Store de conversaciones del panel: memoria + persistencia intercambiable.

Port de `whatsapp-cloud/src/store.js`.
  - Supabase (Postgres) si SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY están definidas.
  - JSON local (data/wa_conversations.json) como fallback para dev/sin credenciales.

El modelo en memoria es la fuente de TODAS las lecturas síncronas (rápido, sin latencia
en el poll del panel). Cada mutación actualiza memoria y hace write-through al backend
(async, best-effort). `load_all()` se llama una vez al arrancar (lifespan de FastAPI).

Modelo en memoria (camelCase, se serializa directo a lo que espera el panel app.js):
  conversations[waId] = { waId, name, lastInboundTs, unread, blocked, aiOn,
    messages: [ { id, dir:'in'|'out', type, text, mediaId, mime, filename, ts, status, error, reaction, replyTo } ] }
"""
import json
import logging
import os
from datetime import datetime, timezone

from app.whatsapp import supabase as sb

logger = logging.getLogger(__name__)

_conversations: dict[str, dict] = {}

_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data")
_FILE = os.path.join(_DATA_DIR, "wa_conversations.json")


# ── Mapeo memoria ↔ filas de Supabase ────────────────────────────────────────
def _conv_to_row(c: dict) -> dict:
    return {
        "wa_id": c["waId"], "name": c.get("name"),
        "last_inbound_ts": c.get("lastInboundTs") or 0, "unread": c.get("unread") or 0,
        "blocked": bool(c.get("blocked")), "ai_on": c.get("aiOn") is not False,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def _msg_to_row(wa_id: str, m: dict) -> dict:
    return {
        "wa_id": wa_id, "wamid": m.get("id"), "dir": m.get("dir"), "type": m.get("type"),
        "text": m.get("text"), "media_id": m.get("mediaId"), "mime": m.get("mime"),
        "filename": m.get("filename"), "ts": m.get("ts"), "status": m.get("status"),
        "error": m.get("error"), "reaction": m.get("reaction"), "reply_to": m.get("replyTo"),
    }


def _row_to_msg(r: dict) -> dict:
    return {
        "id": r.get("wamid"), "dir": r.get("dir"), "type": r.get("type"), "text": r.get("text"),
        "mediaId": r.get("media_id"), "mime": r.get("mime"), "filename": r.get("filename"),
        "ts": int(r.get("ts") or 0), "status": r.get("status"), "error": r.get("error"),
        "reaction": r.get("reaction"), "replyTo": r.get("reply_to"),
    }


# ── Persistencia JSON local (fallback) ───────────────────────────────────────
def _persist_file() -> None:
    try:
        os.makedirs(_DATA_DIR, exist_ok=True)
        with open(_FILE, "w", encoding="utf-8") as f:
            json.dump(_conversations, f, ensure_ascii=False, indent=2)
    except Exception as exc:
        logger.error("[store] error al guardar JSON: %s", exc)


# ── Carga inicial (llamar en lifespan) ───────────────────────────────────────
async def load_all() -> None:
    global _conversations
    try:
        if sb.enabled:
            convs = await sb.select("conversations")
            msgs = await sb.select("messages", {"order": "ts.asc"})
            m: dict[str, dict] = {}
            for r in convs:
                m[r["wa_id"]] = {
                    "waId": r["wa_id"], "name": r.get("name"),
                    "lastInboundTs": int(r.get("last_inbound_ts") or 0),
                    "unread": r.get("unread") or 0, "blocked": bool(r.get("blocked")),
                    "aiOn": r.get("ai_on") is not False, "messages": [],
                }
            for r in msgs:
                c = m.get(r["wa_id"])
                if c:
                    c["messages"].append(_row_to_msg(r))
            _conversations = m
            logger.info("[store] backend=supabase · %d conversaciones cargadas", len(m))
        else:
            if os.path.exists(_FILE):
                with open(_FILE, encoding="utf-8") as f:
                    _conversations = json.load(f) or {}
            logger.info("[store] backend=json · %d conversaciones cargadas", len(_conversations))
    except Exception as exc:
        logger.error("[store] no se pudo cargar, empezando vacío: %s", exc)
        _conversations = {}


async def _write_conv(c: dict) -> None:
    if sb.enabled:
        await sb.upsert("conversations", _conv_to_row(c), on_conflict="wa_id")
    else:
        _persist_file()


async def _write_msg(c: dict, m: dict) -> None:
    if sb.enabled:
        # La FK exige que la conversación exista → upsert conv, luego insert msg.
        # (A diferencia de los pedidos, aquí NO reintentamos: un mensaje suelto
        # perdido por un blip es tolerable; un pedido no — ese sí se reintegra vía
        # reconcile_from_sheets. Si en el futuro se quiere reintento transversal,
        # va en supabase.insert, no aquí.)
        await sb.upsert("conversations", _conv_to_row(c), on_conflict="wa_id")
        await sb.insert("messages", _msg_to_row(c["waId"], m))
    else:
        _persist_file()


# ── Accesores (lectura síncrona desde memoria) ───────────────────────────────
def get_conversation(wa_id: str) -> dict | None:
    return _conversations.get(wa_id)


def ensure_conversation(wa_id: str, name: str | None = None) -> dict:
    c = _conversations.get(wa_id)
    if not c:
        c = _conversations[wa_id] = {
            "waId": wa_id, "name": name or wa_id, "lastInboundTs": 0,
            "unread": 0, "blocked": False, "aiOn": True, "messages": [],
        }
    if name and (c["name"] == c["waId"] or not c["name"]):
        c["name"] = name
    return c


def _preview_of(m: dict) -> str:
    if m.get("text"):
        return m["text"]
    t = m.get("type")
    return {"image": "📷 Foto", "video": "🎥 Video", "audio": "🎵 Audio", "voice": "🎵 Audio",
            "document": "📄 " + (m.get("filename") or "Documento"), "sticker": "Sticker"}.get(t, "")


def list_conversations() -> list[dict]:
    """Lista ordenada por actividad reciente (para el panel)."""
    out = []
    for c in _conversations.values():
        last = c["messages"][-1] if c["messages"] else None
        out.append({
            "waId": c["waId"], "name": c["name"], "unread": c.get("unread") or 0,
            "blocked": bool(c.get("blocked")), "aiOn": c.get("aiOn") is not False,
            "lastInboundTs": c.get("lastInboundTs") or 0,
            "lastTs": last["ts"] if last else (c.get("lastInboundTs") or 0),
            "preview": _preview_of(last) if last else "",
            "messages": c["messages"],
        })
    out.sort(key=lambda x: x["lastTs"] or 0, reverse=True)
    return out


# ── Mutaciones (write-through async) ─────────────────────────────────────────
async def add_inbound(wa_id: str, name: str | None, msg: dict) -> dict:
    c = ensure_conversation(wa_id, name)
    if msg.get("id") and any(m.get("id") == msg["id"] for m in c["messages"]):
        return c  # dedup: Meta reintenta si respondemos lento
    m = {"dir": "in", "status": None, "error": None, **msg}
    c["messages"].append(m)
    c["lastInboundTs"] = msg["ts"]
    c["unread"] = (c.get("unread") or 0) + 1
    await _write_msg(c, m)
    return c


async def add_outbound(wa_id: str, msg: dict) -> dict:
    c = ensure_conversation(wa_id)
    m = {"dir": "out", "status": "sent", "error": None, **msg}
    c["messages"].append(m)
    await _write_msg(c, m)
    return c


_RANK = {"sent": 1, "delivered": 2, "read": 3}


async def apply_status(msg_id: str, status: str, error=None) -> bool:
    """Acuses: sube de nivel, nunca baja. failed siempre pisa."""
    for c in _conversations.values():
        m = next((x for x in c["messages"] if x.get("id") == msg_id), None)
        if not m:
            continue
        if status == "failed":
            m["status"] = "failed"
            if error:
                m["error"] = error
        elif _RANK.get(status, 0) > _RANK.get(m.get("status"), 0):
            m["status"] = status
        else:
            return True  # sin cambio real: no escribas al backend
        if sb.enabled:
            await sb.update("messages", {"status": m["status"], "error": m.get("error")}, {"wamid": msg_id})
        else:
            _persist_file()
        return True
    return False


async def mark_read(wa_id: str) -> dict | None:
    c = _conversations.get(wa_id)
    if not c:
        return None
    c["unread"] = 0
    await _write_conv(c)
    return c


async def apply_reaction(wa_id: str, target_id: str, emoji: str, ts: int) -> bool:
    c = _conversations.get(wa_id)
    if not c:
        return False
    m = next((x for x in c["messages"] if x.get("id") == target_id), None)
    if not m:
        return False
    m["reaction"] = emoji or None
    if ts:
        c["lastInboundTs"] = ts  # una reacción también reabre la ventana de 24h
    if sb.enabled:
        await sb.update("messages", {"reaction": m["reaction"]}, {"wa_id": wa_id, "wamid": target_id})
        if ts:
            await sb.upsert("conversations", _conv_to_row(c), on_conflict="wa_id")
    else:
        _persist_file()
    return True


async def rename(wa_id: str, name: str) -> dict | None:
    c = _conversations.get(wa_id)
    if not c:
        return None
    c["name"] = (name or "").strip() or c["waId"]
    await _write_conv(c)
    return c


async def delete_message(wa_id: str, message_id: str) -> bool:
    """Borra un mensaje SOLO del panel (WhatsApp Cloud API no permite unsend)."""
    c = _conversations.get(wa_id)
    if not c:
        return False
    i = next((idx for idx, m in enumerate(c["messages"]) if m.get("id") == message_id), -1)
    if i < 0:
        return False
    c["messages"].pop(i)
    if sb.enabled:
        await sb.delete("messages", {"wa_id": wa_id, "wamid": message_id})
    else:
        _persist_file()
    return True


async def delete_conversation(wa_id: str) -> bool:
    """Borra la conversación entera del panel (no del teléfono del cliente)."""
    if wa_id not in _conversations:
        return False
    del _conversations[wa_id]
    if sb.enabled:
        await sb.delete("messages", {"wa_id": wa_id})
        await sb.delete("conversations", {"wa_id": wa_id})
    else:
        _persist_file()
    return True


async def set_blocked(wa_id: str, blocked: bool) -> dict | None:
    c = _conversations.get(wa_id)
    if not c:
        return None
    c["blocked"] = bool(blocked)
    await _write_conv(c)
    return c


async def set_ai_on(wa_id: str, on: bool) -> dict | None:
    """IA on/off por chat: cuando está on, el webhook deja que el bot Python responda."""
    c = _conversations.get(wa_id)
    if not c:
        return None
    c["aiOn"] = bool(on)
    await _write_conv(c)
    return c
