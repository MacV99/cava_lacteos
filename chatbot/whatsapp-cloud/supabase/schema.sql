-- Esquema del panel WhatsApp Cloud — La Cava Lácteos.
-- Aplicar en el proyecto Supabase de La Cava (SQL Editor o vía migración).
-- RLS activo sin políticas públicas: solo el backend Node entra (service-role → bypass RLS).

-- ── Conversaciones (una por número de WhatsApp) ──────────────────────────────
create table if not exists public.conversations (
  wa_id           text primary key,
  name            text not null,
  last_inbound_ts bigint not null default 0,   -- epoch ms del último entrante (ventana 24h)
  unread          int    not null default 0,
  blocked         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ── Mensajes ─────────────────────────────────────────────────────────────────
create table if not exists public.messages (
  id         bigint generated always as identity primary key,
  wa_id      text not null references public.conversations(wa_id) on delete cascade,
  wamid      text,                 -- id de WhatsApp; null en algunos salientes
  dir        text not null,        -- 'in' | 'out'
  type       text,                 -- text|image|audio|voice|video|document|sticker|template
  text       text,
  media_id   text,
  mime       text,
  filename   text,
  ts         bigint not null,      -- epoch ms
  status     text,                 -- sent|delivered|read|failed | null(entrante)
  error      jsonb,
  reaction   text,
  reply_to   text,
  created_at timestamptz not null default now()
);

create index if not exists messages_wa_ts_idx on public.messages (wa_id, ts);
-- Dedup de entrantes (Meta reintrega): wamid único cuando no es null.
create unique index if not exists messages_wamid_uidx on public.messages (wamid) where wamid is not null;

-- ── RLS: cerrado al público; el backend usa service-role y lo salta ──────────
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;
