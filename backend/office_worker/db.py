from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from supabase import Client, create_client

from office_worker.config import settings

_client: Client | None = None


def supabase_client() -> Client:
    global _client
    if _client is None:
        _client = create_client(settings.supabase_url, settings.supabase_key)
    return _client


def claim_next_job() -> dict[str, Any] | None:
    """Prend le plus ancien job `queued` et le passe en `running`."""
    client = supabase_client()
    listed = (
        client.table("office_jobs")
        .select("*")
        .eq("status", "queued")
        .order("created_at", desc=False)
        .limit(1)
        .execute()
    )
    rows = listed.data or []
    if not rows:
        return None

    job = rows[0]
    now = datetime.now(timezone.utc).isoformat()
    updated = (
        client.table("office_jobs")
        .update(
            {
                "status": "running",
                "started_at": now,
                "attempts": int(job.get("attempts") or 0) + 1,
            }
        )
        .eq("id", job["id"])
        .eq("status", "queued")
        .select("*")
        .execute()
    )
    claimed = updated.data or []
    return claimed[0] if claimed else None


def finish_job(
    job_id: str,
    *,
    status: str,
    result: dict[str, Any] | None = None,
    error: str | None = None,
    output_path: str | None = None,
) -> None:
    payload: dict[str, Any] = {
        "status": status,
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "result": result or {},
        "error": error,
    }
    if output_path:
        payload["output_path"] = output_path
    supabase_client().table("office_jobs").update(payload).eq("id", job_id).execute()


def download_input(path: str, dest: Path) -> None:
    client = supabase_client()
    data = client.storage.from_(settings.storage_bucket).download(path)
    dest.write_bytes(data)


def upload_output(local_path: Path, remote_path: str, content_type: str) -> str:
    client = supabase_client()
    body = local_path.read_bytes()
    client.storage.from_(settings.storage_bucket).upload(
        remote_path,
        body,
        file_options={"content-type": content_type, "upsert": "true"},
    )
    return remote_path
