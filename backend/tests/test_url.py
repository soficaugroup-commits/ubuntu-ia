import pytest

from backend.ingestion.errors import IngestionError
from backend.ingestion.extract_url import validate_url


def test_reject_localhost() -> None:
    with pytest.raises(IngestionError, match="autorisée"):
        validate_url("http://localhost/admin")


def test_reject_file_scheme() -> None:
    with pytest.raises(IngestionError):
        validate_url("file:///etc/passwd")


def test_accept_https() -> None:
    assert validate_url("https://example.com/page").startswith("https://")
