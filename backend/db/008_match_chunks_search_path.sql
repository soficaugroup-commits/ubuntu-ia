-- L'opérateur pgvector <=> vit dans le schéma extensions.
-- match_document_chunks doit l'avoir dans son search_path, sinon la
-- recherche sémantique échoue (chat toujours sans sources).

create or replace function public.match_document_chunks(
  query_embedding extensions.vector(1536),
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
set search_path = public, extensions
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

grant execute on function public.match_document_chunks(extensions.vector, integer, double precision) to authenticated;
grant execute on function public.match_document_chunks(extensions.vector, integer, double precision) to service_role;
