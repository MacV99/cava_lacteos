# Cava — Panel unificado (WhatsApp Cloud API + Messenger + Instagram)

Backend Node/Express para el número oficial de WhatsApp de **La Cava Lácteos** (WhatsApp
**Cloud API**, número real, negocio verificado) que además **sirve un panel único** para
administrar los **3 canales** desde una sola pantalla:

- **WhatsApp** → tiempo real por este backend (webhook + envío). Responder **a mano, sin IA**.
- **Messenger + Instagram** → leídos/escritos desde la Google Sheet vía el Apps Script (`GAS_URL`
  en `public/app.js`). Conservan la **IA** del bot Python; el panel deja apagarla por chat y
  responder a mano. Este backend NO toca esa lógica.

El panel viejo `../../panel/` queda reemplazado por el de aquí (`public/`).

> Enviar a Messenger/IG usa el Apps Script, que requiere `META_PAGE_ACCESS_TOKEN` y
> `META_IG_ACCESS_TOKEN` en las Propiedades del script (igual que el panel viejo).

> No confundir con `../whatsapp/` (gateway **Baileys**, WhatsApp no oficial por QR, que
> enlaza con el bot Python). Esto es la **API oficial** y es autónomo: no toca Sheets ni el LLM.

## Arquitectura

```
Cliente WhatsApp → Meta → (URL pública HTTPS) → POST /webhook → store → panel
panel (responder)  → POST /api/send → Graph API → Meta → Cliente WhatsApp
```

Backend Node/Express (ESM, `fetch` nativo, Node 20+). **Persistencia intercambiable**:
si defines `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, las conversaciones viven en
**Postgres (Supabase)**; si no, caen a `data/conversations.json` local (dev/fallback).
El store mantiene todo en memoria (lecturas rápidas) y hace write-through al backend elegido.

> En Render el disco es **efímero** → el JSON se borra en cada deploy. Por eso producción
> usa Supabase (ver `supabase/schema.sql`).

```
src/
  config.js     lee .env
  supabase.js   cliente Supabase (service-role; solo backend)
  store.js      conversaciones en memoria + write-through (Supabase | JSON)
  whatsapp.js   envío (sendText/sendTemplate/markRead) + descarga de media + salud del número
  handler.js    procesa el webhook (entrantes + acuses de estado) + reenvía al bot si IA on
  bridge.js     puente panel → bot Python (POST {BOT_WEBHOOK_URL} con X-Gateway-Secret)
  errors.js     mapa de códigos de error de Meta → lenguaje natural
  server.js     Express: panel + API + /webhook + /send (bot → panel)
public/         el panel (index.html, styles.css, app.js)
supabase/       schema.sql (tablas conversations + messages, RLS)
scripts/        migrate-json-to-supabase.js (import único del JSON)
```

### IA en WhatsApp — puente al bot Python (opcional)

Con `GATEWAY_SECRET` + `BOT_WEBHOOK_URL` definidas, WhatsApp usa **el mismo cerebro de IA**
que Messenger/IG (bot Python `chatbot/meta/`), sin duplicar lógica. Este panel hace de
**gateway** (el rol que tenía el viejo Baileys), reusando el contrato que el bot ya habla:

```
Cliente → Meta → panel /webhook → guarda en Supabase
                               └→ (si ai_on) POST {BOT_WEBHOOK_URL} {jid,phone,name,text,mid}
Bot Python (Groq) → POST panel /send {jid,text} → Graph API → Cliente
                                               └→ guarda saliente en Supabase (visible en panel)
```

- **Toggle por chat** (`ai_on` en la tabla `conversations`, default `true`): el interruptor del
  panel lo cambia vía `POST /api/ai-toggle`. On → el webhook reenvía; off → 100% manual.
- **Lado del bot: cero código**, solo config → apunta `WHATSAPP_GATEWAY_URL` a la URL de este
  panel y usa el MISMO secreto: `WHATSAPP_SHARED_SECRET` (bot) = `GATEWAY_SECRET` (panel).
- **v1 = solo texto.** Media entrante (fotos, notas de voz) no dispara la IA; se atiende a mano.

## Puesta en marcha

```bash
npm install
cp .env.example .env   # rellenar credenciales (ver abajo)
npm start              # http://localhost:3000
```

### Variables (`.env`)

| Var | Qué es | Dónde |
|-----|--------|-------|
| `META_TOKEN` | token permanente (System User) o temporal 24h | Business Settings → System Users |
| `PHONE_NUMBER_ID` | ID largo del número (NO el +1 555...) | App → WhatsApp → Configuración de la API |
| `WABA_ID` | WhatsApp Business Account ID | misma pantalla |
| `VERIFY_TOKEN` | string secreto que tú eliges (el mismo va en Meta) | tú lo inventas |
| `GRAPH_VERSION` | versión del Graph API (default `v25.0`) | — |
| `PORT` | puerto HTTP (default 3000) | — |

## Conectar en Meta (pasos)

1. **Publicar la URL.** Local: un túnel — `npx localtunnel --port 3000` o `ngrok http 3000`
   (deja el server **y** el túnel corriendo). La URL de ngrok cambia en cada reinicio →
   hay que re-pegarla en Meta; para producción, despliega con URL fija HTTPS.
2. App → WhatsApp → **Configuración → Webhooks**:
   - Callback URL: `https://TU-URL/webhook`
   - Verify token: el mismo `VERIFY_TOKEN` del `.env`
   - Verificar y guardar (en los logs debe salir `[webhook] verificado OK`)
   - Suscribir el campo **`messages`**.
