"""Singleton de gspread autenticado con service account."""
import base64
import json
import tempfile
import os

import gspread
from google.oauth2.service_account import Credentials

from app.config import settings

_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

_spreadsheet: gspread.Spreadsheet | None = None


def get_spreadsheet() -> gspread.Spreadsheet:
    global _spreadsheet
    if _spreadsheet is None:
        creds = _load_credentials()
        client = gspread.authorize(creds)
        _spreadsheet = client.open_by_key(settings.google_sheets_id)
    return _spreadsheet


def _load_credentials() -> Credentials:
    """Soporta dos modos: archivo JSON o base64 en variable de entorno."""
    if settings.google_sa_json_b64:
        raw = base64.b64decode(settings.google_sa_json_b64).decode("utf-8")
        info = json.loads(raw)
        return Credentials.from_service_account_info(info, scopes=_SCOPES)

    return Credentials.from_service_account_file(
        settings.google_sa_json, scopes=_SCOPES
    )
