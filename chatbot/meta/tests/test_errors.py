"""Tests del mapa de errores de Meta."""
import types

from app.whatsapp.errors import ERROR_FALLBACK, explain_error, full_message


def test_known_code():
    info = explain_error(131047)
    assert "24h" in info["titulo"] or "24h" in info["explica"]
    assert info["gravedad"] in ("info", "warn", "error")


def test_unknown_code_falls_back():
    assert explain_error(999999) is ERROR_FALLBACK


def test_full_message_combines_title():
    e = types.SimpleNamespace(message="boom", title="detalle fino")
    assert full_message(e) == "boom — detalle fino"


def test_full_message_without_title():
    e = types.SimpleNamespace(message="boom", title=None)
    assert full_message(e) == "boom"


def test_full_message_title_equal_message_not_duplicated():
    e = types.SimpleNamespace(message="boom", title="boom")
    assert full_message(e) == "boom"
