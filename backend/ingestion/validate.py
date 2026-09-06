"""Validation des fichiers (type réel + taille) avant tout traitement."""

from pathlib import Path

from backend.ingestion.config import (
    ALLOWED_EXTENSIONS,
    IMAGE_EXTENSIONS,
    MAX_FILE_BYTES,
    OFFICE_ZIP_EXTENSIONS,
)
from backend.ingestion.errors import IngestionError

_OLE = b"\xd0\xcf\x11\xe0"


def _is_pdf(header: bytes) -> bool:
    return header.startswith(b"%PDF")


def _is_zip(header: bytes) -> bool:
    return header.startswith(b"PK")


def _zip_names(path: Path) -> set[str]:
    from zipfile import ZipFile

    try:
        with ZipFile(path) as archive:
            return set(archive.namelist())
    except Exception as exc:
        raise IngestionError(f"Archive Office illisible : {exc}") from exc


def _is_docx(path: Path, header: bytes) -> bool:
    if not _is_zip(header):
        return False
    names = _zip_names(path)
    return "[Content_Types].xml" in names and any(name.startswith("word/") for name in names)


def _is_xlsx(path: Path, header: bytes) -> bool:
    if not _is_zip(header):
        return False
    names = _zip_names(path)
    return "[Content_Types].xml" in names and any(
        name.startswith("xl/") for name in names
    )


def _is_pptx(path: Path, header: bytes) -> bool:
    if not _is_zip(header):
        return False
    names = _zip_names(path)
    return "[Content_Types].xml" in names and any(
        name.startswith("ppt/") for name in names
    )


def _is_ole(header: bytes) -> bool:
    return header.startswith(_OLE)


def _is_image(header: bytes, suffix: str) -> bool:
    if suffix in {".jpg", ".jpeg"}:
        return header.startswith(b"\xff\xd8\xff")
    if suffix == ".png":
        return header.startswith(b"\x89PNG")
    if suffix == ".gif":
        return header.startswith(b"GIF87a") or header.startswith(b"GIF89a")
    if suffix == ".webp":
        return header.startswith(b"RIFF")
    if suffix in {".tif", ".tiff"}:
        return header.startswith(b"II*\x00") or header.startswith(b"MM\x00*")
    if suffix == ".bmp":
        return header.startswith(b"BM")
    return False


def _is_text(path: Path) -> bool:
    sample = path.read_bytes()[:4096]
    if b"\x00" in sample:
        return False
    try:
        sample.decode("utf-8")
        return True
    except UnicodeDecodeError:
        sample.decode("latin-1")
        return True


def validate_file(path: Path) -> str:
    """Retourne l'extension canonique ou lève."""
    if not path.is_file():
        raise IngestionError(f"Fichier introuvable : {path}")

    size = path.stat().st_size
    if size == 0:
        raise IngestionError("Le fichier est vide.")
    if size > MAX_FILE_BYTES:
        raise IngestionError("Le fichier dépasse 20 Mo.")

    suffix = path.suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise IngestionError(
            "Format non accepté. Utilisez un PDF, Word, Excel, PowerPoint, "
            "texte, CSV, image ou infographie."
        )

    header = path.read_bytes()[:12]
    if suffix == ".pdf":
        if not _is_pdf(header):
            raise IngestionError("L'extension .pdf ne correspond pas au contenu réel.")
        return suffix
    if suffix == ".docx":
        if not _is_docx(path, header):
            raise IngestionError("L'extension .docx ne correspond pas au contenu réel.")
        return suffix
    if suffix in {".xlsx", ".xlsm"}:
        if not _is_xlsx(path, header):
            raise IngestionError("L'extension Excel ne correspond pas au contenu réel.")
        return suffix
    if suffix == ".pptx":
        if not _is_pptx(path, header):
            raise IngestionError(
                "L'extension PowerPoint ne correspond pas au contenu réel."
            )
        return suffix
    if suffix == ".xls":
        if not _is_ole(header):
            raise IngestionError("L'extension .xls ne correspond pas au contenu réel.")
        return suffix
    if suffix == ".doc":
        raise IngestionError(
            "Les anciens fichiers Word (.doc) ne sont pas lus. "
            "Enregistrez-le au format .docx, puis renvoyez-le."
        )
    if suffix == ".ppt":
        raise IngestionError(
            "Les anciennes présentations (.ppt) ne sont pas lues. "
            "Enregistrez-la au format .pptx, puis renvoyez-la."
        )
    if suffix in IMAGE_EXTENSIONS:
        if not _is_image(header, suffix):
            raise IngestionError("L'extension image ne correspond pas au contenu réel.")
        return suffix
    if suffix in OFFICE_ZIP_EXTENSIONS:
        raise IngestionError("Le fichier Office est incomplet ou corrompu.")
    if not _is_text(path):
        raise IngestionError("Le fichier texte contient des données binaires.")
    return suffix
