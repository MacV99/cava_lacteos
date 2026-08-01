// Express: sirve el panel estático + API + /webhook (GET verifica, POST recibe).
import express from 'express';
import multer from 'multer';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config, warnMissing } from './config.js';
import { handleWebhookBody } from './handler.js';
import * as store from './store.js';
import {
  sendText, sendTemplate, markRead as waMarkRead, getMediaUrl, downloadMedia,
  uploadMedia, sendMedia, blockUser, unblockUser, getPhoneHealth,
} from './whatsapp.js';
import { convertToMp3 } from './audio.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
import { explainError, fullMessage, ERROR_MAP, ERROR_FALLBACK } from './errors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

const app = express();
app.use(express.json({ limit: '2mb' }));

// ── Login por contraseña (cookie firmada, sin estado en memoria) ────────────
// Gate simple: protege /api/* (los datos). Si PANEL_PASSWORD está vacío, sin login.
// La sesión es una cookie firmada (HMAC) con expiración → sobrevive reinicios/deploys.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días
const AUTH_PUBLIC = new Set(['/api/login', '/api/logout', '/api/me']);

// Secreto derivado de la contraseña: estable entre reinicios; cambiar la clave invalida sesiones.
const sessionSecret = () => createHmac('sha256', 'cava-panel-v1').update(config.panelPassword || '').digest('hex');
const signPart = (exp) => createHmac('sha256', sessionSecret()).update(String(exp)).digest('hex');
function makeSession() { const exp = Date.now() + SESSION_TTL_MS; return `${exp}.${signPart(exp)}`; }
function validSession(token) {
  if (!token) return false;
  const i = token.indexOf('.');
  if (i < 0) return false;
  const exp = Number(token.slice(0, i)), sig = token.slice(i + 1);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = signPart(exp);
  if (sig.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
function cookieToken(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)panel_session=([^;]+)/);
  return m ? m[1] : '';
}
function isAuthed(req) {
  if (!config.panelPassword) return true; // sin clave configurada → abierto
  return validSession(cookieToken(req));
}

// Protege solo /api/* (menos login/me/logout). /webhook y /healthz quedan abiertos.
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/') || AUTH_PUBLIC.has(req.path)) return next();
  if (isAuthed(req)) return next();
  return res.status(401).json({ error: 'no autorizado' });
});

app.get('/api/me', (req, res) => {
  res.json({ authed: isAuthed(req), needsPassword: !!config.panelPassword });
});

app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (!config.panelPassword || password !== config.panelPassword) {
    return res.status(401).json({ ok: false, error: 'clave incorrecta' });
  }
  res.setHeader('Set-Cookie', `panel_session=${makeSession()}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; SameSite=Lax`);
  res.json({ ok: true });
});

app.post('/api/logout', (_req, res) => {
  res.setHeader('Set-Cookie', 'panel_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
  res.json({ ok: true });
});

// ── Webhook: verificación (GET) ──────────────────────────────────────────────
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === config.verifyToken) {
    console.log('[webhook] verificado OK');
    return res.status(200).send(challenge);
  }
  console.warn('[webhook] verificación fallida (token no coincide)');
  return res.sendStatus(403);
});

// ── Webhook: recepción (POST) — responde 200 rápido, procesa async ───────────
app.post('/webhook', (req, res) => {
  res.sendStatus(200);
  handleWebhookBody(req.body).catch((e) => console.error('[webhook] error procesando:', e));
});

// ── /send: el bot Python (IA) pide enviar un texto a un cliente ──────────────
// Mismo contrato que el gateway Baileys: { jid, text } + header X-Gateway-Secret.
// jid == wa_id (número). Envía por Graph API y guarda el saliente para el panel.
app.post('/send', async (req, res) => {
  const secret = req.get('X-Gateway-Secret') || '';
  if (!config.gatewaySecret || secret !== config.gatewaySecret) {
    return res.status(403).json({ ok: false, error: 'secreto inválido' });
  }
  const { jid, text } = req.body || {};
  if (!jid || !text) return res.status(400).json({ ok: false, error: 'faltan jid y text' });
  try {
    const data = await sendText(jid, text);
    const wamid = data.messages?.[0]?.id || null;
    store.addOutbound(jid, { id: wamid, ts: Date.now(), type: 'text', text });
    res.json({ ok: true, id: wamid });
  } catch (e) {
    const raw = fullMessage(e);
    console.error(`[send/bot] error ${e.code}: ${raw}`);
    res.status(502).json({ ok: false, code: e.code, message: raw });
  }
});

