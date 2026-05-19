"""Normaliza el payload crudo de Messenger / Instagram DMs a un evento interno."""
import json
import logging
from dataclasses import dataclass, field
from typing import Literal

logger = logging.getLogger(__name__)

_IMAGE_TYPES = {"image", "video", "file", "sticker"}
_IGNORE_TYPES = {"template", "fallback"}  # eventos de sistema de Instagram, no del usuario


@dataclass
class MessengerEvent:
    psid: str
    type: Literal["text", "audio", "image", "postback", "story_mention", "other"]
    platform: str = "messenger"
    text: str | None = None
    attachment_url: str | None = None
    mid: str | None = None  # message ID, necesario para enviar reacciones


def parse(messaging: dict, platform: str = "messenger") -> "MessengerEvent | None":
    """Retorna MessengerEvent o None si el evento debe ignorarse (eco del bot)."""
    sender = messaging.get("sender", {}).get("id")
    if not sender:
        return None

    if messaging.get("message", {}).get("is_echo"):
        return None

    if "postback" in messaging:
        payload = messaging["postback"].get("payload", "")
        return MessengerEvent(psid=sender, type="postback", text=payload, platform=platform)

    message = messaging.get("message", {})
    mid = message.get("mid")

    if "text" in message:
        return MessengerEvent(psid=sender, type="text", text=message["text"], platform=platform, mid=mid)

    attachments = message.get("attachments", [])
    if attachments:
        att = attachments[0]
        att_type = att.get("type", "")
        url = att.get("payload", {}).get("url")
        if att_type == "audio":
            return MessengerEvent(psid=sender, type="audio", attachment_url=url, platform=platform, mid=mid)
        if att_type == "story_mention":
            return MessengerEvent(psid=sender, type="story_mention", platform=platform, mid=mid)
        if att_type in _IMAGE_TYPES:
            return MessengerEvent(psid=sender, type="image", platform=platform, mid=mid)
        if att_type in _IGNORE_TYPES:
            return None
        logger.warning("Attachment desconocido tipo=%s payload=%s", att_type, json.dumps(att, ensure_ascii=False))
        return MessengerEvent(psid=sender, type="other", platform=platform, mid=mid)

    return None
