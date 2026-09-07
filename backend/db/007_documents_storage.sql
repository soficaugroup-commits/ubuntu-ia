-- Fichiers indexés stockés dans Supabase Storage (production Netlify).

insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 20971520)
on conflict (id) do nothing;

drop policy if exists documents_objects_admin on storage.objects;
create policy documents_objects_admin
  on storage.objects
  for all
  to authenticated
  using (bucket_id = 'documents' and public.is_administrateur())
  with check (bucket_id = 'documents' and public.is_administrateur());
