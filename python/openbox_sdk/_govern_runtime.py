from __future__ import annotations

import asyncio
import math
import random
import re
import time
import uuid
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any, Literal, TypeAlias, TypeVar, cast

from ._utils import maybe_await, utc_now
from .generated.runtime_contract import (
    ACTIVITY_COMPLETED_EVENT_TYPE,
    ACTIVITY_STARTED_EVENT_TYPE,
    APPROVAL_STATUS_FIELD_ALIASES,
    DEFAULT_GUARDRAIL_FIELD_STATUS,
    DEFAULT_GUARDRAIL_INPUT_TYPE,
    DEFAULT_HOOK_SPAN_PARENT_EVENT_TYPE,
    DEFAULT_SDK_SOURCE,
    GOVERNED_PAYLOAD_FIELD_ALIASES,
    GUARDRAIL_FIELD_RESULT_FIELD_ALIASES,
    GUARDRAIL_FIELD_STATUSES,
    GUARDRAIL_INPUT_TYPES,
    GUARDRAIL_OUTPUT_TYPE,
    GUARDRAILS_RESULT_FIELD_ALIASES,
    GUARDRAILS_RESULT_GROUP_FIELD_ALIASES,
    GUARDRAILS_RESULT_RESPONSE_ALIASES,
    HANDOFF_EVENT_TYPE,
    SIGNAL_RECEIVED_EVENT_TYPE,
    SOURCE_INPUT_KEY,
    SPAN_ALIAS_FIELDS,
    SPAN_PERSISTABLE_ATTRIBUTE_FIELDS,
    SPAN_PERSISTABLE_ROOT_STRING_FIELDS,
    SPAN_RUNTIME_HINT_FIELDS,
    TELEMETRY_FIELD_ALIASES,
    VERDICT_ARM_RANK,
    WORKFLOW_COMPLETED_EVENT_TYPE,
    WORKFLOW_EVENT_SOURCE,
    WORKFLOW_FAILED_EVENT_TYPE,
    WORKFLOW_STARTED_EVENT_TYPE,
    WORKFLOW_VERDICT_FIELD_ALIASES,
)

EventType: TypeAlias = Literal[
    "WorkflowStarted",
    "WorkflowCompleted",
    "WorkflowFailed",
    "ActivityStarted",
    "ActivityCompleted",
    "SignalReceived",
    "Handoff",
]
ActivityStage: TypeAlias = Literal["pre", "post"]
VerdictArm: TypeAlias = Literal["allow", "constrain", "require_approval", "block", "halt"]
JsonDict: TypeAlias = dict[str, Any]
GovernedPayload: TypeAlias = Mapping[str, Any]
WorkflowVerdict: TypeAlias = JsonDict
Sleep: TypeAlias = Callable[[float], Awaitable[None]]
ApprovalHook: TypeAlias = Callable[[Mapping[str, Any]], Awaitable[None] | None]
ExternalDecisionHook: TypeAlias = Callable[[Mapping[str, Any]], Awaitable[str | None] | str | None]

T = TypeVar("T")

_TERMINAL_RANK: dict[str, int] = dict(VERDICT_ARM_RANK)


class SessionAlreadyTerminatedError(RuntimeError):
    def __init__(self) -> None:
        super().__init__(
            "[govern] session already terminated; create a new govern() scope to continue."
        )


@dataclass(frozen=True)
class OpenActivityHandle:
    activity_id: str
    verdict: WorkflowVerdict
    complete: Callable[..., Awaitable[WorkflowVerdict]]


