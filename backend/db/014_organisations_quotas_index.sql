-- Organisations, quotas, fichiers générés, index vectoriel adapté à un corpus plus grand.

create table if not exists public.organisations (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  quota_messages_jour integer not null default 200 check (quota_messages_jour > 0),
  created_at timestamptz not null default now()
);

insert into public.organisations (nom)
select 'SOFICAU UBUNTU GROUP'
where not exists (select 1 from public.organisations);

alter table public.users
  add column if not exists organisation_id uuid references public.organisations(id);

alter table public.documents
  add column if not exists organisation_id uuid references public.organisations(id);

update public.users
set organisation_id = (select id from public.organisations order by created_at limit 1)
where organisation_id is null;

update public.documents
set organisation_id = (select id from public.organisations order by created_at limit 1)
where organisation_id is null;

create table if not exists public.usage_journalier (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('message', 'fichier')),
  created_at timestamptz not null default now()
);

create index if not exists usage_journalier_user_day_idx
  on public.usage_journalier (user_id, kind, created_at desc);

alter table public.usage_journalier enable row level security;
revoke all on public.usage_journalier from public, anon;
grant select on public.usage_journalier to authenticated;
grant all on public.usage_journalier to service_role;

drop policy if exists usage_select_own on public.usage_journalier;
create policy usage_select_own
  on public.usage_journalier
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_administrateur());

drop policy if exists documents_select_authenticated on public.documents;
create policy documents_select_authenticated
  on public.documents
  for select
  to authenticated
  using (
    organisation_id is null
    or organisation_id = (
      select organisation_id from public.users where id = auth.uid()
    )
  );

create or replace function public.match_document_chunks_scoped(
  query_embedding vector(1536),
  match_count integer default 6,
  match_threshold double precision default 0.2,
  organisation_id uuid default null
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
    and (organisation_id is null or d.organisation_id = match_document_chunks_scoped.organisation_id or d.organisation_id is null)
    and (1 - (c.embedding <=> query_embedding)) >= match_threshold
  order by c.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

grant execute on function public.match_document_chunks_scoped(vector, integer, double precision, uuid)
  to authenticated, service_role;

drop index if exists document_chunks_embedding_idx;
create index document_chunks_embedding_idx
  on public.document_chunks
  using hnsw (embedding vector_cosine_ops);

insert into storage.buckets (id, name, public, file_size_limit)
values ('generated-files', 'generated-files', false, 26214400)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

drop policy if exists generated_files_owner on storage.objects;
create policy generated_files_owner
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'generated-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

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
  if v_role not in ('administrateur', 'utilisateur') then
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
