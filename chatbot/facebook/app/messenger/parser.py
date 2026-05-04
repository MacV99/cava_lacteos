"""Normaliza el payload crudo de Messenger a un evento interno."""
from dataclasses import dataclass
from typing import Literal

_IMAGE_TYPES = {"image", "video", "file", "sticker"}


@dataclass
class MessengerEvent:
    psid: str
    type: Literal["text", "audio", "image", "postback", "other"]
    text: str | None = None
    attachment_url: str | None = None


def parse(messaging: dict) -> "MessengerEvent | None":
    """Retorna MessengerEvent o None si el evento debe ignorarse (eco del bot)."""
    sender = messaging.get("sender", {}).get("id")
    if not sender:
        return None

    if messaging.get("message", {}).get("is_echo"):
        return None

    if "postback" in messaging:
        payload = messaging["postback"].get("payload", "")
        return MessengerEvent(psid=sender, type="postback", text=payload)

    message = messaging.get("message", {})

    if "text" in message:
        return MessengerEvent(psid=sender, type="text", text=message["text"])

    attachments = message.get("attachments", [])
    if attachments:
        att = attachments[0]
        att_type = att.get("type", "")
        url = att.get("payload", {}).get("url")
        if att_type == "audio":
            return MessengerEvent(psid=sender, type="audio", attachment_url=url)
        if att_type in _IMAGE_TYPES:
            return MessengerEvent(psid=sender, type="image")
        return MessengerEvent(psid=sender, type="other")

    return None
