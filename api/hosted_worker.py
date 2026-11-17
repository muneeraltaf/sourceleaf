import os
from secrets import compare_digest
from urllib.parse import urlencode, urlsplit
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException

from ingestion_worker import Worker, process_one_batch
from rag import RagError, SupabaseSettings, _json_request, _required, _supabase, load_environment

router = APIRouter(prefix="/api/internal")


def start_hosted_ingestion(settings: SupabaseSettings, job: dict) -> None:
    origin = os.getenv("SOURCELEAF_WORKFLOW_ORIGIN", "").strip().rstrip("/")
    token = os.getenv("SOURCELEAF_WORKER_TOKEN", "").strip()
    if not origin or job["status"] not in ("queued", "processing"):
        return
    parts = urlsplit(origin)
    if not token or parts.scheme != "https" or not parts.hostname or parts.path or parts.query or parts.fragment:
        raise RagError("Invalid hosted workflow configuration.")
    secret = _required("SUPABASE_SECRET_KEY")
    job_payload = {"target_job_id": job["id"]}
    reservation = _supabase(settings, "rpc/reserve_ingestion_dispatch", payload=job_payload, credentials=secret)
    if reservation is None:
        return
    try:
        _json_request(
            f"{origin}/internal/ingestion", provider="Vercel Workflow",
            headers={"Authorization": f"Bearer {token}"},
            timeout=settings.timeout, payload={"jobId": job["id"]},
        )
    except RagError:
        _supabase(settings, "rpc/release_ingestion_dispatch",
                  payload={**job_payload, "reservation": reservation}, credentials=secret)
        raise


@router.post("/ingestion/{job_id}")
def index_batch(job_id: UUID, authorization: str = Header(default="")):
    load_environment()
    token = os.getenv("SOURCELEAF_WORKER_TOKEN", "").strip()
    if not token or not compare_digest(authorization.encode(), f"Bearer {token}".encode()):
        raise HTTPException(404, "Worker endpoint unavailable.")
    try:
        worker = Worker.load()
        result = process_one_batch(worker, job_id=job_id)
        if result and result[1] in ("ready", "failed"):
            return {"status": result[1]}
        query = urlencode({"select": "status,available_at,lease_expires_at", "id": f"eq.{job_id}"})
        rows = _supabase(
            worker.settings, f"ingestion_jobs?{query}", method="GET", credentials=worker.secret,
        )
        if not rows:
            return {"status": "missing"}
        job = rows[0]
        return {"status": job["status"], "next_at": job["lease_expires_at"] or job["available_at"]}
    except RagError:
        raise HTTPException(503, "Indexing batch is temporarily unavailable.") from None
