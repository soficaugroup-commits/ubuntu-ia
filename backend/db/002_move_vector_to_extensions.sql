-- Déplace pgvector hors de public pour qu'il n'apparaisse plus dans l'API.
-- Les colonnes existantes (document_chunks.embedding) restent en place.
create schema if not exists extensions;
alter extension vector set schema extensions;
