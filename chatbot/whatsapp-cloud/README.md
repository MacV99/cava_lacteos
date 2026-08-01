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

Backend Node/Express (ESM, `fetch` nativo, Node 20+). Sin base de datos: las
conversaciones se guardan en `data/conversations.json` (gitignored).

```
src/
  config.js     lee .env
  store.js      conversaciones + persistencia en disco (debounce 400ms)
  whatsapp.js   envío (sendText/sendTemplate/markRead) + descarga de media
  handler.js    procesa el webhook (entrantes + acuses de estado)
  errors.js     mapa de códigos de error de Meta → lenguaje natural
  server.js     Express: panel + API + /webhook
public/         el panel (index.html, styles.css, app.js)
```

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

## Producción / limpieza

- Antes de entregar, borra `data/conversations.json` (datos de prueba).
- Token temporal = 24h. Para producción usa el **permanente** (System User) en `.env`.
- Despliega el backend con URL fija HTTPS y pon esa URL en Meta (evita re-pegar ngrok).
- Deploy sugerido (Render): servicio **Node aparte**, `npm start`, disco persistente montado
  en `data/` para no perder el historial en cada deploy.
