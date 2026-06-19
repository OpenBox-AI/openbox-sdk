from __future__ import annotations

import inspect
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from typing import Any, TypeVar

from openbox_sdk._govern_runtime import BaseGovernedSession, WorkflowVerdict
from openbox_sdk.clients import AsyncOpenBoxCoreClient
from openbox_sdk.generated.govern import presets

T = TypeVar("T")


class OpenBoxLangGraphMiddleware:
    def __init__(
        self,
        *,
        core: Any | None = None,
        workflow_id: str | None = None,
        run_id: str | None = None,
        workflow_type: str = "LangGraphRun",
        task_queue: str = "langgraph",
        session: BaseGovernedSession | None = None,
        strict: bool = True,
    ) -> None:
        if session is None and core is None:
            core = AsyncOpenBoxCoreClient()
        self.session = session or presets.langgraph(
            core=core,
            workflow_id=workflow_id,
            run_id=run_id,
            workflow_type=workflow_type,
            task_queue=task_queue,
            register_exit_handlers=False,
        )
        self.strict = strict

    async def start_activity(
        self,
        activity_type: str,
        payload: Mapping[str, Any] | None = None,
        *,
        activity_id: str | None = None,
    ) -> WorkflowVerdict:
        return await self.session.observe_activity(
            "ActivityStarted",
            activity_type,
            _with_activity_id(payload, activity_id),
        )

    async def complete_activity(
        self,
        activity_type: str,
        payload: Mapping[str, Any] | None = None,
        *,
        activity_id: str | None = None,
    ) -> WorkflowVerdict:
        return await self.session.observe_activity(
            "ActivityCompleted",
            activity_type,
            _with_activity_id(payload, activity_id),
        )

    async def evaluate_hook_span(
        self,
        *,
        activity_id: str,
        activity_type: str,
        span: Mapping[str, Any],
        event_type: str = "ActivityStarted",
    ) -> WorkflowVerdict:
        payload = {
            "event_type": event_type,
            "activity_id": activity_id,
            "activity_type": activity_type,
            "hook_trigger": True,
            "spans": [dict(span)],
        }
        return await self.session.emit(payload)

    async def wrap_tool_call(
        self,
        request: Any,
        handler: Callable[[Any], Awaitable[T] | T],
    ) -> T:
        activity_id = _request_id(request)
        activity_type = _request_name(request, "ToolCall")
        started = await self.start_activity(
            activity_type,
            {"input": [_plain_request(request)]},
            activity_id=activity_id,
        )
        self._enforce_verdict(started)
        try:
            result = await _maybe_await(handler(request))
        except BaseException as exc:
            await self.complete_activity(
                activity_type,
                {"input": [_plain_request(request)], "output": {"error": str(exc)}},
                activity_id=activity_id,
            )
            raise
        completed = await self.complete_activity(
            activity_type,
            {"input": [_plain_request(request)], "output": result},
            activity_id=activity_id,
        )
        self._enforce_verdict(completed)
        return result

    async def wrap_model_call(
        self,
        request: Any,
        handler: Callable[[Any], Awaitable[T] | T],
    ) -> T:
        activity_id = _request_id(request)
        started = await self.start_activity(
            "on_chat_model_start",
            {"input": [_plain_request(request)]},
            activity_id=activity_id,
        )
        self._enforce_verdict(started)
        result = await _maybe_await(handler(request))
        completed = await self.complete_activity(
            "on_chat_model_end",
            {"input": [_plain_request(request)], "output": result},
            activity_id=activity_id,
        )
        self._enforce_verdict(completed)
        return result

    def _enforce_verdict(self, verdict: Mapping[str, Any]) -> None:
        if not self.strict:
            return
        arm = verdict.get("arm")
        if arm in {"block", "halt"}:
            raise RuntimeError(str(verdict.get("reason") or f"OpenBox governance {arm}"))


class OpenBoxGraphHandler:
    def __init__(self, graph: Any, middleware: OpenBoxLangGraphMiddleware) -> None:
        self.graph = graph
        self.middleware = middleware

    async def ainvoke(self, *args: Any, **kwargs: Any) -> Any:
        await self.middleware.session.workflow_started()
        try:
            result = await _maybe_await(self.graph.ainvoke(*args, **kwargs))
            await self.middleware.session.workflow_completed()
            return result
        except BaseException as exc:
            await self.middleware.session.workflow_failed(exc)
            raise

    async def astream(self, *args: Any, **kwargs: Any) -> AsyncIterator[Any]:
        await self.middleware.session.workflow_started()
        try:
            async for item in self.graph.astream(*args, **kwargs):
                yield item
            await self.middleware.session.workflow_completed()
        except BaseException as exc:
            await self.middleware.session.workflow_failed(exc)
            raise


def create_openbox_graph_handler(
    graph: Any,
    *,
    middleware: OpenBoxLangGraphMiddleware | None = None,
    **middleware_options: Any,
) -> OpenBoxGraphHandler:
    return OpenBoxGraphHandler(
        graph,
        middleware or OpenBoxLangGraphMiddleware(**middleware_options),
    )


def _with_activity_id(
    payload: Mapping[str, Any] | None,
    activity_id: str | None,
) -> dict[str, Any]:
    result = dict(payload or {})
    if activity_id is not None:
        result["activity_id"] = activity_id
    return result


def _request_id(request: Any) -> str:
    for key in ("id", "run_id", "tool_call_id"):
        value = _value(request, key)
        if isinstance(value, str) and value:
            return value
    return str(uuid.uuid4())


def _request_name(request: Any, fallback: str) -> str:
    for key in ("name", "tool_name", "tool"):
        value = _value(request, key)
        if isinstance(value, str) and value:
            return value
    return fallback


def _plain_request(request: Any) -> Any:
    if isinstance(request, Mapping):
        return dict(request)
    if hasattr(request, "model_dump"):
        dumped = request.model_dump()
        return dumped if isinstance(dumped, Mapping) else request
    return request


def _value(request: Any, key: str) -> Any:
    if isinstance(request, Mapping):
        return request.get(key)
    return getattr(request, key, None)


async def _maybe_await(value: Awaitable[T] | T) -> T:
    if inspect.isawaitable(value):
        return await value
    return value


__all__ = [
    "OpenBoxGraphHandler",
    "OpenBoxLangGraphMiddleware",
    "create_openbox_graph_handler",
]
