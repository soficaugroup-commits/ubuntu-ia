"""Worker Ubuntu IA — traite les jobs `office_jobs` (LibreOffice / scripts skills)."""

from __future__ import annotations

import logging
import signal
import sys
import tempfile
import time
import traceback
from pathlib import Path

from dotenv import load_dotenv

from office_worker.config import settings
from office_worker.db import claim_next_job, finish_job, supabase_client
from office_worker.jobs import run_job

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")
load_dotenv(ROOT.parent / ".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("office_worker")

_stop = False


def _handle_stop(signum: int, _frame: object) -> None:
    global _stop
    log.info("Arrêt demandé (signal %s).", signum)
    _stop = True


def main() -> int:
    signal.signal(signal.SIGTERM, _handle_stop)
    signal.signal(signal.SIGINT, _handle_stop)

    missing = settings.missing()
    if missing:
        log.error("Variables manquantes : %s", ", ".join(missing))
        return 1

    client = supabase_client()
    client.table("office_jobs").select("id").limit(1).execute()
    log.info(
        "Worker office démarré (poll=%ss, timeout=%ss).",
        settings.poll_seconds,
        settings.job_timeout_seconds,
    )

    while not _stop:
        job = claim_next_job()
        if not job:
            time.sleep(settings.poll_seconds)
            continue

        job_id = job["id"]
        kind = job["kind"]
        log.info("Job %s (%s) — démarrage.", job_id, kind)
        work = Path(tempfile.mkdtemp(prefix=f"office-{job_id}-"))
        try:
            result = run_job(job, work)
            output_path = result.get("output_path") if isinstance(result, dict) else None
            finish_job(
                job_id,
                status="succeeded",
                result=result,
                output_path=output_path if isinstance(output_path, str) else None,
            )
            log.info("Job %s — succès.", job_id)
        except Exception as exc:  # noqa: BLE001
            log.error("Job %s — échec : %s\n%s", job_id, exc, traceback.format_exc())
            finish_job(job_id, status="failed", error=str(exc)[:2000], result={})
        finally:
            for path in sorted(work.rglob("*"), reverse=True):
                try:
                    if path.is_file():
                        path.unlink()
                    elif path.is_dir():
                        path.rmdir()
                except OSError:
                    pass
            try:
                work.rmdir()
            except OSError:
                pass

    log.info("Worker arrêté proprement.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
