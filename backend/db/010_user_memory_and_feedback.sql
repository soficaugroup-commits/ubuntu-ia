-- Mémoire persistante par utilisateur + boucle de feedback.
-- Adaptations par rapport au brief :
-- - user_id NOT NULL sur les deux tables (RLS et cascade à la suppression du compte)
-- - unique (user_id, cle) pour mettre à jour un fait plutôt que le dupliquer
-- - conversation source en SET NULL (la mémoire survit à la suppression d'un fil)
-- - feedback : extraits figés (question / réponse) pour la revue admin
--   même si la conversation disparaît ; message_id en plus de message_index

create table public.user_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  cle text not null,
  valeur text not null,
  source_conversation_id uuid references public.conversations(id) on delete set null,
  date_creation timestamptz not null default now(),
  date_maj timestamptz not null default now(),
  unique (user_id, cle)
);

create index user_memory_user_id_idx on public.user_memory (user_id);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  message_id text,
  message_index integer,
  type text not null check (type in ('positif', 'negatif')),
  commentaire text,
  extrait_question text,
  extrait_reponse text,
  date_creation timestamptz not null default now(),
  unique (user_id, message_id)
);

create index feedback_date_idx on public.feedback (date_creation desc);
create index feedback_type_idx on public.feedback (type, date_creation desc);

alter table public.user_memory enable row level security;
alter table public.feedback enable row level security;

create policy user_memory_select_own_or_admin
  on public.user_memory
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_administrateur());

create policy user_memory_insert_own
  on public.user_memory
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy user_memory_update_own_or_admin
  on public.user_memory
  for update
  to authenticated
  using (user_id = auth.uid() or public.is_administrateur())
  with check (user_id = auth.uid() or public.is_administrateur());

create policy user_memory_delete_own_or_admin
  on public.user_memory
  for delete
  to authenticated
  using (user_id = auth.uid() or public.is_administrateur());

create policy feedback_select_own_or_admin
  on public.feedback
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_administrateur());

create policy feedback_insert_own
  on public.feedback
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy feedback_update_own
  on public.feedback
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on public.user_memory from anon, public;
revoke all on public.feedback from anon, public;

grant select, insert, update, delete on public.user_memory to authenticated;
grant select, insert, update, delete on public.feedback to authenticated;

grant all on public.user_memory to service_role;
grant all on public.feedback to service_role;

comment on table public.user_memory is
  'Faits durables exprimés par l''utilisateur, réinjectés dans le prompt à chaque question.';
comment on table public.feedback is
  'Pouce haut/bas sur une réponse. Les extraits permettent une revue admin sans relire tout le fil.';
