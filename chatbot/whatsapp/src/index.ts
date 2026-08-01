import "./env-loader.js"; // PRIMER import (side-effect): carga .env antes que config.ts
import pino from "pino";
import { config } from "./config.js";
import { start } from "./baileys.js";
import { createServer } from "./server.js";

const logger = pino({ level: config.logLevel });

async function main() {
  const app = createServer();
  app.listen(config.port, () => {
    logger.info("Gateway HTTP en http://localhost:%d  (QR en /qr)", config.port);
  });
  await start();
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    logger.info("Señal %s recibida, cerrando", sig);
    process.exit(0);
  });
}

main().catch((err) => {
  logger.error({ err: String(err) }, "Fallo fatal al arrancar el gateway");
  process.exit(1);
});
