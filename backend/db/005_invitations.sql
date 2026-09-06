-- Ubuntu IA — Invitations d'accès + identité (prénom, nom).
-- Les jetons restent côté service_role. L'e-mail part via Resend (API Next).

alter table public.users add column if not exists prenom text;
alter table public.users add column if not exists nom text;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  v_role := coalesce(new.raw_user_meta_data->>'role', 'utilisateur');
  if v_role not in ('administrateur', 'utilisateur') then
    v_role := 'utilisateur';
  end if;

  insert into public.users (id, email, role, organisation, prenom, nom)
  values (
    new.id,
    new.email,
    v_role,
    'SOFICAU UBUNTU GROUP',
    nullif(trim(coalesce(new.raw_user_meta_data->>'prenom', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data->>'nom', '')), '')
  );
  return new;
end;
$$;

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  prenom text not null,
  nom text not null,
  role text not null check (role in ('administrateur', 'utilisateur')),
  token_hash text unique not null,
  invited_by uuid references public.users(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index invitations_email_idx on public.invitations (email);
create index invitations_pending_idx
  on public.invitations (email)
  where accepted_at is null;

alter table public.invitations enable row level security;

revoke all on public.invitations from public, anon, authenticated;
grant all on public.invitations to service_role;
