from __future__ import annotations

import asyncio
import email.utils
import inspect
import random
from collections.abc import Awaitable, Callable, Coroutine, Mapping
from datetime import UTC, datetime
from typing import Any, TypeVar, cast
from urllib.parse import quote

T = TypeVar("T")


def normalize_api_url(url: str, *, require_https: bool = False) -> str:
    normalized = url.rstrip("/")
    if not normalized:
        raise ValueError("api_url is required")
    if not normalized.startswith(("http://", "https://")):
        raise ValueError("api_url must include http:// or https://")
    if require_https and normalized.startswith("http://") and not _is_loopback_url(normalized):
        raise ValueError("core api_url must use https outside loopback development hosts")
    return normalized


def _is_loopback_url(url: str) -> bool:
    return (
        url.startswith("http://localhost")
        or url.startswith("http://127.0.0.1")
        or url.startswith("http://[::1]")
    )


def render_path(template: str, path_params: Mapping[str, Any] | None = None) -> str:
    rendered = template
    for raw_name, value in (path_params or {}).items():
        rendered = rendered.replace("{" + raw_name + "}", quote(str(value), safe=""))
    if "{" in rendered or "}" in rendered:
        raise ValueError(f"missing path parameter for {template}")
    return rendered


def compact_json_dumps(data: Any) -> bytes:
    import json

    return json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def utc_now() -> datetime:
    return datetime.now(tz=UTC)


def parse_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    if not isinstance(value, str):
        return None
    parsed = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        dt = datetime.fromisoformat(parsed)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def retry_backoff_seconds(
    attempt: int,
    *,
    base_seconds: float,
    max_seconds: float,
    retry_after: str | None,
) -> float:
    if retry_after:
        parsed = _parse_retry_after(retry_after)
        if parsed is not None:
            return min(parsed, max_seconds)
    jitter = random.uniform(0, base_seconds)
    return float(min(max_seconds, base_seconds * (2**attempt) + jitter))


def _parse_retry_after(value: str) -> float | None:
    try:
        return max(0.0, float(value))
    except ValueError:
        pass
    parsed = email.utils.parsedate_to_datetime(value)
    if parsed is None:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return max(0.0, (parsed - utc_now()).total_seconds())


def run_blocking(factory: Callable[[], Coroutine[Any, Any, T]]) -> T:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(factory())
    raise RuntimeError("synchronous OpenBox clients cannot run inside an active event loop")


async def maybe_await(value: T | Awaitable[T]) -> T:
    if inspect.isawaitable(value):
        return await cast(Awaitable[T], value)
    return value
