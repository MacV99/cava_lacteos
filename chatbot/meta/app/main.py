import asyncio
import hashlib
import hmac
import logging
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse

from app.config import settings
from app.sheets.cache import refresh_cache

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_seen_mids: set[str] = set()
_MAX_SEEN = 2000

_scheduler = AsyncIOScheduler()


@asynccontextmanager
async def _lifespan(app: FastAPI):
    _scheduler.add_job(refresh_cache, "interval", hours=2, id="cache_updater")
    _scheduler.start()
    logger.info("APScheduler iniciado — cache se actualizará cada 2 h")
    yield
    _scheduler.shutdown(wait=False)


app = FastAPI(title="Cava Lácteos — Chatbot (Messenger + Instagram + WhatsApp)", lifespan=_lifespan)

# CORS para que el panel estático consuma /connections* desde otro origen.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.panel_origin] if settings.panel_origin != "*" else ["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


def _check_panel_token(request: Request) -> None:
    """Si PANEL_TOKEN está definido, exige el header X-Panel-Token en /connections*."""
    if settings.panel_token and request.headers.get("x-panel-token", "") != settings.panel_token:
        raise HTTPException(status_code=403, detail="Panel token inválido")


# ── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


@app.post("/cache/refresh")
async def cache_refresh():
    """Fuerza la actualización del cache manualmente (útil para pruebas)."""
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
    """Recibe eventos de Messenger e Instagram DMs.

    Responde 200 inmediatamente (Meta tiene timeout de 20 s) y procesa
    en background para no bloquear la respuesta con el wait de 5 s del debounce.
    """
    raw_body = await request.body()
    _verify_signature(request, raw_body)

    payload = await request.json()

    platform = payload.get("object")  # "page" (Messenger) o "instagram"
    if platform not in ("page", "instagram"):
        return Response(status_code=200)

    from app.bot.orchestrator import handle_event

    for entry in payload.get("entry", []):
        # Messenger Platform: entry[].messaging[]
        for messaging in entry.get("messaging", []):
            _enqueue(messaging, platform, background_tasks, handle_event)
        # Instagram Graph API: entry[].changes[] con field="messages"
        for change in entry.get("changes", []):
            if change.get("field") == "messages":
                _enqueue(change.get("value", {}), platform, background_tasks, handle_event)

    return Response(content="EVENT_RECEIVED", status_code=200)


@app.get("/connections")
async def connections_status(request: Request):
    """Estado de conexión de los 3 canales para el panel admin.

    whatsapp: {status, phone} desde el gateway Baileys.
    messenger / instagram: {status, name?} según validez del token de Meta.
    """
    _check_panel_token(request)
    from app.messenger.client import check_connection
    from app.whatsapp import gateway as wa_gateway

    wa = await wa_gateway.get_status()
    messenger = await check_connection("messenger")
    instagram = await check_connection("instagram")
    return {"whatsapp": wa, "messenger": messenger, "instagram": instagram}


@app.get("/connections/whatsapp/qr")
async def connections_whatsapp_qr(request: Request):
    """QR (data URL) para vincular WhatsApp, vía gateway."""
    _check_panel_token(request)
    from app.whatsapp import gateway as wa_gateway
    return await wa_gateway.get_qr()


@app.post("/connections/whatsapp/disconnect")
async def connections_whatsapp_disconnect(request: Request):
    """Cierra la sesión de WhatsApp (regenera QR)."""
    _check_panel_token(request)
    from app.whatsapp import gateway as wa_gateway
    ok = await wa_gateway.disconnect()
    return {"ok": ok}


@app.post("/webhook/whatsapp")
async def webhook_whatsapp(request: Request, background_tasks: BackgroundTasks):
    """Recibe mensajes de texto reenviados por el gateway Baileys (servicio Node).

    El gateway ya normalizó el evento a: { jid, phone, name, text, mid }.
    Aquí se autentica con el secreto compartido, se sintetiza el shape que espera
    `parse()` (igual que Messenger) y se procesa con el MISMO orchestrator.
    Responde 200 rápido; el trabajo real (buffer 5 s + LLM) va a background.
    """
    from app.bot.orchestrator import handle_event
    from app.whatsapp import gateway as wa_gateway

    secret = request.headers.get("x-gateway-secret", "")
    if not settings.whatsapp_shared_secret or secret != settings.whatsapp_shared_secret:
        raise HTTPException(status_code=403, detail="Secreto inválido")

    payload = await request.json()
    jid = str(payload.get("jid", "")).strip()
    text = str(payload.get("text", "")).strip()
    if not jid or not text:
        return Response(status_code=200)

    mid = str(payload.get("mid", "")).strip()
    if mid:
        if mid in _seen_mids:
            logger.info("WA duplicado ignorado mid=%s", mid)
            return Response(status_code=200)
        _seen_mids.add(mid)
        if len(_seen_mids) > _MAX_SEEN:
            _seen_mids.clear()

    # El pushName no viene de ninguna API: lo cacheamos para que el orchestrator
    # lo recupere vía get_profile_name(jid, "whatsapp").
    wa_gateway.remember_pushname(jid, payload.get("name"))

    # Shape compatible con parser.parse() (usa sender.id como psid = jid).
    messaging = {"sender": {"id": jid}, "message": {"text": text, "mid": mid or None}}
    background_tasks.add_task(handle_event, messaging, "whatsapp")

    return Response(content="EVENT_RECEIVED", status_code=200)


def _enqueue(messaging: dict, platform: str, background_tasks: BackgroundTasks, handle_event) -> None:
    mid = messaging.get("message", {}).get("mid", "")
    if mid:
        if mid in _seen_mids:
            logger.info("Duplicado ignorado mid=%s", mid)
            return
        _seen_mids.add(mid)
        if len(_seen_mids) > _MAX_SEEN:
            _seen_mids.clear()
    background_tasks.add_task(handle_event, messaging, platform)


# ── Validación de firma ───────────────────────────────────────────────────────

def _verify_signature(request: Request, body: bytes) -> None:
    """Valida X-Hub-Signature-256 enviada por Meta (Messenger o Instagram)."""
    signature_header = request.headers.get("x-hub-signature-256", "")
    if not signature_header.startswith("sha256="):
        raise HTTPException(status_code=403, detail="Firma ausente")

    received = signature_header.removeprefix("sha256=")

    secrets = [settings.meta_app_secret]
    if settings.meta_ig_app_secret:
        secrets.append(settings.meta_ig_app_secret)

    for secret in secrets:
        expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        if hmac.compare_digest(expected, received):
            return

    raise HTTPException(status_code=403, detail="Firma inválida")
