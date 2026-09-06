"""Extraction du contenu utile d'une page web (une URL, pas un site)."""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

from backend.ingestion.config import MAX_URL_BYTES, URL_TIMEOUT_SECONDS
from backend.ingestion.errors import IngestionError


def _is_public_ip(ip: str) -> bool:
    address = ipaddress.ip_address(ip)
    return not (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    )


def validate_url(url: str) -> str:
    parsed = urlparse(url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise IngestionError(
            "Indiquez une URL http ou https complète, par exemple https://soficau-ubuntu.com/page."
        )
    if parsed.hostname.lower() in {"localhost", "metadata.google.internal"}:
        raise IngestionError("Cette adresse n'est pas autorisée.")

    try:
        infos = socket.getaddrinfo(parsed.hostname, None)
    except socket.gaierror as exc:
        raise IngestionError(f"Nom d'hôte inaccessible : {parsed.hostname}") from exc

    for info in infos:
        ip = info[4][0]
        if not _is_public_ip(ip):
            raise IngestionError("Les adresses internes ou privées ne sont pas autorisées.")
    return parsed.geturl()


def extract_url(url: str) -> tuple[str, str]:
    """Retourne (titre, texte)."""
    import trafilatura
    from trafilatura.settings import use_config

    safe_url = validate_url(url)
    config = use_config()
    config.set("DEFAULT", "DOWNLOAD_TIMEOUT", str(URL_TIMEOUT_SECONDS))
    config.set("DEFAULT", "MAX_FILE_SIZE", str(MAX_URL_BYTES))

    downloaded = trafilatura.fetch_url(safe_url, config=config)
    if not downloaded:
        downloaded = _download_html(safe_url)
    if not downloaded:
        raise IngestionError(
            "La page n'a pas pu être récupérée. Vérifiez qu'elle est publique."
        )

    metadata = trafilatura.extract_metadata(downloaded)
    text = trafilatura.extract(
        downloaded,
        config=config,
        include_comments=False,
        include_tables=True,
        favor_recall=True,
    )
    if not text or not text.strip():
        text = _fallback_html_text(downloaded)
    if not text or not text.strip():
        raise IngestionError("Aucun contenu textuel utile n'a été trouvé sur cette page.")

    title = (metadata.title if metadata else None) or safe_url
    return title.strip(), text.strip()


def _download_html(url: str) -> str:
    import requests

    try:
        response = requests.get(
            url,
            timeout=URL_TIMEOUT_SECONDS,
            headers={"User-Agent": "UbuntuIA-Indexer/1.0"},
            allow_redirects=True,
        )
        response.raise_for_status()
    except Exception as exc:
        raise IngestionError(f"La page n'a pas pu être récupérée : {exc}") from exc

    if len(response.content) > MAX_URL_BYTES:
        raise IngestionError("La page dépasse la taille maximale autorisée.")
    return response.text


def _fallback_html_text(html: str) -> str:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "noscript"]):
        tag.decompose()
    return " ".join(soup.get_text(" ", strip=True).split())


if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="Extraire le texte d'une page web.")
    parser.add_argument("url")
    args = parser.parse_args()
    try:
        titre, texte = extract_url(args.url)
        print(titre)
        print()
        print(texte)
    except IngestionError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