3. **⚠️ GOTCHA #1 — suscribir la app a la WABA.** Configurar el webhook lo **verifica pero
   NO entrega mensajes**. Falta esto (si no, verifica pero nunca llega nada):
   ```bash
   curl -X POST "https://graph.facebook.com/v25.0/{WABA_ID}/subscribed_apps?access_token={META_TOKEN}"
   # respuesta esperada: {"success":true}
   ```
   Verifica con `GET` al mismo endpoint: tu app debe aparecer en la lista.
4. Negocio verificado + número Conectado → puedes escribir a **cualquier** cliente
   (no hay límite de 5 destinatarios del número de prueba).

## Reglas y detalles que importan

- **Ventana de 24h:** texto libre solo si el cliente escribió hace < 24h. El panel muestra
  un badge Abierta/Cerrada por chat y **bloquea el composer** si está cerrada. Fuera de las
  24h solo se puede con **plantilla aprobada** (`/api/send` acepta `{ template }`).
- **Acuses:** cada saliente muestra ✓ (sent) → ✓✓ (delivered) → ✓✓ azul (read) o ⚠ (failed,
  toca el ⚠ para ver el error en lenguaje natural). El nivel sube, nunca baja.
- **Media entrante:** la media de WhatsApp no es URL abierta (2 pasos con token). El backend
  la proxya en `GET /api/media/:id`; el panel la muestra y abre en **lightbox**. Las imágenes
  expiran ~30 días → fallback vía `onerror`.
- **Errores de Meta:** modal en lenguaje natural (`errors.js`, ~15 códigos clave + fallback):
  131047 (fuera de 24h→plantilla), 190/0 (token vencido), 131026 (sin WhatsApp),
  130403 (te bloquearon), 80007/130429 (rate limit), 132001 (plantilla no aprobada), etc.

## API

| Método | Ruta | Uso |
|--------|------|-----|
| GET | `/webhook` | verificación (hub.challenge) |
| POST | `/webhook` | recepción (200 rápido, procesa async) |
| GET | `/api/conversations` | snapshot para el panel (poll cada 3s) |
| POST | `/api/send` | `{ to, text }` o `{ to, template }` |
| POST | `/api/read` | `{ waId }` — limpia no leídos + acusa read |
| GET | `/api/media/:id` | proxy de media entrante |
| GET | `/api/errors.json` | mapa de errores para el modal |
| GET | `/healthz` | healthcheck |

## Checklist de prueba

- [ ] `GET /webhook?hub.mode=subscribe&hub.verify_token=TU_TOKEN&hub.challenge=X` → devuelve `X`
- [ ] Escribir desde un WhatsApp real al número → aparece en el panel
- [ ] Responder desde el panel → llega al WhatsApp
- [ ] Enviar una foto → se ve en el panel (proxy) y abre en lightbox
- [ ] ✓ / ✓✓ / ✓✓ azul aparecen al enviar
- [ ] Un error (ej. token malo) abre el modal en lenguaje natural

## Deploy en Render (runbook)

Persistencia = **Supabase** (ya no hace falta disco persistente). Hay `render.yaml`.

1. **Supabase listo:** proyecto de La Cava con el esquema aplicado (`supabase/schema.sql`).
2. **Crear el servicio** en Render desde el repo, **Root Directory** = `chatbot/whatsapp-cloud`
   (o usar el `render.yaml`). Runtime Node, `npm install` / `npm start`, health check `/healthz`.
3. **Env vars** (todas `sync:false` en `render.yaml`): `META_TOKEN`, `PHONE_NUMBER_ID`, `WABA_ID`,
   `VERIFY_TOKEN`, `PANEL_PASSWORD`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, y para la IA
   `GATEWAY_SECRET` + `BOT_WEBHOOK_URL`.
4. **Webhook en Meta:** Callback URL = `https://<servicio>.onrender.com/webhook`, mismo `VERIFY_TOKEN`,
   y suscribir el campo **`messages`**.
5. **Cablear la IA con el bot** (`chatbot/meta/`): en su Render, `WHATSAPP_GATEWAY_URL` = URL de
   este panel y `WHATSAPP_SHARED_SECRET` = el **mismo** `GATEWAY_SECRET`.
6. **Verificar:** `GET /healthz` → `{ok:true}`; escribir al número → aparece en el panel y (si `ai_on`)
   responde la IA.

Notas: token de Meta = **permanente** (System User), no el temporal de 24h. En Render free el
servicio duerme tras ~15 min de inactividad (primer mensaje tras dormir tarda en el cold start).
