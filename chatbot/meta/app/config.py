from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # Meta / Facebook + Instagram
    meta_verify_token: str
    meta_page_access_token: str
    meta_app_secret: str
    meta_ig_access_token: str = ""
    meta_ig_app_secret: str = ""
    meta_ig_account_id: str = "17841436769814214"

    # Groq
    groq_api_key: str
    groq_chat_model: str = "openai/gpt-oss-120b"
    groq_whisper_model: str = "whisper-large-v3"

    # ── WhatsApp Cloud API (canal oficial) ────────────────────────────────────
    # Antes vivían en el servicio Node aparte (whatsapp-cloud). Ahora el mismo
    # FastAPI recibe el webhook oficial y envía por Graph API directo.
    meta_token: str = ""                 # token System User permanente del número
    phone_number_id: str = ""            # ID largo del número (NO el +57 300...)
    waba_id: str = ""
    graph_version: str = "v25.0"
    whatsapp_verify_token: str = ""      # si vacío, el webhook usa meta_verify_token
    whatsapp_app_secret: str = ""        # si la WABA vive en otra app Meta; si vacío, usa meta_app_secret

    # ── Persistencia del panel (Supabase de La Cava) ──────────────────────────
    # Si ambas están, el store persiste en Postgres; si faltan, cae a JSON local.
    supabase_url: str = ""
    supabase_service_role_key: str = ""

    # ── Panel admin ───────────────────────────────────────────────────────────
    panel_password: str = ""            # login del panel (vacío = panel abierto, solo dev)
    panel_origin: str = "*"             # CORS: origen del panel. "*" = abierto

    # Google Sheets
    google_sheets_id: str
    google_sa_json: str = "credentials/service_account.json"
    google_sa_json_b64: str = ""  # alternativa: JSON en base64 (útil en Render)

    # URL del catálogo (incluida en el system prompt)
    catalog_url: str = "https://lacavalacteos.com/"

    # Comportamiento del bot
    buffer_wait_seconds: int = 5
    history_max_items: int = 28   # equivale a slice(-28) del n8n
    session_timeout_minutes: int = 60


settings = Settings()
