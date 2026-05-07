"""Bot de Instagram mínimo — responde 'respuesta ok' a todo DM."""
import hashlib
import hmac
import logging
import os

import httpx
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request, Response
from fastapi.responses import PlainTextResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Cava Lácteos — Instagram test")

_VERIFY_TOKEN = os.environ["IG_VERIFY_TOKEN"]
_ACCESS_TOKEN = os.environ["IG_PAGE_ACCESS_TOKEN"]
_APP_SECRET = os.environ["IG_APP_SECRET"]
_GRAPH_URL = "https://graph.instagram.com/v21.0/me/messages"


# ── Webhook verify ────────────────────────────────────────────────────────────

@app.get("/webhook")
async def webhook_verify(
    hub_mode: str | None = None,
    hub_verify_token: str | None = None,
    hub_challenge: str | None = None,
):
    if hub_mode == "subscribe" and hub_verify_token == _VERIFY_TOKEN:
        logger.info("Webhook verificado")
        return PlainTextResponse(hub_challenge or "")
    raise HTTPException(status_code=403, detail="Verificación fallida")


# ── Webhook receive ───────────────────────────────────────────────────────────

@app.post("/webhook")
async def webhook_receive(request: Request, background_tasks: BackgroundTasks):
    raw_body = await request.body()
    _verify_signature(request, raw_body)

    payload = await request.json()

    if payload.get("object") != "instagram":
        return Response(status_code=200)

    for entry in payload.get("entry", []):
        # Instagram Graph API usa "changes[]"; Messenger Platform usa "messaging[]"
        for change in entry.get("changes", []):
            if change.get("field") == "messages":
                background_tasks.add_task(_handle, change.get("value", {}))
        for messaging in entry.get("messaging", []):
            background_tasks.add_task(_handle, messaging)

    return Response(content="EVENT_RECEIVED", status_code=200)


# ── Lógica ────────────────────────────────────────────────────────────────────

async def _handle(messaging: dict) -> None:
    sender_id = messaging.get("sender", {}).get("id")
    message = messaging.get("message", {})

    if not sender_id or message.get("is_echo"):
        return

    text = message.get("text", "")
    logger.info("Mensaje de %s: %s", sender_id, text)

    await _send(sender_id, "¡Hola! 🐮 Bienvenid@ a La Cava Lácteos. ¿En qué podemos ayudarte hoy? ♻️")


async def _send(psid: str, text: str) -> None:
    payload = {"recipient": {"id": psid}, "message": {"text": text}}
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            _GRAPH_URL,
            headers={"Authorization": f"Bearer {_ACCESS_TOKEN}"},
            json=payload,
        )
        if resp.status_code != 200:
            logger.error("Graph API error %s: %s", resp.status_code, resp.text)
        resp.raise_for_status()


# ── Firma ─────────────────────────────────────────────────────────────────────

def _verify_signature(request: Request, body: bytes) -> None:
    sig = request.headers.get("x-hub-signature-256", "")
    if not sig.startswith("sha256="):
        raise HTTPException(status_code=403, detail="Firma ausente")
    received = sig.removeprefix("sha256=")
    expected = hmac.new(_APP_SECRET.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received):
        raise HTTPException(status_code=403, detail="Firma inválida")


# ── Healthcheck ───────────────────────────────────────────────────────────────

@app.get("/healthz")
async def healthz():
    return {"status": "ok"}
