from backend.office_worker.config import resolve_bucket


def test_bucket_from_payload_when_allowed() -> None:
    job = {"payload": {"bucket": "generated-files"}}
    assert resolve_bucket(job, "office-jobs") == "generated-files"
    job = {"payload": {"bucket": "modeles-documents"}}
    assert resolve_bucket(job, "office-jobs") == "modeles-documents"


def test_bucket_defaults_when_missing_or_unknown() -> None:
    assert resolve_bucket({}, "office-jobs") == "office-jobs"
    assert resolve_bucket({"payload": None}, "office-jobs") == "office-jobs"
    assert resolve_bucket({"payload": {"bucket": "documents"}}, "office-jobs") == "office-jobs"
    assert resolve_bucket({"payload": {"bucket": 42}}, "office-jobs") == "office-jobs"
