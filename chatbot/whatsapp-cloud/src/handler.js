// Procesa el body del webhook de Meta: mensajes entrantes + acuses de estado.
import { addInbound, applyStatus, applyReaction } from './store.js';
import { forwardInbound } from './bridge.js';

const MEDIA_TYPES = ['image', 'video', 'audio', 'voice', 'document', 'sticker'];

// Normaliza el timestamp de Meta (segundos, string) a ms.
function tsToMs(t) {
  const n = Number(t);
  return Number.isFinite(n) ? n * 1000 : Date.now();
}

function extractMessage(m, contactName) {
  const base = { id: m.id, ts: tsToMs(m.timestamp), type: m.type };

  if (m.type === 'text') {
    return { ...base, text: m.text?.body || '' };
  }
  if (m.type === 'button') {
    return { ...base, type: 'text', text: m.button?.text || '' };
  }
  if (m.type === 'interactive') {
    const i = m.interactive || {};
    const text = i.button_reply?.title || i.list_reply?.title || '';
    return { ...base, type: 'text', text };
  }
  if (m.type === 'reaction') {
    return { ...base, type: 'text', text: `${m.reaction?.emoji || '❤️'} (reacción)` };
  }
  if (m.type === 'location') {
    const loc = m.location || {};
    return { ...base, type: 'text', text: `📍 Ubicación: ${loc.latitude}, ${loc.longitude}` };
  }
  if (MEDIA_TYPES.includes(m.type)) {
    const media = m[m.type] || {};
    return {
      ...base,
      mediaId: media.id || null,
      mime: media.mime_type || null,
      filename: media.filename || null,
      text: media.caption || '', // el caption va como texto
    };
  }
  // tipo desconocido → deja rastro legible
  return { ...base, type: 'text', text: `[mensaje tipo ${m.type} no soportado]` };
}

export async function handleWebhookBody(body) {
  if (!body || body.object !== 'whatsapp_business_account') return;

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};

      // mapa wa_id → nombre de perfil
      const names = {};
      for (const c of value.contacts || []) {
        if (c.wa_id) names[c.wa_id] = c.profile?.name || c.wa_id;
      }

      // mensajes entrantes
      for (const m of value.messages || []) {
        const waId = m.from;
        const name = names[waId] || waId;

        // Reacción: se adjunta a la burbuja del mensaje al que reaccionó.
        if (m.type === 'reaction') {
          const emoji = m.reaction?.emoji || '';
          const targetId = m.reaction?.message_id;
          const ok = applyReaction(waId, targetId, emoji, tsToMs(m.timestamp));
          if (ok) {
            console.log(`[reaction] ${name}: ${emoji || '(quitada)'} → ${targetId}`);
            continue;
          }
          // fallback: si no tenemos el mensaje objetivo, la dejamos como nota entrante
        }

        const msg = extractMessage(m, name);
        const c = addInbound(waId, name, msg);
        console.log(`[in] ${name} (${waId}): ${msg.text || msg.type}`);
        // Si la IA está encendida para este chat, deja que el bot Python responda.
        forwardInbound(c, msg);
      }

      // acuses de estado (sent/delivered/read/failed)
      for (const s of value.statuses || []) {
        const e0 = s.errors?.[0];
        const err = e0
          ? {
              code: e0.code,
              title: e0.title || e0.message,
              // Meta pone el motivo real en error_data.details (ej. "Media could not be
              // downloaded/processed"). href apunta a la doc del código. Sin esto, 131053
              // sale genérico y no se puede diagnosticar qué rechazó exactamente.
              details: e0.error_data?.details || null,
              href: e0.href || null,
            }
          : null;
        applyStatus(s.id, s.status, err);
        if (s.status === 'failed') console.warn(`[status] failed ${s.id}:`, JSON.stringify(err));
      }
    }
  }
}
