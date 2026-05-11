"""Lee la configuración del bot (tono, nombre, frases prohibidas) desde Sheets."""
from dataclasses import dataclass, field

from app.config import settings
from app.sheets.client import get_spreadsheet


@dataclass
class BotConfig:
    bot_name: str = "Asesor"
    tone: str = "amable y profesional"
    forbidden_phrases: list[str] = field(default_factory=list)


def get_bot_config() -> BotConfig:
    ws = get_spreadsheet().worksheet(settings.sheet_tab_config)
    rows = ws.get_all_records()
    # TODO: ajustar según la estructura real de la pestaña Config
    # Se asume filas: Clave | Valor  (ej. "nombre_bot" | "Cavi")
    data = {str(r.get("Clave", "")).lower(): r.get("Valor", "") for r in rows}
    forbidden_raw = data.get("frases_prohibidas", "")
    forbidden = [f.strip() for f in str(forbidden_raw).split(",") if f.strip()]
    return BotConfig(
        bot_name=str(data.get("nombre_bot", "Asesor")),
        tone=str(data.get("tono", "amable y profesional")),
        forbidden_phrases=forbidden,
    )
