from typing import Literal
from urllib.parse import urlencode
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, ConfigDict, Field

from auth import bearer, signed_in_user
from hosted_worker import router as hosted_worker_router
from chats import chat_documents, chat_messages, read_chat, router as chats_router
from rag import (
    Answer, Citation, ProviderHTTPError, RagError, Settings, SupabaseSettings, _required,
    _supabase, answer_question, list_samples,
)
from summaries import SummaryLimit, summarize, summary_batches, summary_calls
from uploads import router as uploads_router
from usage import charge

app = FastAPI(title="Sourceleaf API", docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(uploads_router)
app.include_router(chats_router)
app.include_router(hosted_worker_router)


class Question(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    question: str = Field(min_length=1, max_length=2000)
    document_ids: list[UUID] = Field(min_length=1, max_length=5)


class DocumentQuestion(Question):
    mode: Literal["ask", "explain"] = "ask"
    chat_id: UUID | None = None
    save_chat: bool = False


class DocumentSummary(BaseModel):
    document_ids: list[UUID] = Field(min_length=1, max_length=5)


class DocumentAnswer(Answer):
    chat_id: UUID | None = None


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/samples")
def samples():
    try:
        return list_samples(SupabaseSettings.load())
    except RagError:
        raise HTTPException(502, "Sample documents are currently unavailable.") from None


@app.post("/api/samples/ask")
def ask_samples(body: Question) -> Answer:
    try:
        settings = Settings.load()
        available = {sample["id"] for sample in list_samples(settings)}
        if any(str(document_id) not in available for document_id in body.document_ids):
            raise HTTPException(404, "One or more sample documents are unavailable.")
        charge(settings, "demo", 2)
        return answer_question(settings, body.question, body.document_ids)
    except ProviderHTTPError as exc:
        _provider_error(exc)
    except RagError:
        raise HTTPException(502, "Sample Q&A is currently unavailable.") from None


def _provider_error(exc: ProviderHTTPError):
    if exc.status == 429:
        raise HTTPException(429, "The demo reached a usage limit. Try again later.") from None
    if exc.status == 409:
        raise HTTPException(409, "This chat has changed. Reopen it and try again.") from None
    raise HTTPException(502, "The document service is currently unavailable.") from None


def _check_ready(settings: Settings, owner: UUID, token: str, ids: list[UUID]) -> dict[UUID, str]:
    query = urlencode({
        "select": "id,filename",
        "id": f"in.({','.join(map(str, ids))})",
        "owner_id": f"eq.{owner}",
        "status": "eq.ready",
    })
    rows = _supabase(settings, f"documents?{query}", method="GET", access_token=token)
    if {row["id"] for row in rows} != set(map(str, ids)):
        raise HTTPException(404, "One or more selected documents are unavailable.")
    return {UUID(row["id"]): row["filename"] for row in rows}


@app.post("/api/documents/ask")
def ask_documents(
    body: DocumentQuestion,
    auth: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> DocumentAnswer:
    if auth is None:
        raise HTTPException(401, "Sign in to ask about your documents.")
    try:
        settings = Settings.load()
        owner, token = signed_in_user(settings, auth)
        ids = list(dict.fromkeys(body.document_ids))
        history = []
        expected_turn = 0
        if body.chat_id is not None:
            read_chat(settings, token, body.chat_id)
            if ids != chat_documents(settings, token, body.chat_id):
                raise HTTPException(409, "Start a new chat to change the selected documents.")
            messages = chat_messages(settings, token, body.chat_id, limit=4)
            if messages:
                expected_turn = messages[-1]["turn_number"]
                history = [{"role": row["role"], "text": row["content"][:2000]} for row in messages]
        _check_ready(settings, owner, token, ids)
        charge(settings, "ai", 2 + bool(history), owner)
        answer = answer_question(
            settings, body.question, ids, access_token=token,
            explain=body.mode == "explain", history=history,
        )
        chat_id = None
        if body.save_chat or body.chat_id:
            chat_id = _supabase(settings, "rpc/save_chat_turn", credentials=_required("SUPABASE_SECRET_KEY"), payload={
                "target_owner": str(owner),
                "target_chat": str(body.chat_id) if body.chat_id else None,
                "selected_documents": list(map(str, ids)),
                "expected_turn": expected_turn,
                "question_text": body.question,
                "answer_text": answer.answer,
                "answer_sources": [source.model_dump(mode="json") for source in answer.sources],
            })
        return DocumentAnswer(answer=answer.answer, sources=answer.sources, chat_id=chat_id)
    except ProviderHTTPError as exc:
        _provider_error(exc)
    except RagError:
        raise HTTPException(502, "Document Q&A is currently unavailable.") from None


@app.post("/api/documents/summarize")
def summarize_documents(
    body: DocumentSummary,
    auth: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> Answer:
    if auth is None:
        raise HTTPException(401, "Sign in to summarize your documents.")
    try:
        settings = Settings.load()
        owner, token = signed_in_user(settings, auth)
        ids = list(dict.fromkeys(body.document_ids))
        filenames = _check_ready(settings, owner, token, ids)
        passages = []
        for document_id in ids:
            position = -1
            while True:
                query = urlencode({
                    "select": "id,document_id,position,location,content",
                    "document_id": f"eq.{document_id}",
                    "position": f"gt.{position}", "order": "position.asc", "limit": 100,
                })
                rows = _supabase(settings, f"chunks?{query}", method="GET", access_token=token)
                if not rows:
                    break
                passages.extend(Citation.model_validate({
                    **row, "chunk_id": row["id"], "filename": filenames[document_id],
                }) for row in rows)
                position = rows[-1]["position"]
                # Stop reading early when the selected documents exceed the section budget.
                summary_batches([*dict.fromkeys(p.document_id for p in passages)], passages)
        plan = summary_batches(ids, passages)
        units = summary_calls(plan)
        if units * settings.timeout > 240:
            raise SummaryLimit("This selection is too large to summarize in one request. Choose fewer documents.")
        charge(settings, "ai", units, owner)
        return summarize(settings, plan)
    except SummaryLimit as exc:
        raise HTTPException(413, str(exc)) from None
    except ProviderHTTPError as exc:
        _provider_error(exc)
    except RagError:
        raise HTTPException(502, "Document summaries are currently unavailable.") from None
