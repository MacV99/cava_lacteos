"""Tests de orders_store — reintento de save_order y normalización de total (Supabase-only)."""
import asyncio

import pytest

from app.whatsapp import orders_store
from app.whatsapp import supabase as sb


@pytest.fixture
def enable_sb(monkeypatch):
    monkeypatch.setattr(sb, "enabled", True)
    # sleep instantáneo para no ralentizar el test
    async def _fast_sleep(_):
        return None
    monkeypatch.setattr(asyncio, "sleep", _fast_sleep)


def _args():
    return ("psid1", "Miguel", "3172366425", "villa rosa", "efectivo", "1 Yogurt", "29000", "whatsapp")


@pytest.mark.asyncio
async def test_guarda_al_primer_intento(enable_sb, monkeypatch):
    calls = []
    async def fake_insert(table, row):
        calls.append(row); return True
    monkeypatch.setattr(sb, "insert", fake_insert)
    assert await orders_store.save_order(*_args()) is True
    assert len(calls) == 1
    assert calls[0]["plataforma"] == "whatsapp" and calls[0]["total"] == "29000"


@pytest.mark.asyncio
async def test_reintenta_y_logra(enable_sb, monkeypatch):
    n = {"i": 0}
    async def flaky_insert(table, row):
        n["i"] += 1
        return n["i"] >= 2  # falla la 1ª, entra la 2ª
    monkeypatch.setattr(sb, "insert", flaky_insert)
    assert await orders_store.save_order(*_args()) is True
    assert n["i"] == 2


@pytest.mark.asyncio
async def test_reintenta_ante_excepcion(enable_sb, monkeypatch):
    n = {"i": 0}
    async def raise_then_ok(table, row):
        n["i"] += 1
        if n["i"] == 1:
            raise RuntimeError("timeout simulado")
        return True
    monkeypatch.setattr(sb, "insert", raise_then_ok)
    assert await orders_store.save_order(*_args()) is True
    assert n["i"] == 2


@pytest.mark.asyncio
async def test_agota_reintentos_devuelve_false(enable_sb, monkeypatch):
    n = {"i": 0}
    async def always_fail(table, row):
        n["i"] += 1; return False
    monkeypatch.setattr(sb, "insert", always_fail)
    assert await orders_store.save_order(*_args()) is False
    assert n["i"] == orders_store._SAVE_RETRIES


@pytest.mark.asyncio
async def test_sin_supabase_noop(monkeypatch):
    monkeypatch.setattr(sb, "enabled", False)
    assert await orders_store.save_order(*_args()) is False


@pytest.mark.asyncio
async def test_incluye_origen_key_cuando_se_pasa(enable_sb, monkeypatch):
    rows = []
    async def fake_insert(table, row):
        rows.append(row); return True
    monkeypatch.setattr(sb, "insert", fake_insert)
    await orders_store.save_order(*_args(), key="whatsapp:psid1:fx")
    assert rows[0]["origen_key"] == "whatsapp:psid1:fx"


# ── normalización de total (columna numeric) ─────────────────────────────────

@pytest.mark.parametrize("entrada,esperado", [
    ("$41,000", "41000"),   # símbolo + coma de miles (el bug que rompía el insert)
    ("41.000", "41000"),    # punto de miles
    ("$ 29000 COP", "29000"),
    ("29000", "29000"),
    (29000, "29000"),
    ("", None),             # vacío → null
    ("gratis", None),       # sin dígitos → null
])
def test_num_total_normaliza(entrada, esperado):
    assert orders_store._num_total(entrada) == esperado


@pytest.mark.asyncio
async def test_save_order_normaliza_total(enable_sb, monkeypatch):
    rows = []
    async def fake_insert(table, row):
        rows.append(row); return True
    monkeypatch.setattr(sb, "insert", fake_insert)
    args = ("psid1", "Miguel", "3172366425", "villa rosa", "efectivo", "2 Fresas keto", "$41,000", "whatsapp")
    assert await orders_store.save_order(*args) is True
    assert rows[0]["total"] == "41000"   # ya no manda "$41,000" a la columna numeric
