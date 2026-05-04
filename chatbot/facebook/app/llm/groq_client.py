"""Wrapper de Groq para chat completions."""
import logging

from groq import AsyncGroq

from app.config import settings

logger = logging.getLogger(__name__)

_groq = AsyncGroq(api_key=settings.groq_api_key)


async def chat(messages: list[dict]) -> str:
    """Llama a Groq con los mensajes (system ya incluido) y retorna la respuesta."""
    response = await _groq.chat.completions.create(
        model=settings.groq_chat_model,
        messages=messages,
        temperature=0.5,
        max_tokens=700,
    )
    reply = response.choices[0].message.content or ""
    logger.debug("Groq reply (primeros 100 chars): %s", reply[:100])
    return reply
