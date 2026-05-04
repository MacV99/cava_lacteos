import hashlib
import hmac
import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request, Response
from fastapi.responses import PlainTextResponse

from app.config import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Cava Lácteos — Facebook Chatbot")

_scheduler = AsyncIOScheduler()


@app.on_event("startup")
async def _startup() -> None:
    from app.sheets.cache import refresh_cache

    # Ejecutar el Cache Updater cada 2 horas (igual que el workflow n8n)
    _scheduler.add_job(refresh_cache, "interval", hours=2, id="cache_updater")
    _scheduler.start()
    logger.info("APScheduler iniciado — cache se actualizará cada 2 h")


@app.on_event("shutdown")
async def _shutdown() -> None:
    _scheduler.shutdown(wait=False)


# ── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


@app.post("/cache/refresh")
async def cache_refresh():
    """Fuerza la actualización del cache manualmente (útil para pruebas)."""
    import asyncio
    from app.sheets.cache import refresh_cache
    await asyncio.to_thread(refresh_cache)
    return {"status": "ok"}


@app.get("/webhook")
async def webhook_verify(
    hub_mode: str | None = None,
    hub_verify_token: str | None = None,
    hub_challenge: str | None = None,
):
    """Meta llama este endpoint al registrar el webhook."""
    if hub_mode == "subscribe" and hub_verify_token == settings.meta_verify_token:
        logger.info("Webhook verificado por Meta")
        return PlainTextResponse(hub_challenge or "")
    raise HTTPException(status_code=403, detail="Verificación fallida")


@app.post("/webhook")
async def webhook_receive(request: Request, background_tasks: BackgroundTasks):
    """Recibe eventos de Messenger.

    Responde 200 inmediatamente (Meta tiene timeout de 20 s) y procesa
    en background para no bloquear la respuesta con el wait de 5 s del debounce.
    """
    raw_body = await request.body()
    _verify_signature(request, raw_body)

    payload = await request.json()

    if payload.get("object") != "page":
        return Response(status_code=200)

    from app.bot.orchestrator import handle_event

    for entry in payload.get("entry", []):
        for messaging in entry.get("messaging", []):
            background_tasks.add_task(handle_event, messaging)

    return Response(content="EVENT_RECEIVED", status_code=200)


# ── Validación de firma ───────────────────────────────────────────────────────

def _verify_signature(request: Request, body: bytes) -> None:
    """Valida X-Hub-Signature-256 enviada por Meta."""
    signature_header = request.headers.get("x-hub-signature-256", "")
    if not signature_header.startswith("sha256="):
        raise HTTPException(status_code=403, detail="Firma ausente")

    expected = hmac.new(
        settings.meta_app_secret.encode(),
        body,
        hashlib.sha256,
    ).hexdigest()

    received = signature_header.removeprefix("sha256=")
    if not hmac.compare_digest(expected, received):
        raise HTTPException(status_code=403, detail="Firma inválida")
