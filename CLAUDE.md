# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Cava Lácteos — Workspace

Workspace multi-proyecto para la empresa **Cava Lácteos**. Cada subcarpeta es un proyecto independiente con su propio stack y ciclo de vida.

## Estructura y estado

```
cava_lacteos/
├── website/              ← Sitio web y catálogo (Astro) — sin inicializar
├── chatbot/
│   ├── meta/             ← SERVICIO ÚNICO: cerebro (Messenger + Instagram + WhatsApp Cloud)
│   │                        + panel unificado + Supabase, todo en un FastAPI. EN PRODUCCIÓN (Render)
│   ├── whatsapp-cloud/   ← Panel WhatsApp Node/Express — RETIRADO, portado dentro de meta/ (referencia)
│   └── whatsapp/         ← Gateway Baileys (WhatsApp no oficial, QR) — LEGACY/retirado
└── CLAUDE.md
```

`website/` sigue vacío. `chatbot/meta/` es **un solo servicio** que hace todo: el cerebro
(lógica, LLM, Sheets), recibe el webhook oficial de WhatsApp Cloud, envía por Graph API, y
sirve el **panel** de los 3 canales con persistencia en Supabase. `chatbot/whatsapp-cloud/`
(Node) y `chatbot/whatsapp/` (Baileys) quedaron **retirados** — no desplegar. Se consolidó
en Python para caber en el free tier de Render (1 servicio ≈720 h/mes < 750 h) con un solo
cronjob de keep-alive.

### WhatsApp como canal (todo dentro de meta/)

WhatsApp NO reimplementa la lógica: es un tercer canal junto a Messenger e Instagram, con
**el mismo `handle_event`**. Antes el transporte + panel vivían en un servicio Node aparte
(`whatsapp-cloud/`); se **portaron dentro de `meta/`** para tener un único servicio:

- **Entrada:** el mismo `POST /webhook` (firma `X-Hub-Signature-256`) recibe `object ==
  "whatsapp_business_account"`, lo procesa `app/whatsapp/handler.py` (guarda el entrante en
  el store del panel/Supabase) y —si `ai_on` está activo para ese chat— corre el **mismo**
  `handle_event` con `platform="whatsapp"` en background.
- **Salida:** el bot llama `app.whatsapp.gateway.send_text`, que ahora envía por la **Graph
  API oficial directo** (`app/whatsapp/graph.py`) y guarda el saliente en el store (aparece en
  el panel). `app/messenger/client.py` ramifica por `platform`; el orchestrator no cambió.
- **Panel:** FastAPI sirve la UI estática en `/` (`meta/public/`) y las rutas `/api/*`
  (`app/panel/routes.py`) — conversaciones, envío manual, media, bloqueo, renombrar. Login por
  cookie firmada (`app/panel/auth.py`, `PANEL_PASSWORD`).
- **Toggle IA por chat:** columna `ai_on` (default true) en la tabla `conversations` de Supabase;
  el panel la cambia con `POST /api/ai-toggle`. Off → WhatsApp 100% manual. v1 IA = **solo texto**
  (media entra al panel pero no se manda al LLM; notas de voz salientes: sin ffmpeg, pendiente).
- **Persistencia del panel:** conversaciones en **Supabase** (`app/whatsapp/store.py`, vía
  PostgREST con httpx; sin `SUPABASE_URL` cae a JSON local). El cerebro sigue guardando su estado
  de WhatsApp en Sheets (`actividad`, `canal='whatsapp'`) — dos almacenes distintos por ahora.
- **Pedidos en el panel (SOLO Supabase):** cuando la IA concreta una venta, el bot escribe la
  tabla `pedidos` de Supabase (`app/whatsapp/orders_store.save_order`, llamado desde
  `orchestrator.py`). **Ya NO se escribe la hoja de Sheets** — el puente de migración
  (dual-write + `reconcile_from_sheets`) se retiró: Supabase es la única fuente de verdad, así
  que borrar/editar un pedido en el panel es definitivo (antes la reconciliación desde Sheets lo
  revivía). El panel tiene pantalla **Pedidos** (botón 📦 con badge de nuevos): `GET /api/orders`
  lista, `POST /api/orders/estado` marca despachado/pendiente, `/api/orders/editar` y
  `/api/orders/eliminar`.
