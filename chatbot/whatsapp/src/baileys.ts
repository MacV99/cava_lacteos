import fs from "node:fs";
import path from "node:path";
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  DisconnectReason,
  type WASocket,
  type WAMessage,
} from "@whiskeysockets/baileys";
import pino from "pino";
import qrcodeTerminal from "qrcode-terminal";
import { config } from "./config.js";
import { forward } from "./forward.js";

const logger = pino({ level: config.logLevel });

const AUTH_DIR = path.resolve(process.cwd(), "auth");

type Status = "disconnected" | "qr" | "connecting" | "connected";

// Estado del módulo, leído por el servidor HTTP (/status, /qr) y usado para enviar.
let sock: WASocket | null = null;
let status: Status = "disconnected";
let latestQr: string | null = null;
let phone: string | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;

export function getStatus() {
  return { status, phone, hasQr: latestQr !== null };
}

export function getQrString(): string | null {
  return latestQr;
}

/** Envía texto a un jid de WhatsApp. Lo llama el endpoint /send (bot en modo humano o respuesta IA). */
export async function sendText(jid: string, text: string): Promise<void> {
  if (!sock) throw new Error("Socket no conectado");
  await sock.sendMessage(jid, { text });
}

/** Cierra sesión, borra credenciales y reinicia para regenerar el QR (gestión desde el panel). */
export async function disconnect(): Promise<void> {
  try { await sock?.logout(); } catch { /* ignorar */ }
  try { sock?.end(undefined); } catch { /* ignorar */ }
  sock = null;
  status = "disconnected";
  phone = null;
  latestQr = null;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch { /* ignorar */ }
  logger.info("Desconectado por el panel; reiniciando para regenerar QR");
  start().catch((err) => logger.error({ err: String(err) }, "Fallo al reiniciar tras disconnect"));
}

export async function start(): Promise<void> {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  // SIEMPRE intentar la última versión: WhatsApp rechaza versiones viejas con code 405.
  let version: [number, number, number] | undefined;
  try {
    ({ version } = await fetchLatestBaileysVersion());
  } catch {
    logger.warn("No se pudo obtener la última versión de Baileys; se usa la del paquete");
    version = undefined;
  }

  status = "connecting";
  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),   // Baileys SIEMPRE silent (su log es ruidoso)
    browser: Browsers.macOS("Desktop"),   // fingerprint conocido; uno custom dispara code 440 en loop
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr) {
      latestQr = qr;
      status = "qr";
      logger.info("QR generado — escanéalo en http://localhost:%d/qr o aquí abajo:", config.port);
      qrcodeTerminal.generate(qr, { small: true });
    }

    if (connection === "open") {
      latestQr = null;
      status = "connected";
      const userId = sock?.user?.id ?? "";
      phone = userId.split(":")[0].split("@")[0] || null;
      logger.info({ phone }, "✓ WhatsApp conectado");
    }

    if (connection === "close") {
      const code = (lastDisconnect?.error as any)?.output?.statusCode as number | undefined;
      if (code === DisconnectReason.loggedOut) {
        // 401: sesión cerrada desde el teléfono. NO reconectar; hay que re-escanear QR.
        status = "disconnected";
        phone = null;
        logger.warn("Sesión cerrada (loggedOut). Borra auth/ y reinicia para re-escanear.");
        return;
      }
      // Cualquier otro código → reconectar con backoff.
      logger.warn({ code }, "Conexión cerrada; reintentando");
      scheduleReconnect(code);
    }
  });

  sock.ev.on("messages.upsert", async (e) => {
    if (e.type !== "notify") return;   // ignora histórico (append/replace)
    for (const msg of e.messages) {
      await handleMessage(msg);
    }
  });
}

async function handleMessage(msg: WAMessage): Promise<void> {
  if (msg.key.fromMe) return;                       // eco propio (por eso se prueba desde OTRO móvil)
  const remoteJid = msg.key.remoteJid;
  if (!remoteJid) return;
  if (
    remoteJid.endsWith("@g.us") ||                  // grupos
    remoteJid.endsWith("@broadcast") ||
    remoteJid.endsWith("@newsletter")
  ) {
    return;
  }
  // Aceptar SOLO 1:1: @s.whatsapp.net O @lid (WhatsApp despliega LID en 2025-2026).
  if (!remoteJid.endsWith("@s.whatsapp.net") && !remoteJid.endsWith("@lid")) return;

  const text = msg.message?.conversation ?? msg.message?.extendedTextMessage?.text ?? null;

  if (!text) {
    // v1: solo texto. Media/audio → aviso fijo (espejo del fallback de Messenger).
    if (msg.message && sock) {
      try {
        await sock.sendMessage(remoteJid, {
          text: "Por ahora por WhatsApp solo puedo leer texto 🙏\nEscríbeme tu pregunta y con gusto te ayudo.",
        });
      } catch { /* ignorar */ }
    }
    return;
  }

  const phoneNumber = remoteJid.split("@")[0].split(":")[0];
  await forward({
    jid: remoteJid,
    phone: phoneNumber,
    name: msg.pushName ?? "",
    text,
    mid: msg.key.id ?? "",
  });
}

function scheduleReconnect(code: number | undefined): void {
  if (reconnectTimer) return;
  // 440 = connectionReplaced, típico justo tras el pairing; reconectar rápido entra en loop.
  const delay = code === 440 ? 15000 : 5000;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    try {
      sock?.end(undefined);   // limpia el socket viejo para no dejar listeners colgando
    } catch { /* ignorar */ }
    sock = null;
    start().catch((err) => logger.error({ err: String(err) }, "Fallo al reconectar"));
  }, delay);
}
