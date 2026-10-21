from __future__ import annotations

import os
from collections.abc import Mapping
from typing import Any

ALLOWED_BUCKETS: tuple[str, ...] = ("office-jobs", "generated-files", "modeles-documents")


def _int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


class Settings:
    @property
    def supabase_url(self) -> str:
        return (os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL") or "").strip()

    @property
    def supabase_key(self) -> str:
        return (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()

    @property
    def worker_secret(self) -> str:
        return (os.getenv("OFFICE_WORKER_SECRET") or "").strip()

    @property
    def poll_seconds(self) -> int:
        return max(2, _int("OFFICE_POLL_SECONDS", 5))

    @property
    def job_timeout_seconds(self) -> int:
        return max(30, _int("OFFICE_JOB_TIMEOUT_SECONDS", 300))

    @property
    def max_file_bytes(self) -> int:
        return max(1_000_000, _int("OFFICE_MAX_FILE_BYTES", 25 * 1024 * 1024))

    @property
    def storage_bucket(self) -> str:
        return (os.getenv("OFFICE_STORAGE_BUCKET") or "office-jobs").strip()

    def missing(self) -> list[str]:
        needed = []
        if not self.supabase_url:
            needed.append("SUPABASE_URL")
        if not self.supabase_key:
            needed.append("SUPABASE_SERVICE_ROLE_KEY")
        return needed


settings = Settings()


def resolve_bucket(job: Mapping[str, Any], default: str) -> str:
    """Bucket Storage d'un job : `payload.bucket` s'il est autorisé, sinon le bucket par défaut.

    Le chat dépose ses fichiers dans `generated-files`, l'admin ses modèles dans
    `modeles-documents` ; tout autre nom est ignoré pour ne pas ouvrir d'autres buckets.
    """
    payload = job.get("payload")
    requested = payload.get("bucket") if isinstance(payload, Mapping) else None
    if isinstance(requested, str) and (requested in ALLOWED_BUCKETS or requested == default):
        return requested
    return default
