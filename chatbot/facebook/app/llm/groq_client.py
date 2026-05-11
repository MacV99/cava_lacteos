"""Wrapper de Groq para chat completions. Exporta el cliente singleton `groq_client`."""
import logging

from groq import AsyncGroq

from app.config import settings

logger = logging.getLogger(__name__)

# Singleton compartido — importar desde aquí para no crear instancias duplicadas.
groq_client = AsyncGroq(api_key=settings.groq_api_key)


async def chat(messages: list[dict]) -> str:
    """Llama a Groq con los mensajes (system ya incluido) y retorna la respuesta."""
    response = await groq_client.chat.completions.create(
        model=settings.groq_chat_model,
        messages=messages,
        temperature=0.5,
        max_tokens=700,
    )
    reply = response.choices[0].message.content or ""
    logger.debug("Groq reply (primeros 100 chars): %s", reply[:100])
    return reply
