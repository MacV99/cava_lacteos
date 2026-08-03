"""Tests de orders_store — reintento de save_order y reconciliación Sheets→Supabase."""
import asyncio

import pytest

from app.sheets import orders as sheets_orders
from app.whatsapp import orders_store
from app.whatsapp import supabase as sb


def _sheet_row(sender="573172366425", nombre="miguel cuellar", tel="3172366425",
               dire="villa rosa cra43#20a-57", pago="efectivo",
               pedido="1 Yogurt de Café 1 Litro", total="29000", plat="whatsapp",
               fecha="2/8/2026, 5:54:34 p. m."):
    return {"fecha": fecha, "sender_id": sender, "nombre": nombre, "telefono": tel,
            "direccion": dire, "pago": pago, "pedido": pedido, "total": total, "plataforma": plat}


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


# ── reconcile_from_sheets ────────────────────────────────────────────────────

@pytest.fixture
def recon_sb(monkeypatch):
    """Supabase falso en memoria para reconcile: select/insert/update rastreados."""
    monkeypatch.setattr(sb, "enabled", True)
    async def _fast_sleep(_):
        return None
    monkeypatch.setattr(asyncio, "sleep", _fast_sleep)
    state = {"existing": [], "inserted": [], "updated": []}
    async def fake_select(table, params=None):
        return list(state["existing"])
    async def fake_insert(table, row):
        state["inserted"].append(row); return True
    async def fake_update(table, patch, filters):
        state["updated"].append((filters, patch))
    monkeypatch.setattr(sb, "select", fake_select)
    monkeypatch.setattr(sb, "insert", fake_insert)
    monkeypatch.setattr(sb, "update", fake_update)
    return state


def _set_sheet(monkeypatch, rows):
    monkeypatch.setattr(sheets_orders, "read_all", lambda: rows)


@pytest.mark.asyncio
async def test_reconcile_inserta_faltante(recon_sb, monkeypatch):
    _set_sheet(monkeypatch, [_sheet_row()])   # en Sheets, no en Supabase
    n = await orders_store.reconcile_from_sheets()
    assert n == 1
    assert len(recon_sb["inserted"]) == 1
    assert recon_sb["inserted"][0]["origen_key"] == "whatsapp:573172366425:2/8/2026, 5:54:34 p. m."


@pytest.mark.asyncio
async def test_reconcile_salta_existente_por_key(recon_sb, monkeypatch):
    key = orders_store.origen_key("whatsapp", "573172366425", "2/8/2026, 5:54:34 p. m.")
    recon_sb["existing"] = [{"id": 9, "origen_key": key}]
    _set_sheet(monkeypatch, [_sheet_row()])
    n = await orders_store.reconcile_from_sheets()
    assert n == 0
    assert recon_sb["inserted"] == [] and recon_sb["updated"] == []


@pytest.mark.asyncio
async def test_reconcile_adopta_fila_vieja_sin_key(recon_sb, monkeypatch):
    # Fila vieja en Supabase con MISMO contenido pero sin origen_key → se adopta, no se duplica
    recon_sb["existing"] = [{
        "id": 4, "sender_id": "573172366425", "telefono": "3172366425",
        "pedido": "1 Yogurt de Café 1 Litro", "total": 29000, "plataforma": "whatsapp",
        "origen_key": None,
    }]
    _set_sheet(monkeypatch, [_sheet_row()])
    n = await orders_store.reconcile_from_sheets()
    assert n == 1
    assert recon_sb["inserted"] == []            # no insertó duplicado
    assert recon_sb["updated"] == [({"id": 4}, {"origen_key": "whatsapp:573172366425:2/8/2026, 5:54:34 p. m."})]


@pytest.mark.asyncio
async def test_reconcile_sin_supabase_noop(monkeypatch):
    monkeypatch.setattr(sb, "enabled", False)
    _set_sheet(monkeypatch, [_sheet_row()])
    assert await orders_store.reconcile_from_sheets() == 0
