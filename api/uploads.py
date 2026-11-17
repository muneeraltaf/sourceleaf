from pathlib import PurePath
from urllib.parse import urlencode
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, ConfigDict, Field

from auth import bearer, signed_in_user
from hosted_worker import start_hosted_ingestion
from usage import charge
from rag import (
    ProviderHTTPError,
    RagError,
    SupabaseSettings,
    _positive_int,
    _required,
    _supabase,
)

router = APIRouter(prefix="/api/documents")


class UploadRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    filename: str = Field(min_length=1, max_length=255)
    size_bytes: int = Field(gt=0, strict=True)


class UploadReservation(BaseModel):
    document_id: UUID
    bucket: str
    path: str


class IngestionJob(BaseModel):
    id: UUID
    status: str
    completed_steps: int
    error_code: str | None = None


def _max_upload_bytes() -> int:
    return _positive_int("SOURCELEAF_MAX_UPLOAD_BYTES", 50 * 1024 * 1024)


@router.post("/uploads", status_code=201)
def reserve_upload(
    body: UploadRequest,
    auth: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> UploadReservation:
    try:
        settings = SupabaseSettings.load()
        owner, _ = signed_in_user(settings, auth)
        suffix = PurePath(body.filename).suffix.lower()
        if (
            suffix not in (".pdf", ".docx")
            or "/" in body.filename
            or "\\" in body.filename
            or any(ord(char) < 32 or ord(char) == 127 for char in body.filename)
        ):
            raise HTTPException(400, "Choose a PDF or DOCX file with a valid filename.")
        if body.size_bytes > _max_upload_bytes():
            raise HTTPException(413, "This file exceeds the upload size limit.")

        bucket = _required("SUPABASE_STORAGE_BUCKET")
        charge(settings, "uploads", 1, owner)
        document_id = uuid4()
        path = f"{owner}/{document_id}{suffix}"
        _supabase(
            settings, "documents",
            payload={
                "id": str(document_id),
                "owner_id": str(owner),
                "filename": body.filename,
                "storage_bucket": bucket,
                "storage_path": path,
            },
            credentials=_required("SUPABASE_SECRET_KEY"),
            prefer="missing=default",
        )
        return UploadReservation(document_id=document_id, bucket=bucket, path=path)
    except ProviderHTTPError as exc:
        if exc.status == 429:
            raise HTTPException(429, "The daily upload limit has been reached.") from None
        raise HTTPException(502, "Could not register this upload.") from None
    except RagError:
        raise HTTPException(502, "Could not register this upload.") from None


@router.post("/{document_id}/ingestion", status_code=202)
def queue_ingestion(
    document_id: UUID,
    auth: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> IngestionJob:
    try:
        settings = SupabaseSettings.load()
        owner, _ = signed_in_user(settings, auth)
        try:
            job = _supabase(
                settings, "rpc/queue_document_ingestion",
                payload={
                    "target_document_id": str(document_id),
                    "target_owner_id": str(owner),
                    "max_bytes": _max_upload_bytes(),
                },
                credentials=_required("SUPABASE_SECRET_KEY"),
            )
        except ProviderHTTPError as exc:
            messages = {
                404: "This document was not found.",
                409: "Upload the file to its reserved location first.",
                413: "This file exceeds the upload size limit.",
                422: "This file is empty or could not be verified.",
            }
            if exc.status in messages:
                raise HTTPException(exc.status, messages[exc.status]) from None
            raise
        start_hosted_ingestion(settings, job)
        return IngestionJob.model_validate(job)
    except RagError:
        raise HTTPException(503, "Could not start indexing. Try queueing the upload again.") from None


@router.get("/{document_id}/ingestion")
def ingestion_status(
    document_id: UUID,
    auth: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> IngestionJob:
    try:
        settings = SupabaseSettings.load()
        _, access_token = signed_in_user(settings, auth)
        query = urlencode({
            "select": "id,status,completed_steps,error_code",
            "document_id": f"eq.{document_id}",
        })
        rows = _supabase(
            settings, f"ingestion_jobs?{query}",
            method="GET", access_token=access_token,
        )
        if not rows:
            raise HTTPException(404, "This indexing job was not found.")
        return IngestionJob.model_validate(rows[0])
    except RagError:
        raise HTTPException(502, "Could not get the indexing status.") from None


@router.post("/{document_id}/ingestion/retry", status_code=202)
def retry_job(
    document_id: UUID,
    auth: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> IngestionJob:
    try:
        settings = SupabaseSettings.load()
        owner, _ = signed_in_user(settings, auth)
        charge(settings, "uploads", 1, owner)
        job = _supabase(
            settings, "rpc/retry_ingestion",
            payload={"target_document_id": str(document_id), "target_owner_id": str(owner)},
            credentials=_required("SUPABASE_SECRET_KEY"),
        )
        start_hosted_ingestion(settings, job)
        return IngestionJob.model_validate(job)
    except ProviderHTTPError as exc:
        if exc.status == 404:
            raise HTTPException(404, "This indexing job was not found.") from None
        if exc.status == 429:
            raise HTTPException(429, "The daily upload limit has been reached.") from None
        raise HTTPException(502, "Could not retry indexing.") from None
    except RagError:
        raise HTTPException(502, "Could not retry indexing.") from None
