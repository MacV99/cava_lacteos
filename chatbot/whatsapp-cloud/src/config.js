// Carga .env (sin dependencias) y expone la config tipada del proceso.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Parser .env minimalista: KEY=VALUE por línea, ignora # y líneas vacías.
function loadEnvFile() {
  try {
    const raw = readFileSync(join(ROOT, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      // quita comentario en línea (  VAR=valor  # nota) salvo si va entrecomillado
      if (!val.startsWith('"') && !val.startsWith("'")) {
        const hash = val.indexOf(' #');
        if (hash !== -1) val = val.slice(0, hash).trim();
      }
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    // sin .env (ej. en producción con envVars del host) — se usa process.env directo
  }
}
loadEnvFile();

export const ROOT_DIR = ROOT;

export const config = {
  metaToken: process.env.META_TOKEN || '',
  phoneNumberId: process.env.PHONE_NUMBER_ID || '',
  wabaId: process.env.WABA_ID || '',
  verifyToken: process.env.VERIFY_TOKEN || '',
  graphVersion: process.env.GRAPH_VERSION || 'v25.0',
  port: Number(process.env.PORT || 3000),
  panelPassword: process.env.PANEL_PASSWORD || '',
  // Supabase (opcional): si ambos están, el store persiste en Postgres; si no, en JSON local.
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  // Puente IA hacia el bot Python (Messenger/IG). Si faltan, WhatsApp queda 100% manual.
  gatewaySecret: process.env.GATEWAY_SECRET || '',   // header X-Gateway-Secret compartido con el bot
  botWebhookUrl: process.env.BOT_WEBHOOK_URL || '',  // ej. https://cava-chatbot-meta.onrender.com/webhook/whatsapp
};

export const graphBase = () => `https://graph.facebook.com/${config.graphVersion}`;

// Aviso temprano si falta algo crítico (no aborta: /webhook GET puede verificar igual).
export function warnMissing() {
  const missing = ['metaToken', 'phoneNumberId', 'verifyToken']
    .filter((k) => !config[k]);
  if (missing.length) {
    console.warn('[config] faltan variables en .env:', missing.join(', '));
  }
}