// ── API para el panel ────────────────────────────────────────────────────────
const WINDOW_MS = 24 * 60 * 60 * 1000;

app.get('/api/conversations', (req, res) => {
  const now = Date.now();
  const list = store.listConversations().map((c) => ({
    ...c,
    windowOpen: c.lastInboundTs > 0 && now - c.lastInboundTs < WINDOW_MS,
    windowMsLeft: c.lastInboundTs > 0 ? Math.max(0, WINDOW_MS - (now - c.lastInboundTs)) : 0,
  }));
  res.json({ conversations: list, serverNow: now });
});

// Enviar texto (o plantilla si se pasa `template`). `replyTo` = wamid a citar.
app.post('/api/send', async (req, res) => {
  const { to, text, template, replyTo } = req.body || {};
  if (!to || (!text && !template)) return res.status(400).json({ error: 'faltan to y text' });
  try {
    let data, msg;
    if (template) {
      data = await sendTemplate(to, template.name, template.lang, template.components);
      msg = { type: 'template', text: `[plantilla: ${template.name}]` };
    } else {
      data = await sendText(to, text, replyTo);
      msg = { type: 'text', text, replyTo: replyTo || null };
    }
    const wamid = data.messages?.[0]?.id || null;
    store.addOutbound(to, { id: wamid, ts: Date.now(), ...msg });
    res.json({ ok: true, id: wamid });
  } catch (e) {
    const info = explainError(e.code), raw = fullMessage(e);
    console.error(`[send] error ${e.code}: ${raw}`);
    res.status(502).json({ ok: false, code: e.code, message: raw, error: { code: e.code, ...info } });
  }
});

// Enviar multimedia/audio: multipart { file, to, type, caption?, replyTo? }.
app.post('/api/send-media', upload.single('file'), async (req, res) => {
  const { to, type, caption, replyTo } = req.body || {};
  const file = req.file;
  if (!to || !type || !file) return res.status(400).json({ error: 'faltan to, type o file' });
  try {
    let buffer = file.buffer, mime = file.mimetype, filename = file.originalname;
    if (type === 'audio') {
      const before = mime;
      // MP3: llega como audio con play. Nota de voz nativa (ogg/opus + voice:true) queda
      // para producción — el número de prueba la rechaza con 131053. Ver audio.js.
      buffer = await convertToMp3(buffer);
      mime = 'audio/mpeg';
      filename = (filename || 'audio').replace(/\.[^.]+$/, '') + '.mp3';
      console.log(`[send-media] audio ${before} (${file.size}b) → mp3 (${buffer.length}b)`);
    } else {
      console.log(`[send-media] ${type} ${mime} (${file.size}b)`);
    }
    const { id: mediaId } = await uploadMedia(buffer, mime, filename);
    const data = await sendMedia(to, type, mediaId, { caption, filename, replyTo });
    const wamid = data.messages?.[0]?.id || null;
    store.addOutbound(to, {
      id: wamid, ts: Date.now(), type, mediaId, mime,
      filename, text: caption || '', replyTo: replyTo || null,
    });
    res.json({ ok: true, id: wamid, mediaId });
  } catch (e) {
    const info = explainError(e.code), raw = fullMessage(e);
    console.error(`[send-media] error ${e.code}: ${raw}`);
    res.status(502).json({ ok: false, code: e.code, message: raw, error: { code: e.code, ...info } });
  }
});

