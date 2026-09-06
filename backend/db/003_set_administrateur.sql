-- Ubuntu IA — Promouvoir un compte existant au rôle administrateur.
-- Prérequis : l'utilisateur existe déjà dans Authentication (auth.users).
-- Ce script ne crée pas le mot de passe : il définit seulement le rôle métier.
--
-- 1. Remplacer l'adresse ci-dessous.
-- 2. Exécuter dans le SQL Editor Supabase (rôle postgres / service).

do $$
declare
  v_email text := 'administrateur@ubuntu-grp.com';
  v_id uuid;
begin
  v_email := lower(trim(v_email));

  select id
    into v_id
  from auth.users
  where lower(email) = v_email;

  if v_id is null then
    raise exception
      'Aucun compte Auth pour %. Créez d''abord l''utilisateur dans Authentication > Users.',
      v_email;
  end if;

  insert into public.users (id, email, role, organisation)
  values (v_id, v_email, 'administrateur', 'SOFICAU UBUNTU GROUP')
  on conflict (id) do update
    set email = excluded.email,
        role = 'administrateur',
        organisation = coalesce(public.users.organisation, excluded.organisation);

  raise notice 'Rôle administrateur défini pour % (id %).', v_email, v_id;
end $$;

select id, email, role, organisation
from public.users
where role = 'administrateur'
order by email;
