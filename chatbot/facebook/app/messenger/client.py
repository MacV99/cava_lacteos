"""Cliente para la Graph API de Meta (envío de mensajes)."""
import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_GRAPH_URL = "https://graph.facebook.com/v20.0/me/messages"


async def send_text(psid: str, text: str) -> None:
    payload = {
        "recipient": {"id": psid},
        "message": {"text": text},
    }
    await _post(payload)


async def send_typing_on(psid: str) -> None:
    payload = {
        "recipient": {"id": psid},
        "sender_action": "typing_on",
    }
    await _post(payload)


async def _post(payload: dict) -> None:
    params = {"access_token": settings.meta_page_access_token}
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(_GRAPH_URL, params=params, json=payload)
        if resp.status_code != 200:
            logger.error("Graph API error %s: %s", resp.status_code, resp.text)
        resp.raise_for_status()
