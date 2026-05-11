"""Descarga audio desde Messenger y lo transcribe con Whisper (Groq)."""
import io
import logging

import httpx

from app.config import settings
from app.llm.groq_client import groq_client as _groq

logger = logging.getLogger(__name__)

_http = httpx.AsyncClient(timeout=30)


async def transcribe_url(audio_url: str) -> str:
    """Descarga el audio de la URL y retorna el texto transcrito."""
    resp = await _http.get(audio_url)
    resp.raise_for_status()
    audio_bytes = resp.content

    file_tuple = ("audio.ogg", io.BytesIO(audio_bytes), "audio/ogg")
    result = await _groq.audio.transcriptions.create(
        file=file_tuple,
        model=settings.groq_whisper_model,
        response_format="text",
    )
    return result.strip() if isinstance(result, str) else result.text.strip()
