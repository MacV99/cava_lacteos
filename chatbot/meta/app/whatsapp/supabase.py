"""Cliente Supabase mínimo vía PostgREST (httpx) — SOLO backend.

En vez de traer `supabase-py`, hablamos directo con la REST API de Supabase con la
service-role key (bypass RLS). Es async-nativo sobre el httpx que ya usa el proyecto.
Si faltan las vars, `enabled` es False y el store cae a JSON local.

Tablas (creadas en Fase 1 del panel Node):
  conversations(wa_id pk, name, last_inbound_ts, unread, blocked, ai_on, updated_at)
  messages(wa_id fk, wamid, dir, type, text, media_id, mime, filename, ts, status, error, reaction, reply_to)
"""
import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

enabled = bool(settings.supabase_url and settings.supabase_service_role_key)

_base = settings.supabase_url.rstrip("/") + "/rest/v1" if settings.supabase_url else ""
_http = httpx.AsyncClient(timeout=15)


def _headers(extra: dict | None = None) -> dict:
    h = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Content-Type": "application/json",
    }
    if extra:
        h.update(extra)
    return h


async def select(table: str, params: dict | None = None) -> list:
    r = await _http.get(f"{_base}/{table}", headers=_headers(), params={"select": "*", **(params or {})})
    r.raise_for_status()
    return r.json()


async def upsert(table: str, row: dict, on_conflict: str) -> None:
    r = await _http.post(
        f"{_base}/{table}",
        headers=_headers({"Prefer": "resolution=merge-duplicates,return=minimal"}),
        params={"on_conflict": on_conflict},
        json=row,
    )
    if r.status_code >= 300:
        logger.error("[supabase] upsert %s: %s %s", table, r.status_code, r.text)


async def insert(table: str, row: dict) -> bool:
    """Inserta una fila. Devuelve True si Supabase la aceptó (2xx), False si no."""
    r = await _http.post(f"{_base}/{table}", headers=_headers({"Prefer": "return=minimal"}), json=row)
    if r.status_code >= 300:
        logger.error("[supabase] insert %s: %s %s", table, r.status_code, r.text)
        return False
    return True


async def update(table: str, patch: dict, filters: dict) -> bool:
    """Aplica un patch. Devuelve True si Supabase lo aceptó (2xx), False si no."""
    r = await _http.patch(f"{_base}/{table}", headers=_headers({"Prefer": "return=minimal"}),
                          params={k: f"eq.{v}" for k, v in filters.items()}, json=patch)
    if r.status_code >= 300:
        logger.error("[supabase] update %s: %s %s", table, r.status_code, r.text)
        return False
    return True


async def delete(table: str, filters: dict) -> bool:
    """Borra filas. Devuelve True si Supabase lo aceptó (2xx), False si no."""
    r = await _http.request("DELETE", f"{_base}/{table}", headers=_headers({"Prefer": "return=minimal"}),
                            params={k: f"eq.{v}" for k, v in filters.items()})
    if r.status_code >= 300:
        logger.error("[supabase] delete %s: %s %s", table, r.status_code, r.text)
        return False
    return True
