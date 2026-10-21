-- Ubuntu IA — Droits fins, actions proposées et journal d'audit (lot C1).
-- Idempotent. À jouer après 016.

alter table public.users drop constraint if exists users_role_check;
alter table public.users
  add constraint users_role_check
  check (role in ('administrateur', 'responsable', 'utilisateur'));

alter table public.invitations drop constraint if exists invitations_role_check;
alter table public.invitations
  add constraint invitations_role_check
  check (role in ('administrateur', 'responsable', 'utilisateur'));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_org uuid;
begin
  v_role := coalesce(new.raw_user_meta_data->>'role', 'utilisateur');
  if v_role not in ('administrateur', 'responsable', 'utilisateur') then
    v_role := 'utilisateur';
  end if;
  select id into v_org from public.organisations order by created_at limit 1;

  insert into public.users (id, email, role, organisation, prenom, nom, organisation_id)
  values (
    new.id,
    new.email,
    v_role,
    'SOFICAU UBUNTU GROUP',
    nullif(trim(coalesce(new.raw_user_meta_data->>'prenom', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data->>'nom', '')), ''),
    v_org
  );
  return new;
end;
$$;

create table if not exists public.permissions_actions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations(id) on delete cascade,
  role text not null check (role in ('administrateur', 'responsable', 'utilisateur')),
  action text not null check (char_length(trim(action)) between 3 and 80),
  niveau text not null check (niveau in ('autorise', 'validation_requise', 'interdit')),
  unique (role, action, organisation_id)
);

create table if not exists public.delegations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations(id) on delete cascade,
  de_user_id uuid not null references public.users(id) on delete cascade,
  a_user_id uuid not null references public.users(id) on delete cascade,
  action text not null,
  expire_at timestamptz,
  created_at timestamptz not null default now(),
  check (de_user_id <> a_user_id)
);

create table if not exists public.actions_proposees (
  id uuid primary key default gen_random_uuid(),
  tache_id uuid references public.taches(id) on delete set null,
  user_id uuid not null references public.users(id) on delete cascade,
  connecteur text not null,
  action text not null,
  cible text not null default '',
  charge jsonb not null default '{}'::jsonb,
  charge_hash text not null,
  apercu text not null default '',
  statut text not null default 'proposee'
    check (statut in ('proposee', 'approuvee', 'refusee', 'executee', 'echouee', 'expiree')),
  approuve_par uuid references public.users(id) on delete set null,
  approuve_at timestamptz,
  execute_at timestamptz,
  resultat jsonb not null default '{}'::jsonb,
  erreur text,
  expire_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now()
);

create table if not exists public.journal_audit (
  id uuid primary key default gen_random_uuid(),
  horodatage timestamptz not null default now(),
  user_id uuid references public.users(id) on delete set null,
  acteur text not null check (acteur in ('agent', 'utilisateur')),
  action text not null,
  connecteur text not null default '',
  cible text not null default '',
  action_proposee_id uuid references public.actions_proposees(id) on delete set null,
  ip text,
  details jsonb not null default '{}'::jsonb
);

create index if not exists permissions_actions_lookup_idx
  on public.permissions_actions (role, action);
create index if not exists delegations_cible_idx
  on public.delegations (a_user_id, action);
create index if not exists actions_proposees_user_idx
  on public.actions_proposees (user_id, created_at desc);
create index if not exists journal_audit_date_idx
  on public.journal_audit (horodatage desc);

create or replace function public.journal_audit_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Le journal d''audit est immuable.';
end;
$$;

drop trigger if exists journal_audit_no_change on public.journal_audit;
create trigger journal_audit_no_change
  before update or delete on public.journal_audit
  for each row execute function public.journal_audit_immutable();

alter table public.permissions_actions enable row level security;
alter table public.delegations enable row level security;
alter table public.actions_proposees enable row level security;
alter table public.journal_audit enable row level security;

revoke all on public.permissions_actions from public, anon;
revoke all on public.delegations from public, anon;
revoke all on public.actions_proposees from public, anon;
revoke all on public.journal_audit from public, anon;
grant select on public.permissions_actions, public.delegations, public.actions_proposees, public.journal_audit to authenticated;
grant all on public.permissions_actions, public.delegations, public.actions_proposees to service_role;
grant insert, select on public.journal_audit to service_role;

drop policy if exists permissions_actions_select on public.permissions_actions;
create policy permissions_actions_select
  on public.permissions_actions for select to authenticated
  using (
    public.is_administrateur()
    or organisation_id is null
    or organisation_id = (select organisation_id from public.users where id = auth.uid())
  );

drop policy if exists delegations_select on public.delegations;
create policy delegations_select
  on public.delegations for select to authenticated
  using (
    public.is_administrateur()
    or de_user_id = auth.uid()
    or a_user_id = auth.uid()
  );

drop policy if exists actions_proposees_select on public.actions_proposees;
create policy actions_proposees_select
  on public.actions_proposees for select to authenticated
  using (public.is_administrateur() or user_id = auth.uid());

drop policy if exists journal_audit_select on public.journal_audit;
create policy journal_audit_select
  on public.journal_audit for select to authenticated
  using (public.is_administrateur() or user_id = auth.uid());

insert into public.permissions_actions (organisation_id, role, action, niveau)
select null, role, action, niveau
from (
  values
    ('administrateur', 'messagerie.lire', 'autorise'),
    ('administrateur', 'messagerie.brouillon', 'validation_requise'),
    ('administrateur', 'messagerie.envoyer', 'validation_requise'),
    ('administrateur', 'itrack.lire', 'autorise'),
    ('administrateur', 'itrack.mettre_a_jour', 'validation_requise'),
    ('administrateur', 'calendrier.lire', 'autorise'),
    ('administrateur', 'calendrier.creer', 'validation_requise'),
    ('administrateur', 'fichiers.lire', 'autorise'),
    ('administrateur', 'fichiers.supprimer', 'interdit'),
    ('responsable', 'messagerie.lire', 'autorise'),
    ('responsable', 'messagerie.brouillon', 'validation_requise'),
    ('responsable', 'messagerie.envoyer', 'validation_requise'),
    ('responsable', 'itrack.lire', 'autorise'),
    ('responsable', 'itrack.mettre_a_jour', 'validation_requise'),
    ('responsable', 'calendrier.lire', 'autorise'),
    ('responsable', 'calendrier.creer', 'validation_requise'),
    ('responsable', 'fichiers.lire', 'autorise'),
    ('responsable', 'fichiers.supprimer', 'interdit'),
    ('utilisateur', 'messagerie.lire', 'autorise'),
    ('utilisateur', 'messagerie.brouillon', 'validation_requise'),
    ('utilisateur', 'messagerie.envoyer', 'validation_requise'),
    ('utilisateur', 'itrack.lire', 'autorise'),
    ('utilisateur', 'itrack.mettre_a_jour', 'validation_requise'),
    ('utilisateur', 'calendrier.lire', 'autorise'),
    ('utilisateur', 'calendrier.creer', 'validation_requise'),
    ('utilisateur', 'fichiers.lire', 'autorise'),
    ('utilisateur', 'fichiers.supprimer', 'interdit')
) as seed(role, action, niveau)
where not exists (
  select 1 from public.permissions_actions existing
  where existing.organisation_id is null
    and existing.role = seed.role
    and existing.action = seed.action
);

comment on table public.journal_audit is
  'Journal immuable des actions demandées, approuvées et exécutées.';