class BaseGovernedSession:
    def __init__(
        self,
        *,
        core: Any,
        workflow_id: str | None = None,
        run_id: str | None = None,
        workflow_type: str = "governed_agent",
        task_queue: str = "generic",
        multi_agent_session_id: str | None = None,
        approval_poll_interval_seconds: float = 0.5,
        approval_poll_max_interval_seconds: float = 5.0,
        approval_poll_backoff_factor: float = 1.5,
        approval_poll_jitter: float = 0.25,
        inline_approval: bool = False,
        attached: bool = False,
        register_exit_handlers: bool = True,
        on_pending_approval: ApprovalHook | None = None,
        on_approval_resolved: ApprovalHook | None = None,
        await_external_decision: ExternalDecisionHook | None = None,
        source: str = DEFAULT_SDK_SOURCE,
        sleep: Sleep = asyncio.sleep,
    ) -> None:
        del register_exit_handlers
        self.core = core
        self.workflow_id = workflow_id or str(uuid.uuid4())
        self.run_id = run_id or str(uuid.uuid4())
        self.workflow_type = workflow_type
        self.task_queue = task_queue
        self.multi_agent_session_id = multi_agent_session_id
        self.approval_poll_interval_seconds = approval_poll_interval_seconds
        self.approval_poll_max_interval_seconds = approval_poll_max_interval_seconds
        self.approval_poll_backoff_factor = approval_poll_backoff_factor
        self.approval_poll_jitter = approval_poll_jitter
        self.inline_approval = inline_approval
        self.auto_open_suppressed = attached
        self.on_pending_approval = on_pending_approval
        self.on_approval_resolved = on_approval_resolved
        self.await_external_decision = await_external_decision
        self.source = source
        self._sleep = sleep
        self._opened = attached
        self._finalized = False
        self._activity_starts_ms: dict[str, int] = {}
        self._activity_parents: set[str] = set()
        self._in_flight: set[str] = set()

    @property
    def is_open(self) -> bool:
        return self._opened and not self._finalized

    @property
    def is_terminated(self) -> bool:
        return self._finalized

    async def workflow_started(self) -> None:
        if self._opened:
            return
        self._opened = True
        await self.emit({"event_type": WORKFLOW_STARTED_EVENT_TYPE})

    async def begin(self) -> None:
        await self.workflow_started()

    async def workflow_completed(self) -> WorkflowVerdict | None:
        if self._finalized:
            return None
        self._finalized = True
        return await self.emit({"event_type": WORKFLOW_COMPLETED_EVENT_TYPE, "status": "completed"})

    async def complete(self) -> WorkflowVerdict | None:
        return await self.workflow_completed()

    async def workflow_failed(self, error: object | None = None) -> WorkflowVerdict | None:
        if self._finalized:
            return None
        self._finalized = True
        return await self.emit(
            {
                "event_type": WORKFLOW_FAILED_EVENT_TYPE,
                "status": "failed",
                "error": _error_info(error),
            }
        )

    async def fail(self, error: object | None = None) -> WorkflowVerdict | None:
        return await self.workflow_failed(error)

    async def activity(
        self,
        event_type: EventType,
        activity_type: str,
        payload: GovernedPayload | None = None,
    ) -> WorkflowVerdict:
        return await self.run_activity(event_type, activity_type, payload or {})

    async def observe_activity(
        self,
        event_type: EventType,
        activity_type: str,
        payload: GovernedPayload | None = None,
    ) -> WorkflowVerdict:
        return await self.run_activity(
            event_type,
            activity_type,
            payload or {},
            observe_only=True,
        )

    async def open_activity(
        self,
        activity_type: str,
        payload: GovernedPayload | None = None,
    ) -> OpenActivityHandle:
        await self._ensure_activity_allowed()
        source_payload = dict(payload or {})
        activity_id = str(_pick_payload_field(source_payload, "activity_id") or uuid.uuid4())
        start_time = _coerce_int(_pick_payload_field(source_payload, "start_time"), _now_ms())
        self._activity_starts_ms[activity_id] = start_time
        self._in_flight.add(activity_id)
        try:
            verdict = await self.emit_with_span_hook(
                {
                    "event_type": ACTIVITY_STARTED_EVENT_TYPE,
                    "activity_id": activity_id,
                    "activity_type": activity_type,
                    "activity_input": _source_attributed_input(
                        source_payload.get("input"),
                        self.source,
                    ),
                    "start_time": start_time,
                    "spans": source_payload.get("spans"),
                    **_telemetry_fields(source_payload, self.multi_agent_session_id),
                }
            )
            verdict["activityId"] = activity_id
            verdict = await self._resolve_approval_if_needed(activity_id, activity_type, verdict)
            if verdict.get("arm") not in {"allow", "constrain"}:
                self._activity_starts_ms.pop(activity_id, None)
                self._activity_parents.discard(activity_id)

            async def complete_handle(
                completion_payload: GovernedPayload | None = None,
                completion_activity_type: str | None = None,
            ) -> WorkflowVerdict:
                next_payload = {**dict(completion_payload or {}), "activity_id": activity_id}
                next_payload.setdefault(
                    "hook_span_parent_event_type",
                    DEFAULT_HOOK_SPAN_PARENT_EVENT_TYPE,
                )
                return await self.run_activity(
                    cast(EventType, ACTIVITY_COMPLETED_EVENT_TYPE),
                    completion_activity_type or activity_type,
                    next_payload,
                )

            return OpenActivityHandle(
                activity_id=activity_id,
                verdict=verdict,
                complete=complete_handle,
            )
        finally:
            self._in_flight.discard(activity_id)

    async def run_activity(
        self,
        event_type: EventType,
        activity_type: str,
        payload: GovernedPayload | None = None,
        *,
        observe_only: bool = False,
    ) -> WorkflowVerdict:
        await self._ensure_activity_allowed()
        source_payload = dict(payload or {})
        activity_id = str(_pick_payload_field(source_payload, "activity_id") or uuid.uuid4())
        start_time = _coerce_int(_pick_payload_field(source_payload, "start_time"), _now_ms())
        self._in_flight.add(activity_id)
        try:
            if event_type == HANDOFF_EVENT_TYPE:
                return await self._standalone_event(
                    HANDOFF_EVENT_TYPE,
                    activity_id,
                    activity_type,
                    source_payload,
                )
            if event_type == SIGNAL_RECEIVED_EVENT_TYPE:
                return await self._standalone_event(
                    SIGNAL_RECEIVED_EVENT_TYPE,
                    activity_id,
                    activity_type,
                    source_payload,
                )
            if event_type == ACTIVITY_COMPLETED_EVENT_TYPE:
                return await self.emit_completed(
                    activity_id,
                    activity_type,
                    source_payload,
                    poll_approvals=not observe_only,
                )

            self._activity_starts_ms[activity_id] = start_time
            started = await self.emit_with_span_hook(
                {
                    "event_type": ACTIVITY_STARTED_EVENT_TYPE,
                    "activity_id": activity_id,
                    "activity_type": activity_type,
                    "activity_input": _source_attributed_input(
                        source_payload.get("input"),
                        self.source,
                    ),
                    "start_time": start_time,
                    "spans": source_payload.get("spans"),
                    **_telemetry_fields(source_payload, self.multi_agent_session_id),
                }
            )
            started["activityId"] = activity_id
            if observe_only:
                return started
            if started.get("arm") == "constrain":
                try:
                    await self.emit_completed(
                        activity_id,
                        activity_type,
                        {key: value for key, value in source_payload.items() if key != "spans"},
                    )
                except Exception:
                    pass
                return started
            if started.get("arm") != "allow":
                self._activity_starts_ms.pop(activity_id, None)
                if started.get("arm") == "require_approval":
                    return await self._resolve_approval_if_needed(
                        activity_id,
                        activity_type,
                        started,
                    )
                return started
            return await self.emit_completed(
                activity_id,
                activity_type,
                {key: value for key, value in source_payload.items() if key != "spans"},
            )
        finally:
            self._in_flight.discard(activity_id)

    async def _standalone_event(
        self,
        event_type: EventType,
        activity_id: str,
        activity_type: str,
        payload: JsonDict,
    ) -> WorkflowVerdict:
        event: JsonDict = {
            "event_type": event_type,
            "activity_id": activity_id,
            "activity_type": activity_type,
            "activity_input": _source_attributed_input(payload.get("input"), self.source),
            **_telemetry_fields(payload, self.multi_agent_session_id),
        }
        if event_type == SIGNAL_RECEIVED_EVENT_TYPE:
            event["signal_name"] = _pick_payload_field(payload, "signal_name")
            event["signal_args"] = _pick_payload_field(payload, "signal_args")
        verdict = await self.emit(event)
        verdict["activityId"] = activity_id
        return verdict

    async def emit_completed(
        self,
        activity_id: str,
        activity_type: str,
        payload: GovernedPayload | None = None,
        *,
        poll_approvals: bool = True,
    ) -> WorkflowVerdict:
        source_payload = dict(payload or {})
        start_time = _pick_payload_field(source_payload, "start_time")
        if start_time is None:
            start_time = self._activity_starts_ms.get(activity_id)
        end_time = _coerce_int(_pick_payload_field(source_payload, "end_time"), _now_ms())
        duration_ms = _pick_payload_field(source_payload, "duration_ms")
        if duration_ms is None and isinstance(start_time, int):
            duration_ms = max(0, end_time - start_time)
        completed = await self.emit_with_span_hook(
            {
                "event_type": ACTIVITY_COMPLETED_EVENT_TYPE,
                "activity_id": activity_id,
                "activity_type": activity_type,
                "status": _activity_completion_status(activity_type),
                "activity_input": _source_attributed_input(
                    source_payload.get("input"),
                    self.source,
                ),
                "activity_output": source_payload.get("output"),
                "start_time": start_time,
                "end_time": end_time,
                "duration_ms": duration_ms,
                "spans": source_payload.get("spans"),
                "hook_span_parent_event_type": _pick_payload_field(
                    source_payload,
                    "hook_span_parent_event_type",
                ),
                "ensure_hook_span_parent": _pick_payload_field(
                    source_payload,
                    "ensure_hook_span_parent",
                ),
                **_telemetry_fields(source_payload, self.multi_agent_session_id),
            }
        )
        self._activity_starts_ms.pop(activity_id, None)
        self._activity_parents.discard(activity_id)
        completed["activityId"] = activity_id
        if completed.get("arm") == "require_approval" and poll_approvals:
            return await self._resolve_approval_if_needed(activity_id, activity_type, completed)
        return completed

    async def emit_with_span_hook(self, event: Mapping[str, Any]) -> WorkflowVerdict:
        spans = event.get("spans")
        hook_parent_type = _pick_payload_field(event, "hook_span_parent_event_type")
        parent_event = _without_span_runtime_hints(event)
        hook_parent_event = (
            {**parent_event, "event_type": DEFAULT_HOOK_SPAN_PARENT_EVENT_TYPE}
            if hook_parent_type == DEFAULT_HOOK_SPAN_PARENT_EVENT_TYPE
            else parent_event
        )
        if hook_parent_type == DEFAULT_HOOK_SPAN_PARENT_EVENT_TYPE:
            for key in ("status", "activity_output", "end_time", "duration_ms"):
                hook_parent_event.pop(key, None)
        has_activity_spans = (
            event.get("event_type") == DEFAULT_HOOK_SPAN_PARENT_EVENT_TYPE
            or hook_parent_type == DEFAULT_HOOK_SPAN_PARENT_EVENT_TYPE
        ) and isinstance(spans, list)
        persistable_spans = (
            [span for span in spans or [] if _is_persistable_hook_span(span)]
            if has_activity_spans
            else []
        )
        if (
            persistable_spans
            and hook_parent_event.get("event_type") == DEFAULT_HOOK_SPAN_PARENT_EVENT_TYPE
            and _pick_payload_field(event, "ensure_hook_span_parent") is True
            and isinstance(event.get("activity_id"), str)
            and event["activity_id"] not in self._activity_parents
        ):
            await self.emit(_without_span_runtime_hints(hook_parent_event))
            self._activity_parents.add(event["activity_id"])
        parent_verdict = await self.emit(parent_event)
        if parent_event.get("event_type") == DEFAULT_HOOK_SPAN_PARENT_EVENT_TYPE and isinstance(
            event.get("activity_id"), str
        ):
            self._activity_parents.add(event["activity_id"])
        if not persistable_spans:
            return parent_verdict
        hook_verdict = parent_verdict
        for span in persistable_spans:
            hook_span = _with_span_hook_context(span, event)
            attempt = _pick(event, "attempt")
            next_verdict = await self.emit(
                {
                    **hook_parent_event,
                    "attempt": attempt if attempt is not None else 1,
                    "hook_trigger": True,
                    "spans": [hook_span],
                }
            )
            hook_verdict = _stricter_verdict(hook_verdict, next_verdict)
        if parent_verdict.get("arm") not in {"allow", "constrain"}:
            return parent_verdict
        return hook_verdict

    async def emit(self, event: Mapping[str, Any]) -> WorkflowVerdict:
        payload = {
            **dict(event),
            "source": WORKFLOW_EVENT_SOURCE,
            "workflow_id": self.workflow_id,
            "run_id": self.run_id,
            "workflow_type": self.workflow_type,
            "task_queue": self.task_queue,
            "multi_agent_session_id": event.get("multi_agent_session_id")
            or self.multi_agent_session_id,
            "timestamp": _timestamp(),
            "hook_trigger": bool(event.get("hook_trigger", False)),
        }
        spans = payload.get("spans")
        if spans is None:
            payload.pop("spans", None)
        if isinstance(spans, list):
            payload["span_count"] = len(spans)
        else:
            payload.pop("span_count", None)
        response = await maybe_await(self.core.evaluate(payload))
        return map_verdict(response)

    async def poll_approval(
        self,
        activity_id: str,
        activity_type: str,
        initial: WorkflowVerdict,
    ) -> WorkflowVerdict:
        approval_id = str(initial.get("approvalId") or activity_id)
        external_signaled = False
        external_task: asyncio.Task[str | None] | None = None
        if self.await_external_decision is not None:
            external_task = asyncio.create_task(
                _await_external_decision(
                    self.await_external_decision,
                    {
                        "approvalId": approval_id,
                        "governanceEventId": initial.get("governanceEventId"),
                        "activityId": activity_id,
                        "activityType": activity_type,
                        "expiresAt": initial.get("approvalExpiresAt"),
                        "source": self.source,
                    },
                )
            )
        interval = self.approval_poll_interval_seconds
        try:
            while True:
                sleep_seconds = max(
                    0.0, _apply_jitter(interval, self.approval_poll_jitter)
                )
                if external_task is not None and not external_task.done():
                    done, _pending = await asyncio.wait(
                        {external_task},
                        timeout=sleep_seconds,
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                    external_signaled = bool(done)
                else:
                    await self._sleep(sleep_seconds)
                try:
                    status = await maybe_await(
                        self.core.poll_approval(
                            {
                                "workflow_id": self.workflow_id,
                                "run_id": self.run_id,
                                "activity_id": activity_id,
                            }
                        )
                    )
                except Exception:
                    interval = self._next_poll_interval(interval, external_signaled)
                    continue
                if bool(_pick(status, "expired")):
                    return _expired_verdict(initial, activity_type, status)
                arm = normalize_arm(_pick_alias(status, APPROVAL_STATUS_FIELD_ALIASES["arm"]))
                if arm in {"allow", "block", "halt"}:
                    return {
                        **initial,
                        "arm": arm,
                        "approvalExpiresAt": _pick_alias(
                            status,
                            APPROVAL_STATUS_FIELD_ALIASES["approvalExpiresAt"],
                        ),
                        "reason": _pick_alias(status, APPROVAL_STATUS_FIELD_ALIASES["reason"]),
                    }
                interval = self._next_poll_interval(interval, external_signaled)
        finally:
            if external_task is not None and not external_task.done():
                external_task.cancel()

    async def _resolve_approval_if_needed(
        self,
        activity_id: str,
        activity_type: str,
        verdict: WorkflowVerdict,
    ) -> WorkflowVerdict:
        if verdict.get("arm") != "require_approval":
            return verdict
        approval_id = str(verdict.get("approvalId") or activity_id)
        await _swallow_hook(
            self.on_pending_approval,
            {
                "approvalId": approval_id,
                "governanceEventId": verdict.get("governanceEventId"),
                "activityId": activity_id,
                "activityType": activity_type,
                "expiresAt": verdict.get("approvalExpiresAt"),
                "reason": verdict.get("reason"),
                "source": self.source,
            },
        )
        if self.inline_approval:
            return verdict
        resolved = await self.poll_approval(activity_id, activity_type, verdict)
        resolved["activityId"] = activity_id
        await _swallow_hook(
            self.on_approval_resolved,
            {
                "approvalId": approval_id,
                "activityId": activity_id,
                "activityType": activity_type,
                "arm": resolved.get("arm"),
                "source": self.source,
            },
        )
        return resolved

    async def _ensure_activity_allowed(self) -> None:
        if self._finalized:
            raise SessionAlreadyTerminatedError()
        if not self._opened and not self.auto_open_suppressed:
            await self.workflow_started()

    def _next_poll_interval(self, current: float, external_signaled: bool) -> float:
        if external_signaled:
            return self.approval_poll_interval_seconds
        return min(
            current * self.approval_poll_backoff_factor,
            self.approval_poll_max_interval_seconds,
        )


def map_verdict(response: Any) -> WorkflowVerdict:
    raw = dict(response or {}) if isinstance(response, Mapping) else {}
    guardrails = _map_guardrails_result(_pick_alias(raw, GUARDRAILS_RESULT_RESPONSE_ALIASES))
    guardrails_failed = isinstance(guardrails, dict) and guardrails.get("validationPassed") is False
    wire_arm = normalize_arm(_pick_alias(raw, WORKFLOW_VERDICT_FIELD_ALIASES["arm"]) or "allow")
    arm = (
        wire_arm if wire_arm in {"halt", "block"} else ("block" if guardrails_failed else wire_arm)
    )
    reason = _pick_alias(raw, WORKFLOW_VERDICT_FIELD_ALIASES["reason"])
    return {
        "arm": arm,
        "approvalId": _pick_alias(raw, WORKFLOW_VERDICT_FIELD_ALIASES["approvalId"]),
        "governanceEventId": _pick_alias(
            raw,
            WORKFLOW_VERDICT_FIELD_ALIASES["governanceEventId"],
        ),
        "approvalExpiresAt": _pick_alias(
            raw,
            WORKFLOW_VERDICT_FIELD_ALIASES["approvalExpiresAt"],
        ),
        "reason": reason
        if reason is not None
        else (_guardrail_failure_reason(guardrails) if guardrails_failed else None),
        "riskScore": _pick_alias(raw, WORKFLOW_VERDICT_FIELD_ALIASES["riskScore"]) or 0,
        "trustTier": _pick_alias(raw, WORKFLOW_VERDICT_FIELD_ALIASES["trustTier"]),
        "alignmentScore": _pick_alias(raw, WORKFLOW_VERDICT_FIELD_ALIASES["alignmentScore"]),
        "policyId": _pick_alias(raw, WORKFLOW_VERDICT_FIELD_ALIASES["policyId"]),
        "behavioralViolations": _pick_alias(
            raw,
            WORKFLOW_VERDICT_FIELD_ALIASES["behavioralViolations"],
        ),
        "constraints": raw.get("constraints"),
        "metadata": raw.get("metadata"),
        "fallbackUsed": _pick_alias(raw, WORKFLOW_VERDICT_FIELD_ALIASES["fallbackUsed"]),
        "guardrailsResult": guardrails,
        "ageResult": _pick_alias(raw, WORKFLOW_VERDICT_FIELD_ALIASES["ageResult"]),
    }


def normalize_arm(value: Any) -> VerdictArm:
    if isinstance(value, int):
        if value == 1:
            return "constrain"
        if value == 2:
            return "require_approval"
        if value == 3:
            return "block"
        if value == 4:
            return "halt"
        return "allow"
    normalized = str(value or "allow").strip().lower().replace("-", "_")
    if normalized in {"approve", "approved", "allow", "allowed", "continue"}:
        return "allow"
    if normalized in {"reject", "rejected", "deny", "denied", "block", "blocked"}:
        return "block"
    if normalized in {"halt", "stopped", "stop"}:
        return "halt"
    if normalized in {
        "require_approval",
        "requires_approval",
        "request_approval",
        "pending",
        "ask",
    }:
        return "require_approval"
    if normalized == "constrain":
        return "constrain"
    return "allow"


async def _await_external_decision(
    hook: ExternalDecisionHook,
    info: Mapping[str, Any],
) -> str | None:
    decision = await maybe_await(hook(info))
    return decision if decision in {"approve", "reject"} else None


async def _swallow_hook(hook: ApprovalHook | None, info: Mapping[str, Any]) -> None:
    if hook is None:
        return
    try:
        await maybe_await(hook(info))
    except Exception:
        return


def _telemetry_fields(
    payload: Mapping[str, Any], default_multi_agent_session_id: str | None
) -> JsonDict:
    fields: JsonDict = {}
    for target, names in TELEMETRY_FIELD_ALIASES.items():
        for name in names:
            if name in payload and payload[name] is not None:
                fields[target] = payload[name]
                break
    if "multi_agent_session_id" not in fields and default_multi_agent_session_id:
        fields["multi_agent_session_id"] = default_multi_agent_session_id
    return fields


def _source_attributed_input(value: Any, source: str) -> list[Any]:
    if isinstance(value, list):
        items = value or [{}]
    elif value is None:
        items = [{}]
    else:
        items = [value]
    return [_stamp_source(item, source) for item in items]


def _stamp_source(value: Any, source: str) -> Any:
    if isinstance(value, Mapping):
        record = dict(value)
        record[SOURCE_INPUT_KEY] = str(record.get(SOURCE_INPUT_KEY) or source)
        return record
    return {SOURCE_INPUT_KEY: source, "value": value}


def _pick(source: Any, *keys: str) -> Any:
    if not isinstance(source, Mapping):
        return None
    for key in keys:
        if key in source and source[key] is not None:
            return source[key]
    return None


def _pick_alias(source: Any, aliases: list[str]) -> Any:
    return _pick(source, *aliases)


def _pick_payload_field(source: Any, field: str) -> Any:
    return _pick_alias(source, GOVERNED_PAYLOAD_FIELD_ALIASES[field])


def _expired_verdict(initial: WorkflowVerdict, activity_type: str, status: Any) -> WorkflowVerdict:
    return {
        **initial,
        "arm": "block",
        "approvalExpiresAt": _pick_alias(
            status,
            APPROVAL_STATUS_FIELD_ALIASES["approvalExpiresAt"],
        ),
        "reason": _pick_alias(status, APPROVAL_STATUS_FIELD_ALIASES["reason"])
        or f"Approval expired for {activity_type}",
    }


def _map_guardrails_result(raw: Any) -> JsonDict | None:
    if not isinstance(raw, Mapping):
        return None
    if len(raw) == 0:
        return None
    validation_passed = (
        _pick_alias(raw, GUARDRAILS_RESULT_FIELD_ALIASES["validationPassed"])
        if any(key in raw for key in GUARDRAILS_RESULT_FIELD_ALIASES["validationPassed"])
        else None
    )
    return {
        "inputType": _normalize_guardrails_input_type(
            _pick_alias(raw, GUARDRAILS_RESULT_FIELD_ALIASES["inputType"])
        ),
        "redactedInput": _pick_alias(raw, GUARDRAILS_RESULT_FIELD_ALIASES["redactedInput"]),
        "redactedOutput": _pick_alias(raw, GUARDRAILS_RESULT_FIELD_ALIASES["redactedOutput"]),
        "validationPassed": validation_passed is not False,
        "rawLogs": _pick_alias(raw, GUARDRAILS_RESULT_FIELD_ALIASES["rawLogs"]),
        "reasons": [
            {
                "type": str(reason.get("type") or ""),
                "field": reason.get("field"),
                "reason": str(reason.get("reason") or ""),
            }
            for reason in _pick_alias(raw, GUARDRAILS_RESULT_FIELD_ALIASES["reasons"]) or []
            if isinstance(reason, Mapping)
        ],
        "fieldResults": _map_guardrail_field_results(raw),
    }


def _guardrail_failure_reason(result: JsonDict | None) -> str:
    if result is None:
        return "Guardrails validation failed"
    reasons = result.get("reasons")
    cleaned_reasons: list[str] = []
    if isinstance(reasons, list):
        for reason in reasons:
            if isinstance(reason, Mapping) and isinstance(reason.get("reason"), str):
                cleaned = _clean_guardrail_reason(reason["reason"])
                if cleaned:
                    cleaned_reasons.append(cleaned)
    if cleaned_reasons:
        if result.get("inputType") == GUARDRAIL_OUTPUT_TYPE:
            return "; ".join(cleaned_reasons)
        return cleaned_reasons[0]
    if result.get("inputType") == GUARDRAIL_OUTPUT_TYPE:
        return "Guardrails output validation failed"
    return "Guardrails validation failed"


def _clean_guardrail_reason(reason: str) -> str:
    without_question = re.sub(r"\n?-\s*Question:\s*\[Session context\][^\n]*\n?", "", reason)
    markers = ["\n\nThought:", "\n\nThought", "\nThought:", "\nThought"]
    for marker in markers:
        index = without_question.find(marker)
        if index >= 0:
            return without_question[:index].rstrip()
    return without_question.rstrip()


def _stricter_verdict(current: WorkflowVerdict, candidate: WorkflowVerdict) -> WorkflowVerdict:
    current_rank = _TERMINAL_RANK.get(str(current.get("arm")), 0)
    candidate_rank = _TERMINAL_RANK.get(str(candidate.get("arm")), 0)
    return candidate if candidate_rank > current_rank else current


def _map_guardrail_field_results(raw: Mapping[str, Any]) -> list[JsonDict]:
    direct = _pick_alias(raw, GUARDRAILS_RESULT_FIELD_ALIASES["fieldResults"])
    mapped: list[JsonDict] = []
    if isinstance(direct, list):
        mapped.extend(
            _map_guardrail_field_result(item)
            for item in direct
            if isinstance(item, Mapping)
        )
    nested = raw.get("results")
    if not isinstance(nested, list):
        return mapped
    for group in nested:
        if not isinstance(group, Mapping) or not isinstance(group.get("results"), list):
            continue
        for field_result in group["results"]:
            if not isinstance(field_result, Mapping):
                continue
            mapped.append(_map_guardrail_field_result(field_result, group))
    return mapped


def _map_guardrail_field_result(
    field_result: Mapping[str, Any], group: Mapping[str, Any] | None = None
) -> JsonDict:
    mapped: JsonDict = {
        "field": str(
            _pick_alias(field_result, GUARDRAIL_FIELD_RESULT_FIELD_ALIASES["field"]) or ""
        ),
        "status": _normalize_guardrail_field_status(
            _pick_alias(field_result, GUARDRAIL_FIELD_RESULT_FIELD_ALIASES["status"])
        ),
        "reason": _pick_alias(field_result, GUARDRAIL_FIELD_RESULT_FIELD_ALIASES["reason"]),
    }
    guardrail_type = (
        _pick_alias(field_result, GUARDRAIL_FIELD_RESULT_FIELD_ALIASES["guardrailType"])
        or (
            _pick_alias(group, GUARDRAILS_RESULT_GROUP_FIELD_ALIASES["guardrailType"])
            if group
            else None
        )
    )
    if isinstance(guardrail_type, str) and guardrail_type:
        mapped["guardrailType"] = guardrail_type
    order = _pick_alias(field_result, GUARDRAIL_FIELD_RESULT_FIELD_ALIASES["order"])
    if isinstance(order, int) and not isinstance(order, bool):
        mapped["order"] = order
    return mapped


def _normalize_guardrails_input_type(value: Any) -> str:
    normalized = str(value or "").strip()
    if normalized in GUARDRAIL_INPUT_TYPES:
        return normalized
    return str(DEFAULT_GUARDRAIL_INPUT_TYPE)


def _normalize_guardrail_field_status(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"allowed", "allow"}:
        return "allowed"
    if normalized in {"blocked", "block"}:
        return "blocked"
    if normalized in GUARDRAIL_FIELD_STATUSES:
        return normalized
    return str(DEFAULT_GUARDRAIL_FIELD_STATUS)


def _is_persistable_hook_span(span: Any) -> bool:
    if not isinstance(span, Mapping):
        return False
    if _has_non_empty_string(span, *SPAN_PERSISTABLE_ROOT_STRING_FIELDS):
        return True
    raw_attributes = span.get("attributes")
    attributes: Mapping[str, Any] = raw_attributes if isinstance(raw_attributes, Mapping) else {}
    return any(
        isinstance(attributes.get(attribute), str)
        for attribute in SPAN_PERSISTABLE_ATTRIBUTE_FIELDS
    )


def _without_span_runtime_hints(event: Mapping[str, Any]) -> JsonDict:
    result = dict(event)
    for key in ("spans", *SPAN_RUNTIME_HINT_FIELDS):
        result.pop(key, None)
    return result


def _with_span_hook_context(span: Any, event: Mapping[str, Any]) -> Any:
    if not isinstance(span, Mapping):
        return span
    result = _normalize_hook_span_aliases(span)
    activity_id = event.get("activity_id")
    if isinstance(activity_id, str) and not str(result.get("activity_id") or "").strip():
        result["activity_id"] = activity_id
    if not _has_useful_span_duration(result):
        start_time = _to_span_timestamp_ns(event.get("start_time"))
        end_time = _to_span_timestamp_ns(event.get("end_time"))
        duration_ns = _duration_ms_to_ns(event.get("duration_ms"))
        if duration_ns is None and start_time is not None and end_time is not None:
            duration_ns = max(0, end_time - start_time)
        if start_time is not None:
            result["start_time"] = start_time
        if event.get("event_type") == DEFAULT_HOOK_SPAN_PARENT_EVENT_TYPE:
            result["end_time"] = None
            result["duration_ns"] = None
        elif event.get("event_type") == ACTIVITY_COMPLETED_EVENT_TYPE:
            if end_time is not None:
                result["end_time"] = end_time
            if duration_ns is not None:
                result["duration_ns"] = duration_ns
    return result


def _normalize_hook_span_aliases(span: Mapping[str, Any]) -> JsonDict:
    raw_attributes = span.get("attributes")
    attributes = dict(raw_attributes) if isinstance(raw_attributes, Mapping) else None
    if (
        attributes is not None
        and not isinstance(attributes.get("http.url"), str)
        and isinstance(attributes.get("url.full"), str)
    ):
        attributes["http.url"] = attributes["url.full"]
    result = dict(span)
    if attributes is not None:
        result["attributes"] = attributes
    for snake, camel in SPAN_ALIAS_FIELDS:
        if snake not in result and camel in result:
            result[snake] = result[camel]
    if "events" in result:
        result["events"] = _normalize_hook_span_events(result["events"])
    if "status" in result:
        status = _normalize_hook_span_status(result["status"])
        if status is None:
            result.pop("status", None)
        else:
            result["status"] = status
    _normalize_hook_span_header_field(result, "request_headers")
    _normalize_hook_span_header_field(result, "response_headers")
    return result


def _normalize_hook_span_events(events: Any) -> list[JsonDict]:
    if not isinstance(events, list):
        return []
    normalized: list[JsonDict] = []
    for event in events:
        record = _plain_record(event)
        timestamp = record.get("timestamp")
        normalized.append(
            {
                "attributes": _plain_record(record.get("attributes")),
                "name": record["name"] if isinstance(record.get("name"), str) else "",
                "timestamp": timestamp
                if isinstance(timestamp, (int, float)) and math.isfinite(timestamp)
                else 0,
            }
        )
    return normalized


def _normalize_hook_span_status(status: Any) -> JsonDict | None:
    record = _plain_record(status)
    code = record.get("code") if isinstance(record.get("code"), str) else None
    raw_description = record.get("description")
    has_description = isinstance(raw_description, str) or (
        "description" in record and raw_description is None
    )
    if not code and not has_description:
        return None
    return {
        **({"code": code} if code else {}),
        **({"description": raw_description} if has_description else {}),
    }


def _normalize_hook_span_header_field(
    record: JsonDict,
    key: Literal["request_headers", "response_headers"],
) -> None:
    if key not in record:
        return
    value = record[key]
    if value is None:
        return
    headers = _string_record(value)
    if headers:
        record[key] = headers
    else:
        record.pop(key, None)


def _string_record(value: Any) -> dict[str, str] | None:
    record = _plain_record(value)
    entries = {key: entry for key, entry in record.items() if isinstance(entry, str)}
    return entries or None


def _plain_record(value: Any) -> JsonDict:
    if not isinstance(value, Mapping):
        return {}
    return dict(value)


def _has_non_empty_string(source: Mapping[str, Any], *keys: str) -> bool:
    return any(isinstance(source.get(key), str) and source[key].strip() for key in keys)


def _has_useful_span_duration(span: Mapping[str, Any]) -> bool:
    duration = span.get("duration_ns")
    return isinstance(duration, (int, float)) and math.isfinite(duration) and duration > 0


def _to_span_timestamp_ns(value: Any) -> int | None:
    if not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    if value >= 1_000_000_000_000_000:
        return int(value)
    return int(value * 1_000_000)


def _duration_ms_to_ns(value: Any) -> int | None:
    if not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return max(0, int(value * 1_000_000))


def _activity_completion_status(activity_type: str) -> str:
    return (
        "failed"
        if re.search(
            r"(error|fail|failed|failure|timeout|timedout|cancel|abort)", activity_type, re.I
        )
        else "completed"
    )


def _apply_jitter(interval: float, jitter: float) -> float:
    if jitter <= 0:
        return interval
    spread = interval * jitter
    return max(0.0, interval + random.uniform(-spread, spread))


def _now_ms() -> int:
    return int(time.time() * 1000)


def _timestamp() -> str:
    return utc_now().isoformat().replace("+00:00", "Z")


def _coerce_int(value: Any, fallback: int) -> int:
    return value if isinstance(value, int) else fallback


def _error_info(error: object | None) -> JsonDict | None:
    if error is None:
        return None
    return {"name": type(error).__name__, "message": str(error)}
