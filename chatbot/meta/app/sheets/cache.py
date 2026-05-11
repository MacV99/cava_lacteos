"""Operaciones sobre la hoja 'cache' y lógica del Cache Updater.

La hoja cache tiene dos filas:
  clave='empresa'  → valor=JSON con config de la empresa
  clave='catalogo' → valor=texto formateado del catálogo

El Cache Updater lee las hojas 'empresa' y 'catalogo', las procesa
y escribe el resultado en 'cache'. Corre cada 2 horas (APScheduler en main.py).
"""
import json
import logging
import threading

import gspread

from app.sheets.client import get_spreadsheet

logger = logging.getLogger(__name__)

_TAB_CACHE    = "cache"
_TAB_EMPRESA  = "empresa"
_TAB_CATALOGO = "catalogo"

_mem_cache: dict = {}
_cache_lock = threading.Lock()


def get_cache() -> dict:
    """Retorna {'empresa': dict, 'catalogo': str} desde memoria.

    En cold start (primera llamada tras arranque) dispara refresh_cache() para poblar el cache.
    A partir de ahí solo refresh_cache() actualiza el cache — vía APScheduler (cada 2h)
    o el endpoint POST /cache/refresh.
    """
    with _cache_lock:
        if not _mem_cache:
            _refresh_locked()
        return dict(_mem_cache)


def refresh_cache() -> None:
    """Lee empresa + catalogo, escribe en la hoja cache y actualiza el cache en memoria."""
    with _cache_lock:
        _refresh_locked()


def _refresh_locked() -> None:
    """Ejecuta el refresco real. Debe llamarse con _cache_lock ya adquirido."""
    global _mem_cache
    ss = get_spreadsheet()
    empresa = _read_empresa(ss)
    catalogo_text = _read_catalogo(ss)

    ws_cache = ss.worksheet(_TAB_CACHE)
    _upsert_cache_row(ws_cache, "empresa", json.dumps(empresa, ensure_ascii=False))
    _upsert_cache_row(ws_cache, "catalogo", catalogo_text)

    _mem_cache = {"empresa": empresa, "catalogo": catalogo_text}
    logger.info("Cache actualizado: empresa y catalogo")


# ---------------------------------------------------------------------------
# Helpers internos
# ---------------------------------------------------------------------------

def _read_empresa(ss: gspread.Spreadsheet) -> dict:
    """Lee la hoja 'empresa' (campo | valor) y retorna un dict."""
    rows = ss.worksheet(_TAB_EMPRESA).get_all_records()
    empresa: dict = {}
    for row in rows:
        campo = str(row.get("campo", "")).strip()
        valor = str(row.get("valor", "")).strip()
        if campo and valor:
            empresa[campo] = valor
    return empresa


def _read_catalogo(ss: gspread.Spreadsheet) -> str:
    """Lee la hoja 'catalogo' y retorna texto formateado para el prompt."""
    rows = ss.worksheet(_TAB_CATALOGO).get_all_records()
    lines = []
    for row in rows:
        producto     = str(row.get("producto", "")).strip()
        categoria    = str(row.get("categoria", "")).strip()
        presentacion = str(row.get("presentacion", "")).strip()
        precio_raw   = row.get("precio", 0)
        stock_raw    = row.get("stock", 0)

        try:
            precio = int(float(str(precio_raw).replace(",", "").replace(".", "")))
            precio_fmt = f"{precio:,}".replace(",", ".")
        except (ValueError, TypeError):
            precio_fmt = str(precio_raw)

        try:
            stock = int(float(str(stock_raw)))
            stock_info = f"Stock: {stock} uds" if stock > 0 else "AGOTADO"
        except (ValueError, TypeError):
            stock_info = "AGOTADO"

        lines.append(
            f"• {producto} | {categoria} | {presentacion} | ${precio_fmt} COP | {stock_info}"
        )
    return "\n".join(lines)


def _upsert_cache_row(ws: gspread.Worksheet, clave: str, valor: str) -> None:
    """Actualiza la fila de la clave o la crea si no existe."""
    try:
        cell = ws.find(clave, in_column=1)
        ws.update([[clave, valor]], range_name=f"A{cell.row}:B{cell.row}")
    except gspread.exceptions.CellNotFound:
        ws.append_row([clave, valor], value_input_option="USER_ENTERED")
