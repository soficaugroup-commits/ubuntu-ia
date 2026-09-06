"""Recherche sémantique dans les documents indexés."""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from backend.ingestion.db import service_client
from backend.ingestion.embeddings import embed_query
from backend.ingestion.errors import IngestionError


def search_chunks(
    question: str,
    match_count: int = 6,
    match_threshold: float = 0.2,
) -> list[dict[str, Any]]:
    vector = embed_query(question)
    result = service_client().rpc(
        "match_document_chunks",
        {
            "query_embedding": vector,
            "match_count": match_count,
            "match_threshold": match_threshold,
        },
    ).execute()
    return list(result.data or [])


def main() -> int:
    parser = argparse.ArgumentParser(description="Tester la recherche sémantique.")
    parser.add_argument("--query", required=True)
    parser.add_argument("--count", type=int, default=4)
    parser.add_argument("--threshold", type=float, default=0.15)
    args = parser.parse_args()

    try:
        rows = search_chunks(args.query, args.count, args.threshold)
    except IngestionError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    if not rows:
        print("Aucun passage assez proche.")
        return 0

    print(json.dumps(rows, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
