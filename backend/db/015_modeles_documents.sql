-- Ubuntu IA — Modèles de documents du groupe (lot A2).
-- Un administrateur dépose un modèle officiel (.docx / .pptx / .xlsx) ; les utilisateurs de la même
-- organisation peuvent produire un livrable à partir de ce modèle depuis le chat.
-- Idempotent : peut être rejoué sans effet de bord.

insert into storage.buckets (id, name, public, file_size_limit)
values ('modeles-documents', 'modeles-documents', false, 26214400)
on conflict (id) do update set file_size_limit = excluded.file_size_limit, public = false;

-- Lecture et écriture des fichiers de modèles réservées au serveur.
-- Aucune politique pour anon / authenticated : le bucket reste invisible côté client.
drop policy if exists modeles_documents_objects_admin on storage.objects;
drop policy if exists modeles_documents_objects_service on storage.objects;
create policy modeles_documents_objects_service
  on storage.objects
  for all
  to service_role
  using (bucket_id = 'modeles-documents')
  with check (bucket_id = 'modeles-documents');

create table if not exists public.modeles_documents (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations(id) on delete cascade,
  nom text not null check (char_length(trim(nom)) between 1 and 160),
  description text not null default '',
  format text not null check (format in ('docx', 'pptx', 'xlsx')),
  categorie text references public.document_categories(id) on update cascade on delete set null,
  storage_path text not null,
  champs jsonb not null default '[]'::jsonb,
  structure jsonb not null default '{}'::jsonb,
  apercu_path text,
  actif boolean not null default true,
  cree_par uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists modeles_documents_org_format_idx
  on public.modeles_documents (organisation_id, format, actif);

create or replace function public.modeles_documents_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists modeles_documents_touch on public.modeles_documents;
create trigger modeles_documents_touch
  before update on public.modeles_documents
  for each row execute function public.modeles_documents_touch();

alter table public.modeles_documents enable row level security;

revoke all on public.modeles_documents from public, anon;
grant select, insert, update, delete on public.modeles_documents to authenticated;
grant all on public.modeles_documents to service_role;

drop policy if exists modeles_documents_select_org on public.modeles_documents;
create policy modeles_documents_select_org
  on public.modeles_documents
  for select
  to authenticated
  using (
    public.is_administrateur()
    or (
      actif
      and (
        organisation_id is null
        or organisation_id = (select organisation_id from public.users where id = auth.uid())
      )
    )
  );

drop policy if exists modeles_documents_admin_insert on public.modeles_documents;
create policy modeles_documents_admin_insert
  on public.modeles_documents
  for insert
  to authenticated
  with check (public.is_administrateur());

drop policy if exists modeles_documents_admin_update on public.modeles_documents;
create policy modeles_documents_admin_update
  on public.modeles_documents
  for update
  to authenticated
  using (public.is_administrateur())
  with check (public.is_administrateur());

drop policy if exists modeles_documents_admin_delete on public.modeles_documents;
create policy modeles_documents_admin_delete
  on public.modeles_documents
  for delete
  to authenticated
  using (public.is_administrateur());

comment on table public.modeles_documents is
  'Modèles officiels du groupe (docx/pptx/xlsx) utilisés comme base des livrables générés par Ubuntu IA.';
comment on column public.modeles_documents.champs is
  'Champs détectés à l''import : liste de { nom, type (texte | boucle | nom_defini | tableau), colonnes? }.';
comment on column public.modeles_documents.structure is
  'Structure détectée à défaut de balises : titres, tableaux, dispositions de diapositives, plages nommées.';
