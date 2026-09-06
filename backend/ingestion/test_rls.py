"""Vérifie qu'un collaborateur ne peut pas supprimer un document ni lire
les conversations d'un autre compte."""

from __future__ import annotations

import secrets
import sys
import uuid

from supabase import create_client

from backend.ingestion.config import (
    require_env,
    supabase_service_key,
    supabase_url,
)
from backend.ingestion.db import service_client


def _anon_client():
    return create_client(supabase_url(), require_env("SUPABASE_ANON_KEY"))


def _create_user(email: str, password: str) -> str:
    admin = service_client()
    created = admin.auth.admin.create_user(
        {
            "email": email,
            "password": password,
            "email_confirm": True,
        }
    )
    if not created.user:
        raise RuntimeError("Création du compte de test impossible.")
    return created.user.id


def _delete_user(user_id: str) -> None:
    service_client().auth.admin.delete_user(user_id)


def main() -> int:
    suffix = uuid.uuid4().hex[:8]
    password = secrets.token_urlsafe(16)
    admin_email = f"admin.rls.{suffix}@ubuntu-grp.com"
    user_email = f"user.rls.{suffix}@ubuntu-grp.com"
    admin_id = ""
    user_id = ""
    document_id = ""
    conversation_id = ""

    try:
        admin_id = _create_user(admin_email, password)
        user_id = _create_user(user_email, password)
        service = service_client()
        service.table("users").update({"role": "administrateur"}).eq("id", admin_id).execute()

        inserted = (
            service.table("documents")
            .insert({"titre": "Document RLS", "type_source": "fichier", "statut_indexation": "termine"})
            .execute()
        )
        document_id = inserted.data[0]["id"]
        conversation = (
            service.table("conversations")
            .insert({"user_id": admin_id, "messages": [{"question": "privée"}]})
            .execute()
        )
        conversation_id = conversation.data[0]["id"]

        user_client = _anon_client()
        session = user_client.auth.sign_in_with_password(
            {"email": user_email, "password": password}
        )
        if not session.user:
            raise RuntimeError("Connexion du compte utilisateur de test impossible.")

        delete_result = user_client.table("documents").delete().eq("id", document_id).execute()
        if delete_result.data:
            print("ÉCHEC : un collaborateur a pu supprimer un document.", file=sys.stderr)
            return 1

        still_there = service.table("documents").select("id").eq("id", document_id).execute()
        if not still_there.data:
            print("ÉCHEC : le document a disparu après la tentative utilisateur.", file=sys.stderr)
            return 1

        leaked = (
            user_client.table("conversations").select("id, messages").eq("id", conversation_id).execute()
        )
        if leaked.data:
            print("ÉCHEC : un collaborateur a lu la conversation d'un autre compte.", file=sys.stderr)
            return 1

        print("RLS OK : suppression document et lecture conversation étrangère refusées.")
        return 0
    finally:
        service = service_client()
        if document_id:
            service.table("documents").delete().eq("id", document_id).execute()
        if conversation_id:
            service.table("conversations").delete().eq("id", conversation_id).execute()
        if admin_id:
            _delete_user(admin_id)
        if user_id:
            _delete_user(user_id)


if __name__ == "__main__":
    raise SystemExit(main())
