import express from "express";
import QRCode from "qrcode";
import pino from "pino";
import { config } from "./config.js";
import { getStatus, getQrString, sendText, disconnect } from "./baileys.js";

const logger = pino({ level: config.logLevel });

export function createServer() {
  const app = express();
  app.use(express.json());

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/status", (_req, res) => {
    res.json(getStatus());
  });

  // Página simple para escanear el QR sin mirar la terminal. Auto-refresca cada 3 s.
  app.get("/qr", async (_req, res) => {
    const qr = getQrString();
    const st = getStatus();
    let body: string;
    if (st.status === "connected") {
      body = `<h2>✓ WhatsApp conectado</h2><p>Número: +${st.phone ?? "?"}</p>`;
    } else if (qr) {
      const dataUrl = await QRCode.toDataURL(qr, { width: 320, margin: 2 });
      body = `<h2>Conectar WhatsApp</h2>
        <img src="${dataUrl}" alt="QR" style="background:#fff;padding:12px;border-radius:12px"/>
        <ol style="text-align:left;max-width:320px;margin:16px auto">
          <li>WhatsApp → Dispositivos vinculados</li>
          <li>Vincular un dispositivo</li>
          <li>Escanea este código</li>
        </ol>`;
    } else {
      body = `<h2>Esperando QR…</h2><p>Estado: ${st.status}</p>`;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8">
      <meta http-equiv="refresh" content="3"><title>Gateway WhatsApp — Cava</title></head>
      <body style="font-family:system-ui;text-align:center;padding:40px;background:#0a0a0a;color:#eee">
      ${body}</body></html>`);
  });

  // QR como data URL (JSON) para que el panel lo muestre. Protegido: lo llama el bot Python.
  app.get("/qr.json", async (req, res) => {
    if (!config.gatewaySecret || req.header("X-Gateway-Secret") !== config.gatewaySecret) {
      return res.status(403).json({ ok: false, error: "Secreto inválido" });
    }
    const st = getStatus();
    const qr = getQrString();
    let dataUrl: string | null = null;
    if (qr && st.status !== "connected") {
      dataUrl = await QRCode.toDataURL(qr, { width: 320, margin: 2 });
    }
    return res.json({ ok: true, status: st.status, phone: st.phone, qr: dataUrl });
  });

  // Desconectar / cerrar sesión de WhatsApp (regenera QR). Protegido: lo llama el bot Python.
  app.post("/disconnect", async (req, res) => {
    if (!config.gatewaySecret || req.header("X-Gateway-Secret") !== config.gatewaySecret) {
      return res.status(403).json({ ok: false, error: "Secreto inválido" });
    }
    try {
      await disconnect();
      return res.json({ ok: true });
    } catch (err) {
      logger.error({ err: String(err) }, "Error al desconectar");
      return res.status(500).json({ ok: false, error: String(err) });
    }
  });

  // Endpoint que usa el bot Python para responder por WhatsApp.
  app.post("/send", async (req, res) => {
    if (!config.gatewaySecret || req.header("X-Gateway-Secret") !== config.gatewaySecret) {
      return res.status(403).json({ ok: false, error: "Secreto inválido" });
    }
    const jid = String(req.body?.jid ?? "").trim();
    const text = String(req.body?.text ?? "").trim();
    if (!jid || !text) {
      return res.status(400).json({ ok: false, error: "jid y text requeridos" });
    }
    try {
      await sendText(jid, text);
      return res.json({ ok: true });
    } catch (err) {
      logger.error({ err: String(err), jid }, "Error enviando a WhatsApp");
      return res.status(502).json({ ok: false, error: String(err) });
    }
  });

  return app;
}
