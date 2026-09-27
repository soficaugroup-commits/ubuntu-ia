from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

from office_worker.config import settings
from office_worker import db as store

SKILLS = Path(__file__).resolve().parents[2] / ".agents" / "skills"


def run_job(job: dict[str, Any], work: Path) -> dict[str, Any]:
    kind = job["kind"]
    if kind == "validate_ooxml":
        return validate_ooxml(job, work)
    if kind == "pptx_thumbnails":
        return pptx_thumbnails(job, work)
    if kind == "xlsx_recalc":
        return xlsx_recalc(job, work)
    if kind == "pptx_from_template":
        return pptx_from_template(job, work)
    if kind == "pdf_fill_form":
        return pdf_fill_form(job, work)
    raise ValueError(f"Type de job inconnu : {kind}")


def _download(job: dict[str, Any], work: Path, name: str) -> Path:
    input_path = job.get("input_path")
    if not input_path:
        raise ValueError("input_path manquant.")
    dest = work / name
    store.download_input(input_path, dest)
    if dest.stat().st_size > settings.max_file_bytes:
        raise ValueError("Fichier trop volumineux pour le worker.")
    return dest


def validate_ooxml(job: dict[str, Any], work: Path) -> dict[str, Any]:
    """Valide un .docx / .pptx via le script skills office/validate.py."""
    src = _download(job, work, "input.bin")
    suffix = Path(str(job.get("input_path") or "")).suffix.lower() or ".docx"
    office = src.with_suffix(suffix)
    src.rename(office)

    validate = _find_validate_script()
    if not validate:
        out_dir = work / "out"
        out_dir.mkdir(exist_ok=True)
        _soffice_convert(office, out_dir, "pdf")
        pdfs = list(out_dir.glob("*.pdf"))
        if not pdfs:
            raise RuntimeError("LibreOffice n'a pas produit de PDF.")
        remote = f"{job['user_id']}/{job['id']}/validated.pdf"
        store.upload_output(pdfs[0], remote, "application/pdf")
        return {"ok": True, "mode": "soffice", "output_path": remote}

    proc = subprocess.run(
        ["python", str(validate), str(office)],
        cwd=str(validate.parent),
        capture_output=True,
        text=True,
        timeout=settings.job_timeout_seconds,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            proc.stderr.strip() or proc.stdout.strip() or "Validation OOXML échouée."
        )
    return {"ok": True, "mode": "validate.py", "stdout": proc.stdout[-2000:]}


def pptx_thumbnails(job: dict[str, Any], work: Path) -> dict[str, Any]:
    """Génère une grille d'aperçu via LibreOffice → PDF → images (Poppler)."""
    src = _download(job, work, "deck.bin")
    pptx = src.with_suffix(".pptx")
    src.rename(pptx)
    out_dir = work / "thumbs"
    out_dir.mkdir(exist_ok=True)
    _soffice_convert(pptx, out_dir, "pdf")
    pdfs = list(out_dir.glob("*.pdf"))
    if not pdfs:
        raise RuntimeError("Conversion PPTX→PDF impossible.")
    prefix = out_dir / "page"
    subprocess.run(
        ["pdftoppm", "-jpeg", "-r", "100", str(pdfs[0]), str(prefix)],
        check=True,
        timeout=settings.job_timeout_seconds,
        capture_output=True,
    )
    pages = sorted(out_dir.glob("page*.jpg"))
    if not pages:
        raise RuntimeError("pdftoppm n'a produit aucune image.")
    uploaded: list[str] = []
    for index, page in enumerate(pages[:30], start=1):
        remote = f"{job['user_id']}/{job['id']}/thumb-{index:02d}.jpg"
        store.upload_output(page, remote, "image/jpeg")
        uploaded.append(remote)
    return {"ok": True, "thumbnails": uploaded, "count": len(uploaded)}


def xlsx_recalc(job: dict[str, Any], work: Path) -> dict[str, Any]:
    """Recalcule un classeur via LibreOffice (headless)."""
    src = _download(job, work, "book.bin")
    xlsx = src.with_suffix(".xlsx")
    src.rename(xlsx)
    out_dir = work / "recalc"
    out_dir.mkdir(exist_ok=True)
    _soffice_convert(xlsx, out_dir, "xlsx")
    outputs = list(out_dir.glob("*.xlsx"))
    if not outputs:
        raise RuntimeError("Recalcul Excel impossible.")
    remote = f"{job['user_id']}/{job['id']}/recalculated.xlsx"
    store.upload_output(
        outputs[0],
        remote,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    return {"ok": True, "output_path": remote}


def pptx_from_template(job: dict[str, Any], work: Path) -> dict[str, Any]:
    """Remplace le texte des formes d'un modèle PPTX (payload.replacements)."""
    src = _download(job, work, "template.bin")
    pptx = src.with_suffix(".pptx")
    src.rename(pptx)
    replacements = (job.get("payload") or {}).get("replacements") or {}
    if not isinstance(replacements, dict) or not replacements:
        raise ValueError("payload.replacements est requis (nom de forme → texte).")
    from pptx import Presentation

    deck = Presentation(str(pptx))
    applied = 0
    for slide in deck.slides:
        for shape in slide.shapes:
            if not getattr(shape, "has_text_frame", False):
                continue
            name = getattr(shape, "name", "")
            if name not in replacements:
                continue
            shape.text_frame.text = str(replacements[name])
            applied += 1
    if applied == 0:
        raise ValueError("Aucune forme du modèle ne correspond aux remplacements.")
    out = work / "filled.pptx"
    deck.save(str(out))
    remote = f"{job['user_id']}/{job['id']}/from-template.pptx"
    store.upload_output(
        out,
        remote,
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    )
    return {"ok": True, "output_path": remote, "replaced": applied}


def pdf_fill_form(job: dict[str, Any], work: Path) -> dict[str, Any]:
    """Remplit un formulaire PDF (payload.fields)."""
    src = _download(job, work, "form.bin")
    pdf = src.with_suffix(".pdf")
    src.rename(pdf)
    fields = (job.get("payload") or {}).get("fields") or {}
    if not isinstance(fields, dict) or not fields:
        raise ValueError("payload.fields est requis (nom de champ → valeur).")
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(str(pdf))
    writer = PdfWriter()
    writer.append(reader)
    for page in writer.pages:
        writer.update_page_form_field_values(page, {k: str(v) for k, v in fields.items()})
    out = work / "filled.pdf"
    with out.open("wb") as handle:
        writer.write(handle)
    remote = f"{job['user_id']}/{job['id']}/filled.pdf"
    store.upload_output(out, remote, "application/pdf")
    return {"ok": True, "output_path": remote, "fields": list(fields)}


def _soffice_convert(source: Path, out_dir: Path, fmt: str) -> None:
    subprocess.run(
        [
            "soffice",
            "--headless",
            "--nologo",
            "--nofirststartwizard",
            "--convert-to",
            fmt,
            "--outdir",
            str(out_dir),
            str(source),
        ],
        check=True,
        timeout=settings.job_timeout_seconds,
        capture_output=True,
    )


def _find_validate_script() -> Path | None:
    candidates = [
        SKILLS / "docx" / "scripts" / "office" / "validate.py",
        SKILLS / "pptx" / "scripts" / "office" / "validate.py",
        SKILLS / "xlsx" / "scripts" / "office" / "validate.py",
    ]
    for path in candidates:
        if path.is_file():
            return path
    return None
