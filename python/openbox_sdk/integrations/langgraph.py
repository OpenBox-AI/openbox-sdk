from __future__ import annotations

import inspect
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from typing import Any, TypeVar, overload

from openbox_sdk._govern_runtime import BaseGovernedSession, WorkflowVerdict
from openbox_sdk.clients import AsyncOpenBoxCoreClient
from openbox_sdk.generated.govern import PRESET_ACTIVITY_TYPES, presets
from openbox_sdk.generated.runtime_contract import (
    ACTIVITY_COMPLETED_EVENT_TYPE,
    ACTIVITY_STARTED_EVENT_TYPE,
)

T = TypeVar("T")
R = TypeVar("R")
DEFAULT_ACTIVITY_TYPES = PRESET_ACTIVITY_TYPES["default"]


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
            ACTIVITY_STARTED_EVENT_TYPE,
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
            ACTIVITY_COMPLETED_EVENT_TYPE,
            activity_type,
            _with_activity_id(payload, activity_id),
        )

    async def evaluate_hook_span(
        self,
        *,
        activity_id: str,
        activity_type: str,
        span: Mapping[str, Any],
        event_type: str = ACTIVITY_STARTED_EVENT_TYPE,
    ) -> WorkflowVerdict:
        payload = {
            "event_type": event_type,
            "activity_id": activity_id,
            "activity_type": activity_type,
            "hook_trigger": True,
            "spans": [dict(span)],
        }
        return await self.session.emit(payload)

    @overload
    async def wrap_tool_call(
        self,
        request: R,
        handler: Callable[[R], Awaitable[T]],
    ) -> T: ...

    @overload
    async def wrap_tool_call(
        self,
        request: R,
        handler: Callable[[R], T],
    ) -> T: ...

    async def wrap_tool_call(
        self,
        request: R,
        handler: Callable[[R], Awaitable[T] | T],
    ) -> T:
        activity_id = _request_id(request)
        activity_type = _request_name(request, DEFAULT_ACTIVITY_TYPES["agentAction"])
        plain_request = _plain_request(request)
        tool_input = _tool_input(request)
        opened = await self.session.open_activity(
            activity_type,
            {
                "activity_id": activity_id,
                "input": [plain_request],
                "tool_name": activity_type,
                "tool_type": _span_type_for(activity_type, tool_input),
                "spans": [_tool_span(activity_type, tool_input, stage="started")],
            },
        )
        self._enforce_verdict(opened.verdict)
        try:
            result = await _maybe_await(handler(request))
        except BaseException as exc:
            await opened.complete(
                {
                    "input": [plain_request],
                    "output": {"error": str(exc)},
                    "tool_name": activity_type,
                    "tool_type": _span_type_for(activity_type, tool_input),
                    "spans": [
                        _tool_span(
                            activity_type,
                            tool_input,
                            tool_output={"error": str(exc)},
                            stage="completed",
                        )
                    ],
                },
            )
            raise
        completed = await opened.complete(
            {
                "input": [plain_request],
                "output": result,
                "tool_name": activity_type,
                "tool_type": _span_type_for(activity_type, tool_input),
                "spans": [
                    _tool_span(
                        activity_type,
                        tool_input,
                        tool_output=result,
                        stage="completed",
                    )
                ],
            },
        )
        self._enforce_verdict(completed)
        return result

    @overload
    async def wrap_model_call(
        self,
        request: R,
        handler: Callable[[R], Awaitable[T]],
    ) -> T: ...

    @overload
    async def wrap_model_call(
        self,
        request: R,
        handler: Callable[[R], T],
    ) -> T: ...

    async def wrap_model_call(
        self,
        request: R,
        handler: Callable[[R], Awaitable[T] | T],
    ) -> T:
        activity_id = _request_id(request)
        plain_request = _plain_request(request)
        opened = await self.session.open_activity(
            "on_chat_model_start",
            {
                "activity_id": activity_id,
                "input": [plain_request],
                **_model_request_fields(request),
            },
        )
        self._enforce_verdict(opened.verdict)
        result = await _maybe_await(handler(request))
        completed = await opened.complete(
            {
                "input": [plain_request],
                "output": result,
                **_model_completion_fields(request, result),
            },
            "on_chat_model_end",
        )
        self._enforce_verdict(completed)
        return result

    def _enforce_verdict(self, verdict: Mapping[str, Any]) -> None:
        if not self.strict:
            return
        arm = verdict.get("arm")
        if arm in {"block", "halt", "require_approval"}:
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


