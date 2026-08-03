"""Rutas HTTP del panel (/api/*). Port de los endpoints de `whatsapp-cloud/src/server.js`.

El frontend estático (public/app.js) es el contrato: rutas, campos y shapes de respuesta
deben coincidir exactos. La UI hace polling a /api/conversations y envía por /api/send.
"""
import time

from fastapi import APIRouter, File, Form, Request, Response, UploadFile
from fastapi.responses import JSONResponse

from app.config import settings
from app.panel import auth
from app.whatsapp import graph, orders_store, store
from app.whatsapp.errors import ERROR_FALLBACK, ERROR_MAP, explain_error, full_message

router = APIRouter()

WINDOW_MS = 24 * 60 * 60 * 1000


def _now() -> int:
    return int(time.time() * 1000)


def _graph_error_body(e: graph.GraphError) -> dict:
    info = explain_error(e.code)
    return {"ok": False, "code": e.code, "message": full_message(e), "error": {"code": e.code, **info}}


# ── Login ────────────────────────────────────────────────────────────────────
@router.get("/api/me")
async def api_me(request: Request):
    return {"authed": auth.is_authed(request), "needsPassword": bool(settings.panel_password)}


@router.post("/api/login")
async def api_login(request: Request):
    body = await request.json()
    password = (body or {}).get("password")
    if not settings.panel_password or password != settings.panel_password:
        return JSONResponse({"ok": False, "error": "clave incorrecta"}, status_code=401)
    # Secure solo bajo HTTPS (Render va detrás de proxy → X-Forwarded-Proto). En http local, no.
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    resp = JSONResponse({"ok": True})
    resp.set_cookie(auth.COOKIE_NAME, auth.make_session(), max_age=auth.SESSION_TTL_MS // 1000,
                    httponly=True, path="/", samesite="lax", secure=(proto == "https"))
    return resp


@router.post("/api/logout")
async def api_logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(auth.COOKIE_NAME, path="/")
    return resp


# ── Conversaciones ───────────────────────────────────────────────────────────
@router.get("/api/conversations")
async def api_conversations():
    now = _now()
    out = []
    for c in store.list_conversations():
        last_in = c["lastInboundTs"]
        out.append({
            **c,
            "windowOpen": last_in > 0 and now - last_in < WINDOW_MS,
            "windowMsLeft": max(0, WINDOW_MS - (now - last_in)) if last_in > 0 else 0,
        })
    return {"conversations": out, "serverNow": now}


# ── Pedidos (migración Sheets → Supabase) ────────────────────────────────────
@router.get("/api/orders")
async def api_orders():
    return {"orders": await orders_store.list_orders(), "serverNow": _now()}


@router.post("/api/orders/crear")
async def api_orders_crear(request: Request):
    body = await request.json() or {}
    if not any((body.get(k) or "").strip() for k in orders_store.CAMPOS_EDITABLES):
        return JSONResponse({"error": "el pedido está vacío"}, status_code=400)
    if not await orders_store.create_order(body):
        return JSONResponse({"error": "no se pudo crear (Supabase no configurado o falló)"}, status_code=400)
    return {"ok": True}


@router.post("/api/orders/estado")
async def api_orders_estado(request: Request):
    body = await request.json() or {}
    order_id, estado = body.get("id"), body.get("estado")
    if order_id is None or not estado:
        return JSONResponse({"error": "faltan id y estado"}, status_code=400)
    if not await orders_store.set_estado(order_id, estado):
        return JSONResponse({"error": "estado inválido o Supabase no configurado"}, status_code=400)
    return {"ok": True, "estado": estado}


@router.post("/api/orders/editar")
async def api_orders_editar(request: Request):
    body = await request.json() or {}
    order_id = body.get("id")
    patch = {k: body.get(k) for k in orders_store.CAMPOS_EDITABLES if k in body}
    if order_id is None or not patch:
        return JSONResponse({"error": "faltan id y campos a editar"}, status_code=400)
    if not await orders_store.update_order(order_id, patch):
        return JSONResponse({"error": "no se pudo editar (Supabase no configurado o falló)"}, status_code=400)
    return {"ok": True}


@router.post("/api/orders/eliminar")
async def api_orders_eliminar(request: Request):
    body = await request.json() or {}
    order_id = body.get("id")
    if order_id is None:
        return JSONResponse({"error": "falta id"}, status_code=400)
    if not await orders_store.delete_order(order_id):
        return JSONResponse({"error": "no se pudo eliminar (Supabase no configurado o falló)"}, status_code=400)
    return {"ok": True}


# ── Envío ────────────────────────────────────────────────────────────────────
@router.post("/api/send")
async def api_send(request: Request):
    body = await request.json() or {}
    to, text, template, reply_to = body.get("to"), body.get("text"), body.get("template"), body.get("replyTo")
    if not to or (not text and not template):
        return JSONResponse({"error": "faltan to y text"}, status_code=400)
    try:
        if template:
            data = await graph.send_template(to, template["name"], template.get("lang", "es"), template.get("components"))
            msg = {"type": "template", "text": f"[plantilla: {template['name']}]"}
        else:
            data = await graph.send_text(to, text, reply_to)
            msg = {"type": "text", "text": text, "replyTo": reply_to}
        wamid = (data.get("messages") or [{}])[0].get("id")
        await store.add_outbound(to, {"id": wamid, "ts": _now(), **msg})
        return {"ok": True, "id": wamid}
    except graph.GraphError as e:
        return JSONResponse(_graph_error_body(e), status_code=502)


