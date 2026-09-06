-- Ubuntu IA — Domaines e-mail autorisés à la connexion.
-- Lecture publique (page de connexion). Écriture réservée aux administrateurs.
-- Au moins un domaine doit rester, sinon plus personne ne peut se connecter.

create table public.domaines_autorises (
  id uuid primary key default gen_random_uuid(),
  domaine text unique not null,
  date_ajout timestamptz not null default now(),
  constraint domaines_autorises_format
    check (domaine ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$')
);

create or replace function public.normalize_domaine_autorise()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.domaine := lower(trim(new.domaine));
  if left(new.domaine, 1) = '@' then
    new.domaine := substring(new.domaine from 2);
  end if;
  return new;
end;
$$;

drop trigger if exists domaines_autorises_normalize on public.domaines_autorises;
create trigger domaines_autorises_normalize
  before insert or update on public.domaines_autorises
  for each row execute function public.normalize_domaine_autorise();

create or replace function public.prevent_last_domaine_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from public.domaines_autorises) <= 1 then
    raise exception 'Il doit rester au moins un domaine autorisé.';
  end if;
  return old;
end;
$$;

drop trigger if exists domaines_autorises_keep_one on public.domaines_autorises;
create trigger domaines_autorises_keep_one
  before delete on public.domaines_autorises
  for each row execute function public.prevent_last_domaine_delete();

insert into public.domaines_autorises (domaine)
values ('ubuntu-grp.com')
on conflict (domaine) do nothing;

alter table public.domaines_autorises enable row level security;

create policy domaines_select_public
  on public.domaines_autorises
  for select
  to anon, authenticated
  using (true);

create policy domaines_admin_insert
  on public.domaines_autorises
  for insert
  to authenticated
  with check (public.is_administrateur());

create policy domaines_admin_delete
  on public.domaines_autorises
  for delete
  to authenticated
  using (public.is_administrateur());

revoke all on public.domaines_autorises from public;
grant select on public.domaines_autorises to anon, authenticated;
grant insert, delete on public.domaines_autorises to authenticated;
grant all on public.domaines_autorises to service_role;