def _tool_input(request: Any) -> dict[str, Any]:
    value = _value(request, "input") or _value(request, "args") or _value(request, "arguments")
    if isinstance(value, Mapping):
        return dict(value)
    plain = _plain_request(request)
    return dict(plain) if isinstance(plain, Mapping) else {}


def _span_type_for(tool_name: str, tool_input: Mapping[str, Any]) -> str:
    lower = tool_name.lower()
    if "read" in lower or tool_input.get("read") is True:
        return "file_read"
    if "write" in lower or "edit" in lower:
        return "file_write"
    if "delete" in lower or "remove" in lower:
        return "file_delete"
    if "bash" in lower or "shell" in lower or isinstance(tool_input.get("command"), str):
        return "shell"
    if (
        "web" in lower
        or isinstance(tool_input.get("url"), str)
        or isinstance(tool_input.get("uri"), str)
    ):
        return "http"
    if lower.startswith("mcp") or "mcp" in lower:
        return "mcp"
    return "internal"


def _tool_span(
    tool_name: str,
    tool_input: Mapping[str, Any],
    *,
    tool_output: Any | None = None,
    stage: str,
) -> dict[str, Any]:
    span_type = _span_type_for(tool_name, tool_input)
    attributes: dict[str, Any] = {
        "openbox.tool.name": tool_name,
        "tool.name": tool_name,
        "tool_name": tool_name,
        "openbox.semantic_type": span_type,
        "openbox.span_type": "function" if span_type in {"internal", "shell"} else span_type,
    }
    if span_type == "shell" and isinstance(tool_input.get("command"), str):
        attributes["shell.command"] = tool_input["command"]
    if span_type == "http":
        attributes["http.method"] = str(tool_input.get("method") or "GET").upper()
        target = _first_string(tool_input.get("url"), tool_input.get("uri"), tool_input.get("href"))
        if target:
            attributes["http.url"] = target
    if span_type.startswith("file_"):
        path = _first_string(
            tool_input.get("file_path"),
            tool_input.get("filePath"),
            tool_input.get("path"),
        )
        if path:
            attributes["file.path"] = path
        attributes["file.operation"] = span_type.removeprefix("file_")
    if span_type == "mcp":
        attributes["mcp.method"] = "callTool"

    return {
        "name": tool_name,
        "kind": "INTERNAL",
        "span_type": "function" if span_type in {"internal", "shell"} else span_type,
        "hook_type": "function_call",
        "semantic_type": "internal" if span_type == "shell" else span_type,
        "stage": stage,
        "attributes": attributes,
        "function": tool_name,
        "args": dict(tool_input),
        "result": tool_output,
    }


def _model_request_fields(request: Any) -> dict[str, Any]:
    model = _model_from(request)
    prompt = _prompt_from(request)
    return {
        **({"llm_model": model} if model else {}),
        **({"prompt": prompt} if prompt else {}),
    }


