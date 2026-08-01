// Capa de salida hacia la Graph API de WhatsApp Cloud.
import { config, graphBase } from './config.js';

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${config.metaToken}`, ...extra };
}

// POST genérico a /{PHONE_NUMBER_ID}/messages. Propaga el código de error de Meta.
async function postToGraph(payload) {
  const url = `${graphBase()}/${config.phoneNumberId}/messages`;
  const r = await fetch(url, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) {
    const err = new Error(data.error?.message || `Graph API HTTP ${r.status}`);
    err.code = data.error?.code ?? r.status;
    err.title = data.error?.error_data?.details || data.error?.type || null;
    err.raw = data.error || null;
    throw err;
  }
  return data; // { messages: [{ id: wamid }], contacts: [...] }
}

/** Texto libre (solo dentro de la ventana de 24h). `replyTo` = wamid a citar. */
export function sendText(to, body, replyTo) {
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { preview_url: true, body },
  };
  if (replyTo) payload.context = { message_id: replyTo };
  return postToGraph(payload);
}

/** Sube un binario a WhatsApp y devuelve { id } (media_id) para luego enviarlo. */
export async function uploadMedia(buffer, mime, filename = 'file') {
  const url = `${graphBase()}/${config.phoneNumberId}/media`;
  const fd = new FormData();
  fd.append('messaging_product', 'whatsapp');
  fd.append('type', mime);
  fd.append('file', new Blob([buffer], { type: mime }), filename);
  const r = await fetch(url, { method: 'POST', headers: authHeaders(), body: fd });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) {
    const err = new Error(data.error?.message || `upload media HTTP ${r.status}`);
    err.code = data.error?.code ?? r.status;
    throw err;
  }
  return data; // { id }
}

/** Envía media ya subida. type: image|audio|video|document|sticker.
 * Para audio, `voice: true` lo entrega como NOTA DE VOZ nativa (onda/mic) en vez de
 * archivo de audio. Requiere que el media sea ogg/opus mono (ver audio.js). */
export function sendMedia(to, type, mediaId, { caption, filename, replyTo, voice } = {}) {
  const media = { id: mediaId };
  if (caption && (type === 'image' || type === 'video' || type === 'document')) media.caption = caption;
  if (filename && type === 'document') media.filename = filename;
  if (type === 'audio' && voice) media.voice = true;
  const payload = { messaging_product: 'whatsapp', to, type, [type]: media };
  if (replyTo) payload.context = { message_id: replyTo };
  return postToGraph(payload);
}

// ── Block API (oficial) ──────────────────────────────────────────────────────
async function blockCall(method, waId) {
  const url = `${graphBase()}/${config.phoneNumberId}/block_users`;
  const r = await fetch(url, {
    method,
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ messaging_product: 'whatsapp', block_users: [{ user: waId }] }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) {
    const err = new Error(data.error?.message || `block HTTP ${r.status}`);
    err.code = data.error?.code ?? r.status;
    throw err;
  }
  return data;
}
export const blockUser = (waId) => blockCall('POST', waId);
export const unblockUser = (waId) => blockCall('DELETE', waId);

/** Plantilla aprobada (para escribir fuera de las 24h). */
export function sendTemplate(to, name, lang = 'es', components = []) {
  return postToGraph({
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: { name, language: { code: lang }, components },
  });
}

/** Marca como leído en WhatsApp (los ✓✓ azules del cliente). */
export async function markRead(messageId) {
  const url = `${graphBase()}/${config.phoneNumberId}/messages`;
  const r = await fetch(url, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId }),
  });
  return r.ok;
}

// ── Salud del canal ───────────────────────────────────────────────────────────
/** Ping a Graph /{PHONE_NUMBER_ID}: verifica que el token viva y trae número/calidad.
 * Devuelve {status:'connected', name, number, quality} | {status:'no_configurado'}
 * | {status:'error', code, message}. */
export async function getPhoneHealth() {
  if (!config.metaToken || !config.phoneNumberId) return { status: 'no_configurado' };
  const fields = 'verified_name,display_phone_number,quality_rating';
  try {
    const r = await fetch(`${graphBase()}/${config.phoneNumberId}?fields=${fields}`, { headers: authHeaders() });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.error) {
      return { status: 'error', code: data.error?.code ?? r.status, message: data.error?.message || `HTTP ${r.status}` };
    }
    return {
      status: 'connected',
      name: data.verified_name || '',
      number: data.display_phone_number || '',
      quality: data.quality_rating || '',
    };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

// ── Media entrante: 2 pasos con token ────────────────────────────────────────
/** Paso 1: pedir la URL temporal + mime de un media id. */
export async function getMediaUrl(id) {
  const r = await fetch(`${graphBase()}/${id}`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`getMediaUrl HTTP ${r.status}`);
  return r.json(); // { url, mime_type, ... }
}

/** Paso 2: bajar el binario (también requiere el token). */
export async function downloadMedia(url) {
  const r = await fetch(url, { headers: authHeaders() });
  if (!r.ok) throw new Error(`downloadMedia HTTP ${r.status}`);
  const buffer = Buffer.from(await r.arrayBuffer());
  return { buffer, contentType: r.headers.get('content-type') };
}
