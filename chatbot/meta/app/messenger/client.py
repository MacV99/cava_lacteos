"""Cliente para la Graph API de Meta (envío de mensajes — Messenger e Instagram)."""
import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_MESSENGER_URL = "https://graph.facebook.com/v20.0/me/messages"
_INSTAGRAM_URL = "https://graph.instagram.com/v21.0/me/messages"

_MESSENGER_PROFILE = "https://graph.facebook.com/v20.0/{psid}"
_INSTAGRAM_PROFILE = "https://graph.instagram.com/v21.0/{psid}"

_http = httpx.AsyncClient(timeout=10)


async def get_profile_name(psid: str, platform: str = "messenger") -> str:
    """Trae el nombre del perfil del cliente desde Meta. Retorna "" si falla.

    Messenger: fields=first_name,last_name (token por query param).
    Instagram: fields=name,username (token Bearer); usa name y si no, username.
    """
    try:
        if platform == "instagram":
            url = _INSTAGRAM_PROFILE.format(psid=psid)
            headers = {"Authorization": f"Bearer {settings.meta_ig_access_token}"}
            params = {"fields": "name,username"}
            resp = await _http.get(url, params=params, headers=headers)
        else:
            url = _MESSENGER_PROFILE.format(psid=psid)
            params = {"fields": "first_name,last_name", "access_token": settings.meta_page_access_token}
            resp = await _http.get(url, params=params)

        if resp.status_code != 200:
            logger.warning("Graph API perfil %s: %s %s", psid, resp.status_code, resp.text)
            return ""

        data = resp.json()
        if platform == "instagram":
            return str(data.get("name") or data.get("username") or "").strip()
        nombre = f"{data.get('first_name', '')} {data.get('last_name', '')}".strip()
        return nombre
    except Exception as exc:
        logger.warning("Error trayendo perfil de %s: %s", psid, exc)
        return ""


async def send_text(psid: str, text: str, platform: str = "messenger") -> None:
    payload = {
        "recipient": {"id": psid},
        "message": {"text": text},
    }
    await _post(payload, platform)


async def send_typing_on(psid: str, platform: str = "messenger") -> None:
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
