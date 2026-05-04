"""Flujo principal del chatbot.

Réplica fiel del workflow n8n 'CAVA - Messenger':

1.  Parsear evento → ignorar ecos / postbacks sin texto
2.  Imagen/video/sticker → respuesta "no soportamos"
3.  Audio → transcribir con Whisper (Groq)
4.  Buscar contacto en hoja 'actividad'
5.  Verificar que el bot esté activo para ese usuario
6.  Enviar typing_on
7.  BUFFER DEBOUNCE:
    a. Leer buffer actual + agregar mensaje nuevo
    b. Guardar buffer + timestamp propio (procesando) en Sheets
    c. Esperar 5 s (asyncio.sleep — no bloquea el event loop)
    d. Releer la fila — si otro mensaje llegó después, mi timestamp ya fue reemplazado
    e. Si no soy el último → descartar silenciosamente
8.  Combinar todos los mensajes del buffer con '\n'
9.  Determinar si es sesión nueva (ultima_vez > 60 min o null)
10. Cargar cache (empresa + catalogo)
11. Llamar Groq con system prompt + historial + mensaje combinado
12. Parsear respuesta: bloque PEDIDO_CONFIRMADO + separador |||
13. Si pedido → registrar en hoja 'pedidos'
14. Enviar msg1 (y msg2 si existe)
15. Actualizar 'actividad': historial, ultima_vez, limpiar buffer y procesando
"""
import asyncio
import json
import logging
import re
from collections import defaultdict
from datetime import datetime, timezone

from app.audio.transcribe import transcribe_url
from app.config import settings
from app.llm.groq_client import chat
from app.llm.prompts import build_system_prompt
from app.messenger.client import send_text, send_typing_on
from app.messenger.parser import parse
from app.sheets import activity, cache as sheets_cache, orders

logger = logging.getLogger(__name__)

# Un lock por PSID evita race conditions cuando dos mensajes llegan casi simultáneamente.
# El lock solo envuelve la lectura-modificación-escritura del buffer (no el sleep de 5 s).
_buffer_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

_PEDIDO_RE = re.compile(
    r"PEDIDO_CONFIRMADO\r?\nnombre:\s*(.+)\r?\npedido:\s*(.+)\r?\ntotal:\s*(\d+)",
)


