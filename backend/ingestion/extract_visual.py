"""Lecture visuelle : images, infographies et pages scannées."""

from __future__ import annotations

import base64
import io
from pathlib import Path

from backend.ingestion.config import (
    OPENROUTER_BASE_URL,
    VISION_IMAGE_MAX_BYTES,
    VISION_MODEL,
    VISION_PAGE_LIMIT,
    openrouter_api_key,
)
from backend.ingestion.errors import IngestionError

IMAGE_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".bmp": "image/bmp",
}

VISION_PROMPT = (
    "Tu extrais le contenu utile d'un document visuel "
    "(image, infographie, graphique, diapositive ou page scannée). "
    "Restitue tout le texte lisible, les titres, légendes, chiffres, unités, "
    "la structure des tableaux et le message des graphiques. "
    "N'invente aucun chiffre absent. Réponds dans la langue du document."
)


def _prepare_image(raw: bytes, mime: str) -> tuple[bytes, str]:
    if len(raw) <= VISION_IMAGE_MAX_BYTES and mime in {
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
    }:
        return raw, mime
    try:
        from PIL import Image

        image = Image.open(io.BytesIO(raw))
        if image.mode not in {"RGB", "L"}:
            image = image.convert("RGB")
        output = io.BytesIO()
        image.save(output, format="JPEG", quality=82, optimize=True)
        return output.getvalue(), "image/jpeg"
    except Exception as exc:
        raise IngestionError(f"Image illisible : {exc}") from exc


def describe_image_bytes(raw: bytes, mime: str) -> str:
    payload, content_type = _prepare_image(raw, mime)
    encoded = base64.b64encode(payload).decode("ascii")
    from openai import OpenAI

    try:
        response = OpenAI(
            base_url=OPENROUTER_BASE_URL,
            api_key=openrouter_api_key(),
        ).chat.completions.create(
            model=VISION_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": VISION_PROMPT},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{content_type};base64,{encoded}"
                            },
                        },
                    ],
                }
            ],
        )
    except Exception as exc:
        raise IngestionError(f"Lecture visuelle impossible : {exc}") from exc

    text = (response.choices[0].message.content or "").strip()
    if not text:
        raise IngestionError("Le modèle n'a extrait aucun contenu de l'image.")
    return text


def describe_images(blobs: list[bytes], limit: int = 8) -> list[str]:
    """Décrit des images embarquées sans faire échouer tout le document."""
    texts: list[str] = []
    for blob in blobs[:limit]:
        if not blob:
            continue
        try:
            texts.append(describe_image_bytes(blob, "image/png"))
        except IngestionError:
            continue
    return texts


def extract_image(path: Path) -> str:
    suffix = path.suffix.lower()
    mime = IMAGE_MIME.get(suffix, "image/jpeg")
    return describe_image_bytes(path.read_bytes(), mime)


def extract_pdf_visual(path: Path) -> str:
    try:
        import pypdfium2 as pdfium
    except ImportError as exc:
        raise IngestionError(
            "La lecture des PDF scannés n'est pas installée (pypdfium2)."
        ) from exc

    try:
        document = pdfium.PdfDocument(str(path))
    except Exception as exc:
        raise IngestionError(f"PDF scanné illisible : {exc}") from exc

    parts: list[str] = []
    try:
        page_count = min(len(document), VISION_PAGE_LIMIT)
        for index in range(page_count):
            page = document[index]
            bitmap = page.render(scale=1.4)
            pil_image = bitmap.to_pil()
            buffer = io.BytesIO()
            pil_image.convert("RGB").save(buffer, format="JPEG", quality=80)
            text = describe_image_bytes(buffer.getvalue(), "image/jpeg")
            parts.append(f"# Page {index + 1}\n{text}")
    finally:
        document.close()

    if not parts:
        raise IngestionError("Aucune page du PDF scanné n'a pu être lue.")
    return "\n\n".join(parts)
