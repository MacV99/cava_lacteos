"""Fixtures compartidas de los tests.

Aíslan la capa de WhatsApp/panel para correr SIN red: store en memoria (Supabase
deshabilitado, sin escribir a disco) y sin cargar nada al arrancar.
"""
import pytest
from fastapi.testclient import TestClient

import app.whatsapp.supabase as sb
from app.config import settings
from app.whatsapp import handler, store


async def _noop_async():
    return None


@pytest.fixture(autouse=True)
def isolate_store(monkeypatch):
    # Store 100% en memoria: sin Supabase, sin persistir a disco, sin carga inicial.
    monkeypatch.setattr(sb, "enabled", False)
    monkeypatch.setattr(store, "_persist_file", lambda: None)
    monkeypatch.setattr(store, "load_all", _noop_async)
    store._conversations.clear()
    handler._seen_mids.clear()
    yield
    store._conversations.clear()
    handler._seen_mids.clear()


@pytest.fixture
def panel_password(monkeypatch):
    monkeypatch.setattr(settings, "panel_password", "testpass")
    return "testpass"


@pytest.fixture
def client(panel_password):
    from app.main import app
    with TestClient(app) as c:
        yield c
