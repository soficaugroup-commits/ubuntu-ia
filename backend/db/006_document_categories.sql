-- Ubuntu IA — Catégories d'indexation persistées.
-- Les libellés créés par un administrateur survivent au rechargement.

create table public.document_categories (
  id text primary key,
  label text not null,
  date_ajout timestamptz not null default now(),
  constraint document_categories_id_format
    check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and id <> 'all')
);

create unique index document_categories_label_lower_idx
  on public.document_categories (lower(label));

insert into public.document_categories (id, label)
values
  ('rh', 'RH'),
  ('finance', 'Finance'),
  ('procedures', 'Procédures'),
  ('projets', 'Projets'),
  ('institutionnel', 'Institutionnel')
on conflict (id) do nothing;

alter table public.document_categories enable row level security;

create policy document_categories_select_authenticated
  on public.document_categories
  for select
  to authenticated
  using (true);

create policy document_categories_admin_insert
  on public.document_categories
  for insert
  to authenticated
  with check (public.is_administrateur());

create policy document_categories_admin_update
  on public.document_categories
  for update
  to authenticated
  using (public.is_administrateur())
  with check (public.is_administrateur());

create policy document_categories_admin_delete
  on public.document_categories
  for delete
  to authenticated
  using (public.is_administrateur());

revoke all on public.document_categories from anon, public;
grant select, insert, update, delete on public.document_categories to authenticated;
grant all on public.document_categories to service_role;
