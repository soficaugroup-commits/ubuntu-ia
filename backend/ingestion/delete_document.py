"""Suppression d'un document et de tous ses segments."""

from __future__ import annotations

import argparse
import sys

from backend.ingestion.db import service_client
from backend.ingestion.errors import IngestionError


def delete_document(document_id: str) -> None:
    client = service_client()
    existing = client.table("documents").select("id").eq("id", document_id).execute()
    if not existing.data:
        raise IngestionError(f"Document introuvable : {document_id}")

    client.table("documents").delete().eq("id", document_id).execute()

    leftovers = (
        client.table("document_chunks").select("id").eq("document_id", document_id).execute()
    )
    if leftovers.data:
        raise IngestionError(
            "Des segments orphelins restent en base après la suppression."
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Supprimer un document indexé.")
    parser.add_argument("--id", required=True)
    args = parser.parse_args()
    try:
        delete_document(args.id)
    except IngestionError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(f"Document supprimé : {args.id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
