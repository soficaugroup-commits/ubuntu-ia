"""Découpage en segments avec chevauchement et position d'origine."""

from dataclasses import dataclass

from backend.ingestion.config import (
    CHARS_PER_TOKEN,
    CHUNK_OVERLAP_RATIO,
    CHUNK_TARGET_TOKENS,
)


@dataclass(frozen=True)
class Chunk:
    contenu: str
    position_document: int


def _split_paragraphs(text: str) -> list[str]:
    blocks = [block.strip() for block in text.replace("\r\n", "\n").split("\n\n")]
    return [block for block in blocks if block]


def chunk_text(text: str) -> list[Chunk]:
    """Découpe un texte en segments de 500-800 tokens environ, overlap 12 %."""
    cleaned = text.strip()
    if not cleaned:
        return []

    target_chars = CHUNK_TARGET_TOKENS * CHARS_PER_TOKEN
    overlap_chars = int(target_chars * CHUNK_OVERLAP_RATIO)
    paragraphs = _split_paragraphs(cleaned)
    if not paragraphs:
        paragraphs = [cleaned]

    chunks: list[Chunk] = []
    buffer = ""
    cursor = 0

    def flush(current: str) -> None:
        nonlocal cursor
        body = current.strip()
        if not body:
            return
        chunks.append(Chunk(contenu=body, position_document=len(chunks)))
        cursor += max(len(body) - overlap_chars, 1)

    for paragraph in paragraphs:
        candidate = f"{buffer}\n\n{paragraph}".strip() if buffer else paragraph
        if len(candidate) <= target_chars:
            buffer = candidate
            continue
        if buffer:
            flush(buffer)
            overlap = buffer[-overlap_chars:] if overlap_chars < len(buffer) else buffer
            buffer = f"{overlap}\n\n{paragraph}".strip()
            if len(buffer) > target_chars * 1.3:
                flush(paragraph)
                buffer = ""
        else:
            start = 0
            while start < len(paragraph):
                end = min(start + target_chars, len(paragraph))
                flush(paragraph[start:end])
                if end >= len(paragraph):
                    break
                start = max(end - overlap_chars, start + 1)

    if buffer:
        flush(buffer)

    return chunks
