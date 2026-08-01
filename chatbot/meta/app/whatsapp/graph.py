"""Capa de salida hacia la Graph API de WhatsApp Cloud (oficial).

Port de `whatsapp-cloud/src/whatsapp.js`. Antes esto vivía en el panel Node; ahora
el mismo FastAPI habla con Graph directo usando el token del número (System User).

Todas las funciones propagan `GraphError` con `.code` / `.title` para que el panel
muestre el motivo real de Meta (mismo modal de errores que antes).
"""
import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_http = httpx.AsyncClient(timeout=30)


class GraphError(Exception):
    """Error devuelto por la Graph API. `code` = código de Meta; `title` = detalle fino."""

    def __init__(self, message: str, code=None, title=None, raw=None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.title = title
        self.raw = raw


def _graph_base() -> str:
    return f"https://graph.facebook.com/{settings.graph_version}"


def _auth_headers(extra: dict | None = None) -> dict:
    h = {"Authorization": f"Bearer {settings.meta_token}"}
    if extra:
        h.update(extra)
    return h


async def _post_to_graph(payload: dict) -> dict:
    """POST genérico a /{PHONE_NUMBER_ID}/messages. Propaga el código de error de Meta."""
    url = f"{_graph_base()}/{settings.phone_number_id}/messages"
    r = await _http.post(url, headers=_auth_headers({"Content-Type": "application/json"}), json=payload)
    data = _safe_json(r)
    err = data.get("error")
    if r.status_code >= 400 or err:
        raise GraphError(
            (err or {}).get("message") or f"Graph API HTTP {r.status_code}",
            code=(err or {}).get("code", r.status_code),
            title=((err or {}).get("error_data") or {}).get("details") or (err or {}).get("type"),
            raw=err,
        )
    return data  # { messages: [{ id: wamid }], contacts: [...] }


def _safe_json(r: httpx.Response) -> dict:
    try:
        return r.json()
    except Exception:
        return {}


async def send_text(to: str, body: str, reply_to: str | None = None) -> dict:
    """Texto libre (solo dentro de la ventana de 24h). `reply_to` = wamid a citar."""
    payload = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "text",
        "text": {"preview_url": True, "body": body},
    }
    if reply_to:
        payload["context"] = {"message_id": reply_to}
    return await _post_to_graph(payload)


async def upload_media(buffer: bytes, mime: str, filename: str = "file") -> dict:
    """Sube un binario a WhatsApp y devuelve { id } (media_id) para luego enviarlo."""
    url = f"{_graph_base()}/{settings.phone_number_id}/media"
    files = {
        "messaging_product": (None, "whatsapp"),
        "type": (None, mime),
        "file": (filename, buffer, mime),
    }
    r = await _http.post(url, headers=_auth_headers(), files=files)
    data = _safe_json(r)
    err = data.get("error")
    if r.status_code >= 400 or err:
        raise GraphError((err or {}).get("message") or f"upload media HTTP {r.status_code}",
                         code=(err or {}).get("code", r.status_code), raw=err)
    return data  # { id }


async def send_media(to: str, mtype: str, media_id: str, *, caption=None, filename=None,
                     reply_to=None, voice=False) -> dict:
    """Envía media ya subida. type: image|audio|video|document|sticker.

    Para audio, `voice=True` lo entrega como NOTA DE VOZ nativa. Requiere ogg/opus mono;
    sin ffmpeg el navegador manda webm/ogg tal cual (Firefox ogg/opus suele pasar, Chrome
    webm puede fallar con 131053 — el error se ve en el panel).
    """
    media: dict = {"id": media_id}
    if caption and mtype in ("image", "video", "document"):
        media["caption"] = caption
    if filename and mtype == "document":
        media["filename"] = filename
    if mtype == "audio" and voice:
        media["voice"] = True
    payload = {"messaging_product": "whatsapp", "to": to, "type": mtype, mtype: media}
    if reply_to:
        payload["context"] = {"message_id": reply_to}
    return await _post_to_graph(payload)


async def send_template(to: str, name: str, lang: str = "es", components: list | None = None) -> dict:
    """Plantilla aprobada (para escribir fuera de las 24h)."""
    return await _post_to_graph({
        "messaging_product": "whatsapp",
        "to": to,
        "type": "template",
        "template": {"name": name, "language": {"code": lang}, "components": components or []},
    })


async def _block_call(method: str, wa_id: str) -> dict:
    url = f"{_graph_base()}/{settings.phone_number_id}/block_users"
    r = await _http.request(
        method, url,
        headers=_auth_headers({"Content-Type": "application/json"}),
        json={"messaging_product": "whatsapp", "block_users": [{"user": wa_id}]},
    )
    data = _safe_json(r)
    err = data.get("error")
    if r.status_code >= 400 or err:
        raise GraphError((err or {}).get("message") or f"block HTTP {r.status_code}",
                         code=(err or {}).get("code", r.status_code), raw=err)
    return data


async def block_user(wa_id: str) -> dict:
    return await _block_call("POST", wa_id)


async def unblock_user(wa_id: str) -> dict:
    return await _block_call("DELETE", wa_id)


async def mark_read(message_id: str) -> bool:
    """Marca como leído en WhatsApp (los ✓✓ azules del cliente)."""
    url = f"{_graph_base()}/{settings.phone_number_id}/messages"
    try:
        r = await _http.post(url, headers=_auth_headers({"Content-Type": "application/json"}),
                             json={"messaging_product": "whatsapp", "status": "read", "message_id": message_id})
        return r.status_code == 200
    except Exception:
        return False


async def get_phone_health() -> dict:
    """Ping a Graph /{PHONE_NUMBER_ID}: verifica que el token viva y trae número/calidad."""
    if not settings.meta_token or not settings.phone_number_id:
        return {"status": "no_configurado"}
    fields = "verified_name,display_phone_number,quality_rating"
    try:
        r = await _http.get(f"{_graph_base()}/{settings.phone_number_id}?fields={fields}", headers=_auth_headers())
        data = _safe_json(r)
        err = data.get("error")
        if r.status_code >= 400 or err:
            return {"status": "error", "code": (err or {}).get("code", r.status_code),
                    "message": (err or {}).get("message") or f"HTTP {r.status_code}"}
        return {
            "status": "connected",
            "name": data.get("verified_name", ""),
            "number": data.get("display_phone_number", ""),
            "quality": data.get("quality_rating", ""),
        }
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


async def get_media_url(media_id: str) -> dict:
    """Paso 1: pedir la URL temporal + mime de un media id."""
    r = await _http.get(f"{_graph_base()}/{media_id}", headers=_auth_headers())
    if r.status_code != 200:
        raise GraphError(f"getMediaUrl HTTP {r.status_code}", code=r.status_code)
    return r.json()  # { url, mime_type, ... }


async def download_media(url: str) -> tuple[bytes, str | None]:
    """Paso 2: bajar el binario (también requiere el token)."""
    r = await _http.get(url, headers=_auth_headers())
    if r.status_code != 200:
        raise GraphError(f"downloadMedia HTTP {r.status_code}", code=r.status_code)
    return r.content, r.headers.get("content-type")