def _model_completion_fields(request: Any, result: Any) -> dict[str, Any]:
    usage = _usage_from(result) or _usage_from(request)
    input_tokens = _token_value(
        usage,
        "input_tokens",
        "prompt_tokens",
        "inputTokens",
        "promptTokens",
    )
    output_tokens = _token_value(
        usage,
        "output_tokens",
        "completion_tokens",
        "outputTokens",
        "completionTokens",
    )
    total_tokens = _token_value(usage, "total_tokens", "totalTokens")
    if total_tokens is None and (input_tokens is not None or output_tokens is not None):
        total_tokens = (input_tokens or 0) + (output_tokens or 0)
    model = _model_from(result) or _model_from(request)
    finish_reason = _first_string(
        _value(result, "finish_reason"),
        _value(result, "finishReason"),
        _nested_value(result, "response_metadata", "finish_reason"),
        _nested_value(result, "response_metadata", "finishReason"),
    )
    completion = _completion_from(result)
    return {
        **({"llm_model": model} if model else {}),
        **({"input_tokens": input_tokens} if input_tokens is not None else {}),
        **({"output_tokens": output_tokens} if output_tokens is not None else {}),
        **({"total_tokens": total_tokens} if total_tokens is not None else {}),
        "has_tool_calls": _has_tool_calls(result),
        **({"finish_reason": finish_reason} if finish_reason else {}),
        **({"completion": completion} if completion else {}),
    }


def _usage_from(value: Any) -> Mapping[str, Any] | None:
    for candidate in (
        _value(value, "usage_metadata"),
        _value(value, "usageMetadata"),
        _value(value, "usage"),
        _value(value, "token_usage"),
        _nested_value(value, "response_metadata", "usage"),
        _nested_value(value, "response_metadata", "token_usage"),
        _nested_value(value, "llm_output", "token_usage"),
    ):
        if isinstance(candidate, Mapping):
            return candidate
    return None


def _model_from(value: Any) -> str | None:
    return _first_string(
        _value(value, "model"),
        _value(value, "model_name"),
        _value(value, "modelName"),
        _nested_value(value, "response_metadata", "model"),
        _nested_value(value, "response_metadata", "model_name"),
        _nested_value(value, "response_metadata", "modelName"),
        _nested_value(value, "llm_output", "model"),
    )


def _prompt_from(value: Any) -> str | None:
    prompt = _value(value, "prompt")
    if isinstance(prompt, str) and prompt.strip():
        return prompt
    messages = _value(value, "messages")
    if isinstance(messages, list):
        parts = []
        for message in messages:
            content = _value(message, "content")
            if isinstance(content, str) and content.strip():
                parts.append(content.strip())
        if parts:
            return "\n".join(parts)
    return None


def _completion_from(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value
    direct = _first_string(_value(value, "content"), _value(value, "text"))
    if direct:
        return direct
    message = _value(value, "message")
    if isinstance(message, Mapping):
        return _first_string(message.get("content"))
    choices = _value(value, "choices")
    if isinstance(choices, list) and choices:
        first = choices[0]
        if isinstance(first, Mapping):
            return _first_string(
                first.get("text"),
                _nested_value(first, "message", "content"),
            )
    return None


def _has_tool_calls(value: Any) -> bool:
    candidates = (
        _value(value, "tool_calls"),
        _value(value, "toolCalls"),
        _nested_value(value, "additional_kwargs", "tool_calls"),
        _nested_value(value, "message", "tool_calls"),
    )
    return any(isinstance(candidate, list) and len(candidate) > 0 for candidate in candidates)


def _token_value(source: Mapping[str, Any] | None, *keys: str) -> int | None:
    if source is None:
        return None
    for key in keys:
        value = source.get(key)
        if isinstance(value, int) and value >= 0:
            return value
        if isinstance(value, float) and value >= 0 and value.is_integer():
            return int(value)
    return None


def _nested_value(value: Any, first: str, second: str) -> Any:
    child = _value(value, first)
    if isinstance(child, Mapping):
        return child.get(second)
    return getattr(child, second, None) if child is not None else None


def _first_string(*values: Any) -> str | None:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


async def _maybe_await(value: Awaitable[T] | T) -> T:
    if inspect.isawaitable(value):
        return await value
    return value


__all__ = [
    "OpenBoxGraphHandler",
    "OpenBoxLangGraphMiddleware",
    "create_openbox_graph_handler",
]
