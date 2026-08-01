export const config = {
  port: Number(process.env.PORT ?? 8100),
  botWebhookUrl: process.env.BOT_WEBHOOK_URL ?? "http://localhost:8000/webhook/whatsapp",
  gatewaySecret: process.env.GATEWAY_SECRET ?? "",
  logLevel: (process.env.LOG_LEVEL ?? "info") as "silent" | "error" | "warn" | "info" | "debug",
};

if (!config.gatewaySecret) {
  // No abortamos, pero avisamos fuerte: sin secreto el puente queda abierto.
  console.warn("[gateway] AVISO: GATEWAY_SECRET vacío. /send queda sin protección y el bot rechazará el webhook.");
}
