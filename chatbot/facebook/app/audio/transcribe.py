"""Descarga audio desde Messenger y lo transcribe con Whisper (Groq)."""
import io
import logging

import httpx
from groq import AsyncGroq

from app.config import settings

logger = logging.getLogger(__name__)

_groq = AsyncGroq(api_key=settings.groq_api_key)


async def transcribe_url(audio_url: str) -> str:
    """Descarga el audio de la URL y retorna el texto transcrito."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(audio_url)
        resp.raise_for_status()
        audio_bytes = resp.content

    file_tuple = ("audio.ogg", io.BytesIO(audio_bytes), "audio/ogg")
    result = await _groq.audio.transcriptions.create(
        file=file_tuple,
        model=settings.groq_whisper_model,
        response_format="text",
    )
    return result.strip() if isinstance(result, str) else result.text.strip()
