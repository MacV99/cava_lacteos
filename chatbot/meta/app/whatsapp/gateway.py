"""Cliente HTTP hacia el gateway Baileys (servicio Node aparte).

WhatsApp es un canal más del bot. Baileys corre en Node (no hay puerto oficial a
Python), así que se comunica con FastAPI por HTTP:
  - entrada:  el gateway hace POST a  /webhook/whatsapp  (ver app/main.py)
  - salida:   este módulo hace POST a  {WHATSAPP_GATEWAY_URL}/send

El `sender_id` que usamos como clave (y guardamos en Sheets col A) es el `jid`
completo de WhatsApp (ej. "573001234567@s.whatsapp.net" o "...@lid"), para poder
responder por el dominio correcto sin reconstruirlo (lección @lid del kit Baileys).

El nombre (`pushName`) no se consulta a ninguna API: llega en el evento entrante y
se cachea aquí para que el orchestrator lo recupere vía get_profile_name().
"""
import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_http = httpx.AsyncClient(timeout=15)

# jid -> pushName. Lo llena el webhook al recibir un mensaje; lo lee el orchestrator
# cuando aún no hay nombre guardado en la hoja. Se pierde al reiniciar (se rellena solo).
_pushname_cache: dict[str, str] = {}


def remember_pushname(jid: str, name: str | None) -> None:
    if name and name.strip():
        _pushname_cache[jid] = name.strip()


def get_pushname(jid: str) -> str:
    return _pushname_cache.get(jid, "")


def _base_url() -> str | None:
    return settings.whatsapp_gateway_url.rstrip("/") if settings.whatsapp_gateway_url else None


def _headers() -> dict:
    return {"X-Gateway-Secret": settings.whatsapp_shared_secret}


async def send_text(jid: str, text: str) -> None:
    """Pide al gateway Baileys que envíe `text` al `jid`."""
    base = _base_url()
    if not base:
        logger.error("WHATSAPP_GATEWAY_URL no configurada — no se puede enviar a %s", jid)
        return
    resp = await _http.post(base + "/send", headers=_headers(), json={"jid": jid, "text": text})
    if resp.status_code != 200:
        logger.error("Gateway /send error %s: %s", resp.status_code, resp.text)
    resp.raise_for_status()


async def get_status() -> dict:
    """Estado de conexión del gateway: {status, phone}. Si no hay gateway o no responde,
    devuelve status 'sin_gateway' (el panel lo muestra como no disponible)."""
    base = _base_url()
    if not base:
        return {"status": "sin_gateway", "phone": None}
    try:
        resp = await _http.get(base + "/status")
        if resp.status_code == 200:
            data = resp.json()
            return {"status": data.get("status", "disconnected"), "phone": data.get("phone")}
        return {"status": "sin_gateway", "phone": None}
    except Exception as exc:
        logger.warning("Gateway /status no disponible: %s", exc)
        return {"status": "sin_gateway", "phone": None}


async def get_qr() -> dict:
    """QR (data URL) para escanear, vía gateway. {status, phone, qr}."""
    base = _base_url()
    if not base:
        return {"status": "sin_gateway", "phone": None, "qr": None}
    try:
        resp = await _http.get(base + "/qr.json", headers=_headers())
        if resp.status_code == 200:
            return resp.json()
        logger.error("Gateway /qr.json error %s: %s", resp.status_code, resp.text)
        return {"status": "sin_gateway", "phone": None, "qr": None}
    except Exception as exc:
        logger.warning("Gateway /qr.json no disponible: %s", exc)
        return {"status": "sin_gateway", "phone": None, "qr": None}


async def disconnect() -> bool:
    """Cierra la sesión de WhatsApp en el gateway (regenera QR). True si ok."""
    base = _base_url()
    if not base:
        return False
    try:
        resp = await _http.post(base + "/disconnect", headers=_headers())
        return resp.status_code == 200
    except Exception as exc:
        logger.warning("Gateway /disconnect no disponible: %s", exc)
        return False
