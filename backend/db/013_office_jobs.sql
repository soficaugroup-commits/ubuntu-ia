-- Ubuntu IA — File d'attente des jobs office (worker Python / LibreOffice).

create table if not exists public.office_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null
    check (kind in (
      'validate_ooxml',
      'pptx_thumbnails',
      'pptx_from_template',
      'xlsx_recalc',
      'pdf_fill_form'
    )),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  input_path text,
  output_path text,
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists office_jobs_status_created_idx
  on public.office_jobs (status, created_at);
create index if not exists office_jobs_user_created_idx
  on public.office_jobs (user_id, created_at desc);

alter table public.office_jobs enable row level security;

revoke all on public.office_jobs from public, anon, authenticated;
grant all on public.office_jobs to service_role;
grant select on public.office_jobs to authenticated;

-- Lecture / insert pour le propriétaire (API Next authentifiée via service_role
-- pour l'écriture worker ; policies optionnelles pour un client direct).
create policy office_jobs_select_own
  on public.office_jobs
  for select
  to authenticated
  using (user_id = auth.uid());

comment on table public.office_jobs is
  'Jobs bureautiques traités par le worker Python (Render).';