// Borrar un mensaje del panel (WhatsApp no permite unsend por API).
app.post('/api/message/delete', (req, res) => {
  const { waId, messageId } = req.body || {};
  if (!waId || !messageId) return res.status(400).json({ error: 'faltan waId y messageId' });
  const ok = store.deleteMessage(waId, messageId);
  res.json({ ok });
});

// Borrar la conversación del panel.
app.post('/api/conversation/delete', (req, res) => {
  const { waId } = req.body || {};
  if (!waId) return res.status(400).json({ error: 'falta waId' });
  res.json({ ok: store.deleteConversation(waId) });
});

// Bloquear / desbloquear (Block API oficial de WhatsApp).
app.post('/api/conversation/block', async (req, res) => {
  const { waId, block } = req.body || {};
  if (!waId) return res.status(400).json({ error: 'falta waId' });
  try {
    if (block) await blockUser(waId); else await unblockUser(waId);
    store.setBlocked(waId, !!block);
    res.json({ ok: true, blocked: !!block });
  } catch (e) {
    const info = explainError(e.code), raw = fullMessage(e);
    console.error(`[block] error ${e.code}: ${raw}`);
    res.status(502).json({ ok: false, code: e.code, message: raw, error: { code: e.code, ...info } });
  }
});

// Marcar conversación como leída (limpia unread + acusa read en WhatsApp).
app.post('/api/read', async (req, res) => {
  const { waId } = req.body || {};
  if (!waId) return res.status(400).json({ error: 'falta waId' });
  const c = store.getConversation(waId);
  store.markRead(waId);
  // acusa read del último entrante en WhatsApp (best-effort)
  const lastIn = c ? [...c.messages].reverse().find((m) => m.dir === 'in' && m.id) : null;
  if (lastIn) waMarkRead(lastIn.id).catch(() => {});
  res.json({ ok: true });
});

// Encender/apagar la IA (bot Python) para un chat. On → el webhook reenvía sus entrantes.
app.post('/api/ai-toggle', (req, res) => {
  const { waId, on } = req.body || {};
  if (!waId) return res.status(400).json({ error: 'falta waId' });
  const c = store.setAiOn(waId, !!on);
  if (!c) return res.status(404).json({ error: 'conversación no encontrada' });
  res.json({ ok: true, aiOn: c.aiOn });
});

// Renombrar contacto de WhatsApp (el nombre por defecto es el del perfil).
app.post('/api/rename', (req, res) => {
  const { waId, name } = req.body || {};
  if (!waId) return res.status(400).json({ error: 'falta waId' });
  const c = store.rename(waId, name);
  if (!c) return res.status(404).json({ error: 'conversación no encontrada' });
  res.json({ ok: true, name: c.name });
});

// Proxy de media entrante: <img src="/api/media/{id}">
app.get('/api/media/:id', async (req, res) => {
  try {
    const meta = await getMediaUrl(req.params.id);
    const { buffer, contentType } = await downloadMedia(meta.url);
    res.set('Content-Type', contentType || meta.mime_type || 'application/octet-stream');
    res.set('Cache-Control', 'private, max-age=86400');
    res.send(buffer);
  } catch (e) {
    console.error('[media] error:', e.message);
    res.sendStatus(502);
  }
});

// Mapa de errores para el modal del panel.
app.get('/api/errors.json', (_req, res) => {
  res.json({ map: ERROR_MAP, fallback: ERROR_FALLBACK });
});

// Estado real del canal WhatsApp Cloud (ping a Graph con el token del número).
// Messenger/IG los evalúa el panel por su cuenta (flujo de datos del Apps Script).
app.get('/api/health/channels', async (_req, res) => {
  const whatsapp = await getPhoneHealth();
  res.json({ whatsapp, serverNow: Date.now() });
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

// ── Panel estático (no-cache para no servir JS viejo) ────────────────────────
app.use(express.static(PUBLIC_DIR, {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));

app.listen(config.port, () => {
  warnMissing();
  console.log(`[server] escuchando en http://localhost:${config.port}`);
  console.log(`[server] panel: http://localhost:${config.port}/  ·  webhook: /webhook`);
});
