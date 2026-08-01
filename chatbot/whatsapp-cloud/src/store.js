// Store de conversaciones en memoria con persistencia intercambiable:
//   - Supabase (Postgres) si SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY están definidas.
//   - JSON local (data/conversations.json) como fallback para dev/sin credenciales.
//
// El modelo en memoria es la fuente para TODAS las lecturas síncronas (rápido, sin latencia
// en el poll del panel). Cada mutación actualiza memoria y hace write-through al backend.
// Al bootear se carga todo el backend a memoria (top-level await).
//
// Estructura en memoria:
//   conversations[waId] = {
//     waId, name, lastInboundTs, unread, blocked,
//     messages: [ { id, dir:'in'|'out', type, text, mediaId, mime, filename, ts, status, error, reaction, replyTo } ]
//   }
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT_DIR } from './config.js';
import { supabase, supabaseEnabled } from './supabase.js';

const DATA_DIR = join(ROOT_DIR, 'data');
const FILE = join(DATA_DIR, 'conversations.json');

/** @type {Record<string, any>} */
let conversations = {};

// ── Mapeo memoria ↔ filas de Supabase ───────────────────────────────────────
function convToRow(c) {
  return {
    wa_id: c.waId,
    name: c.name,
    last_inbound_ts: c.lastInboundTs || 0,
    unread: c.unread || 0,
    blocked: !!c.blocked,
    ai_on: c.aiOn !== false,
    updated_at: new Date().toISOString(),
  };
}
function msgToRow(waId, m) {
  return {
    wa_id: waId,
    wamid: m.id || null,
    dir: m.dir,
    type: m.type || null,
    text: m.text ?? null,
    media_id: m.mediaId || null,
    mime: m.mime || null,
    filename: m.filename || null,
    ts: m.ts,
    status: m.status ?? null,
    error: m.error ?? null,
    reaction: m.reaction ?? null,
    reply_to: m.replyTo || null,
  };
}
function rowToMsg(r) {
  return {
    id: r.wamid || null,
    dir: r.dir,
    type: r.type || null,
    text: r.text ?? null,
    mediaId: r.media_id || null,
    mime: r.mime || null,
    filename: r.filename || null,
    ts: Number(r.ts),
    status: r.status ?? null,
    error: r.error ?? null,
    reaction: r.reaction ?? null,
    replyTo: r.reply_to || null,
  };
}

// ── Backend Supabase ─────────────────────────────────────────────────────────
const supabaseBackend = {
  async loadAll() {
    const { data: convs, error: e1 } = await supabase.from('conversations').select('*');
    if (e1) throw new Error(e1.message);
    const { data: msgs, error: e2 } = await supabase
      .from('messages').select('*').order('ts', { ascending: true });
    if (e2) throw new Error(e2.message);
    const map = {};
    for (const r of convs || []) {
      map[r.wa_id] = {
        waId: r.wa_id, name: r.name, lastInboundTs: Number(r.last_inbound_ts) || 0,
        unread: r.unread || 0, blocked: !!r.blocked, aiOn: r.ai_on !== false, messages: [],
      };
    }
    for (const r of msgs || []) { const c = map[r.wa_id]; if (c) c.messages.push(rowToMsg(r)); }
    return map;
  },
  // Upsert de conversación + insert de mensaje EN ORDEN (la FK exige que la conv exista).
  async addMessage(c, m) {
    const { error: e1 } = await supabase.from('conversations').upsert(convToRow(c), { onConflict: 'wa_id' });
    if (e1) { console.error('[supabase] upsertConv:', e1.message); return; }
    const { error: e2 } = await supabase.from('messages').insert(msgToRow(c.waId, m));
    if (e2) console.error('[supabase] insertMsg:', e2.message);
  },
  async upsertConversation(c) {
    const { error } = await supabase.from('conversations').upsert(convToRow(c), { onConflict: 'wa_id' });
    if (error) console.error('[supabase] upsertConv:', error.message);
  },
  async updateMessageStatus(wamid, status, error) {
    if (!wamid) return;
    const { error: e } = await supabase.from('messages').update({ status, error: error ?? null }).eq('wamid', wamid);
    if (e) console.error('[supabase] updStatus:', e.message);
  },
  async updateMessageReaction(waId, wamid, reaction) {
    if (!wamid) return;
    const { error } = await supabase.from('messages').update({ reaction: reaction ?? null })
      .eq('wa_id', waId).eq('wamid', wamid);
    if (error) console.error('[supabase] updReaction:', error.message);
  },
  async deleteMessage(waId, wamid) {
    if (!wamid) return;
    const { error } = await supabase.from('messages').delete().eq('wa_id', waId).eq('wamid', wamid);
    if (error) console.error('[supabase] delMsg:', error.message);
  },
  async deleteConversation(waId) {
    const { error } = await supabase.from('conversations').delete().eq('wa_id', waId);
    if (error) console.error('[supabase] delConv:', error.message);
  },
};

