-- Ubuntu IA — Tâches persistantes de l'agent (lot B1).
-- Une tâche survit aux timeouts HTTP : chaque étape est sauvegardée, reprise possible le lendemain.
-- Idempotent. Écriture réservée à service_role (API Next) ; lecture propriétaire + admin.

create table if not exists public.taches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  organisation_id uuid references public.organisations(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  dossier_id uuid,
  titre text not null check (char_length(trim(titre)) between 1 and 200),
  objectif text not null default '',
  statut text not null default 'cadrage'
    check (statut in (
      'cadrage',
      'plan_propose',
      'en_cours',
      'en_attente_utilisateur',
      'en_attente_validation',
      'terminee',
      'echouee',
      'annulee'
    )),
  plan jsonb not null default '[]'::jsonb,
  contexte jsonb not null default '{}'::jsonb,
  etape_courante int not null default 0,
  budget jsonb not null default '{}'::jsonb,
  verrou_jusqua timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  terminee_at timestamptz
);

create table if not exists public.etapes_tache (
  id uuid primary key default gen_random_uuid(),
  tache_id uuid not null references public.taches(id) on delete cascade,
  ordre int not null check (ordre >= 1),
  type text not null
    check (type in (
      'chercher',
      'lire',
      'rediger',
      'verifier',
      'corriger',
      'livrer',
      'demander',
      'agir'
    )),
  description text not null default '',
  statut text not null default 'a_faire'
    check (statut in ('a_faire', 'en_cours', 'faite', 'sautee', 'echouee', 'bloquee')),
  entree jsonb not null default '{}'::jsonb,
  sortie jsonb not null default '{}'::jsonb,
  necessite_validation boolean not null default false,
  tentatives int not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  erreur text,
  unique (tache_id, ordre)
);

create table if not exists public.journal_tache (
  id uuid primary key default gen_random_uuid(),
  tache_id uuid not null references public.taches(id) on delete cascade,
  horodatage timestamptz not null default now(),
  type text not null
    check (type in ('fait', 'reste', 'decision', 'question', 'reponse', 'erreur', 'validation')),
  contenu text not null,
  auteur text not null check (auteur in ('agent', 'utilisateur'))
);

create index if not exists taches_user_updated_idx
  on public.taches (user_id, updated_at desc);
create index if not exists taches_statut_updated_idx
  on public.taches (statut, updated_at desc);
create index if not exists etapes_tache_ordre_idx
  on public.etapes_tache (tache_id, ordre);
create index if not exists journal_tache_tache_idx
  on public.journal_tache (tache_id, horodatage);

create or replace function public.taches_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists taches_touch on public.taches;
create trigger taches_touch
  before update on public.taches
  for each row execute function public.taches_touch();

-- Verrou court : une seule exécution à la fois (B2). Retourne true si le verrou est pris.
create or replace function public.claim_tache(p_id uuid, p_until timestamptz)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  taken int;
begin
  update public.taches
  set verrou_jusqua = p_until
  where id = p_id
    and (verrou_jusqua is null or verrou_jusqua < now())
    and statut in ('cadrage', 'plan_propose', 'en_cours', 'en_attente_utilisateur', 'en_attente_validation');
  get diagnostics taken = row_count;
  return taken = 1;
end;
$$;

revoke all on function public.claim_tache(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_tache(uuid, timestamptz) to service_role;

alter table public.taches enable row level security;
alter table public.etapes_tache enable row level security;
alter table public.journal_tache enable row level security;

revoke all on public.taches from public, anon;
revoke all on public.etapes_tache from public, anon;
revoke all on public.journal_tache from public, anon;
grant select on public.taches, public.etapes_tache, public.journal_tache to authenticated;
grant all on public.taches, public.etapes_tache, public.journal_tache to service_role;

drop policy if exists taches_select_own_or_admin on public.taches;
create policy taches_select_own_or_admin
  on public.taches
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_administrateur());

drop policy if exists etapes_tache_select_own_or_admin on public.etapes_tache;
create policy etapes_tache_select_own_or_admin
  on public.etapes_tache
  for select
  to authenticated
  using (
    exists (
      select 1 from public.taches t
      where t.id = tache_id
        and (t.user_id = auth.uid() or public.is_administrateur())
    )
  );

drop policy if exists journal_tache_select_own_or_admin on public.journal_tache;
create policy journal_tache_select_own_or_admin
  on public.journal_tache
  for select
  to authenticated
  using (
    exists (
      select 1 from public.taches t
      where t.id = tache_id
        and (t.user_id = auth.uid() or public.is_administrateur())
    )
  );

comment on table public.taches is
  'Tâches conduites par Ubuntu IA jusqu''au bout : plan, contexte, reprise après timeout.';
comment on column public.taches.dossier_id is
  'Réservé au lot D (mémoire de dossier). Pas de clé étrangère pour l''instant.';
comment on column public.taches.verrou_jusqua is
  'Fin du verrou d''exécution : empêche deux avances simultanées de la même tâche.';
comment on function public.claim_tache(uuid, timestamptz) is
  'Prend le verrou d''une tâche si elle n''est pas déjà en cours d''exécution.';
