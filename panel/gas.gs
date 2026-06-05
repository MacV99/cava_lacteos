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

    return _json({ ok: false, error: "accion desconocida" });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
