"""Génération d'embeddings via OpenRouter. Modèle figé."""

from openai import OpenAI

from backend.ingestion.config import (
    EMBEDDING_DIMENSIONS,
    EMBEDDING_MODEL,
    OPENROUTER_BASE_URL,
    openrouter_api_key,
)
from backend.ingestion.errors import IngestionError


def _client() -> OpenAI:
    return OpenAI(base_url=OPENROUTER_BASE_URL, api_key=openrouter_api_key())


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Retourne un vecteur non nul par texte, dans le même ordre."""
    if not texts:
        return []

    try:
        response = _client().embeddings.create(
            model=EMBEDDING_MODEL,
            input=texts,
            dimensions=EMBEDDING_DIMENSIONS,
        )
    except Exception as exc:
        raise IngestionError(f"Échec de génération des embeddings : {exc}") from exc

    ordered = sorted(response.data, key=lambda item: item.index)
    if len(ordered) != len(texts):
        raise IngestionError("Le nombre d'embeddings reçu ne correspond pas aux segments.")

    vectors: list[list[float]] = []
    for item in ordered:
        vector = list(item.embedding)
        if len(vector) != EMBEDDING_DIMENSIONS or not any(vector):
            raise IngestionError("Un embedding est vide ou de mauvaise dimension.")
        vectors.append(vector)
    return vectors


def embed_query(question: str) -> list[float]:
    cleaned = question.strip()
    if not cleaned:
        raise IngestionError("La question est vide.")
    return embed_texts([cleaned])[0]
