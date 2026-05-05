from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # Meta / Facebook + Instagram
    meta_verify_token: str
    meta_page_access_token: str = "EAAU3ivFe4TsBRSem7vWYBIS0YmK3SPtFVXZBRzAk1nna2FJYfHr9PJoVgGc0NErz3GLevisoJgunHpxWrCPZAvDhZCzLWMZC4H3Qky2VYAAXc4moP7o9FJooKk6t4m15CazohNQG1S68SlrH0i2jGuYnUShxDEHeLxvMBjD7qZAVclAYMQ1LU2ssAo4sr5LSkN5nB6SuhAtfP1ZBZAQntYaZA1MkbYWb97ZBYLv4Qogph7ZC2ZAlu6K6AaJX72rn19D5BTK5KP03ODQprsq3OGZAjjjj5gZDZD"
    meta_app_secret: str
    meta_ig_access_token: str = ""
    meta_ig_app_secret: str = "5331411355a969f01db4125ec8e060bb"
    meta_ig_account_id: str = "17841436769814214"

    # Groq
    groq_api_key: str
    groq_chat_model: str = "meta-llama/llama-4-scout-17b-16e-instruct"
    groq_whisper_model: str = "whisper-large-v3"

    # Google Sheets
    google_sheets_id: str
    google_sa_json: str = "credentials/service_account.json"
    google_sa_json_b64: str = ""  # alternativa: JSON en base64 (útil en Render)

    # URL del catálogo (incluida en el system prompt)
    catalog_url: str = "https://catalogo-la-cava.netlify.app/"

    # Comportamiento del bot
    buffer_wait_seconds: int = 5
    history_max_items: int = 28   # equivale a slice(-28) del n8n
    session_timeout_minutes: int = 60


settings = Settings()
