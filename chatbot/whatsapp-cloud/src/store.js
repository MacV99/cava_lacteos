// Store de conversaciones en memoria, persistido en data/conversations.json.
// Estructura:
//   conversations[waId] = {
//     waId, name, lastInboundTs, unread,
//     messages: [ { id, dir:'in'|'out', type, text, mediaId, mime, filename, ts, status, error } ]
//   }
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT_DIR } from './config.js';

const DATA_DIR = join(ROOT_DIR, 'data');
const FILE = join(DATA_DIR, 'conversations.json');

/** @type {Record<string, any>} */
let conversations = {};

// ── Carga inicial ──────────────────────────────────────────────────────────
function load() {
  try {
    if (existsSync(FILE)) {
      conversations = JSON.parse(readFileSync(FILE, 'utf8')) || {};
      const n = Object.keys(conversations).length;
      console.log(`[store] cargadas ${n} conversaciones`);
    }
  } catch (e) {
    console.error('[store] no se pudo cargar, empezando vacío:', e.message);
    conversations = {};
  }
}
load();

// ── Persistencia con debounce (~400ms) ─────────────────────────────────────
let saveTimer = null;
export function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
      writeFileSync(FILE, JSON.stringify(conversations, null, 2));
    } catch (e) {
      console.error('[store] error al guardar:', e.message);
    }
  }, 400);
}

// ── Accesores ──────────────────────────────────────────────────────────────
export function getConversation(waId) {
  return conversations[waId] || null;
}

export function ensureConversation(waId, name) {
  let c = conversations[waId];
  if (!c) {
    c = conversations[waId] = { waId, name: name || waId, lastInboundTs: 0, unread: 0, messages: [] };
  }
  if (name && (c.name === c.waId || !c.name)) c.name = name;
  return c;
}

/** Lista ordenada por actividad reciente (para el panel). */
export function listConversations() {
  return Object.values(conversations)
    .map((c) => {
      const last = c.messages[c.messages.length - 1] || null;
      return {
        waId: c.waId,
        name: c.name,
        unread: c.unread || 0,
        blocked: !!c.blocked,
        lastInboundTs: c.lastInboundTs || 0,
        lastTs: last ? last.ts : (c.lastInboundTs || 0),
        preview: last ? previewOf(last) : '',
        messages: c.messages,
      };
    })
    .sort((a, b) => b.lastTs - a.lastTs);
}

function previewOf(m) {
  if (m.text) return m.text;
  if (m.type === 'image') return '📷 Foto';
  if (m.type === 'video') return '🎥 Video';
  if (m.type === 'audio' || m.type === 'voice') return '🎵 Audio';
  if (m.type === 'document') return '📄 ' + (m.filename || 'Documento');
  if (m.type === 'sticker') return 'Sticker';
  return '';
}

// ── Mensajes ─────────────────────────────────────────────────────────────────
export function addInbound(waId, name, msg) {
  const c = ensureConversation(waId, name);
  // dedup por id (Meta reintrega si respondemos lento)
  if (msg.id && c.messages.some((m) => m.id === msg.id)) return c;
  c.messages.push({ dir: 'in', status: null, error: null, ...msg });
  c.lastInboundTs = msg.ts;
  c.unread = (c.unread || 0) + 1;
  persist();
  return c;
}

export function addOutbound(waId, msg) {
  const c = ensureConversation(waId);
  c.messages.push({ dir: 'out', status: 'sent', error: null, ...msg });
  persist();
  return c;
}

// Acuses: sube de nivel, nunca baja. failed siempre pisa.
const RANK = { sent: 1, delivered: 2, read: 3 };
export function applyStatus(msgId, status, error) {
  for (const c of Object.values(conversations)) {
    const m = c.messages.find((x) => x.id === msgId);
    if (!m) continue;
    if (status === 'failed') {
      m.status = 'failed';
      if (error) m.error = error;
    } else if ((RANK[status] || 0) > (RANK[m.status] || 0)) {
      m.status = status;
    }
    persist();
    return true;
  }
  return false;
}

export function markRead(waId) {
  const c = conversations[waId];
  if (!c) return null;
  c.unread = 0;
  persist();
  return c;
}

// Reacción: se adjunta al mensaje objetivo (no crea burbuja). emoji vacío = quitada.
// Devuelve true si encontró el mensaje; false si no (para fallback del handler).
export function applyReaction(waId, targetId, emoji, ts) {
  const c = conversations[waId];
  if (!c) return false;
  const m = c.messages.find((x) => x.id === targetId);
  if (!m) return false;
  m.reaction = emoji || null;
  if (ts) c.lastInboundTs = ts; // una reacción también reabre la ventana de 24h
  persist();
  return true;
}

export function rename(waId, name) {
  const c = conversations[waId];
  if (!c) return null;
  c.name = String(name || '').trim() || c.waId;
  persist();
  return c;
}

// Borra un mensaje SOLO del panel (WhatsApp Cloud API no permite unsend).
export function deleteMessage(waId, messageId) {
  const c = conversations[waId];
  if (!c) return false;
  const i = c.messages.findIndex((m) => m.id === messageId);
  if (i < 0) return false;
  c.messages.splice(i, 1);
  persist();
  return true;
}

// Borra la conversación entera del panel (no del teléfono del cliente).
export function deleteConversation(waId) {
  if (!conversations[waId]) return false;
  delete conversations[waId];
  persist();
  return true;
}

export function setBlocked(waId, blocked) {
  const c = conversations[waId];
  if (!c) return null;
  c.blocked = !!blocked;
  persist();
  return c;
}
