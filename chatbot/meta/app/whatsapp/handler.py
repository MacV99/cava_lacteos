"""Procesa el body del webhook oficial de WhatsApp Cloud.

Port de `whatsapp-cloud/src/handler.js` + el puente `bridge.js`. Antes el panel Node
guardaba el entrante y hacía POST HTTP al bot Python; ahora todo pasa en proceso:
  1. guarda el entrante en el store del panel (Supabase),
  2. si la IA está encendida para ese chat, corre el MISMO orchestrator (handle_event)
     con platform="whatsapp" — igual que Messenger/IG.

La IA procesa texto y notas de voz (transcritas con Whisper, igual que Messenger).
Otra media (imagen/video/documento) entra al panel pero no se manda al LLM.
"""
import logging
import time

from app.whatsapp import gateway as wa_gateway
from app.whatsapp import store

logger = logging.getLogger(__name__)

_MEDIA_TYPES = {"image", "video", "audio", "voice", "document", "sticker"}

# Dedup para no correr el LLM dos veces si Meta reintrega el webhook.
_seen_mids: set[str] = set()
_MAX_SEEN = 2000


def _ts_to_ms(t) -> int:
    try:
        n = int(t)
        return n * 1000
    except (TypeError, ValueError):
        return int(time.time() * 1000)


def _extract_message(m: dict) -> dict:
    base = {"id": m.get("id"), "ts": _ts_to_ms(m.get("timestamp")), "type": m.get("type")}
    t = m.get("type")

    if t == "text":
        return {**base, "text": (m.get("text") or {}).get("body", "")}
    if t == "button":
        return {**base, "type": "text", "text": (m.get("button") or {}).get("text", "")}
    if t == "interactive":
        i = m.get("interactive") or {}
        text = (i.get("button_reply") or {}).get("title") or (i.get("list_reply") or {}).get("title") or ""
        return {**base, "type": "text", "text": text}
    if t == "reaction":
        return {**base, "type": "text", "text": f"{(m.get('reaction') or {}).get('emoji', '❤️')} (reacción)"}
    if t == "location":
        loc = m.get("location") or {}
        return {**base, "type": "text", "text": f"📍 Ubicación: {loc.get('latitude')}, {loc.get('longitude')}"}
    if t in _MEDIA_TYPES:
        media = m.get(t) or {}
        return {**base, "mediaId": media.get("id"), "mime": media.get("mime_type"),
                "filename": media.get("filename"), "text": media.get("caption", "")}
    return {**base, "type": "text", "text": f"[mensaje tipo {t} no soportado]"}


async def _transcribe_and_handle(wa_id: str, media_id: str, mid: str) -> None:
    """Baja la nota de voz de WhatsApp (Graph), la transcribe (Whisper) y corre el cerebro.

    WhatsApp no da URL pública: hay que resolver media_id → url temporal y bajar el binario
    con el token (a diferencia de Messenger, que sí trae URL pública).
    """
    from app.audio.transcribe import transcribe_bytes
    from app.bot.orchestrator import handle_event
    from app.whatsapp import graph
    try:
        info = await graph.get_media_url(media_id)
        audio_bytes, ctype = await graph.download_media(info["url"])
        text = (await transcribe_bytes(audio_bytes, info.get("mime_type") or ctype)).strip()
    except Exception as exc:
        logger.error("WA audio: no se pudo transcribir media=%s: %s", media_id, exc)
        return
    if not text:
        logger.info("WA audio: transcripción vacía media=%s", media_id)
        return
    logger.info("WA audio transcrito (%s): %s", wa_id, text)
    messaging = {"sender": {"id": wa_id}, "message": {"text": text, "mid": mid}}
    await handle_event(messaging, "whatsapp")


def _dedup(mid: str) -> bool:
    """True si `mid` ya se procesó (para el LLM)."""
    if not mid:
        return False
    if mid in _seen_mids:
        return True
    _seen_mids.add(mid)
    if len(_seen_mids) > _MAX_SEEN:
        _seen_mids.clear()
    return False


async def handle_webhook_body(body: dict, background_tasks) -> None:
    if not body or body.get("object") != "whatsapp_business_account":
        return

    from app.bot.orchestrator import handle_event

    for entry in body.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value", {})

            # mapa wa_id → nombre de perfil
            names = {}
            for c in value.get("contacts", []):
                if c.get("wa_id"):
                    names[c["wa_id"]] = (c.get("profile") or {}).get("name") or c["wa_id"]

            # mensajes entrantes — un mensaje malo no debe tumbar el resto del lote
            for m in value.get("messages", []):
                try:
                    wa_id = m.get("from")
                    name = names.get(wa_id, wa_id)

                    # Reacción: se adjunta a la burbuja del mensaje al que reaccionó.
                    if m.get("type") == "reaction":
                        emoji = (m.get("reaction") or {}).get("emoji", "")
                        target_id = (m.get("reaction") or {}).get("message_id")
                        if await store.apply_reaction(wa_id, target_id, emoji, _ts_to_ms(m.get("timestamp"))):
                            logger.info("[reaction] %s: %s → %s", name, emoji or "(quitada)", target_id)
                            continue
                        # fallback: si no tenemos el mensaje objetivo, sigue como nota entrante

                    msg = _extract_message(m)
                    wa_gateway.remember_pushname(wa_id, name)
                    conv = await store.add_inbound(wa_id, name, msg)
                    logger.info("[in] %s (%s): %s", name, wa_id, msg.get("text") or msg.get("type"))

                    # IA apagada para este chat → 100% manual, no procesar.
                    if conv.get("aiOn") is False:
                        continue

                    # Nota de voz → transcribir con Whisper y correr el mismo cerebro.
                    if msg.get("type") in ("audio", "voice") and msg.get("mediaId"):
                        if _dedup(msg.get("id")):
                            logger.info("WA duplicado ignorado mid=%s", msg.get("id"))
                            continue
                        background_tasks.add_task(
                            _transcribe_and_handle, wa_id, msg["mediaId"], msg.get("id"))
                        continue

                    # Texto (u otros mapeados a texto: botón/interactivo/ubicación).
                    text = (msg.get("text") or "").strip()
                    if not text:
                        continue
                    if _dedup(msg.get("id")):
                        logger.info("WA duplicado ignorado mid=%s", msg.get("id"))
                        continue
                    # Shape compatible con parser.parse() (sender.id como psid = wa_id).
                    messaging = {"sender": {"id": wa_id}, "message": {"text": text, "mid": msg.get("id")}}
                    background_tasks.add_task(handle_event, messaging, "whatsapp")
                except Exception as exc:
                    logger.exception("Error procesando mensaje WhatsApp %s: %s", m.get("id"), exc)

            # acuses de estado (sent/delivered/read/failed)
            for s in value.get("statuses", []):
                e0 = (s.get("errors") or [None])[0]
                err = None
                if e0:
                    err = {
                        "code": e0.get("code"), "title": e0.get("title") or e0.get("message"),
                        "details": (e0.get("error_data") or {}).get("details"), "href": e0.get("href"),
                    }
                await store.apply_status(s.get("id"), s.get("status"), err)
                if s.get("status") == "failed":
                    logger.warning("[status] failed %s: %s", s.get("id"), err)
