"""Descarga audio desde Messenger y lo transcribe con Whisper (Groq)."""
import io
import logging

import httpx

from app.config import settings
from app.llm.groq_client import groq_client as _groq

logger = logging.getLogger(__name__)

_http = httpx.AsyncClient(timeout=30)


async def transcribe_bytes(audio_bytes: bytes, mime: str | None = None) -> str:
    """Transcribe bytes de audio con Whisper (Groq). Retorna el texto.

    `mime` (p. ej. 'audio/ogg; codecs=opus' de WhatsApp) solo decide la extensión/tipo
    del archivo que se manda a Whisper; si falta se asume ogg.
    """
    ext = "ogg"
    if mime and "/" in mime:
        ext = (mime.split("/", 1)[1].split(";", 1)[0].strip()) or "ogg"
    file_tuple = (f"audio.{ext}", io.BytesIO(audio_bytes), mime or "audio/ogg")
    result = await _groq.audio.transcriptions.create(
        file=file_tuple,
        model=settings.groq_whisper_model,
        response_format="text",
    )
    return result.strip() if isinstance(result, str) else result.text.strip()


async def transcribe_url(audio_url: str) -> str:
    """Descarga el audio de una URL pública (Messenger) y lo transcribe."""
    resp = await _http.get(audio_url)
    resp.raise_for_status()
    return await transcribe_bytes(resp.content, "audio/ogg")
