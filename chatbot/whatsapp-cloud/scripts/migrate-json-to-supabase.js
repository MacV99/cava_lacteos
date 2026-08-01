// Importa data/conversations.json → Supabase (una sola vez, al migrar de JSON a Postgres).
// Uso:  node scripts/migrate-json-to-supabase.js
// Requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY en .env y el esquema ya aplicado.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { supabase, supabaseEnabled } from '../src/supabase.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'data', 'conversations.json');

if (!supabaseEnabled) { console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env'); process.exit(1); }
if (!existsSync(FILE)) { console.log('No hay data/conversations.json — nada que migrar.'); process.exit(0); }

const data = JSON.parse(readFileSync(FILE, 'utf8')) || {};
const convs = Object.values(data);
console.log(`Migrando ${convs.length} conversaciones…`);

let okC = 0, okM = 0;
for (const c of convs) {
  const { error: e1 } = await supabase.from('conversations').upsert({
    wa_id: c.waId, name: c.name || c.waId,
    last_inbound_ts: c.lastInboundTs || 0, unread: c.unread || 0, blocked: !!c.blocked,
  }, { onConflict: 'wa_id' });
  if (e1) { console.error(`  conv ${c.waId}:`, e1.message); continue; }
  okC++;

  const rows = (c.messages || []).map((m) => ({
    wa_id: c.waId, wamid: m.id || null, dir: m.dir, type: m.type || null,
    text: m.text ?? null, media_id: m.mediaId || null, mime: m.mime || null,
    filename: m.filename || null, ts: m.ts, status: m.status ?? null,
    error: m.error ?? null, reaction: m.reaction ?? null, reply_to: m.replyTo || null,
  }));
  if (rows.length) {
    // El índice único de wamid es parcial → no sirve como ON CONFLICT. Insert plano.
    // Para evitar duplicados al re-correr, limpia los mensajes previos de esta conv.
    await supabase.from('messages').delete().eq('wa_id', c.waId);
    const { error: e2 } = await supabase.from('messages').insert(rows);
    if (e2) { console.error(`  msgs ${c.waId}:`, e2.message); continue; }
    okM += rows.length;
  }
}
console.log(`Listo · ${okC} conversaciones · ${okM} mensajes.`);
