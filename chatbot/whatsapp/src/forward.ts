import pino from "pino";
import { config } from "./config.js";

const logger = pino({ level: config.logLevel });

export interface IncomingPayload {
  jid: string;        // remoteJid completo (…@s.whatsapp.net o …@lid) — clave y destino de respuesta
  phone: string;      // solo el número/LID sin dominio ni sufijo :NN (informativo)
  name: string;       // pushName del contacto
  text: string;       // texto del mensaje
  mid: string;        // id del mensaje (dedup en el bot)
}

/** Reenvía un mensaje entrante al webhook del bot FastAPI. */
export async function forward(payload: IncomingPayload): Promise<void> {
  try {
    const resp = await fetch(config.botWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Gateway-Secret": config.gatewaySecret,
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      logger.error({ status: resp.status }, "Webhook del bot respondió error");
    } else {
      logger.info({ jid: payload.jid, mid: payload.mid }, "→ mensaje reenviado al bot");
    }
  } catch (err) {
    logger.error({ err: String(err) }, "No se pudo contactar el webhook del bot");
  }
}
