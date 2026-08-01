"""Capa de envío de mensajes por canal.

Messenger e Instagram → Graph API de Meta (este módulo).
WhatsApp → delega en app.whatsapp.gateway (servicio Node Baileys por HTTP).

El orchestrator llama estas funciones con `platform` y no sabe nada del transporte:
así WhatsApp entra como un canal más sin tocar la lógica de negocio.
"""
import logging

import httpx

from app.config import settings
from app.whatsapp import gateway as wa_gateway

logger = logging.getLogger(__name__)

_MESSENGER_URL = "https://graph.facebook.com/v20.0/me/messages"
_INSTAGRAM_URL = "https://graph.instagram.com/v21.0/me/messages"

_PROFILE_URL = "https://graph.facebook.com/v20.0/{psid}"

_http = httpx.AsyncClient(timeout=10)


async def get_profile_name(psid: str, platform: str = "messenger") -> str:
    """Trae el nombre del perfil del cliente desde Meta. Retorna "" si falla.

    Ambas plataformas se consultan por `graph.facebook.com` con el page token:
    en este montaje el Instagram está conectado a la Página de Facebook, así que
    los IGSID se resuelven por el mismo endpoint (NO por graph.instagram.com, que
    espera un token IG y rechaza el page token EAA con 401 'Cannot parse').
    - Messenger: fields=first_name,last_name
    - Instagram: fields=name
    """
    if platform == "whatsapp":
        # El nombre (pushName) llegó en el evento entrante y quedó cacheado.
        return wa_gateway.get_pushname(psid)
    fields = "name" if platform == "instagram" else "first_name,last_name"
    try:
        resp = await _http.get(
            _PROFILE_URL.format(psid=psid),
            params={"fields": fields, "access_token": settings.meta_page_access_token},
        )
        if resp.status_code != 200:
            logger.warning("Graph API perfil %s: %s %s", psid, resp.status_code, resp.text)
            return ""

        data = resp.json()
        if platform == "instagram":
            return str(data.get("name") or "").strip()
        return f"{data.get('first_name', '')} {data.get('last_name', '')}".strip()
    except Exception as exc:
        logger.warning("Error trayendo perfil de %s: %s", psid, exc)
        return ""


async def send_text(psid: str, text: str, platform: str = "messenger") -> None:
    if platform == "whatsapp":
        await wa_gateway.send_text(psid, text)
        return
    payload = {
        "recipient": {"id": psid},
        "message": {"text": text},
    }
    await _post(payload, platform)


async def send_typing_on(psid: str, platform: str = "messenger") -> None:
    if platform == "whatsapp":
        # Baileys puede enviar presencia, pero no es crítico; no-op en v1.
        return
    payload = {
        "recipient": {"id": psid},
        "sender_action": "typing_on",
    }
    await _post(payload, platform)


async def send_reaction(psid: str, mid: str, reaction: str = "love", platform: str = "instagram") -> None:
    """Envía una reacción a un mensaje (ej: corazón ante story mention)."""
    payload = {
        "recipient": {"id": psid},
        "sender_action": "react",
        "payload": {"reaction": reaction, "message_id": mid},
    }
    await _post(payload, platform)


async def check_connection(platform: str) -> dict:
    """Verifica que el token del canal Meta siga válido llamando a Graph /me.

    Devuelve {status, name?}: 'connected' (token válido), 'no_configurado' (sin token),
    o 'error' (token inválido/caducado). Messenger e Instagram no tienen sesión persistente
    como WhatsApp; su 'conexión' es que el token de la Página/cuenta responda.
    """
    if platform == "instagram":
        token = settings.meta_ig_access_token or settings.meta_page_access_token
    else:
        token = settings.meta_page_access_token
    if not token:
        return {"status": "no_configurado"}
    try:
        resp = await _http.get(
            "https://graph.facebook.com/v20.0/me",
            params={"fields": "name", "access_token": token},
        )
        if resp.status_code == 200:
            return {"status": "connected", "name": resp.json().get("name", "")}
        logger.warning("check_connection %s: %s %s", platform, resp.status_code, resp.text)
        return {"status": "error"}
    except Exception as exc:
        logger.warning("check_connection %s error: %s", platform, exc)
        return {"status": "error"}


async def _post(payload: dict, platform: str = "messenger") -> None:
    if platform == "instagram":
        url = _INSTAGRAM_URL
        headers = {"Authorization": f"Bearer {settings.meta_ig_access_token}"}
        params = {}
    else:
        url = _MESSENGER_URL
        headers = {}
        params = {"access_token": settings.meta_page_access_token}

    resp = await _http.post(url, params=params, headers=headers, json=payload)
    if resp.status_code != 200:
        logger.error("Graph API error %s: %s", resp.status_code, resp.text)
    resp.raise_for_status()
