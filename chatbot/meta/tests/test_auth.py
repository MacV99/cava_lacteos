"""Tests del login por cookie firmada (HMAC) del panel."""
import types

from app.config import settings
from app.panel import auth


def _fake_request(cookie: str):
    return types.SimpleNamespace(headers={"cookie": cookie})


def test_session_roundtrip(monkeypatch):
    monkeypatch.setattr(settings, "panel_password", "secret")
    assert auth.valid_session(auth.make_session()) is True


def test_session_rejects_tampered(monkeypatch):
    monkeypatch.setattr(settings, "panel_password", "secret")
    exp, sig = auth.make_session().split(".", 1)
    tampered = f"{exp}.{sig[:-1]}{'0' if sig[-1] != '0' else '1'}"
    assert auth.valid_session(tampered) is False


def test_session_rejects_expired(monkeypatch):
    monkeypatch.setattr(settings, "panel_password", "secret")
    exp = 1  # ms epoch en el pasado
    assert auth.valid_session(f"{exp}.{auth._sign_part(exp)}") is False


def test_password_change_invalidates_sessions(monkeypatch):
    monkeypatch.setattr(settings, "panel_password", "secret")
    token = auth.make_session()
    monkeypatch.setattr(settings, "panel_password", "otra-clave")
    assert auth.valid_session(token) is False


def test_cookie_token_parsing():
    assert auth.cookie_token(_fake_request("a=1; panel_session=XYZ; b=2")) == "XYZ"
    assert auth.cookie_token(_fake_request("nada=1")) == ""


def test_is_authed_open_when_no_password(monkeypatch):
    monkeypatch.setattr(settings, "panel_password", "")
    assert auth.is_authed(_fake_request("")) is True


def test_is_authed_requires_valid_cookie(monkeypatch):
    monkeypatch.setattr(settings, "panel_password", "secret")
    assert auth.is_authed(_fake_request("")) is False
    good = auth.make_session()
    assert auth.is_authed(_fake_request(f"panel_session={good}")) is True
