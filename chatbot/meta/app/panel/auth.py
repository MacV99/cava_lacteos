"""Login por contraseña con cookie firmada (HMAC), sin estado en memoria.

Port de la lógica de sesión de `whatsapp-cloud/src/server.js`. La sesión es una cookie
firmada con expiración → sobrevive reinicios/deploys. Cambiar PANEL_PASSWORD invalida
todas las sesiones. Si PANEL_PASSWORD está vacío, el panel queda abierto (solo dev).
"""
import hashlib
import hmac
import re
import time

from fastapi import Request

from app.config import settings

SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000  # 30 días
COOKIE_NAME = "panel_session"
AUTH_PUBLIC = {"/api/login", "/api/logout", "/api/me"}


def _session_secret() -> str:
    # Derivado de la contraseña: estable entre reinicios.
    return hmac.new(b"cava-panel-v1", (settings.panel_password or "").encode(), hashlib.sha256).hexdigest()


def _sign_part(exp: int) -> str:
    return hmac.new(_session_secret().encode(), str(exp).encode(), hashlib.sha256).hexdigest()


def make_session() -> str:
    exp = int(time.time() * 1000) + SESSION_TTL_MS
    return f"{exp}.{_sign_part(exp)}"


def valid_session(token: str) -> bool:
    if not token or "." not in token:
        return False
    exp_str, sig = token.split(".", 1)
    try:
        exp = int(exp_str)
    except ValueError:
        return False
    if exp < int(time.time() * 1000):
        return False
    expected = _sign_part(exp)
    return hmac.compare_digest(sig, expected)


def cookie_token(request: Request) -> str:
    raw = request.headers.get("cookie", "")
    m = re.search(r"(?:^|;\s*)panel_session=([^;]+)", raw)
    return m.group(1) if m else ""


def is_authed(request: Request) -> bool:
    if not settings.panel_password:
        return True  # sin clave configurada → abierto
    return valid_session(cookie_token(request))
