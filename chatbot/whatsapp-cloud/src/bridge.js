// Puente panel → bot Python. Reenvía los mensajes entrantes de WhatsApp al mismo
// cerebro de IA que atiende Messenger/IG (POST {BOT_WEBHOOK_URL} con X-Gateway-Secret).
// El bot responde llamando de vuelta a POST /send de este panel (ver server.js).
//
// El bot ya habla este contrato (era el del gateway Baileys): body { jid, phone, name, text, mid }.
// Aquí jid == wa_id (el número); el bot lo usa como sender_id y lo devuelve tal cual en /send.
import { config } from './config.js';

export const bridgeEnabled = () => !!(config.botWebhookUrl && config.gatewaySecret);

/** Reenvía un entrante al bot si la IA está encendida para ese chat. Fire-and-forget. */
export function forwardInbound(c, msg) {
  if (!bridgeEnabled()) return;          // sin bot configurado → WhatsApp manual
  if (c.aiOn === false) return;          // IA apagada para este chat → no molestar al bot
  const text = (msg.text || '').trim();
  if (!text) return;                     // v1 solo texto (el bot ignora vacío de todos modos)

  fetch(config.botWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Gateway-Secret': config.gatewaySecret },
    body: JSON.stringify({ jid: c.waId, phone: c.waId, name: c.name || c.waId, text, mid: msg.id || '' }),
  })
    .then((r) => { if (!r.ok) console.error(`[bridge] bot ${r.status} para ${c.waId}`); })
    .catch((e) => console.error('[bridge] no se pudo reenviar al bot:', e.message));
}
