"""Client Supabase côté serveur (service role uniquement)."""

from supabase import Client, create_client

from backend.ingestion.config import supabase_service_key, supabase_url


def service_client() -> Client:
    return create_client(supabase_url(), supabase_service_key())
