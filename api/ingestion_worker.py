import argparse
import json
from dataclasses import dataclass, field
from hashlib import sha256
from time import sleep
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, build_opener
from uuid import UUID

from pydantic import BaseModel

from documents import DocumentError, chunk_blocks, extract_blocks
from usage import charge
from rag import (
    ProviderHTTPError,
    RagError,
    Settings,
    _RejectRedirects,
    _embed,
    _positive_int,
    _required,
    _supabase,
)


@dataclass(frozen=True)
class Worker:
    settings: Settings
    secret: str = field(repr=False)
    bucket: str
    max_bytes: int
    chunk_chars: int
    batch_size: int
    max_chunks: int
    lease_seconds: int
    failure_limit: int
    retry_delay: int

    @classmethod
    def load(cls) -> "Worker":
        settings = Settings.load()
        batch_size = _positive_int("SOURCELEAF_INGEST_BATCH_SIZE", 20)
        lease_seconds = _positive_int("SOURCELEAF_INGEST_LEASE_SECONDS", 900)
        if lease_seconds <= settings.timeout * (batch_size + 3):
            raise RagError("The indexing lease is too short for the request timeout and batch size.")
        return cls(
            settings=settings,
            secret=_required("SUPABASE_SECRET_KEY"),
            bucket=_required("SUPABASE_STORAGE_BUCKET"),
            max_bytes=_positive_int("SOURCELEAF_MAX_UPLOAD_BYTES", 50 * 1024 * 1024),
            chunk_chars=_positive_int("SOURCELEAF_CHUNK_CHARS", 8000),
            batch_size=batch_size,
            max_chunks=_positive_int("SOURCELEAF_MAX_DOCUMENT_CHUNKS", 10000),
            lease_seconds=lease_seconds,
            failure_limit=_positive_int("SOURCELEAF_INGEST_FAILURE_LIMIT", 10),
            retry_delay=_positive_int("SOURCELEAF_INGEST_RETRY_SECONDS", 3600),
        )

    def rpc(self, name: str, payload: dict):
        return _supabase(
            self.settings, f"rpc/{name}", credentials=self.secret, payload=payload
        )


class Claim(BaseModel):
    job_id: UUID
    document_id: UUID
    lease_token: UUID
    completed_steps: int
    plan_hash: str | None
    bucket: str
    path: str
    filename: str

    def checkpoint(self) -> dict[str, str]:
        return {"target_job_id": str(self.job_id), "target_lease": str(self.lease_token)}


def _download(worker: Worker, claim: Claim) -> bytes:
    if claim.bucket != worker.bucket:
        raise DocumentError("The upload is outside the configured bucket.")
    bucket = quote(claim.bucket, safe="")
    path = quote(claim.path, safe="/")
    request = Request(
        f"{worker.settings.supabase_url}/storage/v1/object/authenticated/{bucket}/{path}",
        headers={"apikey": worker.secret},
    )
    try:
        with build_opener(_RejectRedirects()).open(
            request, timeout=worker.settings.timeout
        ) as response:
            data = response.read(worker.max_bytes + 1)
    except HTTPError as exc:
        raise ProviderHTTPError("Supabase Storage", exc.code) from None
    except (URLError, TimeoutError):
        raise RagError("Supabase Storage did not return the file.") from None

    if not data or len(data) > worker.max_bytes:
        raise DocumentError("The file is empty or exceeds the upload size limit.")
    return data


def _index_claim(worker: Worker, claim: Claim) -> str:
    data = _download(worker, claim)
    blocks = extract_blocks(claim.filename, data, max_unpacked_bytes=worker.max_bytes)
    passages = chunk_blocks(blocks, max_chars=worker.chunk_chars)
    if len(passages) > worker.max_chunks:
        raise DocumentError("The document exceeds the configured indexing chunk limit.")
    settings = worker.settings
    identity = json.dumps([
        settings.embedding_model, settings.dimensions,
        [(passage.location, passage.text) for passage in passages],
    ])
    digest = sha256(identity.encode()).hexdigest()
    if claim.plan_hash is not None and claim.plan_hash != digest:
        raise DocumentError("The document or indexing configuration changed during indexing.")

    start = claim.completed_steps
    selected = passages[start:start + worker.batch_size]
    if not selected:
        raise DocumentError("No passages remain at the saved checkpoint.")
    try:
        charge(settings, "index", len(selected))
    except ProviderHTTPError as exc:
        if exc.status == 429:
            raise DocumentError("The daily indexing limit was reached. Retry later.") from None
        raise
    batch = [
        {
            "location": passage.location,
            "content": passage.text,
            "embedding_model": settings.embedding_model,
            "embedding": _embed(settings, passage.text, title=claim.filename),
        }
        for passage in selected
    ]
    return worker.rpc("save_ingestion_batch", {
        **claim.checkpoint(),
        "batch": batch,
        "total_chunks": len(passages),
        "content_hash": digest,
    })


def process_one_batch(worker: Worker, *, job_id: UUID | None = None) -> tuple[str, str] | None:
    payload = {"lease_seconds": worker.lease_seconds}
    if job_id is not None:
        payload["target_job_id"] = str(job_id)
    response = worker.rpc("claim_ingestion", payload)
    if response is None:
        return None
    claim = Claim.model_validate(response)
    try:
        status = _index_claim(worker, claim)
    except (DocumentError, RagError) as exc:
        retryable = isinstance(exc, RagError)
        if isinstance(exc, ProviderHTTPError):
            retryable = exc.status in (408, 429) or exc.status >= 500
        status = worker.rpc("fail_ingestion", {
            **claim.checkpoint(),
            "retryable": retryable,
            "failure_limit": worker.failure_limit,
            "delay_seconds": worker.retry_delay,
            "failure_code": (
                str(exc) if isinstance(exc, DocumentError) else "Indexing could not finish. Try again."
            ),
        })
    return str(claim.job_id), status


def main() -> None:
    parser = argparse.ArgumentParser(description="Process queued Sourceleaf indexing jobs.")
    parser.add_argument("--watch", type=float, metavar="POLL_SECONDS")
    args = parser.parse_args()
    if args.watch is not None and not 0 < args.watch <= 3600:
        parser.error("--watch requires a polling interval from 0 to 3600 seconds.")

    try:
        worker = Worker.load()
    except RagError as exc:
        parser.exit(1, f"{exc}\n")

    try:
        while True:
            try:
                result = process_one_batch(worker)
            except RagError as exc:
                if args.watch is None:
                    parser.exit(1, f"{exc}\n")
                print(str(exc), flush=True)
                sleep(args.watch)
                continue

            if result is not None:
                job_id, status = result
                print(f"{job_id} {status}", flush=True)

            if args.watch is None:
                if result is None:
                    print("No indexing job is ready.")
                return
            if result is None:
                sleep(args.watch)
    except KeyboardInterrupt:
        return


if __name__ == "__main__":
    main()
