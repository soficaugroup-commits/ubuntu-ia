-- Ubuntu IA — Jalon 1
-- pgvector, tables métier, RLS dès la création.
-- Adaptation nécessaire : users.id référence auth.users(id)
-- pour que auth.uid() puisse appliquer les politiques.

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  role text not null default 'utilisateur'
    check (role in ('administrateur', 'utilisateur')),
  organisation text
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  titre text not null,
  categorie text,
  type_source text not null default 'fichier'
    check (type_source in ('fichier', 'url')),
  url_source text,
  date_ajout timestamptz not null default now(),
  chemin_stockage text,
  statut_indexation text not null default 'en_attente'
    check (statut_indexation in ('en_attente', 'en_cours', 'termine', 'erreur')),
  message_erreur text
);

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  contenu text not null,
  embedding vector(1536),
  position_document integer not null
);

create index document_chunks_document_id_idx
  on public.document_chunks (document_id);

create index document_chunks_embedding_idx
  on public.document_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 1);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  date_creation timestamptz not null default now(),
  messages jsonb not null default '[]'::jsonb
);

create or replace function public.is_administrateur()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users
    where id = auth.uid()
      and role = 'administrateur'
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, role, organisation)
  values (new.id, new.email, 'utilisateur', null);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.match_document_chunks(
  query_embedding vector(1536),
  match_count integer default 6,
  match_threshold double precision default 0.2
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
set search_path = public
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
    and (1 - (c.embedding <=> query_embedding)) >= match_threshold
  order by c.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

alter table public.users enable row level security;
alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;
alter table public.conversations enable row level security;

create policy users_select_own_or_admin
  on public.users
  for select
  to authenticated
  using (id = auth.uid() or public.is_administrateur());

create policy users_admin_insert
  on public.users
  for insert
  to authenticated
  with check (public.is_administrateur());

create policy users_admin_update
  on public.users
  for update
  to authenticated
  using (public.is_administrateur())
  with check (public.is_administrateur());

create policy users_admin_delete
  on public.users
  for delete
  to authenticated
  using (public.is_administrateur());

create policy documents_select_authenticated
  on public.documents
  for select
  to authenticated
  using (true);

create policy documents_admin_insert
  on public.documents
  for insert
  to authenticated
  with check (public.is_administrateur());

create policy documents_admin_update
  on public.documents
  for update
  to authenticated
  using (public.is_administrateur())
  with check (public.is_administrateur());

create policy documents_admin_delete
  on public.documents
  for delete
  to authenticated
  using (public.is_administrateur());

create policy chunks_select_authenticated
  on public.document_chunks
  for select
  to authenticated
  using (true);

create policy chunks_admin_insert
  on public.document_chunks
  for insert
  to authenticated
  with check (public.is_administrateur());

create policy chunks_admin_update
  on public.document_chunks
  for update
  to authenticated
  using (public.is_administrateur())
  with check (public.is_administrateur());

create policy chunks_admin_delete
  on public.document_chunks
  for delete
  to authenticated
  using (public.is_administrateur());

create policy conversations_select_own
  on public.conversations
  for select
  to authenticated
  using (user_id = auth.uid());

create policy conversations_insert_own
  on public.conversations
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy conversations_update_own
  on public.conversations
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy conversations_delete_own
  on public.conversations
  for delete
  to authenticated
  using (user_id = auth.uid());

revoke all on public.users from anon, public;
revoke all on public.documents from anon, public;
revoke all on public.document_chunks from anon, public;
revoke all on public.conversations from anon, public;

grant select, insert, update, delete on public.users to authenticated;
grant select, insert, update, delete on public.documents to authenticated;
grant select, insert, update, delete on public.document_chunks to authenticated;
grant select, insert, update, delete on public.conversations to authenticated;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.is_administrateur() from public, anon;
grant execute on function public.is_administrateur() to authenticated;
grant execute on function public.match_document_chunks(vector, integer, double precision) to authenticated;

grant all on public.users to service_role;
grant all on public.documents to service_role;
grant all on public.document_chunks to service_role;
grant all on public.conversations to service_role;
grant execute on function public.is_administrateur() to service_role;
grant execute on function public.match_document_chunks(vector, integer, double precision) to service_role;
