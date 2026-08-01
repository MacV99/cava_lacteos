// Cliente Supabase — SOLO backend. Usa la service-role key (bypass RLS).
// Esta clave NUNCA llega al navegador: el panel habla con nuestra API Node, no con Supabase.
// Si faltan las vars, `supabaseEnabled` es false y el store cae al modo JSON local.
import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

export const supabaseEnabled = !!(config.supabaseUrl && config.supabaseServiceKey);

export const supabase = supabaseEnabled
  ? createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;