- **Total → columna `numeric`:** el LLM manda el total como texto (`"$41,000"`, `"41.000"`).
  `orders_store._num_total` deja solo dígitos antes del insert; sin esto Postgres rechaza con
  `22P02 invalid input syntax for type numeric`. Aplicado en `save_order`, `create_order` y
  `update_order`.
- **Confiabilidad (que ningún pedido se pierda):** el free tier duerme el servicio y un timeout
  transitorio de Supabase por cold-start podía perder el insert. `orders_store.save_order`
  **reintenta** con backoff (`_SAVE_RETRIES=3`); `supabase.insert` devuelve `bool` para saber si
  aceptó. Si agota los reintentos, queda un log `ERROR` con la fila (ya sin red de Sheets).
  `origen_key` (`plataforma:sender_id:fecha`) + índice único en `pedidos` evita duplicados si un
  mismo evento se procesa dos veces. Pendiente: unificar la señal de error de `supabase.py`
  (`insert` devuelve bool; `upsert/update/delete` no).
- **Keep-alive:** free tier duerme el servicio a los ~15 min. Un pinger externo gratuito
  (cron-job.org / UptimeRobot) a `GET /healthz` cada ~10 min lo mantiene despierto. Render Cron
  Jobs es de pago; por eso el pinger externo.

## Convenciones del workspace

- Cada proyecto maneja sus propias dependencias y `.env` dentro de su subcarpeta — nunca en la raíz.
- No mezclar código entre proyectos.
- **Workflow del usuario:** después de cualquier modificación, **el usuario hace `git add` + `commit` + `push` por su cuenta** y prueba en producción (Render auto-despliega). No ofrecer ni ejecutar commits/pushes desde Claude.

---

# Proyecto: `chatbot/meta/`

Bot de Facebook Messenger e Instagram DMs que responde clientes con un LLM (Groq Llama-4-Scout), guarda historial y pedidos en Google Sheets, y replica el workflow original de n8n "CAVA - Messenger".

## Stack

- **FastAPI + Uvicorn** — webhook HTTP en `/webhook`.
- **Groq** — chat (`llama-3.3-70b-versatile`) y Whisper (`whisper-large-v3`) para transcribir audios.
- **Google Sheets como base de datos** — vía `gspread` con service account.
- **APScheduler** — refresca cache cada 2 horas.
- **Render** — host de producción (ver `render.yaml`).

## Comandos

```bash
# Setup (desde chatbot/meta/)
pip install -r requirements.txt
cp .env.example .env  # luego rellenar credenciales

# Correr local
uvicorn app.main:app --reload

# Tests (pytest, sin red: capa WhatsApp/panel — handler, store, auth, errores, rutas)
pytest

# Endpoints útiles
GET  /healthz           — healthcheck
POST /cache/refresh     — fuerza refresco del cache desde Sheets
GET  /webhook           — verificación de Meta (hub.challenge)
POST /webhook           — eventos de Messenger (firma X-Hub-Signature-256)
```

Render ejecuta: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.

## Arquitectura de alto nivel

El flujo de un mensaje sigue 15 pasos documentados en el docstring de [`app/bot/orchestrator.py`](chatbot/meta/app/bot/orchestrator.py). Lo crítico para entender el sistema:

### 1. Buffer debounce (5 s)

Cuando llega un mensaje, el orchestrator:
1. Lo agrega al `buffer` del contacto en la hoja `actividad` y escribe un `procesando` (timestamp único propio).
2. Espera `BUFFER_WAIT_SECONDS` (5 s) con `asyncio.sleep`.
3. Re-lee la fila: si `procesando` ya no es el suyo, otro mensaje posterior tomó el control y este descarta silenciosamente.
4. El último mensaje en la ventana procesa todo el buffer combinado con `\n`.

Esto permite al cliente enviar varios mensajes seguidos y que el bot los responda como uno solo. El `_buffer_locks` por PSID protege la lectura-modificación-escritura del buffer.

### 2. Sheets como DB — pestañas que importan