// ── Backend JSON local (fallback) ────────────────────────────────────────────
let saveTimer = null;
function persistFile() {
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
const jsonBackend = {
  async loadAll() {
    if (!existsSync(FILE)) return {};
    return JSON.parse(readFileSync(FILE, 'utf8')) || {};
  },
  async addMessage() { persistFile(); },
  async upsertConversation() { persistFile(); },
  async updateMessageStatus() { persistFile(); },
  async updateMessageReaction() { persistFile(); },
  async deleteMessage() { persistFile(); },
  async deleteConversation() { persistFile(); },
};

const backend = supabaseEnabled ? supabaseBackend : jsonBackend;

// ── Carga inicial (bloquea la evaluación del módulo hasta terminar) ──────────
try {
  conversations = await backend.loadAll();
  const n = Object.keys(conversations).length;
  console.log(`[store] backend=${supabaseEnabled ? 'supabase' : 'json'} · ${n} conversaciones cargadas`);
} catch (e) {
  console.error('[store] no se pudo cargar, empezando vacío:', e.message);
  conversations = {};
}

// ── Accesores ──────────────────────────────────────────────────────────────
export function getConversation(waId) {
  return conversations[waId] || null;
}

export function ensureConversation(waId, name) {
  let c = conversations[waId];
  if (!c) {
    c = conversations[waId] = { waId, name: name || waId, lastInboundTs: 0, unread: 0, blocked: false, aiOn: true, messages: [] };
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
        aiOn: c.aiOn !== false,
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
  const m = { dir: 'in', status: null, error: null, ...msg };
  c.messages.push(m);
  c.lastInboundTs = msg.ts;
  c.unread = (c.unread || 0) + 1;
  backend.addMessage(c, m);
  return c;
}

export function addOutbound(waId, msg) {
  const c = ensureConversation(waId);
  const m = { dir: 'out', status: 'sent', error: null, ...msg };
  c.messages.push(m);
  backend.addMessage(c, m);
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
    } else {
      return true; // sin cambio real: no escribas al backend
    }
    backend.updateMessageStatus(msgId, m.status, m.error);
    return true;
  }
  return false;
}

export function markRead(waId) {
  const c = conversations[waId];
  if (!c) return null;
  c.unread = 0;
  backend.upsertConversation(c);
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
  backend.updateMessageReaction(waId, targetId, m.reaction);
  if (ts) backend.upsertConversation(c);
  return true;
}

export function rename(waId, name) {
  const c = conversations[waId];
  if (!c) return null;
  c.name = String(name || '').trim() || c.waId;
  backend.upsertConversation(c);
  return c;
}

// Borra un mensaje SOLO del panel (WhatsApp Cloud API no permite unsend).
export function deleteMessage(waId, messageId) {
  const c = conversations[waId];
  if (!c) return false;
  const i = c.messages.findIndex((m) => m.id === messageId);
  if (i < 0) return false;
  c.messages.splice(i, 1);
  backend.deleteMessage(waId, messageId);
  return true;
}

// Borra la conversación entera del panel (no del teléfono del cliente).
export function deleteConversation(waId) {
  if (!conversations[waId]) return false;
  delete conversations[waId];
  backend.deleteConversation(waId);
  return true;
}

export function setBlocked(waId, blocked) {
  const c = conversations[waId];
  if (!c) return null;
  c.blocked = !!blocked;
  backend.upsertConversation(c);
  return c;
}

// IA on/off por chat: cuando está on, el webhook reenvía los entrantes al bot Python.
export function setAiOn(waId, on) {
  const c = conversations[waId];
  if (!c) return null;
  c.aiOn = !!on;
  backend.upsertConversation(c);
  return c;
}
