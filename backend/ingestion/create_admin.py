"""Crée ou met à jour un administrateur réel dans Supabase Auth."""

from __future__ import annotations

import argparse
import secrets
import sys

from backend.ingestion.db import service_client

ALLOWED_DOMAIN = "ubuntu-grp.com"
DEFAULT_EMAIL = "administrateur@ubuntu-grp.com"
ORGANISATION = "SOFICAU UBUNTU GROUP"


def _find_auth_user(admin, email: str):
    for user in admin.auth.admin.list_users():
        if (user.email or "").lower() == email:
            return user
    return None


def _ensure_profile(admin, user_id: str, email: str) -> None:
    existing = (
        admin.table("users").select("id").eq("id", user_id).limit(1).execute()
    )
    payload = {
        "email": email,
        "role": "administrateur",
        "organisation": ORGANISATION,
    }
    if existing.data:
        admin.table("users").update(payload).eq("id", user_id).execute()
        return
    admin.table("users").insert({"id": user_id, **payload}).execute()


def main() -> int:
    parser = argparse.ArgumentParser(description="Créer un administrateur Ubuntu IA")
    parser.add_argument("--email", default=DEFAULT_EMAIL)
    parser.add_argument("--password", default=None)
    args = parser.parse_args()

    email = args.email.strip().lower()
    domain = email.split("@")[-1] if "@" in email else ""
    password = args.password or secrets.token_urlsafe(16)
    if len(password) < 8:
        print("Le mot de passe doit contenir au moins 8 caractères.", file=sys.stderr)
        return 1

    admin = service_client()
    listed = admin.table("domaines_autorises").select("domaine").execute()
    allowed = {row["domaine"] for row in listed.data or []} or {ALLOWED_DOMAIN}
    if domain not in allowed:
        accepted = ", ".join(f"@{item}" for item in sorted(allowed))
        print(f"Domaine refusé : seules les adresses {accepted} sont acceptées.", file=sys.stderr)
        return 1
    found = _find_auth_user(admin, email)
    if found:
        admin.auth.admin.update_user_by_id(
            found.id,
            {"password": password, "email_confirm": True},
        )
        user_id = found.id
        action = "mis à jour"
    else:
        created = admin.auth.admin.create_user(
            {
                "email": email,
                "password": password,
                "email_confirm": True,
            }
        )
        if not created.user:
            print("Création du compte Auth impossible.", file=sys.stderr)
            return 1
        user_id = created.user.id
        action = "créé"

    _ensure_profile(admin, user_id, email)
    profile = (
        admin.table("users")
        .select("id, email, role")
        .eq("id", user_id)
        .single()
        .execute()
    )
    if not profile.data or profile.data.get("role") != "administrateur":
        print("Le profil public.users n'a pas le rôle administrateur.", file=sys.stderr)
        return 1

    print(f"Administrateur {action} dans Supabase.")
    print(f"E-mail : {email}")
    print(f"Mot de passe : {password}")
    print("Notez ce mot de passe : il n'est pas enregistré dans le dépôt.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
