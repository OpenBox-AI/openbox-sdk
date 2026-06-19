from __future__ import annotations

import asyncio
import os
import re
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any, ClassVar, Self

import httpx

from ._utils import (
    compact_json_dumps,
    maybe_await,
    normalize_api_url,
    parse_datetime,
    retry_backoff_seconds,
    run_blocking,
    utc_now,
)
from ._version import __version__
from .generated.backend_client import BackendOperationsMixin
from .generated.core_client import CoreOperationsMixin
from .generated.permissions import PATH_PERMISSION_RULES
from .identity import AgentIdentityConfig, sign_agent_identity_request

JsonMapping = Mapping[str, Any]
Sleep = Callable[[float], Awaitable[None]]


class OpenBoxAPIError(RuntimeError):
    def __init__(self, *, status_code: int, message: str, payload: Any = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload


class MissingPermissionError(PermissionError):
    def __init__(
        self,
        *,
        method_name: str,
        missing_permissions: tuple[str, ...],
        available_permissions: tuple[str, ...],
    ) -> None:
        message = (
            f"[{method_name}] missing permissions: {', '.join(missing_permissions)}. "
            f"Available permissions: {', '.join(available_permissions) or '(none)'}"
        )
        super().__init__(message)
        self.method_name = method_name
        self.missing_permissions = missing_permissions
        self.available_permissions = available_permissions


@dataclass(frozen=True)
class RetryConfig:
    max_retries: int = 2
    base_delay_seconds: float = 0.1
    max_delay_seconds: float = 2.0


def _request_body_bytes(data: Any) -> bytes | None:
    if data is None:
        return None
    if isinstance(data, bytes):
        return data
    if isinstance(data, str):
        return data.encode("utf-8")
    return compact_json_dumps(data)


def _parse_response(response: httpx.Response) -> Any:
    if response.status_code == 204 or not response.content:
        return None
    if "json" not in response.headers.get("content-type", ""):
        return response.text
    return response.json()


def _unwrap_data(payload: Any) -> Any:
    if isinstance(payload, dict) and "data" in payload:
        return payload["data"]
    return payload


def _error_message(payload: Any, response: httpx.Response) -> str:
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict) and isinstance(error.get("message"), str):
            return str(error["message"])
        if isinstance(error, str):
            return error
        if isinstance(payload.get("message"), str):
            return str(payload["message"])
    return f"OpenBox API request failed with status {response.status_code}"


class _AsyncHttpRuntime:
    RETRYABLE_STATUSES: ClassVar[set[int]] = {408, 409, 425, 429, 500, 502, 503, 504}

    def __init__(
        self,
        *,
        api_url: str,
        timeout: float,
        retry: RetryConfig,
        http_client: httpx.AsyncClient | None,
        sleep: Sleep,
    ) -> None:
        self.api_url = api_url
        self.timeout = timeout
        self.retry = retry
        self._http_client = http_client or httpx.AsyncClient(timeout=timeout)
        self._owns_http_client = http_client is None
        self._sleep = sleep

    async def aclose(self) -> None:
        if self._owns_http_client:
            await self._http_client.aclose()

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *_exc: object) -> None:
        await self.aclose()

    async def _send(
        self,
        *,
        method: str,
        path: str,
        params: JsonMapping | None,
        data: Any,
        headers: JsonMapping,
        retry: RetryConfig | None,
    ) -> Any:
        body = _request_body_bytes(data)
        request_headers = {str(key): str(value) for key, value in headers.items()}
        if body is not None:
            request_headers.setdefault("Content-Type", "application/json")

        attempts = (retry.max_retries if retry is not None else 0) + 1
        last_error: httpx.TransportError | None = None
        for attempt in range(attempts):
            try:
                response = await self._http_client.request(
                    method,
                    f"{self.api_url}{path}",
                    params=dict(params or {}),
                    content=body,
                    headers=request_headers,
                )
            except httpx.TransportError as exc:
                last_error = exc
                if retry is None or attempt == attempts - 1:
                    raise
                await self._sleep(_retry_delay(attempt, retry, None))
                continue

            payload = _parse_response(response)
            if response.status_code < 400:
                return _unwrap_data(payload)
            if (
                retry is not None
                and response.status_code in self.RETRYABLE_STATUSES
                and attempt < attempts - 1
            ):
                await self._sleep(_retry_delay(attempt, retry, response.headers.get("Retry-After")))
                continue
            raise OpenBoxAPIError(
                status_code=response.status_code,
                message=_error_message(payload, response),
                payload=payload,
            )

        if last_error is not None:
            raise last_error
        raise RuntimeError("OpenBox request loop exited unexpectedly")


def _retry_delay(attempt: int, retry: RetryConfig, retry_after: str | None) -> float:
    return retry_backoff_seconds(
        attempt,
        base_seconds=retry.base_delay_seconds,
        max_seconds=retry.max_delay_seconds,
        retry_after=retry_after,
    )


