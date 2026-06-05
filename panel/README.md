# Cava Panel — Administrador de Chats (PWA)

Interfaz gráfica para que el cliente administre los chats del bot sin tocar el Excel/Google Sheets.

## Qué hace

- Lista todos los chats de la hoja `actividad`.
- Muestra el **canal** de cada chat con su logo (Facebook Messenger / Instagram).
- **Toggle de IA por chat**: activa/desactiva el bot para un cliente concreto (escribe `activado` = TRUE/FALSE).
- Abre cualquier chat y muestra el **historial completo** de la conversación.
- Búsqueda por nombre.
- Instalable como app (PWA) en celular y escritorio.

Stack: HTML/CSS/JS puro + Google Apps Script (GAS) sobre la misma Google Sheet del bot. Sin backend extra.

## Cómo funciona (resumen)

```
PWA (panel/)  ──GET JSONP──►  Apps Script (gas.gs)  ──►  Hoja "actividad"
              ──POST toggle─►
```

El bot ya respeta `activado`: si la columna G dice `FALSE`, no responde a ese cliente
(ver `chatbot/meta/app/bot/orchestrator.py`). El panel solo cambia ese valor.

## Puesta en marcha

### 1. Preparar la hoja
En la Google Sheet del bot, hoja `actividad`, agregar el encabezado **`canal`** en la celda **H1**
(las columnas A–G ya existen). El bot llena `canal` automáticamente en el siguiente mensaje de cada cliente.

> Nota: los chats viejos mostrarán canal "—" hasta que ese cliente vuelva a escribir.

### 2. Desplegar el Apps Script
1. En la Sheet: **Extensiones → Apps Script**.
2. Pegar el contenido de [`gas.gs`](gas.gs).
3. **Implementar → Nueva implementación → Aplicación web**.
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
4. Copiar la URL `/exec`.

> Cada vez que edites `gas.gs`, haz **Nueva implementación** (o nueva versión); la URL no se actualiza sola.

### 3. Configurar la PWA
En [`app.js`](app.js), reemplazar:
```js
const API_URL = "PEGAR_URL_DEL_APPS_SCRIPT_AQUI";
```
por la URL del paso 2.

### 4. Servir / desplegar
Cualquier hosting estático con **HTTPS** (requisito del service worker):
- Vercel / Netlify / GitHub Pages → arrastrar la carpeta `panel/`.
- Local para probar: `npx serve panel` y abrir en `localhost`.

## Seguridad (PENDIENTE antes de entregar al cliente)

> ⚠️ Hoy el Apps Script es **público**: cualquiera con la URL puede leer conversaciones y apagar la IA.
> Datos sensibles (nombres, y en `pedidos` teléfonos/direcciones).
>
> Antes de entregar, agregar:
> 1. **Token compartido**: GAS exige un `?token=` en GET y un `token` en el POST; rechaza si no coincide.
> 2. **Clave en la PWA**: pedir una contraseña al abrir, guardada en `localStorage`.
>
> Ambos cambios son pequeños y están previstos; se aplican cuando el panel esté funcionando.

## Archivos

| Archivo | Rol |
|---|---|
| `index.html` | Estructura: vista lista + vista conversación |
| `app.js` | Lógica: JSONP GET, POST toggle, caché, render, PWA |
| `styles.css` | Estilos mobile-first |
| `sw.js` | Service worker (offline / instalable) |
| `manifest.webmanifest` | Manifiesto PWA |
| `gas.gs` | Apps Script (pegar en la Sheet) |
| `img/icon-192.png`, `img/icon-512.png` | Íconos de la app |

## Cambios en el bot asociados

Para alimentar el ícono de canal se agregó la columna `canal` (H) a `actividad`:
- `chatbot/meta/app/sheets/activity.py` — lee/escribe `canal`.
- `chatbot/meta/app/bot/orchestrator.py` — pasa la plataforma (`messenger`/`instagram`).