| Pestaña | Rol | Columnas |
|---|---|---|
| `actividad` | estado por contacto | sender_id \| nombre \| ultima_vez \| historial \| procesando \| buffer \| activado |
| `pedidos` | log de pedidos confirmados | fecha \| sender_id \| nombre \| telefono \| direccion \| pago \| pedido \| total |
| `empresa` | config de la empresa (campo \| valor) | leído por `cache.py` |
| `catalogo` | productos (producto, categoria, presentacion, precio, stock) | leído por `cache.py` |
| `cache` | snapshot derivado de `empresa` + `catalogo` | refrescado cada 2 h |

`cache.py` lee `empresa`/`catalogo` cada 2 horas y materializa el resultado en la pestaña `cache`. El orchestrator solo lee `cache` por mensaje — no las hojas fuente. Para forzar un refresco usar `POST /cache/refresh`.

### 3. System prompt como fuente de verdad

[`app/llm/prompts.py`](chatbot/meta/app/llm/prompts.py) construye el prompt inyectando:
- `empresa` (tono, horario, envíos, métodos de pago, saludo, cierre, etc.).
- `catalogo` formateado.
- Reglas de comportamiento, gramática (yogur/yogures), flujo de compra de 4 pasos, y formato del bloque técnico de pedido.

**Cualquier ajuste de comportamiento del bot va aquí.** No hay máquina de estados en código — el flujo lo dirige el LLM siguiendo el prompt. El prompt termina con un "RECORDATORIO FINAL" porque modelos pequeños obedecen mejor reglas al final (recency bias).

### 4. Protocolo PEDIDO_CONFIRMADO

Cuando el cliente termina de dar todos los datos, el LLM debe emitir un bloque técnico EXACTO antes del mensaje visible:

```
PEDIDO_CONFIRMADO
nombre: ...
telefono: ...
direccion: ...
pago: ...
pedido: ...
total: ...
```

El regex `_PEDIDO_RE` en `orchestrator.py` lo extrae, llama a `orders.register_order(...)` y elimina el bloque del texto que se envía al cliente. Si cambias campos del bloque, hay que tocar **3 puntos sincronizados**:
1. La sección "REGLA CRÍTICA — BLOQUE DE PEDIDO" en `prompts.py`.
2. `_PEDIDO_RE` y la construcción de `pedido_datos` en `orchestrator.py`.
3. La firma de `orders.register_order` y el orden de columnas que escribe.

### 5. Separador `|||` para mensajes dobles

Si el LLM responde con dos ideas separadas por `|||`, el orchestrator las envía como dos mensajes consecutivos al cliente.

### 6. Sesión nueva = saludo

`_is_new_session` considera nueva una conversación si `ultima_vez` está vacía o si pasaron más de `SESSION_TIMEOUT_MINUTES` (default 60). En sesión nueva se descarta el historial al construir el prompt — el LLM saluda con el saludo exacto definido en la hoja `empresa`.

### 7. Tiempo en Bogotá

Toda fecha que se escriba en Sheets pasa por [`app/utils/bogota_time.py`](chatbot/meta/app/utils/bogota_time.py) (`format()` / `parse()`). Formato canónico: `"4/5/2026, 11:23:03 am"`. La implementación es portable (no usa `%-d`/`%-m` que rompen en Windows).

### 8. Seguridad del webhook

`/webhook` POST valida `X-Hub-Signature-256` con `META_APP_SECRET` antes de procesar. La respuesta a Meta es 200 inmediato; el procesamiento real va a `BackgroundTasks` para no chocar con el timeout de 20 s y el debounce de 5 s.

## Acceso de Meta App (importante)

Mientras la app de Meta esté en **Modo Desarrollo / Acceso Estándar**, Messenger solo entrega eventos al webhook de personas con un rol en la página o la app (admins, editores, testers). Cualquier otro usuario escribe y `handle_event` jamás se ejecuta. Para abrir al público se requiere App Review de Meta para `pages_messaging` con Acceso Avanzado y poner la app en Live.

## Variables de entorno

Definidas en `chatbot/meta/app/config.py` (Pydantic Settings, lee `.env`). En Render están como `envVars` en `render.yaml`. Las críticas (sync: false): `META_VERIFY_TOKEN`, `META_PAGE_ACCESS_TOKEN`, `META_APP_SECRET`, `GROQ_API_KEY`, `GOOGLE_SHEETS_ID`, `GOOGLE_SA_JSON_B64`.

`GOOGLE_SA_JSON_B64` es el JSON del service account en base64 — alternativa a `credentials/service_account.json` en local.