def _auth_headers(api_key: str | None, bearer_token: str | None) -> dict[str, str]:
    if api_key:
        return {"X-API-Key": api_key}
    if bearer_token:
        return {"Authorization": f"Bearer {bearer_token}"}
    return {}


class AsyncOpenBoxClient(BackendOperationsMixin, _AsyncHttpRuntime):  # type: ignore[misc]
    REFRESH_ENABLED: ClassVar[bool] = False

    def __init__(
        self,
        *,
        api_url: str | None = None,
        api_key: str | None = None,
        bearer_token: str | None = None,
        permissions: list[str] | tuple[str, ...] | set[str] | None = None,
        timeout: float = 30.0,
        retry: RetryConfig | None = None,
        http_client: httpx.AsyncClient | None = None,
        sleep: Sleep = asyncio.sleep,
    ) -> None:
        resolved_url = api_url or os.environ.get("OPENBOX_API_URL") or "https://api.openbox.ai"
        super().__init__(
            api_url=normalize_api_url(resolved_url),
            timeout=timeout,
            retry=retry or RetryConfig(),
            http_client=http_client,
            sleep=sleep,
        )
        self.api_key = api_key or os.environ.get("OPENBOX_API_KEY")
        self.bearer_token = bearer_token
        self.permissions = frozenset(permissions) if permissions is not None else None

    @staticmethod
    def get_version() -> str:
        return __version__

    def set_permissions(self, permissions: list[str] | tuple[str, ...] | set[str] | None) -> None:
        self.permissions = frozenset(permissions) if permissions is not None else None

    def check_path_permissions(self, method: str, path: str) -> None:
        if self.permissions is None:
            return
        for rule_method, pattern, method_name, permissions in PATH_PERMISSION_RULES:
            if str(rule_method).lower() != method.lower() or re.match(str(pattern), path) is None:
                continue
            required = tuple(str(permission) for permission in permissions)
            missing = tuple(
                permission for permission in required if permission not in self.permissions
            )
            if missing:
                raise MissingPermissionError(
                    method_name=str(method_name),
                    missing_permissions=missing,
                    available_permissions=tuple(sorted(self.permissions)),
                )
            return

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: JsonMapping | None = None,
        data: Any = None,
        operation: str | None = None,
    ) -> Any:
        del operation
        self.check_path_permissions(method, path)
        headers = {
            "Accept": "application/json",
            "X-OpenBox-Client": f"openbox-python/{__version__}",
            **_auth_headers(self.api_key, self.bearer_token),
        }
        return await self._send(
            method=method,
            path=path,
            params=params,
            data=data,
            headers=headers,
            retry=self.retry,
        )

    async def request_operation(
        self,
        operation_id: str,
        *,
        path_params: JsonMapping | None = None,
        params: JsonMapping | None = None,
        data: Any = None,
    ) -> Any:
        method, path = self._resolve_operation(operation_id, path_params)
        return await self._request(method, path, params=params, data=data, operation=operation_id)


