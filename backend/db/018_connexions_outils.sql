-- Ubuntu IA — Connexions aux outils du groupe (lot C2).
-- Jetons illisibles par le client : aucune politique de lecture pour authenticated.
-- Idempotent. À jouer après 017.

alter table public.organisations
  add column if not exists fonctionnalites jsonb not null default '{}'::jsonb;

create table if not exists public.connexions_outils (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  fournisseur text not null check (fournisseur in ('microsoft', 'google')),
  compte text not null default '',
  scopes text not null default '',
  jeton_chiffre text not null,
  expire_at timestamptz,
  statut text not null default 'actif' check (statut in ('actif', 'revoque', 'erreur')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, fournisseur)
);

create index if not exists connexions_outils_user_idx
  on public.connexions_outils (user_id, fournisseur);

alter table public.connexions_outils enable row level security;

revoke all on public.connexions_outils from public, anon, authenticated;
grant all on public.connexions_outils to service_role;

comment on table public.connexions_outils is
  'Connexions OAuth des collaborateurs. Le jeton est chiffré et n''est jamais renvoyé au navigateur.';
comment on column public.organisations.fonctionnalites is
  'Drapeaux par organisation. outlook=true active le connecteur Microsoft. Absent ou false : désactivé.';
