import asyncio
import hashlib
import hmac
import logging
import mimetypes
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.panel import auth
from app.panel.routes import router as panel_router
from app.sheets.cache import refresh_cache
from app.whatsapp import store

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_seen_mids: set[str] = set()
_MAX_SEEN = 2000

_scheduler = AsyncIOScheduler()

_PUBLIC_DIR = Path(__file__).resolve().parent.parent / "public"

# ID de build para invalidar cache del PWA en cada deploy. Render expone el SHA del
# commit en RENDER_GIT_COMMIT; en local cae al timestamp de arranque (cambia por
# reinicio). Se inyecta en /sw.js → cada deploy = SW nuevo = la app se recarga sola.
_BUILD_ID = (os.getenv("RENDER_GIT_COMMIT") or str(int(time.time())))[:12]

# En algunos entornos (Windows) el .webmanifest no está mapeado; sin esto
# StaticFiles lo sirve como octet-stream y el navegador ignora el manifest PWA.
mimetypes.add_type("application/manifest+json", ".webmanifest")


@asynccontextmanager
async def _lifespan(app: FastAPI):
    await store.load_all()
    _scheduler.add_job(refresh_cache, "interval", hours=2, id="cache_updater")
    # Pedidos viven SOLO en Supabase. La reconciliación desde Sheets se retiró.
    _scheduler.start()
    logger.info("APScheduler iniciado — cache cada 2 h")
    yield
    _scheduler.shutdown(wait=False)


app = FastAPI(title="Cava Lácteos — Chatbot + Panel (WhatsApp Cloud / Messenger / Instagram)", lifespan=_lifespan)

# CORS (el panel se sirve same-origin; se deja abierto por si se consume desde otro origen).
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.panel_origin] if settings.panel_origin != "*" else ["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


# ── Guard de sesión del panel: protege /api/* (los datos), salvo login/logout/me ──
@app.middleware("http")
async def _panel_auth_guard(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/") and path not in auth.AUTH_PUBLIC and not auth.is_authed(request):
        return JSONResponse({"error": "no autorizado"}, status_code=401)
    return await call_next(request)


# ── Endpoints base ─────────────────────────────────────────────────────────────
@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


@app.post("/cache/refresh")
async def cache_refresh():
    """Fuerza la actualización del cache manualmente (útil para pruebas)."""
    await asyncio.to_thread(refresh_cache)
    return {"status": "ok"}


# ── Webhook: verificación (GET) — Messenger, Instagram y WhatsApp comparten URL ──
@app.get("/webhook")
async def webhook_verify(
    hub_mode: str | None = Query(None, alias="hub.mode"),
    hub_verify_token: str | None = Query(None, alias="hub.verify_token"),
    hub_challenge: str | None = Query(None, alias="hub.challenge"),
):
    valid_tokens = {settings.meta_verify_token}
    if settings.whatsapp_verify_token:
        valid_tokens.add(settings.whatsapp_verify_token)
    if hub_mode == "subscribe" and hub_verify_token in valid_tokens:
        logger.info("Webhook verificado por Meta")
        return PlainTextResponse(hub_challenge or "")
    raise HTTPException(status_code=403, detail="Verificación fallida")


@app.post("/webhook")
async def webhook_receive(request: Request, background_tasks: BackgroundTasks):
    """Recibe eventos de Messenger, Instagram DMs y WhatsApp Cloud.

    Responde 200 inmediato (Meta tiene timeout de 20 s) y procesa en background para
    no bloquear con el debounce de 5 s del bot.
    """
    import json as _json

    raw_body = await request.body()
    try:
        payload = _json.loads(raw_body)
    except Exception:
        payload = {}
    platform = payload.get("object")  # "page" | "instagram" | "whatsapp_business_account"

    _verify_signature(request, raw_body, platform)

    if platform == "whatsapp_business_account":
        from app.whatsapp.handler import handle_webhook_body
        await handle_webhook_body(payload, background_tasks)
        return Response(content="EVENT_RECEIVED", status_code=200)

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
def _verify_signature(request: Request, body: bytes, platform: str | None = None) -> None:
    """Valida X-Hub-Signature-256 (Messenger, Instagram y WhatsApp usan el mismo esquema).

    WhatsApp puede venir de otra app Meta (distinta a la de Messenger). Si no configuras
    `WHATSAPP_APP_SECRET`, su firma NO se verifica (comportamiento del panel Node viejo,
    útil para pruebas). Setéalo en producción para cerrar el webhook. Messenger/IG siempre
    se verifican con `META_APP_SECRET`.
    """
    if platform == "whatsapp_business_account":
        if not settings.whatsapp_app_secret:
            logger.warning("WhatsApp: sin WHATSAPP_APP_SECRET → firma NO verificada (setéalo en prod)")
            return
        secrets = [settings.whatsapp_app_secret]
    else:
        secrets = [settings.meta_app_secret]
        if settings.meta_ig_app_secret:
            secrets.append(settings.meta_ig_app_secret)

    signature_header = request.headers.get("x-hub-signature-256", "")
    if not signature_header.startswith("sha256="):
        raise HTTPException(status_code=403, detail="Firma ausente")
    received = signature_header.removeprefix("sha256=")

    for secret in secrets:
        expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        if hmac.compare_digest(expected, received):
            return

    raise HTTPException(status_code=403, detail="Firma inválida")


# ── Service worker: servido dinámico para inyectar el build id ────────────────
# Debe ir ANTES del mount estático (las rutas explícitas ganan). Reemplaza el
# placeholder __BUILD_ID__ del archivo por el SHA del deploy → cada push cambia el
# byte del SW → el navegador instala el SW nuevo y la app se recarga sola.
_SW_TEXT = (_PUBLIC_DIR / "sw.js").read_text(encoding="utf-8").replace("__BUILD_ID__", _BUILD_ID)


@app.get("/sw.js")
async def service_worker():
    return Response(
        content=_SW_TEXT,
        media_type="application/javascript",
        headers={"Cache-Control": "no-cache"},  # revalida siempre; nunca sirve un SW viejo
    )


# ── Panel: rutas /api/* + UI estática ─────────────────────────────────────────
class _NoCacheStatic(StaticFiles):
    """Sirve los estáticos con `Cache-Control: no-cache`: el navegador revalida en
    cada carga (ETag → 304 barato si no cambió). Así un deploy nuevo se ve sin
    Ctrl+Shift+F5, sin renombrar archivos ni build step."""

    async def get_response(self, path, scope):
        resp = await super().get_response(path, scope)
        resp.headers["Cache-Control"] = "no-cache"
        return resp


app.include_router(panel_router)
# El mount de estáticos va AL FINAL: las rutas explícitas (/api, /webhook, /sw.js…) ganan.
app.mount("/", _NoCacheStatic(directory=str(_PUBLIC_DIR), html=True), name="panel")