class AsyncOpenBoxCoreClient(CoreOperationsMixin, _AsyncHttpRuntime):  # type: ignore[misc]
    def __init__(
        self,
        *,
        api_url: str | None = None,
        api_key: str | None = None,
        agent_identity: AgentIdentityConfig | Mapping[str, str] | None = None,
        timeout: float = 30.0,
        retry: RetryConfig | None = None,
        http_client: httpx.AsyncClient | None = None,
        sleep: Sleep = asyncio.sleep,
    ) -> None:
        resolved_url = api_url or os.environ.get("OPENBOX_CORE_URL") or "https://core.openbox.ai"
        super().__init__(
            api_url=normalize_api_url(resolved_url, require_https=True),
            timeout=timeout,
            retry=retry or RetryConfig(),
            http_client=http_client,
            sleep=sleep,
        )
        self.api_key = api_key or os.environ.get("OPENBOX_CORE_API_KEY")
        self.agent_identity = _normalize_agent_identity(agent_identity)

    @staticmethod
    def get_version() -> str:
        return __version__

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: JsonMapping | None = None,
        data: Any = None,
        operation: str | None = None,
        retry: RetryConfig | None = None,
    ) -> Any:
        if operation != "healthCheck":
            self._validate_runtime_key()
        body = _request_body_bytes(data)
        return await self._send(
            method=method,
            path=path,
            params=params,
            data=body,
            headers=self._headers(method=method, path=path, body=body),
            retry=retry,
        )

    async def request_operation(
        self,
        operation_id: str,
        *,
        path_params: JsonMapping | None = None,
        params: JsonMapping | None = None,
        data: Any = None,
    ) -> Any:
        method, path = self._resolve_operation(operation_id, path_params)
        retry = None if operation_id in {"evaluateGovernance", "evaluate"} else self.retry
        return await self._request(
            method,
            path,
            params=params,
            data=data,
            operation=operation_id,
            retry=retry,
        )

    async def health(self) -> Any:
        return await self._request("get", "/", operation="healthCheck")

    async def validate_api_key(
        self,
        *,
        query: JsonMapping | None = None,
        data: Any = None,
    ) -> Any:
        del data
        return await self._request(
            "get",
            "/api/v1/auth/validate",
            params=query,
            operation="validateApiKey",
            retry=self.retry,
        )

    async def evaluate(self, request: JsonMapping) -> Any:
        payload = {**dict(request), "sdk_version": __version__}
        return await self._request(
            "post",
            "/api/v1/governance/evaluate",
            data=payload,
            operation="evaluateGovernance",
            retry=None,
        )

    async def poll_approval(
        self,
        request: JsonMapping | None = None,
        *,
        query: JsonMapping | None = None,
        data: Any = None,
    ) -> Any:
        payload_data = request if request is not None else data
        payload = await self._request(
            "post",
            "/api/v1/governance/approval",
            params=query,
            data=dict(payload_data or {}),
            operation="pollApproval",
            retry=self.retry,
        )
        return _normalize_approval_expiry(payload)

    def _headers(self, *, method: str, path: str, body: bytes | None) -> dict[str, str]:
        headers = {
            "Accept": "application/json",
            "User-Agent": f"openbox-python/{__version__}",
            "X-OpenBox-SDK-Version": __version__,
            "x-openbox-internal": "true",
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if self.agent_identity is not None:
            headers.update(
                sign_agent_identity_request(
                    method=method,
                    path=path,
                    body=body or b"",
                    agent_did=self.agent_identity.agent_did,
                    agent_private_key=self.agent_identity.agent_private_key,
                )
            )
        return headers

    def _validate_runtime_key(self) -> None:
        if not self.api_key:
            raise ValueError("OpenBox Core requires a runtime API key")
        if self.api_key.startswith("obx_key_"):
            raise ValueError("backend API keys cannot be used with the OpenBox Core client")
        if not (self.api_key.startswith("obx_live_") or self.api_key.startswith("obx_test_")):
            raise ValueError("OpenBox Core API keys must start with obx_live_ or obx_test_")


def _normalize_agent_identity(
    agent_identity: AgentIdentityConfig | Mapping[str, str] | None,
) -> AgentIdentityConfig | None:
    if agent_identity is None:
        return None
    if isinstance(agent_identity, AgentIdentityConfig):
        return agent_identity
    return AgentIdentityConfig(
        agent_did=agent_identity["agent_did"],
        agent_private_key=agent_identity["agent_private_key"],
    )


def _normalize_approval_expiry(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload
    normalized = dict(payload)
    expires_at = (
        normalized.get("expires_at")
        or normalized.get("approval_expiration_time")
        or normalized.get("expiresAt")
        or normalized.get("approvalExpiresAt")
    )
    parsed = parse_datetime(expires_at)
    if parsed is not None and parsed <= utc_now():
        normalized["expired"] = True
    return normalized


class OpenBoxClient:
    def __init__(self, **config: Any) -> None:
        self._config = config

    def request_operation(
        self,
        operation_id: str,
        *,
        path_params: JsonMapping | None = None,
        params: JsonMapping | None = None,
        data: Any = None,
    ) -> Any:
        return run_blocking(
            lambda: self._call(
                "request_operation",
                operation_id,
                path_params=path_params,
                params=params,
                data=data,
            )
        )

    def __getattr__(self, name: str) -> Callable[..., Any]:
        if hasattr(AsyncOpenBoxClient, name):
            return lambda *args, **kwargs: run_blocking(lambda: self._call(name, *args, **kwargs))
        raise AttributeError(name)

    async def _call(self, name: str, *args: Any, **kwargs: Any) -> Any:
        async with AsyncOpenBoxClient(**self._config) as client:
            method = getattr(client, name)
            return await maybe_await(method(*args, **kwargs))


class OpenBoxCoreClient:
    def __init__(self, **config: Any) -> None:
        self._config = config

    def request_operation(
        self,
        operation_id: str,
        *,
        path_params: JsonMapping | None = None,
        params: JsonMapping | None = None,
        data: Any = None,
    ) -> Any:
        return run_blocking(
            lambda: self._call(
                "request_operation",
                operation_id,
                path_params=path_params,
                params=params,
                data=data,
            )
        )

    def __getattr__(self, name: str) -> Callable[..., Any]:
        if hasattr(AsyncOpenBoxCoreClient, name):
            return lambda *args, **kwargs: run_blocking(lambda: self._call(name, *args, **kwargs))
        raise AttributeError(name)

    async def _call(self, name: str, *args: Any, **kwargs: Any) -> Any:
        async with AsyncOpenBoxCoreClient(**self._config) as client:
            method = getattr(client, name)
            return await maybe_await(method(*args, **kwargs))
