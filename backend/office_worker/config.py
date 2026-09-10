from __future__ import annotations

import os


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