async def handle_event(messaging: dict) -> None:
    event = parse(messaging)
    if event is None:
        return

    psid = event.psid

    # Imagen / video / sticker / archivo → no soportamos
    if event.type in ("image", "other"):
        await _safe_send(psid, "Por ahora solo puedo leer texto y audios 🙏\nSi tiene alguna pregunta escríbala y con gusto le ayudo.")
        return

    # Transcribir audio
    if event.type == "audio":
        if not event.attachment_url:
            return
        try:
            message_text = await transcribe_url(event.attachment_url)
        except Exception as exc:
            logger.error("Error transcribiendo audio: %s", exc)
            message_text = "[Audio recibido, por favor escribe tu mensaje]"
    else:
        message_text = event.text or ""

    if not message_text.strip():
        return

    # Buscar contacto
    contact = await asyncio.to_thread(activity.get_contact, psid)

    # Verificar que el bot esté activo para este usuario
    if str(contact.get("activado", "")).strip().lower() == "false":
        return

    # Typing inmediato
    await _safe_send_typing(psid)

    # ── BUFFER DEBOUNCE ──────────────────────────────────────────────────────
    my_timestamp = datetime.now(timezone.utc).isoformat()

    async with _buffer_locks[psid]:
        # Leer buffer actual (puede haber mensajes de este mismo usuario en tránsito)
        fresh = await asyncio.to_thread(activity.get_contact, psid)
        existing_buffer: list[str] = _parse_json_list(fresh.get("buffer", "[]"))
        nombre = str(fresh.get("nombre", contact.get("nombre", ""))).strip()

        existing_buffer.append(message_text)
        await asyncio.to_thread(
            activity.save_buffer, psid, nombre, existing_buffer, my_timestamp
        )

    # Esperar a que lleguen más mensajes del mismo usuario
    await asyncio.sleep(settings.buffer_wait_seconds)

    # Releer para saber si sigo siendo el último en procesar
    fresh_contact = await asyncio.to_thread(activity.get_contact, psid)
    if fresh_contact.get("procesando") != my_timestamp:
        # Otro mensaje llegó después — ese manejará el buffer completo
        return

    # ── PREPARAR MENSAJE COMBINADO ───────────────────────────────────────────
    buffer: list[str] = _parse_json_list(fresh_contact.get("buffer", "[]"))
    combined_message = "\n".join(buffer) if buffer else "[mensaje vacío]"
    nombre = str(fresh_contact.get("nombre", "")).strip()

    # Determinar si la sesión es nueva
    ultima_vez_str = fresh_contact.get("ultima_vez", "")
    es_nuevo = _is_new_session(ultima_vez_str)

    historial: list[dict] = []
    if not es_nuevo:
        historial = _parse_json_list(fresh_contact.get("historial", "[]"))

    # ── CARGAR CACHE (empresa + catalogo) ────────────────────────────────────
    try:
        cache_data = await asyncio.to_thread(sheets_cache.get_cache)
    except Exception as exc:
        logger.error("Error leyendo cache: %s", exc)
        cache_data = {"empresa": {}, "catalogo": ""}

    empresa  = cache_data.get("empresa", {})
    catalogo = cache_data.get("catalogo", "")

    # ── LLAMAR A GROQ ────────────────────────────────────────────────────────
    system_prompt = build_system_prompt(empresa, catalogo)
    trimmed_history = historial[-settings.history_max_items:]
    messages = (
        [{"role": "system", "content": system_prompt}]
        + trimmed_history
        + [{"role": "user", "content": combined_message}]
    )

    try:
        raw_reply = await chat(messages)
    except Exception as exc:
        logger.error("Error llamando a Groq: %s", exc)
        await _safe_send(psid, "Ups, tuve un problema técnico 😅\nPor favor escribe tu mensaje de nuevo y te ayudo enseguida.")
        await asyncio.to_thread(activity.clear_state, psid)
        return

    # ── PARSEAR RESPUESTA ────────────────────────────────────────────────────
    es_pedido, pedido_datos, visible_text = _parse_reply(raw_reply)

    parts = [p.strip() for p in visible_text.split("|||") if p.strip()]
    msg1 = parts[0] if parts else "[sin respuesta]"
    msg2 = parts[1] if len(parts) > 1 else ""

    # ── GUARDAR PEDIDO ───────────────────────────────────────────────────────
    if es_pedido and pedido_datos:
        try:
            await asyncio.to_thread(
                orders.register_order,
                psid,
                pedido_datos["nombre"],
                pedido_datos["pedido"],
                pedido_datos["total"],
            )
        except Exception as exc:
            logger.error("Error guardando pedido: %s", exc)

    # ── ENVIAR RESPUESTA ─────────────────────────────────────────────────────
    await _safe_send(psid, msg1)
    if msg2:
        await _safe_send(psid, msg2)

    # ── ACTUALIZAR ACTIVIDAD ─────────────────────────────────────────────────
    updated_historial = trimmed_history + [
        {"role": "user",      "content": combined_message},
        {"role": "assistant", "content": visible_text},
    ]
    ultima_vez_new = datetime.now(timezone.utc).isoformat()
    try:
        await asyncio.to_thread(
            activity.update_after_response,
            psid,
            nombre,
            json.dumps(updated_historial, ensure_ascii=False),
            ultima_vez_new,
        )
    except Exception as exc:
        logger.error("Error actualizando actividad: %s", exc)


# ── Helpers privados ─────────────────────────────────────────────────────────

def _parse_json_list(raw: str) -> list:
    try:
        result = json.loads(raw) if raw else []
        return result if isinstance(result, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


def _is_new_session(ultima_vez_str: str) -> bool:
    if not ultima_vez_str:
        return True
    try:
        ultima_vez = datetime.fromisoformat(ultima_vez_str)
        if ultima_vez.tzinfo is None:
            ultima_vez = ultima_vez.replace(tzinfo=timezone.utc)
        elapsed_minutes = (datetime.now(timezone.utc) - ultima_vez).total_seconds() / 60
        return elapsed_minutes > settings.session_timeout_minutes
    except (ValueError, TypeError):
        return True


def _parse_reply(raw: str) -> tuple[bool, dict | None, str]:
    """Extrae PEDIDO_CONFIRMADO (si existe) y retorna (es_pedido, datos, texto_visible)."""
    es_pedido = "PEDIDO_CONFIRMADO" in raw
    pedido_datos: dict | None = None
    visible_text = raw

    if es_pedido:
        match = _PEDIDO_RE.search(raw)
        if match:
            pedido_datos = {
                "nombre": match.group(1).strip(),
                "pedido": match.group(2).strip(),
                "total":  match.group(3).strip(),
            }
        # Remover el bloque técnico del texto visible
        visible_text = re.sub(r"PEDIDO_CONFIRMADO[\s\S]*?\n\n", "", raw, count=1).strip()
        if not visible_text:
            parts = raw.split("\n\n")
            visible_text = "\n\n".join(parts[1:]).strip() if len(parts) > 1 else raw

    return es_pedido, pedido_datos, visible_text


async def _safe_send(psid: str, text: str) -> None:
    try:
        await send_text(psid, text)
    except Exception as exc:
        logger.error("Error enviando mensaje a %s: %s", psid, exc)


async def _safe_send_typing(psid: str) -> None:
    try:
        await send_typing_on(psid)
    except Exception as exc:
        logger.debug("Error enviando typing_on a %s: %s", psid, exc)
