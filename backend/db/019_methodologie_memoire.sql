-- Ubuntu IA — Catégorie « Méthodologie » et mémoire évolutive par utilisateur.
--
-- 1. Les documents de la catégorie « methodologie » servent de références de structure
--    (rapports types, audits, trames BDO, GIZ…) : ils guident la rédaction mais ne sont
--    jamais cités comme sources. La recherche standard les exclut grâce à
--    match_document_chunks_filtered ; la recherche méthodologique les cible seuls.
-- 2. La mémoire utilisateur est classée (portée + sujet), pondérée et vectorisée pour
--    n'injecter que les souvenirs utiles à la demande, sans mélanger les projets.
--
-- Idempotente. Le code applicatif fonctionne aussi tant que cette migration n'est pas
-- appliquée (repli sur les anciennes fonctions et colonnes).

-- ---------------------------------------------------------------------------
-- 1. Catégorie Méthodologie
-- ---------------------------------------------------------------------------

insert into public.document_categories (id, label)
values ('methodologie', 'Méthodologie')
on conflict (id) do nothing;

create or replace function public.match_document_chunks_filtered(
  query_embedding extensions.vector(1536),
  match_count integer default 8,
  match_threshold double precision default 0.4,
  organisation_id uuid default null,
  include_categories text[] default null,
  exclude_categories text[] default null
)
returns table (
  id uuid,
  document_id uuid,
  contenu text,
  position_document integer,
  titre text,
  categorie text,
  type_source text,
  url_source text,
  similarite double precision
)
language sql
stable
set search_path = public, extensions
as $$
  select
    c.id,
    c.document_id,
    c.contenu,
    c.position_document,
    d.titre,
    d.categorie,
    d.type_source,
    d.url_source,
    (1 - (c.embedding <=> query_embedding))::double precision as similarite
  from public.document_chunks c
  inner join public.documents d on d.id = c.document_id
  where d.statut_indexation = 'termine'
    and c.embedding is not null
    and (
      match_document_chunks_filtered.organisation_id is null
      or d.organisation_id is null
      or d.organisation_id = match_document_chunks_filtered.organisation_id
    )
    and (
      include_categories is null
      or coalesce(d.categorie, '') = any(include_categories)
    )
    and (
      exclude_categories is null
      or not (coalesce(d.categorie, '') = any(exclude_categories))
    )
    and (1 - (c.embedding <=> query_embedding)) >= match_threshold
  order by c.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

revoke all on function public.match_document_chunks_filtered(
  extensions.vector, integer, double precision, uuid, text[], text[]
) from public, anon;
grant execute on function public.match_document_chunks_filtered(
  extensions.vector, integer, double precision, uuid, text[], text[]
) to authenticated, service_role;

create index if not exists documents_categorie_idx on public.documents (categorie);

-- ---------------------------------------------------------------------------
-- 2. Mémoire évolutive
-- ---------------------------------------------------------------------------

alter table public.user_memory
  add column if not exists portee text not null default 'contexte',
  add column if not exists sujet text,
  add column if not exists importance smallint not null default 2,
  add column if not exists derniere_utilisation timestamptz,
  add column if not exists embedding extensions.vector(1536);

alter table public.user_memory drop constraint if exists user_memory_portee_check;
alter table public.user_memory
  add constraint user_memory_portee_check
  check (portee in ('preference', 'profil', 'projet', 'organisation', 'contexte'));

alter table public.user_memory drop constraint if exists user_memory_importance_check;
alter table public.user_memory
  add constraint user_memory_importance_check
  check (importance between 1 and 3);

-- Les anciennes clés preference_* deviennent des préférences.
update public.user_memory
set portee = 'preference'
where cle like 'preference\_%' escape '\' and portee = 'contexte';

create index if not exists user_memory_user_portee_idx
  on public.user_memory (user_id, portee, sujet);

create or replace function public.match_user_memory(
  p_user_id uuid,
  query_embedding extensions.vector(1536),
  match_count integer default 8,
  match_threshold double precision default 0.3
)
returns table (
  id uuid,
  cle text,
  valeur text,
  portee text,
  sujet text,
  importance smallint,
  similarite double precision
)
language sql
stable
set search_path = public, extensions
as $$
  select
    m.id,
    m.cle,
    m.valeur,
    m.portee,
    m.sujet,
    m.importance,
    (1 - (m.embedding <=> query_embedding))::double precision as similarite
  from public.user_memory m
  where m.user_id = p_user_id
    and m.embedding is not null
    and (1 - (m.embedding <=> query_embedding)) >= match_threshold
  order by m.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

-- Réservée au serveur : elle filtre par p_user_id, jamais exposée aux clients.
revoke all on function public.match_user_memory(
  uuid, extensions.vector, integer, double precision
) from public, anon, authenticated;
grant execute on function public.match_user_memory(
  uuid, extensions.vector, integer, double precision
) to service_role;

comment on column public.user_memory.portee is
  'preference | profil | projet | organisation | contexte — sépare ce qui concerne la personne de ce qui concerne un dossier.';
comment on column public.user_memory.sujet is
  'Projet, client ou entité concerné (ex. « GIZ MOVE »). Un fait de projet n''est rappelé que si la demande concerne ce sujet.';
