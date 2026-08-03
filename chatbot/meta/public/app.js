// Panel unificado — WhatsApp Cloud (tiempo real, este backend) +
// Messenger/Instagram (Google Sheets vía Apps Script). Sin reescribir el bot.
'use strict';

// ── Configuración ────────────────────────────────────────────────────────────
// URL del Apps Script (lee/escribe la hoja "actividad" de Messenger/IG).
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxAETSMOzO6ozHdy88OoXiKUMZ2YW05VoFvXWGqZHdwDozsGBe6Iiit-hNl9GK-OB_p/exec';
const POLL_WA_MS = 3000;
const POLL_META_MS = 6000;
const POLL_HEALTH_MS = 30000;
const POLL_ORDERS_MS = 15000;

// Metadatos de cada canal para el modal de estado.
const CH_META = {
  whatsapp:  { name: 'WhatsApp',  color: '#25d366' },
  messenger: { name: 'Messenger', color: '#2a7fd4' },
  instagram: { name: 'Instagram', color: '#c13584' },
};

// Alcance del plan: solo WhatsApp está HABILITADO PARA USO (responder, IA). Messenger e
// Instagram sí muestran sus chats (data en vivo, como demo de mejora futura) pero quedan
// en SOLO LECTURA: no se puede enviar ni togglear IA. Poner true para habilitarlos tras cotizar.
const CHANNELS_ENABLED = { whatsapp: true, messenger: false, instagram: false };

const $ = (id) => document.getElementById(id);

// ── SVG de canal ─────────────────────────────────────────────────────────────
const ICON_WA = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2zm5.8 14.16c-.24.68-1.42 1.31-1.96 1.36-.5.06-1.13.08-1.83-.11-.42-.13-.96-.31-1.65-.6-2.91-1.26-4.81-4.19-4.96-4.39-.14-.2-1.19-1.58-1.19-3.01s.75-2.14 1.02-2.43c.27-.29.58-.36.78-.36l.56.01c.18.01.42-.07.66.5.24.59.82 2.02.89 2.17.07.14.12.31.02.51-.1.2-.15.31-.29.48-.14.17-.3.38-.43.51-.14.14-.29.29-.13.57.16.27.72 1.18 1.54 1.91 1.06.94 1.95 1.24 2.23 1.38.27.14.43.12.59-.07.16-.2.68-.79.86-1.06.18-.27.36-.22.61-.13.25.09 1.58.74 1.85.88.27.14.45.2.51.31.07.12.07.66-.17 1.34z"/></svg>';
const ICON_FB = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.21 2 11.4c0 2.96 1.46 5.6 3.75 7.32V22l3.43-1.88c.91.25 1.87.39 2.82.39 5.52 0 10-4.21 10-9.4S17.52 2 12 2zm1.02 12.66l-2.55-2.72-4.97 2.72 5.47-5.8 2.61 2.72 4.91-2.72-5.47 5.8z"/></svg>';
const ICON_IG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.2c3.2 0 3.6 0 4.9.07 1.2.05 1.8.25 2.2.42.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.17.4.37 1 .42 2.2.06 1.3.07 1.7.07 4.9s0 3.6-.07 4.9c-.05 1.2-.25 1.8-.42 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.17-1 .37-2.2.42-1.3.06-1.7.07-4.9.07s-3.6 0-4.9-.07c-1.2-.05-1.8-.25-2.2-.42-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.17-.4-.37-1-.42-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.07-4.9c.05-1.2.25-1.8.42-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.17 1-.37 2.2-.42C8.4 2.2 8.8 2.2 12 2.2zm0 3.2A6.6 6.6 0 1 0 18.6 12 6.6 6.6 0 0 0 12 5.4zm0 10.9A4.3 4.3 0 1 1 16.3 12 4.3 4.3 0 0 1 12 16.3zm6.8-11.1a1.54 1.54 0 1 1-1.54-1.54 1.54 1.54 0 0 1 1.54 1.54z"/></svg>';
const ICON_MANUAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
function canalIcon(ch) {
  return ch === 'instagram' ? ICON_IG : ch === 'messenger' ? ICON_FB : ch === 'manual' ? ICON_MANUAL : ICON_WA;
}

// ── Estado ────────────────────────────────────────────────────────────────
let waConvs = [];      // normalizadas desde este backend
let metaConvs = [];    // normalizadas desde GAS (messenger/instagram)
let convs = [];        // fusión
let byKey = {};
let activeKey = null;
let searchTerm = '';
let channelFilter = 'todos';
let errorMap = { map: {}, fallback: null };
let chHealth = { whatsapp: null };   // salud real de WhatsApp Cloud (backend)
let srvOk = false, metaOk = false;   // server Node alcanzable / Apps Script respondiendo
let listSig = '', threadSig = '';
let replyTarget = null;   // { id, text } al que se responde
let pendingFile = null;   // File adjunto pendiente de enviar
let mediaRec = null, recChunks = [];   // grabación de audio
let recStart = 0, recTimer = null, recAction = 'cancel';

// ── Utilidades ────────────────────────────────────────────────────────────
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function linkify(escaped) {
  return escaped.replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
}
function fmtTime(ts) { return new Date(ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }); }
function dayKey(ts) { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
function dayLabel(ts) {
  const d = new Date(ts), now = new Date();
  if (dayKey(ts) === dayKey(now.getTime())) return 'Hoy';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (dayKey(ts) === dayKey(y.getTime())) return 'Ayer';
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
}
function relTime(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'ahora'; if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return new Date(ts).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
}
function fmtLeft(ms) { const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000); return h > 0 ? `${h}h ${m}m` : `${m}m`; }
// "d/m/yyyy, h:mm:ss am/pm" (Bogotá) → epoch ms
function fechaMs(s) {
  if (!s) return 0;
  const m = String(s).match(/(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2}):(\d{2})\s*(am|pm)/i);
  if (!m) return 0;
  let [, d, mo, y, h, mi, se, ap] = m;
  h = +h % 12; if (/pm/i.test(ap)) h += 12;
  return new Date(+y, +mo - 1, +d, h, +mi, +se).getTime();
}
function isOn(activado) { return String(activado).trim().toLowerCase() !== 'false'; }
function parseHistorial(raw) { try { const x = JSON.parse(raw || '[]'); return Array.isArray(x) ? x : []; } catch { return []; } }

