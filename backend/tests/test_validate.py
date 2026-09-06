from pathlib import Path

import pytest

from backend.ingestion.errors import IngestionError
from backend.ingestion.extract_file import extract_file
from backend.ingestion.validate import validate_file

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "procedure_achat.txt"


def test_validate_text_fixture() -> None:
    assert validate_file(FIXTURE) == ".txt"


def test_extract_text_fixture() -> None:
    text = extract_file(FIXTURE)
    assert "demande d'achat" in text.lower()
    assert "NEXUS TECH AFRICA" in text


def test_reject_unknown_extension(tmp_path: Path) -> None:
    path = tmp_path / "malware.exe"
    path.write_bytes(b"MZ")
    with pytest.raises(IngestionError):
        validate_file(path)


def test_reject_pdf_extension_on_text(tmp_path: Path) -> None:
    path = tmp_path / "faux.pdf"
    path.write_text("ceci n'est pas un pdf", encoding="utf-8")
    with pytest.raises(IngestionError, match="contenu réel"):
        validate_file(path)
