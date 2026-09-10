-- Ubuntu IA — Titres de conversation (auto ou figés par l'utilisateur).

alter table public.conversations
  add column if not exists title text,
  add column if not exists title_locked boolean not null default false;

comment on column public.conversations.title is
  'Titre affiché. Si title_locked est faux, peut être dérivé du premier message.';
comment on column public.conversations.title_locked is
  'Vrai lorsque l''utilisateur a renommé la conversation manuellement.';
