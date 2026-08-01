# Cava WhatsApp Gateway (Baileys)

Gateway **solo de transporte** que conecta un número de WhatsApp por QR (Baileys,
WhatsApp Web no oficial) y lo enlaza con el bot FastAPI de `../meta`. WhatsApp entra
como **un canal más**, junto a Messenger e Instagram: toda la lógica de negocio
(buffer, LLM, Google Sheets, pedidos) vive en el bot Python. Aquí no hay IA ni DB.

## Arquitectura

```
WhatsApp  ─(Baileys WS)─►  gateway Node  ──HTTP POST /webhook/whatsapp──►  bot FastAPI
                                 ▲                                              │
                                 └──────────HTTP POST /send────────────────────┘
```

- **Entrada:** cada mensaje de texto 1:1 → `POST {BOT_WEBHOOK_URL}` con
  `{ jid, phone, name, text, mid }` y header `X-Gateway-Secret`.
- **Salida:** el bot responde llamando `POST /send` `{ jid, text }` con el mismo header.
- **Sesión:** persiste en `auth/` (gitignored). Sin ese folder se re-escanea el QR.

## Correr local

```bash
npm install
cp .env.example .env   # rellenar GATEWAY_SECRET (idéntico al del bot) y BOT_WEBHOOK_URL
npm start
```

Abre `http://localhost:8100/qr`, escanea desde **WhatsApp → Dispositivos vinculados**.
Prueba escribiendo al número desde **OTRO** teléfono (los mensajes propios se ignoran).

## Endpoints

| Método | Ruta        | Auth              | Uso |
|--------|-------------|-------------------|-----|
| GET    | `/healthz`  | —                 | healthcheck |
| GET    | `/status`   | —                 | `{status, phone, hasQr}` |
| GET    | `/qr`       | —                 | página con el QR (auto-refresca 3 s) |
| POST   | `/send`     | `X-Gateway-Secret`| el bot envía `{jid,text}` |

## Variables de entorno (`.env`)

| Var | Propósito |
|-----|-----------|
| `PORT` | puerto HTTP (default 8100) |
| `BOT_WEBHOOK_URL` | webhook del bot: `.../webhook/whatsapp` |
| `GATEWAY_SECRET` | **idéntico** a `WHATSAPP_SHARED_SECRET` del bot |
| `LOG_LEVEL` | `silent\|error\|warn\|info\|debug` (default info) |

## Códigos Baileys (ya mitigados en el código)

- **405** = versión vieja → mitigado con `fetchLatestBaileysVersion`.
- **440** = fingerprint / connectionReplaced → `Browsers.macOS('Desktop')` + backoff 15 s.
- **515** = NO es error, es pairing OK → la reconexión normal lo maneja.
- **401** (loggedOut) = sesión cerrada desde el teléfono → no reconecta; borrar `auth/` y re-escanear.

## Límites v1

- **Solo texto.** Audio/imagen/sticker → responde un aviso fijo (transcribir audio de
  WhatsApp requiere descargar+descifrar media Baileys; queda para v2).
- **Riesgo de ban:** WhatsApp detecta bots no oficiales. Usar un número **secundario**
  del negocio (nunca el personal), sin envíos masivos a desconocidos. Para outbound a
  escala → WhatsApp Business Cloud API oficial, no Baileys.

## Deploy (Render)

Servicio **Node aparte** del bot Python. Necesita **disco persistente** montado en
`auth/` (si no, re-escanea QR en cada deploy). `BOT_WEBHOOK_URL` = URL interna del
servicio Python; `WHATSAPP_GATEWAY_URL` (en el bot) = URL interna de este servicio.
Start command: `npm start`.
