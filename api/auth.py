from uuid import UUID

from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from rag import ProviderHTTPError, RagError, SupabaseSettings, _json_request

bearer = HTTPBearer(auto_error=False)


def signed_in_user(
    settings: SupabaseSettings, auth: HTTPAuthorizationCredentials | None
) -> tuple[UUID, str]:
    if auth is None:
        raise HTTPException(401, "Sign in to access your documents.")
    try:
        user = _json_request(
            f"{settings.supabase_url}/auth/v1/user",
            provider="Supabase Auth",
            headers={
                "apikey": settings.publishable_key,
                "Authorization": f"Bearer {auth.credentials}",
            },
            timeout=settings.timeout,
            method="GET",
        )
    except ProviderHTTPError as exc:
        if exc.status in (400, 401, 403):
            raise HTTPException(401, "Your sign-in session is invalid or expired.") from None
        raise

    if isinstance(user, dict) and user.get("is_anonymous") is True:
        raise HTTPException(401, "Sign in with a permanent account to access your documents.")
    try:
        return UUID(user["id"]), auth.credentials
    except (KeyError, TypeError, ValueError):
        raise RagError("Supabase Auth returned an invalid user.") from None
