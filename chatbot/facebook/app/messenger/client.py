"""Cliente para la Graph API de Meta (envío de mensajes — Messenger e Instagram)."""
import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_GRAPH_BASE = "https://graph.facebook.com/v20.0"


def _url_for(platform: str) -> str:
    if platform == "instagram" and settings.meta_ig_account_id:
        return f"{_GRAPH_BASE}/{settings.meta_ig_account_id}/messages"
    return f"{_GRAPH_BASE}/me/messages"


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


def _token_for(platform: str) -> str:
    if platform == "instagram" and settings.meta_ig_access_token:
        return settings.meta_ig_access_token
    return settings.meta_page_access_token


async def _post(payload: dict, platform: str = "messenger") -> None:
    params = {"access_token": _token_for(platform)}
    url = _url_for(platform)
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(url, params=params, json=payload)
        if resp.status_code != 200:
            logger.error("Graph API error %s: %s", resp.status_code, resp.text)
        resp.raise_for_status()
