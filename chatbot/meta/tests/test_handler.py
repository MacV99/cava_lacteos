"""Tests del handler del webhook de WhatsApp Cloud (parseo + store + despacho a IA)."""
import sys
import types

import pytest

from app.whatsapp import gateway, handler, store


class FakeBG:
    def __init__(self):
        self.calls = []

    def add_task(self, fn, *args):
        self.calls.append((getattr(fn, "__name__", str(fn)), args))


@pytest.fixture(autouse=True)
def stub_orchestrator(monkeypatch):
    """Evita importar el orchestrator real (LLM/Sheets) — el handler solo lo encola."""
    fake = types.ModuleType("app.bot.orchestrator")
    fake.handle_event = lambda *a, **k: None
    monkeypatch.setitem(sys.modules, "app.bot.orchestrator", fake)


def _text_body(wa="57300", mid="m1", text="hola", name="Ana"):
    return {"object": "whatsapp_business_account", "entry": [{"changes": [{"value": {
        "contacts": [{"wa_id": wa, "profile": {"name": name}}],
        "messages": [{"from": wa, "id": mid, "timestamp": "1700000000", "type": "text",
                      "text": {"body": text}}],
    }}]}]}


# ── _extract_message (unit) ──────────────────────────────────────────────────
def test_extract_text():
    m = handler._extract_message({"id": "x", "timestamp": "1700000000", "type": "text", "text": {"body": "hey"}})
    assert m["type"] == "text" and m["text"] == "hey" and m["ts"] == 1700000000000


def test_extract_button_becomes_text():
    m = handler._extract_message({"id": "x", "timestamp": "1", "type": "button", "button": {"text": "Sí"}})
    assert m["type"] == "text" and m["text"] == "Sí"


def test_extract_interactive_reply():
    m = handler._extract_message({"id": "x", "timestamp": "1", "type": "interactive",
                                  "interactive": {"button_reply": {"title": "Comprar"}}})
    assert m["type"] == "text" and m["text"] == "Comprar"


def test_extract_media_keeps_ids():
    m = handler._extract_message({"id": "x", "timestamp": "1", "type": "image",
                                  "image": {"id": "media1", "mime_type": "image/jpeg", "caption": "mira"}})
    assert m["mediaId"] == "media1" and m["mime"] == "image/jpeg" and m["text"] == "mira"


def test_extract_unknown_type():
    m = handler._extract_message({"id": "x", "timestamp": "1", "type": "contacts"})
    assert m["type"] == "text" and "no soportado" in m["text"]


# ── handle_webhook_body (integración en memoria) ─────────────────────────────
async def test_inbound_stores_and_enqueues():
    bg = FakeBG()
    await handler.handle_webhook_body(_text_body(text="tienen yogur?"), bg)
    convs = store.list_conversations()
    assert len(convs) == 1 and convs[0]["messages"][-1]["text"] == "tienen yogur?"
    assert gateway.get_pushname("57300") == "Ana"
    assert len(bg.calls) == 1
    messaging, platform = bg.calls[0][1]
    assert platform == "whatsapp" and messaging["sender"]["id"] == "57300"


async def test_ai_off_stores_but_does_not_enqueue():
    await store.add_inbound("57300", "Ana", {"id": "prev", "ts": 1, "type": "text", "text": "hola"})
    await store.set_ai_on("57300", False)
    bg = FakeBG()
    await handler.handle_webhook_body(_text_body(mid="m2", text="otra"), bg)
    assert bg.calls == []  # IA apagada → no se molesta al bot
    assert len(store.get_conversation("57300")["messages"]) == 2  # pero sí se guarda


async def test_duplicate_mid_not_enqueued_twice():
    bg = FakeBG()
    await handler.handle_webhook_body(_text_body(mid="dup"), bg)
    await handler.handle_webhook_body(_text_body(mid="dup"), bg)
    assert len(bg.calls) == 1


async def test_ignores_non_whatsapp_object():
    bg = FakeBG()
    await handler.handle_webhook_body({"object": "page", "entry": []}, bg)
    assert bg.calls == [] and store.list_conversations() == []


async def test_status_update_marks_failed():
    await store.add_outbound("57300", {"id": "wamid.1", "ts": 1, "type": "text", "text": "hi"})
    body = {"object": "whatsapp_business_account", "entry": [{"changes": [{"value": {
        "statuses": [{"id": "wamid.1", "status": "failed", "timestamp": "1",
                      "errors": [{"code": 131047, "title": "fuera de ventana"}]}]}}]}]}
    await handler.handle_webhook_body(body, FakeBG())
    assert store.get_conversation("57300")["messages"][0]["status"] == "failed"
