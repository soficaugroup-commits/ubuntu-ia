from backend.ingestion.chunking import chunk_text


def test_chunk_text_keeps_position() -> None:
    text = "\n\n".join(f"Paragraphe numéro {index} " * 40 for index in range(12))
    chunks = chunk_text(text)
    assert len(chunks) >= 2
    assert [chunk.position_document for chunk in chunks] == list(range(len(chunks)))
    assert all(chunk.contenu.strip() for chunk in chunks)


def test_chunk_text_empty() -> None:
    assert chunk_text("   ") == []
