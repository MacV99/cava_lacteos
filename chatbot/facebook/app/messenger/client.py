"""Cliente para la Graph API de Meta (envío de mensajes — Messenger e Instagram)."""
import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_MESSENGER_URL = "https://graph.facebook.com/v20.0/me/messages"
_INSTAGRAM_URL = "https://graph.instagram.com/v21.0/me/messages"


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


async def _post(payload: dict, platform: str = "messenger") -> None:
    if platform == "instagram":
        url = _INSTAGRAM_URL
        headers = {"Authorization": f"Bearer {settings.meta_ig_access_token}"}
        params = {}
    else:
        url = _MESSENGER_URL
        headers = {}
        params = {"access_token": settings.meta_page_access_token}

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(url, params=params, headers=headers, json=payload)
        if resp.status_code != 200:
            logger.error("Graph API error %s: %s", resp.status_code, resp.text)
        resp.raise_for_status()