function notify(msg, type = 'ok') {
  const p = $('notif-pill'); p.textContent = msg; p.dataset.type = type; p.classList.remove('hidden');
  clearTimeout(notify._t); notify._t = setTimeout(() => p.classList.add('hidden'), 3200);
}

// ── Fetchers ──────────────────────────────────────────────────────────────
async function pollWA() {
  try {
    const r = await fetch('/api/conversations');
    if (r.status === 401) { panelStarted = false; showLogin(); return; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    waConvs = (data.conversations || []).map(normalizeWA);
    setConn(true);
  } catch { setConn(false); }
  rebuild();
}
function normalizeWA(c) {
  return {
    key: 'whatsapp:' + c.waId, channel: 'whatsapp', id: c.waId,
    name: c.name, lastTs: c.lastTs, unread: c.unread || 0, preview: c.preview,
    windowOpen: c.windowOpen, windowMsLeft: c.windowMsLeft, aiOn: c.aiOn !== false, blocked: !!c.blocked,
    messages: (c.messages || []).map((m) => ({
      id: m.id, dir: m.dir, type: m.type, text: m.text, ts: m.ts, status: m.status,
      mediaId: m.mediaId, mime: m.mime, filename: m.filename, error: m.error,
      reaction: m.reaction || null, replyTo: m.replyTo || null,
    })),
  };
}

function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cb = '_cb_' + Date.now() + Math.floor(Math.random() * 999);
    const script = document.createElement('script');
    const timer = setTimeout(() => { cleanup(); reject('timeout'); }, 12000);
    function cleanup() { clearTimeout(timer); delete window[cb]; script.remove(); }
    window[cb] = (data) => { cleanup(); resolve(data); };
    script.onerror = () => { cleanup(); reject('load failed'); };
    script.src = `${url}?callback=${cb}`;
    document.head.appendChild(script);
  });
}
async function gasPost(payload) {
  const res = await fetch(GAS_URL, {
    method: 'POST', mode: 'cors', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}
async function pollMeta() {
  try {
    const chats = await jsonp(GAS_URL);
    metaConvs = (Array.isArray(chats) ? chats : [])
      .filter((c) => c.sender_id)
      .map(normalizeMeta)
      .filter((c) => c.channel === 'messenger' || c.channel === 'instagram'); // WhatsApp viejo (Baileys) retirado
    metaOk = true;
  } catch { metaOk = false; /* deja lo que había */ }
  renderStatus();
  rebuild();
}

// Salud real de WhatsApp Cloud (el backend hace ping a Graph con el token).
async function pollHealth() {
  try {
    const r = await fetch('/api/health/channels');
    if (r.status === 401) { panelStarted = false; showLogin(); return; }
    const d = await r.json();
    chHealth.whatsapp = d.whatsapp || null;
  } catch { chHealth.whatsapp = { status: 'error', message: 'sin conexión con el servidor' }; }
  renderStatus();
}
function normalizeMeta(c) {
  const raw = (c.canal || '').toLowerCase();
  const channel = raw === 'instagram' ? 'instagram' : (raw === 'messenger' || raw === 'page') ? 'messenger' : 'unknown';
  const hist = parseHistorial(c.historial);
  const last = hist.length ? hist[hist.length - 1].content : '';
  return {
    key: channel + ':' + c.sender_id, channel, id: String(c.sender_id),
    name: c.nombre || c.sender_id, lastTs: fechaMs(c.ultima_vez), unread: 0, preview: last,
    windowOpen: null, windowMsLeft: 0, aiOn: isOn(c.activado),
    messages: hist.map((h) => ({ dir: h.role === 'assistant' ? 'out' : 'in', type: 'text', text: h.content, ts: null })),
  };
}

// ── Fusión + render ─────────────────────────────────────────────────────────
function rebuild() {
  convs = [...waConvs, ...metaConvs].sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
  byKey = Object.fromEntries(convs.map((c) => [c.key, c]));
  renderList();
  if (activeKey) renderThread();
  updateTitle();
}
function setConn(ok) { srvOk = ok; renderStatus(); }

// ── Estado de canales ─────────────────────────────────────────────────────────
function qLabel(q) { return ({ GREEN: 'buena', YELLOW: 'media', RED: 'baja', UNKNOWN: '—' })[q] || String(q).toLowerCase(); }

// Estado por canal: {key, st:'ok'|'err'|'warn'|'load', detail}.
function channelStates() {
  let wa;
  if (!srvOk) {
    wa = { key: 'whatsapp', st: 'err', detail: 'El servidor del panel no responde.' };
  } else {
    const h = chHealth.whatsapp;
    if (!h) wa = { key: 'whatsapp', st: 'load', detail: 'Comprobando…' };
    else if (h.status === 'connected') {
      const parts = [h.number || 'sin número'];
      if (h.name) parts.push(h.name);
      if (h.quality) parts.push('calidad ' + qLabel(h.quality));
      wa = { key: 'whatsapp', st: 'ok', detail: parts.join(' · ') };
    } else if (h.status === 'no_configurado') {
      wa = { key: 'whatsapp', st: 'warn', detail: 'Falta META_TOKEN o PHONE_NUMBER_ID en el .env.' };
    } else {
      wa = { key: 'whatsapp', st: 'err', detail: `Token/API con error${h.code ? ' (código ' + h.code + ')' : ''}. ${h.message || ''}`.trim() };
    }
  }
  const mkMeta = (key) => {
    const n = metaConvs.filter((c) => c.channel === key).length;
    const ro = CHANNELS_ENABLED[key] ? '' : ' · solo lectura';
    return metaOk
      ? { key, st: CHANNELS_ENABLED[key] ? 'ok' : 'off', detail: `${n} chat${n === 1 ? '' : 's'}${ro}` }
      : { key, st: 'err', detail: 'Sin conexión con el Apps Script (Google Sheet).' };
  };
  return [wa, mkMeta('messenger'), mkMeta('instagram')];
}

function statusRowsHTML(states) {
  return states.map((s) => {
    const meta = CH_META[s.key];
    const dotCls = s.st === 'ok' ? 'ok' : s.st === 'err' ? 'err' : s.st === 'off' ? 'off' : 'warn';
    const title = s.st === 'ok' ? 'OK' : s.st === 'err' ? 'Con falla' : s.st === 'off' ? 'No incluido' : 'Atención';
    return `<div class="status-row${s.st === 'off' ? ' status-row--off' : ''}">
      <span class="status-row__icon" style="color:${meta.color}">${canalIcon(s.key)}</span>
      <div class="status-row__body">
        <div class="status-row__name">${meta.name}</div>
        <div class="status-row__detail">${esc(s.detail)}</div>
      </div>
      <span class="status-row__dot status-row__dot--${dotCls}" title="${title}"></span>
    </div>`;
  }).join('');
}

// Punto agregado del topbar + refresco del modal si está abierto.
function renderStatus() {
  const states = channelStates();
  const agg = states.some((s) => s.st === 'err') ? 'off'
            : states.some((s) => s.st === 'warn' || s.st === 'load') ? 'warn' : 'ok';
  const dot = $('conn-dot');
  if (dot) dot.className = 'conn-status conn-status--' + agg;
  if (!$('status-modal').classList.contains('hidden')) $('status-list').innerHTML = statusRowsHTML(states);
}

function openStatus() {
  $('status-list').innerHTML = statusRowsHTML(channelStates());
  $('status-modal').classList.remove('hidden');
  pollHealth();   // refresca WhatsApp al abrir
}
function closeStatus() { $('status-modal').classList.add('hidden'); }
function updateTitle() {
  const total = convs.reduce((n, c) => n + (c.unread || 0), 0);
  document.title = (total > 0 ? `(${total}) ` : '') + 'Cava — Panel de Chats';
}

function filtered() {
  const t = searchTerm.trim().toLowerCase();
  return convs.filter((c) =>
    (channelFilter === 'todos' || c.channel === channelFilter) &&
    (!t || (c.name || '').toLowerCase().includes(t) || (c.id || '').includes(t)));
}
function lastMsg(c) { return c.messages[c.messages.length - 1] || null; }
// Indicador de dirección/entrega del último mensaje en la fila de la lista.
function previewAck(c) {
  const m = lastMsg(c);
  if (!m || m.dir !== 'out') return ''; // solo se marca lo que enviamos nosotros
  if (c.channel === 'whatsapp') {
    if (m.status === 'failed') return '<span class="pv-ack pv-ack--failed">⚠</span>';
    if (m.status === 'read') return '<span class="pv-ack pv-ack--read">✓✓</span>';
    if (m.status === 'delivered') return '<span class="pv-ack">✓✓</span>';
    return '<span class="pv-ack">✓</span>';
  }
  return '<span class="pv-ack">✓</span>'; // Messenger/IG: enviado por nosotros (sin estado de entrega)
}
function listSignature(rows) {
  return rows.map((c) => {
    const m = lastMsg(c) || {};
    return `${c.key}:${c.messages.length}:${c.unread}:${c.lastTs}:${c.windowOpen ? 1 : 0}:${c.aiOn}:${m.dir || ''}:${m.status || ''}`;
  }).join('|') + '::' + activeKey + '::' + searchTerm + '::' + channelFilter;
}
function renderList() {
  const rows = filtered();
  const sig = listSignature(rows);
  if (sig === listSig) return;
  listSig = sig;

  $('loading').classList.add('hidden');
  $('chat-count').textContent = convs.length ? `${convs.length}` : '';
  const empty = $('empty'), box = $('chat-list');
  if (!rows.length) {
    box.innerHTML = '';
    empty.textContent = convs.length ? 'Sin resultados.' : 'No hay chats todavía.';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  box.innerHTML = rows.map((c) => `
    <div class="chat-row ${c.key === activeKey ? 'chat-row--active' : ''}" data-key="${esc(c.key)}">
      <span class="canal-badge canal-badge--${c.channel}" aria-hidden="true">${canalIcon(c.channel)}</span>
      <div class="chat-row__info">
        <div class="chat-row__name">${esc(c.name || c.id)}</div>
        <div class="chat-row__preview">${previewAck(c)}${esc(c.preview || '')}</div>
      </div>
      <div class="chat-row__meta">
        <span class="chat-row__time">${relTime(c.lastTs)}</span>
        ${rightMeta(c)}
      </div>
    </div>`).join('');

  box.querySelectorAll('.chat-row').forEach((el) => el.addEventListener('click', () => openChat(el.dataset.key)));
}
function rightMeta(c) {
  if (c.unread) return `<span class="badge-unread">${c.unread}</span>`;
  if (c.channel === 'whatsapp') return `<span class="chat-row__time">${c.windowOpen ? '🟢' : ''}</span>`;
  if (c.aiOn === false) return `<span class="ai-off-dot">IA off</span>`;
  return '';
}

// ── Hilo ────────────────────────────────────────────────────────────────────
function ackIcon(m) {
  if (m.dir !== 'out') return '';
  if (m.status === 'failed') return `<span class="bubble__ack bubble__ack--failed" data-err="${esc(m.error ? m.error.code : '')}" title="Falló — toca para ver">⚠</span>`;
  if (m.status === 'read') return `<span class="bubble__ack bubble__ack--read">✓✓</span>`;
  if (m.status === 'delivered') return `<span class="bubble__ack">✓✓</span>`;
  if (m.status === 'sent') return `<span class="bubble__ack">✓</span>`;
  return '';
}
function mediaHtml(m) {
  if (!m.mediaId) return '';
  const src = `/api/media/${encodeURIComponent(m.mediaId)}`;
  if (m.type === 'image' || m.type === 'sticker') {
    return `<img class="media" src="${src}" alt="imagen" data-full="${src}"
             onerror="this.outerHTML='<div class=&quot;media-fallback&quot;>📷 Imagen no disponible (expiró)</div>'">`;
  }
  if (m.type === 'audio' || m.type === 'voice') return `<audio controls src="${src}" preload="none"></audio>`;
  if (m.type === 'video') return `<video class="media" controls src="${src}" preload="none"></video>`;
  if (m.type === 'document') return `<a class="doc-link" href="${src}" target="_blank" rel="noopener">📄 ${esc(m.filename || 'Documento')}</a>`;
  return '';
}
function threadSignature(c) {
  return c.key + '::' + c.messages.map((m) => `${m.id || m.ts || ''}:${m.status || ''}:${m.reaction || ''}`).join(',')
    + '::' + c.windowOpen + '::' + c.aiOn;
}
function renderThread() {
  const c = byKey[activeKey];
  if (!c) return;
  const isWA = c.channel === 'whatsapp';

  $('chat-nombre').textContent = c.name || c.id;
  $('chat-sub').textContent = isWA ? c.id : '';
  const badge = $('chat-canal');
  badge.className = 'canal-badge canal-badge--' + c.channel;
  badge.innerHTML = canalIcon(c.channel);

  // canUse = canal habilitado para uso (responder / IA). Solo WhatsApp; Messenger/IG = solo lectura.
  const canUse = CHANNELS_ENABLED[c.channel];
  // Controles según canal: WA → ventana 24h + media/bloqueo; toggle IA solo en canales habilitados
  $('window-badge').classList.toggle('hidden', !isWA);
  $('ai-switch').classList.remove('hidden');
  $('chat-toggle').disabled = !canUse;
  $('btn-attach').classList.toggle('hidden', !isWA);
  $('btn-mic').classList.toggle('hidden', !isWA);
  // items del menú ⋯: renombrar siempre; bloquear/eliminar solo WhatsApp
  $('cmenu-block').classList.toggle('hidden', !isWA);
  $('chat-menu').querySelector('[data-act="delete"]').classList.toggle('hidden', !isWA);
  $('chat-toggle').checked = c.aiOn !== false;
  if (isWA) {
    const wb = $('window-badge');
    if (c.windowOpen) { wb.className = 'win-badge win-badge--open'; wb.textContent = `Abierta · ${fmtLeft(c.windowMsLeft)}`; }
    else { wb.className = 'win-badge win-badge--closed'; wb.textContent = 'Cerrada'; }
    $('cmenu-block').textContent = c.blocked ? '✅ Desbloquear' : '🚫 Bloquear';
    const canWrite = c.windowOpen && !c.blocked;
    $('composer-input').disabled = !canWrite;
    $('composer-send').disabled = !canWrite;
    $('composer').classList.toggle('hidden', !canWrite);
    $('blocked-banner').classList.toggle('hidden', !c.blocked);
    $('window-closed').classList.toggle('hidden', c.blocked || c.windowOpen);
    $('readonly-banner').classList.add('hidden');
  } else if (canUse) {
    $('composer-input').disabled = false;
    $('composer-send').disabled = false;
    $('composer').classList.remove('hidden');
    $('window-closed').classList.add('hidden');
    $('blocked-banner').classList.add('hidden');
    $('readonly-banner').classList.add('hidden');
  } else {
    // Solo lectura: canal fuera del plan (Messenger/IG). Se ven los mensajes, no se responde.
    $('composer').classList.add('hidden');
    $('window-closed').classList.add('hidden');
    $('blocked-banner').classList.add('hidden');
    $('readonly-banner').classList.remove('hidden');
  }

  const sig = threadSignature(c);
  if (sig === threadSig) return;
  const wasNearBottom = isNearBottom();
  threadSig = sig;

  const byMsgId = {};
  for (const m of c.messages) if (m.id) byMsgId[m.id] = m;

  const conv = $('conversation');
  let html = ''; let lastDay = '';
  for (const m of c.messages) {
    if (isWA && m.ts) {
      const dk = dayKey(m.ts);
      if (dk !== lastDay) { html += `<div class="date-sep"><span>${dayLabel(m.ts)}</span></div>`; lastDay = dk; }
    }
    const quote = m.replyTo && byMsgId[m.replyTo]
      ? `<div class="bubble__quote">${esc(quotedLabel(byMsgId[m.replyTo]))}</div>` : '';
    const text = m.text ? `<div class="bubble__text">${linkify(esc(m.text))}</div>` : '';
    const reaction = m.reaction ? `<span class="bubble__reaction">${esc(m.reaction)}</span>` : '';
    const foot = isWA ? `<div class="bubble__foot"><span>${m.ts ? fmtTime(m.ts) : ''}</span>${ackIcon(m)}</div>` : '';
    const acts = (isWA && m.id) ? `<div class="bubble__acts">
        <button class="bubble__act" data-act="reply" data-id="${esc(m.id)}" title="Responder">↩</button>
        <button class="bubble__act" data-act="del" data-id="${esc(m.id)}" title="Eliminar del panel">🗑</button>
      </div>` : '';
    html += `<div class="bubble bubble--${m.dir === 'out' ? 'out' : 'in'}">
      ${acts}${quote}${mediaHtml(m)}${text}${foot}${reaction}
    </div>`;
  }
  conv.innerHTML = html || '<div class="empty">Sin mensajes todavía.</div>';
  if (wasNearBottom) conv.scrollTop = conv.scrollHeight;

  conv.querySelectorAll('img.media').forEach((img) => img.addEventListener('click', () => openLightbox(img.dataset.full)));
  conv.querySelectorAll('.bubble__ack--failed').forEach((el) => el.addEventListener('click', () => showError(Number(el.dataset.err))));
  conv.querySelectorAll('.bubble__act').forEach((el) => el.addEventListener('click', (e) => {
    e.stopPropagation();
    const id = el.dataset.id;
    if (el.dataset.act === 'reply') setReply(id);
    else if (el.dataset.act === 'del') doDeleteMessage(id);
  }));
}
function quotedLabel(m) {
  if (m.text) return m.text.length > 60 ? m.text.slice(0, 60) + '…' : m.text;
  if (m.type === 'image') return '📷 Foto';
  if (m.type === 'video') return '🎥 Video';
  if (m.type === 'audio' || m.type === 'voice') return '🎵 Audio';
  if (m.type === 'document') return '📄 ' + (m.filename || 'Documento');
  return 'Mensaje';
}
function isNearBottom() { const c = $('conversation'); return c.scrollHeight - c.scrollTop - c.clientHeight < 120; }

// ── Abrir / cerrar ───────────────────────────────────────────────────────────
function openChat(key) {
  activeKey = key; threadSig = ''; listSig = '';
  document.body.classList.add('chat-open');
  $('view-list').classList.remove('view--active');
  $('view-chat').classList.add('view--active');
  renderThread();
  const conv = $('conversation'); conv.scrollTop = conv.scrollHeight;
  const c = byKey[key];
  if (c && c.channel === 'whatsapp' && c.unread) markReadWA(c.id);
  renderList();
}
function backToList() {
  activeKey = null; threadSig = ''; listSig = '';
  document.body.classList.remove('chat-open');
  $('view-chat').classList.remove('view--active');
  $('view-list').classList.add('view--active');
  renderList();
}
async function markReadWA(waId) {
  const c = byKey['whatsapp:' + waId]; if (c) c.unread = 0;
  updateTitle(); renderList();
  try { await fetch('/api/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ waId }) }); } catch {}
}

// ── Enviar ──────────────────────────────────────────────────────────────────
async function onComposerSubmit() {
  const c = byKey[activeKey]; if (!c) return;
  if (!CHANNELS_ENABLED[c.channel]) return;   // canal en solo lectura
  const text = $('composer-input').value.trim();
  if (pendingFile) { await sendMediaFile(c, pendingFile, text); return; }
  if (!text) return;
  $('composer-input').value = ''; $('composer-input').style.height = 'auto';
  await sendMessage(c, text);
}

async function sendMessage(c, body) {
  const replyTo = replyTarget ? replyTarget.id : null;
  $('composer-send').disabled = true;
  try {
    if (c.channel === 'whatsapp') {
      const r = await fetch('/api/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: c.id, text: body, replyTo }) });
      const data = await r.json();
      if (!data.ok) { showError(data.code, data.error, data.message); notify('No se pudo enviar', 'err'); }
      else { clearReply(); threadSig = ''; await pollWA(); }
    } else {
      await gasPost({ action: 'send', sender_id: c.id, text: body });
      threadSig = ''; await pollMeta();
    }
  } catch (e) {
    notify('Error al enviar: ' + (e.message || e), 'err');
  } finally {
    $('composer-send').disabled = false;
  }
}

// Deduce el tipo WhatsApp según el MIME del archivo.
function waTypeOf(mime) {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}
async function sendMediaFile(c, file, caption) {
  if (c.channel !== 'whatsapp') { notify('Multimedia solo en WhatsApp por ahora', 'err'); return; }
  const fd = new FormData();
  fd.append('file', file, file.name || 'adjunto');
  fd.append('to', c.id);
  fd.append('type', waTypeOf(file.type || ''));
  if (caption) fd.append('caption', caption);
  if (replyTarget) fd.append('replyTo', replyTarget.id);
  $('composer-send').disabled = true; notify('Enviando adjunto…');
  try {
    const r = await fetch('/api/send-media', { method: 'POST', body: fd });
    const data = await r.json();
    if (!data.ok) { showError(data.code, data.error, data.message); notify('No se pudo enviar el adjunto', 'err'); }
    else { clearAttach(); clearReply(); $('composer-input').value = ''; $('composer-input').style.height = 'auto'; threadSig = ''; await pollWA(); }
  } catch (e) {
    notify('Error al enviar adjunto: ' + (e.message || e), 'err');
  } finally {
    $('composer-send').disabled = false;
  }
}

// ── Responder (citar) ─────────────────────────────────────────────────────────
function setReply(msgId) {
  const c = byKey[activeKey]; if (!c) return;
  const m = c.messages.find((x) => x.id === msgId); if (!m) return;
  replyTarget = { id: msgId, text: quotedLabel(m) };
  $('reply-text').textContent = replyTarget.text;
  $('reply-bar').classList.remove('hidden');
  $('composer-input').focus();
}
function clearReply() { replyTarget = null; $('reply-bar').classList.add('hidden'); }

// ── Adjuntar archivo ──────────────────────────────────────────────────────────
function setAttach(file) {
  pendingFile = file;
  const kind = waTypeOf(file.type || '');
  const labels = { image: '📷 Foto', video: '🎥 Video', audio: '🎵 Audio', document: '📄 Documento' };
  $('attach-kind').textContent = labels[kind] || 'Adjunto';
  $('attach-name').textContent = file.name || 'archivo';
  $('attach-bar').classList.remove('hidden');
}
function clearAttach() { pendingFile = null; $('attach-bar').classList.add('hidden'); $('file-input').value = ''; }

// ── Grabar nota de voz (UX estilo WhatsApp) ────────────────────────────────────
async function startRecording() {
  if (mediaRec && mediaRec.state === 'recording') return;
  const c = byKey[activeKey]; if (!c || c.channel !== 'whatsapp') return;
  if (!navigator.mediaDevices?.getUserMedia) { notify('Tu navegador no permite grabar', 'err'); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recChunks = []; recAction = 'cancel';
    // WhatsApp acepta ogg/opus para notas de voz; se prefiere si el navegador lo soporta.
    const prefer = ['audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
    const mimeType = prefer.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
    mediaRec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRec.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
    mediaRec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      stopRecUI();
      if (recAction !== 'send' || !recChunks.length) return;
      const type = mediaRec.mimeType || 'audio/webm';
      const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
      const blob = new Blob(recChunks, { type });
      const file = new File([blob], `nota-de-voz.${ext}`, { type });
      sendMediaFile(byKey[activeKey], file, ''); // se envía directo, sin pasar por la barra de adjunto
    };
    mediaRec.start();
    startRecUI();
  } catch { notify('No se pudo acceder al micrófono', 'err'); }
}
function stopRecording(action) {
  if (!mediaRec || mediaRec.state !== 'recording') return;
  recAction = action;
  mediaRec.stop();
}
function startRecUI() {
  recStart = Date.now();
  $('rec-bar').classList.remove('hidden');   // barra compacta encima; el composer sigue visible
  $('btn-mic').classList.add('is-recording');
  $('rec-time').textContent = '0:00';
  recTimer = setInterval(() => {
    const s = Math.floor((Date.now() - recStart) / 1000);
    $('rec-time').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 250);
}
function stopRecUI() {
  clearInterval(recTimer); recTimer = null;
  $('rec-bar').classList.add('hidden');
  $('btn-mic').classList.remove('is-recording');
}

// ── Borrar / bloquear ─────────────────────────────────────────────────────────
async function doDeleteMessage(msgId) {
  const c = byKey[activeKey]; if (!c || c.channel !== 'whatsapp') return;
  if (!confirm('¿Quitar este mensaje del panel? (no se borra del teléfono del cliente)')) return;
  try {
    await fetch('/api/message/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ waId: c.id, messageId: msgId }) });
    threadSig = ''; await pollWA();
  } catch { notify('No se pudo eliminar', 'err'); }
}
async function doDeleteConversation() {
  const c = byKey[activeKey]; if (!c || c.channel !== 'whatsapp') return;
  if (!confirm('¿Eliminar este chat del panel? (no afecta el WhatsApp del cliente)')) return;
  try {
    await fetch('/api/conversation/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ waId: c.id }) });
    backToList(); await pollWA();
  } catch { notify('No se pudo eliminar el chat', 'err'); }
}
async function doBlockToggle() {
  const c = byKey[activeKey]; if (!c || c.channel !== 'whatsapp') return;
  const block = !c.blocked;
  if (block && !confirm('¿Bloquear a este contacto? No podrá enviarte mensajes.')) return;
  try {
    const r = await fetch('/api/conversation/block', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ waId: c.id, block }) });
    const data = await r.json();
    if (!data.ok) { showError(data.code, data.error); notify('No se pudo ' + (block ? 'bloquear' : 'desbloquear'), 'err'); }
    else { notify(block ? 'Contacto bloqueado' : 'Contacto desbloqueado'); threadSig = ''; await pollWA(); }
  } catch (e) { notify('Error: ' + (e.message || e), 'err'); }
}

// ── Toggle IA — WhatsApp (panel/Supabase) o Messenger/IG (GAS/Sheets) ────────
async function toggleAI(on) {
  const c = byKey[activeKey]; if (!c) return;
  if (!CHANNELS_ENABLED[c.channel]) { $('chat-toggle').checked = c.aiOn !== false; return; }  // solo lectura
  c.aiOn = on; listSig = '';           // optimista
  try {
    if (c.channel === 'whatsapp') {
      const r = await fetch('/api/ai-toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ waId: c.id, on }) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
    } else {
      await gasPost({ action: 'toggle', sender_id: c.id, activado: on ? 'TRUE' : 'FALSE' });
    }
  } catch (e) {
    c.aiOn = !on; notify('No se pudo cambiar la IA', 'err'); $('chat-toggle').checked = !on;
  }
  renderList();
}

// ── Renombrar ─────────────────────────────────────────────────────────────────
async function renameContact() {
  const c = byKey[activeKey]; if (!c) return;
  const nuevo = prompt('Nombre del contacto:', c.name || '');
  if (nuevo == null) return;
  const name = nuevo.trim(); if (!name) return;
  const prev = c.name; c.name = name; $('chat-nombre').textContent = name; listSig = '';
  try {
    if (c.channel === 'whatsapp') await fetch('/api/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ waId: c.id, name }) });
    else await gasPost({ action: 'rename', sender_id: c.id, nombre: name });
  } catch (e) { c.name = prev; $('chat-nombre').textContent = prev; notify('No se pudo renombrar', 'err'); }
  renderList();
}

// ── Modal error / lightbox ────────────────────────────────────────────────────
function showError(code, inline, rawMessage) {
  const info = inline || errorMap.map[code] || errorMap.fallback || { titulo: 'Error', explica: 'Error desconocido.', accion: '', gravedad: 'error' };
  $('err-titulo').textContent = info.titulo || 'Error';
  // El texto de errors.js es genérico; el motivo REAL lo da Meta en su message crudo.
  const explica = info.explica || '';
  $('err-explica').textContent = rawMessage ? `${explica}\n\nMeta dice: ${rawMessage}` : explica;
  $('err-accion').textContent = info.accion || '';
  $('err-code').textContent = code ? `Código: ${code}` : '';
  $('err-modal').classList.remove('hidden');
}
function openLightbox(src) { $('lightbox-img').src = src; $('lightbox').classList.remove('hidden'); }
function closeLightbox() { $('lightbox').classList.add('hidden'); $('lightbox-img').src = ''; }

// ── Dropdown de filtro (custom) ───────────────────────────────────────────
function wireDropdown() {
  const dd = $('canal-dd'), btn = $('canal-btn'), menu = $('canal-menu');
  const open = () => { dd.dataset.open = 'true'; btn.setAttribute('aria-expanded', 'true'); menu.classList.remove('hidden'); };
  const close = () => { dd.dataset.open = 'false'; btn.setAttribute('aria-expanded', 'false'); menu.classList.add('hidden'); };
  btn.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.contains('hidden') ? open() : close(); });
  menu.querySelectorAll('.dropdown__opt').forEach((opt) => {
    opt.addEventListener('click', () => {
      if (opt.classList.contains('is-disabled')) return;  // canal fuera de alcance
      channelFilter = opt.dataset.value;
      $('canal-label').textContent = opt.textContent.trim();
      menu.querySelectorAll('.dropdown__opt').forEach((o) => o.classList.toggle('is-selected', o === opt));
      close(); listSig = ''; renderList();
    });
  });
  document.addEventListener('click', (e) => { if (!dd.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

// ── Pedidos (Supabase, migración gradual desde Sheets) ─────────────────────
let orders = [];
let ordersFilter = 'pendiente';
let ordersLoaded = false;

function fmtMoney(v) {
  const n = Number(v);
  if (!isFinite(n)) return String(v ?? '');
  return '$' + n.toLocaleString('es-CO');
}
function fmtOrderDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }) + ', ' +
         d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}
const ESTADO_LABEL = { pendiente: 'Pendiente', despachado: 'Despachado' };
function orderChannel(p) {
  const r = String(p || '').toLowerCase();
  return r === 'instagram' ? 'instagram' : (r === 'messenger' || r === 'page') ? 'messenger' : r === 'manual' ? 'manual' : 'whatsapp';
}

async function pollOrders() {
  try {
    const r = await fetch('/api/orders');
    if (r.status === 401) { panelStarted = false; showLogin(); return; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    orders = data.orders || [];
    ordersLoaded = true;
  } catch { /* deja lo que había */ }
  renderOrdersBadge();
  if (currentSection === 'orders') renderOrders();
}

function renderOrdersBadge() {
  const n = orders.filter((o) => o.estado === 'pendiente').length;
  const b = $('nav-orders-badge');
  b.textContent = n > 99 ? '99+' : String(n);
  b.classList.toggle('hidden', n === 0);
}

// ── Navegación por secciones ────────────────────────────────────────────────
let currentSection = 'chats';
function setSection(name) {
  currentSection = name;
  document.querySelectorAll('#nav .nav__tab').forEach((t) => t.classList.toggle('is-active', t.dataset.section === name));
  $('section-chats').classList.toggle('section--active', name === 'chats');
  $('section-orders').classList.toggle('section--active', name === 'orders');
  if (name === 'orders') { if (ordersLoaded) renderOrders(); else pollOrders(); }
}

function renderOrders() {
  $('orders-loading').classList.add('hidden');
  const rows = ordersFilter === 'todos' ? orders : orders.filter((o) => o.estado === ordersFilter);
  $('orders-count').textContent = orders.length ? `${orders.length}` : '';
  const box = $('orders-list'), empty = $('orders-empty');
  if (!rows.length) {
    box.innerHTML = '';
    empty.textContent = ordersLoaded
      ? (orders.length ? 'Sin pedidos en este filtro.' : 'Aún no hay pedidos. Cuando la IA concrete una venta, aparecerá aquí.')
      : 'Cargando…';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  box.innerHTML = rows.map(orderCardHTML).join('');
  box.querySelectorAll('.oaction').forEach((el) => el.addEventListener('click', () => setOrderEstado(el.dataset.id, el.dataset.estado)));
  box.querySelectorAll('.oedit').forEach((el) => el.addEventListener('click', () => openOrderModal(el.dataset.id)));
}

function orderCardHTML(o) {
  const ch = orderChannel(o.plataforma);
  const tel = String(o.telefono || '').replace(/\s+/g, '');
  const row = (ico, val) => `<div class="mrow"><span class="mrow__ico" aria-hidden="true">${ico}</span><span class="mrow__val">${val}</span></div>`;
  const telHtml = tel ? row('📞', `<a href="tel:${esc(tel)}">${esc(o.telefono)}</a>`) : '';
  const dirHtml = o.direccion ? row('📍', esc(o.direccion)) : '';
  const pagoHtml = o.pago ? row('💳', esc(o.pago)) : '';
  const toggle = o.estado === 'pendiente'
    ? `<button class="oaction oaction--ok" data-id="${esc(o.id)}" data-estado="despachado">✓ Despachar</button>`
    : `<button class="oaction" data-id="${esc(o.id)}" data-estado="pendiente">↩ Reabrir</button>`;
  const acciones = `<button class="oedit" data-id="${esc(o.id)}" title="Editar" aria-label="Editar">✎</button>${toggle}`;
  return `<div class="order-card order-card--${o.estado}">
    <div class="order-card__head">
      <span class="canal-badge canal-badge--${ch}" aria-hidden="true">${canalIcon(ch)}</span>
      <div class="order-card__who">
        <div class="order-card__name">${esc(o.nombre || 'Sin nombre')}</div>
        <div class="order-card__time">${esc(fmtOrderDate(o.createdAt))}</div>
      </div>
      <span class="estado-chip estado-chip--${o.estado}">${esc(ESTADO_LABEL[o.estado] || o.estado)}</span>
    </div>
    ${o.pedido ? `<div class="order-card__items">${linkify(esc(o.pedido))}</div>` : ''}
    <div class="order-card__meta">${telHtml}${dirHtml}${pagoHtml}</div>
    <div class="order-card__foot">
      <div class="order-card__total"><small>Total</small>${esc(fmtMoney(o.total))}</div>
      <div class="order-card__actions">${acciones}</div>
    </div>
  </div>`;
}

async function setOrderEstado(id, estado) {
  const o = orders.find((x) => String(x.id) === String(id)); if (!o) return;
  const prev = o.estado; o.estado = estado;   // optimista
  renderOrders(); renderOrdersBadge();
  try {
    const r = await fetch('/api/orders/estado', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, estado }) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    notify(estado === 'despachado' ? 'Pedido despachado' : 'Pedido reabierto');
  } catch {
    o.estado = prev; renderOrders(); renderOrdersBadge(); notify('No se pudo actualizar el pedido', 'err');
  }
}

// ── Editar / eliminar pedido (modal) ───────────────────────────────────────
let editingOrderId = null;
function openOrderModal(id) {
  const o = orders.find((x) => String(x.id) === String(id)); if (!o) return;
  editingOrderId = o.id;
  $('order-modal-title').textContent = 'Editar pedido';
  $('order-edit-delete').classList.remove('hidden');
  $('order-edit-save').textContent = 'Guardar';
  $('order-edit-id').value = o.id;
  $('order-edit-nombre').value = o.nombre || '';
  $('order-edit-telefono').value = o.telefono || '';
  $('order-edit-direccion').value = o.direccion || '';
  $('order-edit-pago').value = o.pago || '';
  $('order-edit-pedido').value = o.pedido || '';
  $('order-edit-total').value = o.total ?? '';
  $('order-modal').classList.remove('hidden');
}
// Modal en modo CREAR: pedido manual desde el panel.
function openOrderCreate() {
  editingOrderId = null;
  $('order-modal-title').textContent = 'Nuevo pedido';
  $('order-edit-delete').classList.add('hidden');   // nada que eliminar aún
  $('order-edit-save').textContent = 'Crear pedido';
  ['nombre', 'telefono', 'direccion', 'pago', 'pedido', 'total'].forEach((f) => { $('order-edit-' + f).value = ''; });
  $('order-edit-id').value = '';
  $('order-modal').classList.remove('hidden');
  setTimeout(() => $('order-edit-nombre').focus(), 50);
}
function closeOrderModal() { $('order-modal').classList.add('hidden'); editingOrderId = null; }

async function saveOrderEdit(e) {
  e.preventDefault();
  const data = {
    nombre: $('order-edit-nombre').value.trim(),
    telefono: $('order-edit-telefono').value.trim(),
    direccion: $('order-edit-direccion').value.trim(),
    pago: $('order-edit-pago').value.trim(),
    pedido: $('order-edit-pedido').value.trim(),
    total: $('order-edit-total').value.trim(),
  };
  const isNew = editingOrderId == null;
  if (isNew && !Object.values(data).some((v) => v)) { notify('El pedido está vacío', 'err'); return; }
  const btn = $('order-edit-save'); btn.disabled = true;
  try {
    if (isNew) {
      const r = await fetch('/api/orders/crear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      closeOrderModal(); await pollOrders(); notify('Pedido creado');
    } else {
      const id = editingOrderId;
      const r = await fetch('/api/orders/editar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...data }) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const o = orders.find((x) => String(x.id) === String(id));
      if (o) Object.assign(o, data);
      closeOrderModal(); renderOrders(); notify('Pedido actualizado');
    }
  } catch {
    notify(isNew ? 'No se pudo crear el pedido' : 'No se pudo guardar el pedido', 'err');
  } finally { btn.disabled = false; }
}

async function deleteOrderEdit() {
  const id = editingOrderId; if (id == null) return;
  if (!confirm('¿Eliminar este pedido? No se puede deshacer.')) return;
  const btn = $('order-edit-delete'); btn.disabled = true;
  try {
    const r = await fetch('/api/orders/eliminar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    orders = orders.filter((x) => String(x.id) !== String(id));
    closeOrderModal(); renderOrders(); renderOrdersBadge(); notify('Pedido eliminado');
  } catch {
    notify('No se pudo eliminar el pedido', 'err');
  } finally { btn.disabled = false; }
}

// ── Login ─────────────────────────────────────────────────────────────────
let panelStarted = false;
function showLogin() { $('login').classList.remove('hidden'); setTimeout(() => $('login-pass').focus(), 50); }
function hideLogin() { $('login').classList.add('hidden'); }
async function doLogin(e) {
  e.preventDefault();
  const pass = $('login-pass').value;
  $('login-btn').disabled = true; $('login-err').classList.add('hidden');
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pass }) });
    if (!r.ok) throw new Error('bad');
    hideLogin(); $('login-pass').value = ''; startPanel();
  } catch {
    $('login-err').classList.remove('hidden'); $('login-pass').select();
  } finally { $('login-btn').disabled = false; }
}

async function boot() {
  wire();
  let me = { authed: false, needsPassword: true };
  try { me = await fetch('/api/me').then((r) => r.json()); } catch {}
  if (me.needsPassword && !me.authed) showLogin();
  else startPanel();
}
let intervalsSet = false;
function startPanel() {
  if (panelStarted) return;
  panelStarted = true;
  fetch('/api/errors.json').then((r) => r.json()).then((d) => { errorMap = d; }).catch(() => {});
  pollWA(); pollMeta(); pollHealth(); pollOrders();
  if (!intervalsSet) {
    intervalsSet = true;
    setInterval(pollWA, POLL_WA_MS);
    setInterval(pollMeta, POLL_META_MS);
    setInterval(pollHealth, POLL_HEALTH_MS);
    setInterval(pollOrders, POLL_ORDERS_MS);
  }
}

// ── Wire-up ─────────────────────────────────────────────────────────────────
function wire() {
  $('login-form').addEventListener('submit', doLogin);
  $('login-eye').addEventListener('click', () => {
    const inp = $('login-pass'), eye = $('login-eye');
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    eye.classList.toggle('is-on', show);
    eye.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
    eye.title = show ? 'Ocultar contraseña' : 'Mostrar contraseña';
    inp.focus();
  });
  $('btn-back').addEventListener('click', backToList);
  $('btn-refresh').addEventListener('click', () => { listSig = ''; threadSig = ''; pollWA(); pollMeta(); pollHealth(); });
  $('btn-status').addEventListener('click', openStatus);
  $('nav').querySelectorAll('.nav__tab').forEach((t) => t.addEventListener('click', () => setSection(t.dataset.section)));
  $('btn-orders-refresh').addEventListener('click', () => { $('orders-loading').classList.remove('hidden'); pollOrders(); });
  $('btn-order-new').addEventListener('click', openOrderCreate);
  $('orders-filters').querySelectorAll('.ofilter').forEach((b) => b.addEventListener('click', () => {
    ordersFilter = b.dataset.estado;
    $('orders-filters').querySelectorAll('.ofilter').forEach((o) => o.classList.toggle('is-active', o === b));
    renderOrders();
  }));
  $('status-modal').querySelectorAll('[data-close-status]').forEach((el) => el.addEventListener('click', closeStatus));
  $('order-modal').querySelectorAll('[data-close-order]').forEach((el) => el.addEventListener('click', closeOrderModal));
  $('order-form').addEventListener('submit', saveOrderEdit);
  $('order-edit-delete').addEventListener('click', deleteOrderEdit);
  $('search').addEventListener('input', (e) => { searchTerm = e.target.value; listSig = ''; renderList(); });
  wireDropdown();
  $('chat-nombre').addEventListener('click', renameContact);
  $('chat-toggle').addEventListener('change', (e) => toggleAI(e.target.checked));

  const input = $('composer-input');
  $('composer').addEventListener('submit', (e) => { e.preventDefault(); onComposerSubmit(); });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 128) + 'px'; });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('composer').requestSubmit(); } });

  // adjuntar / micrófono / respuesta
  $('btn-attach').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) setAttach(f); });
  $('btn-mic').addEventListener('click', startRecording);
  $('rec-send').addEventListener('click', () => stopRecording('send'));
  $('rec-cancel').addEventListener('click', () => stopRecording('cancel'));
  $('reply-cancel').addEventListener('click', clearReply);
  $('attach-cancel').addEventListener('click', clearAttach);

  // menú ⋯ del chat
  const menu = $('chat-menu'), menuBtn = $('chat-menu-btn');
  menuBtn.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); });
  document.addEventListener('click', (e) => { if (!menu.contains(e.target) && e.target !== menuBtn) menu.classList.add('hidden'); });
  menu.querySelectorAll('.cmenu__item').forEach((it) => it.addEventListener('click', () => {
    menu.classList.add('hidden');
    const act = it.dataset.act;
    if (act === 'rename') renameContact();
    else if (act === 'block') doBlockToggle();
    else if (act === 'delete') doDeleteConversation();
  }));

  $('lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox' || e.target.classList.contains('lightbox__close')) closeLightbox(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeLightbox(); $('err-modal').classList.add('hidden'); closeStatus(); } });
  $('err-modal').querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', () => $('err-modal').classList.add('hidden')));
}
boot();
