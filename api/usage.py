from uuid import UUID

from rag import SupabaseSettings, _positive_int, _required, _supabase


def charge(settings: SupabaseSettings, scope: str, units: int, owner: UUID | None = None) -> None:
    prefix = f"SOURCELEAF_DAILY_{scope.upper()}"
    payload = {
        "global_bucket": scope,
        "global_limit": _positive_int(f"{prefix}_LIMIT", 1000000),
        "unit_count": units,
    }
    if owner is not None:
        payload["account_bucket"] = f"{scope}:{owner}"
        payload["account_limit"] = _positive_int(f"{prefix}_ACCOUNT_LIMIT", 1000000)
    _supabase(settings, "rpc/charge_usage", payload=payload, credentials=_required("SUPABASE_SECRET_KEY"))
