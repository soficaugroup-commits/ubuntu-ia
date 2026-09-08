-- Statut de compte : un administrateur peut suspendre un accès
-- sans supprimer le compte. Un compte suspendu ne peut pas se connecter.

alter table public.users
  add column if not exists statut text not null default 'actif';

alter table public.users
  drop constraint if exists users_statut_check;

alter table public.users
  add constraint users_statut_check
  check (statut in ('actif', 'suspendu'));

comment on column public.users.statut is
  'actif : connexion autorisée ; suspendu : identifiants refusés jusqu''à réactivation.';
