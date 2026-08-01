// Panel unificado — WhatsApp Cloud (tiempo real, este backend) +
// Messenger/Instagram (Google Sheets vía Apps Script). Sin reescribir el bot.
'use strict';

// ── Configuración ────────────────────────────────────────────────────────────
// URL del Apps Script (lee/escribe la hoja "actividad" de Messenger/IG).
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxAETSMOzO6ozHdy88OoXiKUMZ2YW05VoFvXWGqZHdwDozsGBe6Iiit-hNl9GK-OB_p/exec';
const POLL_WA_MS = 3000;
const POLL_META_MS = 6000;

const $ = (id) => document.getElementById(id);

// ── SVG de canal ─────────────────────────────────────────────────────────────
const ICON_WA = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2zm5.8 14.16c-.24.68-1.42 1.31-1.96 1.36-.5.06-1.13.08-1.83-.11-.42-.13-.96-.31-1.65-.6-2.91-1.26-4.81-4.19-4.96-4.39-.14-.2-1.19-1.58-1.19-3.01s.75-2.14 1.02-2.43c.27-.29.58-.36.78-.36l.56.01c.18.01.42-.07.66.5.24.59.82 2.02.89 2.17.07.14.12.31.02.51-.1.2-.15.31-.29.48-.14.17-.3.38-.43.51-.14.14-.29.29-.13.57.16.27.72 1.18 1.54 1.91 1.06.94 1.95 1.24 2.23 1.38.27.14.43.12.59-.07.16-.2.68-.79.86-1.06.18-.27.36-.22.61-.13.25.09 1.58.74 1.85.88.27.14.45.2.51.31.07.12.07.66-.17 1.34z"/></svg>';
const ICON_FB = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.21 2 11.4c0 2.96 1.46 5.6 3.75 7.32V22l3.43-1.88c.91.25 1.87.39 2.82.39 5.52 0 10-4.21 10-9.4S17.52 2 12 2zm1.02 12.66l-2.55-2.72-4.97 2.72 5.47-5.8 2.61 2.72 4.91-2.72-5.47 5.8z"/></svg>';
const ICON_IG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.2c3.2 0 3.6 0 4.9.07 1.2.05 1.8.25 2.2.42.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.17.4.37 1 .42 2.2.06 1.3.07 1.7.07 4.9s0 3.6-.07 4.9c-.05 1.2-.25 1.8-.42 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.17-1 .37-2.2.42-1.3.06-1.7.07-4.9.07s-3.6 0-4.9-.07c-1.2-.05-1.8-.25-2.2-.42-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.17-.4-.37-1-.42-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.07-4.9c.05-1.2.25-1.8.42-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.17 1-.37 2.2-.42C8.4 2.2 8.8 2.2 12 2.2zm0 3.2A6.6 6.6 0 1 0 18.6 12 6.6 6.6 0 0 0 12 5.4zm0 10.9A4.3 4.3 0 1 1 16.3 12 4.3 4.3 0 0 1 12 16.3zm6.8-11.1a1.54 1.54 0 1 1-1.54-1.54 1.54 1.54 0 0 1 1.54 1.54z"/></svg>';
function canalIcon(ch) { return ch === 'instagram' ? ICON_IG : ch === 'messenger' ? ICON_FB : ICON_WA; }

// ── Estado ────────────────────────────────────────────────────────────────
let waConvs = [];      // normalizadas desde este backend
let metaConvs = [];    // normalizadas desde GAS (messenger/instagram)
let convs = [];        // fusión
let byKey = {};
let activeKey = null;
let searchTerm = '';
let channelFilter = 'todos';
let errorMap = { map: {}, fallback: null };
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
    windowOpen: c.windowOpen, windowMsLeft: c.windowMsLeft, aiOn: null, blocked: !!c.blocked,
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
  } catch { /* deja lo que había */ }
  rebuild();
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
function setConn(ok) {
  const d = $('conn-dot');
  d.className = 'conn-status ' + (ok ? 'conn-status--ok' : 'conn-status--off');
  d.title = ok ? 'Conectado al servidor' : 'Sin conexión con el servidor';
}
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

  // Controles según canal: WA → ventana 24h + media/bloqueo; Messenger/IG → toggle IA
  $('window-badge').classList.toggle('hidden', !isWA);
  $('ai-switch').classList.toggle('hidden', isWA);
  $('btn-attach').classList.toggle('hidden', !isWA);
  $('btn-mic').classList.toggle('hidden', !isWA);
  // items del menú ⋯: renombrar siempre; bloquear/eliminar solo WhatsApp
  $('cmenu-block').classList.toggle('hidden', !isWA);
  $('chat-menu').querySelector('[data-act="delete"]').classList.toggle('hidden', !isWA);
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
  } else {
    $('chat-toggle').checked = c.aiOn !== false;
    $('composer-input').disabled = false;
    $('composer-send').disabled = false;
    $('composer').classList.remove('hidden');
    $('window-closed').classList.add('hidden');
    $('blocked-banner').classList.add('hidden');
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
      if (!data.ok) { showError(data.code, data.error); notify('No se pudo enviar', 'err'); }
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
    if (!data.ok) { showError(data.code, data.error); notify('No se pudo enviar el adjunto', 'err'); }
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

// ── Toggle IA (Messenger/IG) ─────────────────────────────────────────────────
async function toggleAI(on) {
  const c = byKey[activeKey]; if (!c || c.channel === 'whatsapp') return;
  const nuevo = on ? 'TRUE' : 'FALSE';
  c.aiOn = on; listSig = '';           // optimista
  try { await gasPost({ action: 'toggle', sender_id: c.id, activado: nuevo }); }
  catch (e) { c.aiOn = !on; notify('No se pudo cambiar la IA', 'err'); $('chat-toggle').checked = !on; }
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
function showError(code, inline) {
  const info = inline || errorMap.map[code] || errorMap.fallback || { titulo: 'Error', explica: 'Error desconocido.', accion: '', gravedad: 'error' };
  $('err-titulo').textContent = info.titulo || 'Error';
  $('err-explica').textContent = info.explica || '';
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
      channelFilter = opt.dataset.value;
      $('canal-label').textContent = opt.textContent.trim();
      menu.querySelectorAll('.dropdown__opt').forEach((o) => o.classList.toggle('is-selected', o === opt));
      close(); listSig = ''; renderList();
    });
  });
  document.addEventListener('click', (e) => { if (!dd.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
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
  pollWA(); pollMeta();
  if (!intervalsSet) { intervalsSet = true; setInterval(pollWA, POLL_WA_MS); setInterval(pollMeta, POLL_META_MS); }
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
  $('btn-refresh').addEventListener('click', () => { listSig = ''; threadSig = ''; pollWA(); pollMeta(); });
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
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeLightbox(); $('err-modal').classList.add('hidden'); } });
  $('err-modal').querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', () => $('err-modal').classList.add('hidden')));
}
boot();
