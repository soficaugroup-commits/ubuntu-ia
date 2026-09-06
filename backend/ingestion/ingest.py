"""Ingestion bout-en-bout : fichier ou URL → chunks + embeddings."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

from backend.ingestion.chunking import chunk_text
from backend.ingestion.db import service_client
from backend.ingestion.embeddings import embed_texts
from backend.ingestion.errors import IngestionError
from backend.ingestion.extract_file import extract_file
from backend.ingestion.extract_url import extract_url


def _update_document(document_id: str, values: dict[str, Any]) -> None:
    service_client().table("documents").update(values).eq("id", document_id).execute()


def _create_document(
    titre: str,
    categorie: str | None,
    type_source: str,
    url_source: str | None,
    chemin_stockage: str | None,
) -> str:
    payload = {
        "titre": titre,
        "categorie": categorie,
        "type_source": type_source,
        "url_source": url_source,
        "chemin_stockage": chemin_stockage,
        "statut_indexation": "en_cours",
    }
    result = service_client().table("documents").insert(payload).execute()
    if not result.data:
        raise IngestionError("Impossible de créer l'enregistrement du document.")
    return str(result.data[0]["id"])


def _store_chunks(document_id: str, chunks: list[dict[str, Any]]) -> None:
    if not chunks:
        raise IngestionError("Aucun segment à indexer.")
    service_client().table("document_chunks").insert(chunks).execute()


def ingest_text(
    text: str,
    titre: str,
    categorie: str | None,
    type_source: str,
    url_source: str | None = None,
    chemin_stockage: str | None = None,
) -> str:
    document_id = _create_document(
        titre=titre,
        categorie=categorie,
        type_source=type_source,
        url_source=url_source,
        chemin_stockage=chemin_stockage,
    )
    try:
        _index_text_into(document_id, text)
        return document_id
    except Exception as exc:
        message = str(exc) if isinstance(exc, IngestionError) else f"Indexation interrompue : {exc}"
        _update_document(
            document_id,
            {"statut_indexation": "erreur", "message_erreur": message},
        )
        raise IngestionError(message) from exc


def ingest_file(path: str | Path, categorie: str | None) -> str:
    resolved = Path(path).expanduser().resolve()
    text = extract_file(resolved)
    return ingest_text(
        text=text,
        titre=resolved.stem,
        categorie=categorie,
        type_source="fichier",
        chemin_stockage=str(resolved),
    )


def _index_text_into(document_id: str, text: str) -> None:
    client = service_client()
    client.table("document_chunks").delete().eq("document_id", document_id).execute()
    segments = chunk_text(text)
    if not segments:
        raise IngestionError("Le document n'a produit aucun segment.")
    vectors = embed_texts([segment.contenu for segment in segments])
    rows = [
        {
            "document_id": document_id,
            "contenu": segment.contenu,
            "embedding": vector,
            "position_document": segment.position_document,
        }
        for segment, vector in zip(segments, vectors, strict=True)
    ]
    _store_chunks(document_id, rows)
    _update_document(document_id, {"statut_indexation": "termine", "message_erreur": None})


def reingest_document(document_id: str) -> str:
    """Réextrait un fichier ou une page déjà enregistrés, y compris les anciens formats."""
    result = (
        service_client()
        .table("documents")
        .select("id, chemin_stockage, type_source, url_source")
        .eq("id", document_id)
        .execute()
    )
    if not result.data:
        raise IngestionError(f"Document introuvable : {document_id}")
    document = result.data[0]

    _update_document(document_id, {"statut_indexation": "en_cours", "message_erreur": None})
    try:
        if document.get("type_source") == "url":
            url = document.get("url_source")
            if not url:
                raise IngestionError("Cette page n'a pas d'adresse à relire.")
            _titre, text = extract_url(url)
        else:
            storage = document.get("chemin_stockage")
            if not storage:
                raise IngestionError("Ce document n'a pas de fichier source à relire.")
            resolved = Path(storage).expanduser()
            if not resolved.is_file():
                raise IngestionError(f"Fichier source introuvable : {storage}")
            text = extract_file(resolved)
        _index_text_into(document_id, text)
    except Exception as exc:
        message = str(exc) if isinstance(exc, IngestionError) else f"Réindexation interrompue : {exc}"
        _update_document(
            document_id,
            {"statut_indexation": "erreur", "message_erreur": message},
        )
        raise IngestionError(message) from exc
    return document_id


def reingest_existing_files() -> list[str]:
    """Relit tous les fichiers et pages déjà enregistrés avec les extracteurs actuels."""
    result = (
        service_client()
        .table("documents")
        .select("id, chemin_stockage, type_source, url_source")
        .execute()
    )
    indexed: list[str] = []
    for row in result.data or []:
        if row.get("type_source") == "url" and row.get("url_source"):
            indexed.append(reingest_document(str(row["id"])))
        elif row.get("chemin_stockage"):
            indexed.append(reingest_document(str(row["id"])))
    return indexed


def ingest_url(url: str, categorie: str | None) -> str:
    titre, text = extract_url(url)
    return ingest_text(
        text=text,
        titre=titre,
        categorie=categorie,
        type_source="url",
        url_source=url,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Indexer un fichier ou une URL dans Ubuntu IA.")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--file", dest="file_path")
    source.add_argument("--url")
    source.add_argument("--reingest", dest="reingest_id", help="Réindexer un document déjà enregistré.")
    source.add_argument(
        "--reingest-all",
        action="store_true",
        help="Réindexer tous les fichiers et pages déjà enregistrés.",
    )
    parser.add_argument("--categorie")
    args = parser.parse_args()

    try:
        if args.reingest_all:
            ids = reingest_existing_files()
            print(f"Documents réindexés : {len(ids)}")
            return 0
        if args.reingest_id:
            document_id = reingest_document(args.reingest_id)
            print(f"Document réindexé : {document_id}")
            return 0
        document_id = (
            ingest_file(args.file_path, args.categorie)
            if args.file_path
            else ingest_url(args.url, args.categorie)
        )
    except IngestionError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    print(f"Document indexé : {document_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