@router.post("/api/send-media")
async def api_send_media(
    to: str = Form(...),
    type: str = Form(...),
    file: UploadFile = File(...),
    caption: str | None = Form(None),
    replyTo: str | None = Form(None),
):
    buffer = await file.read()
    mime = file.content_type or "application/octet-stream"
    filename = file.filename or "adjunto"
    try:
        # v1 sin ffmpeg: se sube el binario tal cual. Audio → nota de voz (voice:true);
        # si el navegador manda webm, Meta puede rechazar con 131053 (se ve en el panel).
        up = await graph.upload_media(buffer, mime, filename)
        media_id = up.get("id")
        data = await graph.send_media(to, type, media_id, caption=caption, filename=filename,
                                      reply_to=replyTo, voice=(type == "audio"))
        wamid = (data.get("messages") or [{}])[0].get("id")
        await store.add_outbound(to, {"id": wamid, "ts": _now(), "type": type, "mediaId": media_id,
                                      "mime": mime, "filename": filename, "text": caption or "", "replyTo": replyTo})
        return {"ok": True, "id": wamid, "mediaId": media_id}
    except graph.GraphError as e:
        return JSONResponse(_graph_error_body(e), status_code=502)


# ── Gestión de mensajes / conversaciones ─────────────────────────────────────
@router.post("/api/message/delete")
async def api_message_delete(request: Request):
    body = await request.json() or {}
    wa_id, message_id = body.get("waId"), body.get("messageId")
    if not wa_id or not message_id:
        return JSONResponse({"error": "faltan waId y messageId"}, status_code=400)
    return {"ok": await store.delete_message(wa_id, message_id)}


@router.post("/api/conversation/delete")
async def api_conversation_delete(request: Request):
    body = await request.json() or {}
    wa_id = body.get("waId")
    if not wa_id:
        return JSONResponse({"error": "falta waId"}, status_code=400)
    return {"ok": await store.delete_conversation(wa_id)}


@router.post("/api/conversation/block")
async def api_conversation_block(request: Request):
    body = await request.json() or {}
    wa_id, block = body.get("waId"), body.get("block")
    if not wa_id:
        return JSONResponse({"error": "falta waId"}, status_code=400)
    try:
        if block:
            await graph.block_user(wa_id)
        else:
            await graph.unblock_user(wa_id)
        await store.set_blocked(wa_id, bool(block))
        return {"ok": True, "blocked": bool(block)}
    except graph.GraphError as e:
        return JSONResponse(_graph_error_body(e), status_code=502)


@router.post("/api/read")
async def api_read(request: Request):
    body = await request.json() or {}
    wa_id = body.get("waId")
    if not wa_id:
        return JSONResponse({"error": "falta waId"}, status_code=400)
    c = store.get_conversation(wa_id)
    await store.mark_read(wa_id)
    # acusa read del último entrante en WhatsApp (best-effort)
    if c:
        last_in = next((m for m in reversed(c["messages"]) if m.get("dir") == "in" and m.get("id")), None)
        if last_in:
            await graph.mark_read(last_in["id"])
    return {"ok": True}


@router.post("/api/ai-toggle")
async def api_ai_toggle(request: Request):
    body = await request.json() or {}
    wa_id, on = body.get("waId"), body.get("on")
    if not wa_id:
        return JSONResponse({"error": "falta waId"}, status_code=400)
    c = await store.set_ai_on(wa_id, bool(on))
    if not c:
        return JSONResponse({"error": "conversación no encontrada"}, status_code=404)
    return {"ok": True, "aiOn": c["aiOn"]}


@router.post("/api/rename")
async def api_rename(request: Request):
    body = await request.json() or {}
    wa_id, name = body.get("waId"), body.get("name")
    if not wa_id:
        return JSONResponse({"error": "falta waId"}, status_code=400)
    c = await store.rename(wa_id, name)
    if not c:
        return JSONResponse({"error": "conversación no encontrada"}, status_code=404)
    return {"ok": True, "name": c["name"]}


# ── Media entrante: proxy <img src="/api/media/{id}"> ────────────────────────
@router.get("/api/media/{media_id}")
async def api_media(media_id: str):
    try:
        meta = await graph.get_media_url(media_id)
        buffer, content_type = await graph.download_media(meta["url"])
        return Response(content=buffer, media_type=content_type or meta.get("mime_type") or "application/octet-stream",
                        headers={"Cache-Control": "private, max-age=86400"})
    except Exception:
        return Response(status_code=502)


# ── Estado / errores ─────────────────────────────────────────────────────────
@router.get("/api/errors.json")
async def api_errors():
    return {"map": ERROR_MAP, "fallback": ERROR_FALLBACK}


@router.get("/api/health/channels")
async def api_health_channels():
    return {"whatsapp": await graph.get_phone_health(), "serverNow": _now()}
