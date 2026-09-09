-- Ubuntu IA — Réinitialisation de mot de passe.
-- Jetons côté service_role uniquement. L'e-mail part via Resend (API Next).

create table if not exists public.password_resets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  email text not null,
  token_hash text unique not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists password_resets_email_idx on public.password_resets (email);
create index if not exists password_resets_user_pending_idx
  on public.password_resets (user_id)
  where used_at is null;

alter table public.password_resets enable row level security;

revoke all on public.password_resets from public, anon, authenticated;
grant all on public.password_resets to service_role;
