"""Configuration d'ingestion. Le modèle d'embedding est figé."""

from pathlib import Path

from dotenv import load_dotenv
import os

ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env")

# Figé pour tout le projet. Un changement exige une réindexation complète
# et une migration de la colonne vector(1536).
EMBEDDING_MODEL = "openai/text-embedding-3-small"
EMBEDDING_DIMENSIONS = 1536
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_URL_BYTES = 5 * 1024 * 1024
URL_TIMEOUT_SECONDS = 15
CHUNK_TARGET_TOKENS = 650
CHUNK_OVERLAP_RATIO = 0.12
CHARS_PER_TOKEN = 4
VISION_PAGE_LIMIT = 20
VISION_IMAGE_MAX_BYTES = 4 * 1024 * 1024

# Lecture visuelle (OCR, infographies, PDF scannés) via OpenRouter.
VISION_MODEL = os.getenv("VISION_MODEL", "openai/gpt-4o-mini").strip() or "openai/gpt-4o-mini"

ALLOWED_EXTENSIONS = {
    ".pdf",
    ".docx",
    ".txt",
    ".md",
    ".csv",
    ".xlsx",
    ".xlsm",
    ".xls",
    ".pptx",
    ".ppt",
    ".doc",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".tif",
    ".tiff",
    ".bmp",
}
IMAGE_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".tif",
    ".tiff",
    ".bmp",
}
OFFICE_ZIP_EXTENSIONS = {".docx", ".xlsx", ".xlsm", ".pptx"}
ALLOWED_CATEGORIES = {
    "rh",
    "finance",
    "procedures",
    "projets",
    "institutionnel",
    "juridique",
}


def require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Variable d'environnement manquante : {name}")
    return value


def supabase_url() -> str:
    return require_env("SUPABASE_URL")


def supabase_service_key() -> str:
    return require_env("SUPABASE_SERVICE_ROLE_KEY")


def openrouter_api_key() -> str:
    return require_env("OPENROUTER_API_KEY")
