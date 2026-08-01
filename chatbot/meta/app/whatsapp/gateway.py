"""Salida de WhatsApp usada por el orchestrator (mismo contrato de siempre).

Antes delegaba en el servicio Node (Baileys → luego panel Cloud) por HTTP. Ahora
envía por la Graph API oficial directo (app.whatsapp.graph) y guarda el saliente en
el store del panel, así el mensaje de la IA aparece en el panel igual que uno manual.

El `sender_id` (clave del bot y col A de Sheets) es el `wa_id` = número del cliente.

El nombre (`pushName`) no se consulta a ninguna API: llega en el evento entrante y se
cachea aquí para que el orchestrator lo recupere vía get_profile_name().
"""
import logging
import time

from app.whatsapp import graph, store
from app.whatsapp.errors import full_message

logger = logging.getLogger(__name__)

# wa_id -> pushName. Lo llena el webhook al recibir un mensaje; lo lee el orchestrator
# cuando aún no hay nombre guardado en la hoja. Se pierde al reiniciar (se rellena solo).
_pushname_cache: dict[str, str] = {}


def remember_pushname(jid: str, name: str | None) -> None:
    if name and name.strip():
        _pushname_cache[jid] = name.strip()


def get_pushname(jid: str) -> str:
    return _pushname_cache.get(jid, "")


async def send_text(jid: str, text: str) -> None:
    """Envía `text` al cliente por Graph API y lo registra en el store del panel.

    Si Graph rechaza (ventana 24h cerrada, bloqueo, rate limit…), registra la burbuja
    como **fallida** en el panel con el código de error, para que el operador lo vea y
    reaccione (ej. mandar plantilla). No relanza: el orchestrator es fire-and-forget.
    """
    now = int(time.time() * 1000)
    try:
        data = await graph.send_text(jid, text)
        wamid = (data.get("messages") or [{}])[0].get("id")
        await store.add_outbound(jid, {"id": wamid, "ts": now, "type": "text", "text": text})
    except graph.GraphError as exc:
        logger.error("WhatsApp send_text error %s: %s", exc.code, full_message(exc))
        err = {"code": exc.code, "title": getattr(exc, "title", None), "details": None}
        await store.add_outbound(jid, {"id": None, "ts": now, "type": "text", "text": text,
                                       "status": "failed", "error": err})
    except Exception as exc:
        logger.error("WhatsApp send_text fallo inesperado a %s: %s", jid, exc)
        await store.add_outbound(jid, {"id": None, "ts": now, "type": "text", "text": text,
                                       "status": "failed", "error": {"code": None, "title": str(exc)}})
