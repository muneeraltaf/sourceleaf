from urllib.parse import urlencode
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from auth import bearer, signed_in_user
from rag import RagError, SupabaseSettings, _supabase

router = APIRouter(prefix="/api/chats")


def _read(settings: SupabaseSettings, token: str, table: str, **filters):
    return _supabase(
        settings, f"{table}?{urlencode(filters)}", method="GET", access_token=token
    )


def read_chat(settings: SupabaseSettings, token: str, chat_id: UUID) -> dict:
    rows = _read(settings, token, "chats", select="id,title,created_at", id=f"eq.{chat_id}")
    if not rows:
        raise HTTPException(404, "This chat is unavailable.")
    return rows[0]


def chat_documents(settings: SupabaseSettings, token: str, chat_id: UUID) -> list[UUID]:
    rows = _read(settings, token, "chat_documents", select="document_id",
                 chat_id=f"eq.{chat_id}", order="position.asc,document_id.asc")
    return [UUID(row["document_id"]) for row in rows]


def chat_messages(settings: SupabaseSettings, token: str, chat_id: UUID, limit: int) -> list[dict]:
    rows = _read(settings, token, "messages", select="turn_number,role,content,sources",
                 chat_id=f"eq.{chat_id}", order="turn_number.desc,role.asc", limit=limit)
    return list(reversed(rows))


@router.get("")
def list_chats(auth: HTTPAuthorizationCredentials | None = Depends(bearer)):
    try:
        settings = SupabaseSettings.load()
        _, token = signed_in_user(settings, auth)
        return _read(settings, token, "chats", select="id,title,created_at",
                     order="created_at.desc,id.desc", limit=50)
    except RagError:
        raise HTTPException(502, "Could not load chats.") from None


@router.get("/{chat_id}")
def open_chat(chat_id: UUID, auth: HTTPAuthorizationCredentials | None = Depends(bearer)):
    try:
        settings = SupabaseSettings.load()
        _, token = signed_in_user(settings, auth)
        return {
            **read_chat(settings, token, chat_id),
            "document_ids": chat_documents(settings, token, chat_id),
            "messages": chat_messages(settings, token, chat_id, limit=100),
        }
    except RagError:
        raise HTTPException(502, "Could not open this chat.") from None
