/**
 * Cava Lácteos — Apps Script para el Panel de Chats.
 *
 * Pegar este código en: la Google Sheet del bot → Extensiones → Apps Script.
 * Luego: Implementar → Nueva implementación → Aplicación web
 *   - Ejecutar como: Yo
 *   - Quién tiene acceso: Cualquier usuario
 * Copiar la URL /exec y pegarla en panel/app.js como API_URL.
 *
 * IMPORTANTE: cada cambio de código requiere una NUEVA implementación (o
 * "Administrar implementaciones" → editar → Nueva versión). La URL no cambia
 * si editas la implementación existente.
 *
 * RESPONDER DESDE EL PANEL (acción "send"): GAS envía el mensaje a Meta con
 * UrlFetchApp. Requiere guardar los tokens en Propiedades del script:
 *   Configuración del proyecto → Propiedades del script → agregar:
 *     META_PAGE_ACCESS_TOKEN  (token de la Página — Messenger)
 *     META_IG_ACCESS_TOKEN    (token de Instagram — DMs de IG)
 * Son los mismos valores que el bot usa en Render.
 *
 * Hoja leída/escrita: "actividad"
 * Columnas: A sender_id | B nombre | C ultima_vez | D historial | E procesando | F buffer | G activado | H canal
 */

const SHEET_NAME = "actividad";
const COL = { SENDER_ID: 1, NOMBRE: 2, ULTIMA_VEZ: 3, HISTORIAL: 4, ACTIVADO: 7, CANAL: 8 };

// ── GET: lista de chats (JSONP) ────────────────────────────────────────────────
function doGet(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const values = sheet.getDataRange().getValues();
  const rows = values.slice(1); // saltar encabezado

  const chats = rows
    .filter(r => r[COL.SENDER_ID - 1])
    .map(r => ({
      sender_id:  String(r[COL.SENDER_ID - 1]),
      nombre:     r[COL.NOMBRE - 1],
      ultima_vez: r[COL.ULTIMA_VEZ - 1],
      historial:  r[COL.HISTORIAL - 1] || "[]",
      activado:   r[COL.ACTIVADO - 1],
      canal:      r[COL.CANAL - 1] || "",
    }));

  const json = JSON.stringify(chats);
  const cb = e && e.parameter && e.parameter.callback;
  return ContentService
    .createTextOutput(cb ? `${cb}(${json})` : json)
    .setMimeType(cb ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
}

// ── POST: cambiar el toggle de IA ──────────────────────────────────────────────
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    if (payload.action === "toggle") {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
      const ids = sheet.getRange(1, COL.SENDER_ID, sheet.getLastRow(), 1).getValues();
      const target = String(payload.sender_id);
      const valor = String(payload.activado).toUpperCase() === "FALSE" ? "FALSE" : "TRUE";

      for (let i = 1; i < ids.length; i++) { // i=1 → saltar encabezado
        if (String(ids[i][0]) === target) {
          sheet.getRange(i + 1, COL.ACTIVADO).setValue(valor);
          return _json({ ok: true, activado: valor });
        }
      }
      return _json({ ok: false, error: "sender_id no encontrado" });
    }

    if (payload.action === "rename") {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
      const ids = sheet.getRange(1, COL.SENDER_ID, sheet.getLastRow(), 1).getValues();
      const target = String(payload.sender_id);
      const nombre = String(payload.nombre || "").trim();

      for (let i = 1; i < ids.length; i++) {
        if (String(ids[i][0]) === target) {
          sheet.getRange(i + 1, COL.NOMBRE).setValue(nombre);
          return _json({ ok: true, nombre: nombre });
        }
      }
      return _json({ ok: false, error: "sender_id no encontrado" });
    }

    if (payload.action === "send") {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
      const target = String(payload.sender_id);
      const text = String(payload.text || "").trim();
      if (!text) return _json({ ok: false, error: "texto vacío" });

      const lastRow = sheet.getLastRow();
      const data = sheet.getRange(1, 1, lastRow, COL.CANAL).getValues();
      for (let i = 1; i < data.length; i++) { // i=1 → saltar encabezado
        if (String(data[i][COL.SENDER_ID - 1]) === target) {
          const canal = data[i][COL.CANAL - 1];
          sendToMeta(canal, target, text); // lanza excepción si Meta falla

          // Registrar el mensaje en el historial como "assistant".
          let hist;
          try { hist = JSON.parse(data[i][COL.HISTORIAL - 1] || "[]"); if (!Array.isArray(hist)) hist = []; }
          catch (e) { hist = []; }
          hist.push({ role: "assistant", content: text });
          sheet.getRange(i + 1, COL.HISTORIAL).setValue(JSON.stringify(hist));

          return _json({ ok: true });
        }
      }
      return _json({ ok: false, error: "sender_id no encontrado" });
    }

    return _json({ ok: false, error: "accion desconocida" });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

// ── Envío a Meta (Messenger / Instagram) — espeja app/messenger/client.py ─────────
function sendToMeta(canal, psid, text) {
  const props = PropertiesService.getScriptProperties();
  const c = String(canal || "").toLowerCase();
  // tag HUMAN_AGENT → ventana de respuesta de 7 días (en vez de 24 h) para agentes humanos.
  const payload = {
    recipient: { id: psid },
    messaging_type: "MESSAGE_TAG",
    tag: "HUMAN_AGENT",
    message: { text: text },
  };
  let url, options;

  if (c === "instagram") {
    const igToken = props.getProperty("META_IG_ACCESS_TOKEN");
    if (!igToken) throw new Error("Falta META_IG_ACCESS_TOKEN en Propiedades del script");
    url = "https://graph.instagram.com/v21.0/me/messages";
    options = {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + igToken },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    };
  } else {
    const pageToken = props.getProperty("META_PAGE_ACCESS_TOKEN");
    if (!pageToken) throw new Error("Falta META_PAGE_ACCESS_TOKEN en Propiedades del script");
    url = "https://graph.facebook.com/v20.0/me/messages?access_token=" + encodeURIComponent(pageToken);
    options = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    };
  }

  const resp = UrlFetchApp.fetch(url, options);
  const code = resp.getResponseCode();
  if (code !== 200) throw new Error("Meta " + code + ": " + resp.getContentText());
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
