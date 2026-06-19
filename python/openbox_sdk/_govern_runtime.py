from __future__ import annotations

import asyncio
import random
import re
import time
import uuid
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any, Literal, TypeAlias, TypeVar

from ._utils import maybe_await, parse_datetime, utc_now

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

_TERMINAL_RANK: dict[str, int] = {
    "allow": 0,
    "constrain": 1,
    "require_approval": 2,
    "block": 3,
    "halt": 4,
}


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
        await self.emit({"event_type": "WorkflowStarted"})

    async def begin(self) -> None:
        await self.workflow_started()

    async def workflow_completed(self) -> WorkflowVerdict | None:
        if self._finalized:
            return None
        self._finalized = True
        return await self.emit({"event_type": "WorkflowCompleted", "status": "completed"})

    async def complete(self) -> WorkflowVerdict | None:
        return await self.workflow_completed()

    async def workflow_failed(self, error: object | None = None) -> WorkflowVerdict | None:
        if self._finalized:
            return None
        self._finalized = True
        return await self.emit(
            {
                "event_type": "WorkflowFailed",
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
        activity_id = str(source_payload.get("activity_id") or uuid.uuid4())
        start_time = _coerce_int(source_payload.get("start_time"), _now_ms())
        self._activity_starts_ms[activity_id] = start_time
        self._in_flight.add(activity_id)
        try:
            verdict = await self.emit_with_span_hook(
                {
                    "event_type": "ActivityStarted",
                    "activity_id": activity_id,
                    "activity_type": activity_type,
                    "activity_input": source_payload.get("input"),
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
                next_payload.setdefault("hook_span_parent_event_type", "ActivityStarted")
                return await self.run_activity(
                    "ActivityCompleted",
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
        activity_id = str(source_payload.get("activity_id") or uuid.uuid4())
        start_time = _coerce_int(source_payload.get("start_time"), _now_ms())
        self._in_flight.add(activity_id)
        try:
            if event_type == "Handoff":
                return await self._standalone_event(
                    "Handoff",
                    activity_id,
                    activity_type,
                    source_payload,
                )
            if event_type == "SignalReceived":
                return await self._standalone_event(
                    "SignalReceived",
                    activity_id,
                    activity_type,
                    source_payload,
                )
            if event_type == "ActivityCompleted":
                return await self.emit_completed(
                    activity_id,
                    activity_type,
                    source_payload,
                    poll_approvals=not observe_only,
                )

            self._activity_starts_ms[activity_id] = start_time
            started = await self.emit_with_span_hook(
                {
                    "event_type": "ActivityStarted",
                    "activity_id": activity_id,
                    "activity_type": activity_type,
                    "activity_input": source_payload.get("input"),
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
            "activity_input": payload.get("input"),
            **_telemetry_fields(payload, self.multi_agent_session_id),
        }
        if event_type == "SignalReceived":
            event["signal_name"] = payload.get("signal_name") or payload.get("signalName")
            event["signal_args"] = payload.get("signal_args") or payload.get("signalArgs")
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
        start_time = source_payload.get("start_time") or self._activity_starts_ms.get(activity_id)
        end_time = _coerce_int(source_payload.get("end_time"), _now_ms())
        duration_ms = source_payload.get("duration_ms")
        if duration_ms is None and isinstance(start_time, int):
            duration_ms = max(0, end_time - start_time)
        completed = await self.emit_with_span_hook(
            {
                "event_type": "ActivityCompleted",
                "activity_id": activity_id,
                "activity_type": activity_type,
                "status": _activity_completion_status(activity_type),
                "activity_input": source_payload.get("input"),
                "activity_output": source_payload.get("output"),
                "start_time": start_time,
                "end_time": end_time,
                "duration_ms": duration_ms,
                "spans": source_payload.get("spans"),
                "hook_span_parent_event_type": source_payload.get("hook_span_parent_event_type")
                or source_payload.get("hookSpanParentEventType"),
                "ensure_hook_span_parent": source_payload.get("ensure_hook_span_parent")
                or source_payload.get("ensureHookSpanParent"),
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
        hook_parent_type = event.get("hook_span_parent_event_type") or event.get(
            "hookSpanParentEventType"
        )
        parent_event = _without_span_runtime_hints(event)
        hook_parent_event = (
            {**parent_event, "event_type": "ActivityStarted"}
            if hook_parent_type == "ActivityStarted"
            else parent_event
        )
        if hook_parent_type == "ActivityStarted":
            for key in ("status", "activity_output", "end_time", "duration_ms"):
                hook_parent_event.pop(key, None)
        has_activity_spans = (
            event.get("event_type") == "ActivityStarted" or hook_parent_type == "ActivityStarted"
        ) and isinstance(spans, list)
        persistable_spans = (
            [span for span in spans or [] if _is_persistable_hook_span(span)]
            if has_activity_spans
            else []
        )
        if (
            persistable_spans
            and hook_parent_event.get("event_type") == "ActivityStarted"
            and event.get("ensure_hook_span_parent") is True
            and isinstance(event.get("activity_id"), str)
            and event["activity_id"] not in self._activity_parents
        ):
            await self.emit(_without_span_runtime_hints(hook_parent_event))
            self._activity_parents.add(event["activity_id"])
        parent_verdict = await self.emit(parent_event)
        if parent_event.get("event_type") == "ActivityStarted" and isinstance(
            event.get("activity_id"), str
        ):
            self._activity_parents.add(event["activity_id"])
        if not persistable_spans:
            return parent_verdict
        hook_verdict = parent_verdict
        for span in persistable_spans:
            hook_span = _with_span_hook_context(span, event)
            next_verdict = await self.emit(
                {
                    **hook_parent_event,
                    "attempt": event.get("attempt") or 1,
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
            "source": "workflow-telemetry",
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
        deadline = _approval_deadline(initial.get("approvalExpiresAt"))
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
                    },
                )
            )
        interval = self.approval_poll_interval_seconds
        try:
            while time.time() < deadline:
                remaining = deadline - time.time()
                sleep_seconds = max(
                    0.0, min(_apply_jitter(interval, self.approval_poll_jitter), remaining)
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
                status_deadline = _approval_deadline(
                    _pick(status, "approval_expiration_time", "approvalExpiresAt")
                )
                if status_deadline != float("inf"):
                    deadline = min(deadline, status_deadline)
                if bool(_pick(status, "expired")) or time.time() >= deadline:
                    return _expired_verdict(initial, activity_type, status)
                arm = normalize_arm(_pick(status, "verdict", "action"))
                if arm in {"allow", "block", "halt"}:
                    return {
                        **initial,
                        "arm": arm,
                        "approvalExpiresAt": _pick(status, "approval_expiration_time"),
                        "reason": _pick(status, "reason"),
                    }
                interval = self._next_poll_interval(interval, external_signaled)
            return {
                **initial,
                "arm": "block",
                "reason": initial.get("reason") or f"Approval expired for {activity_type}",
            }
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
    guardrails = _map_guardrails_result(raw.get("guardrails_result") or raw.get("guardrailsResult"))
    guardrails_failed = isinstance(guardrails, dict) and guardrails.get("validationPassed") is False
    wire_arm = normalize_arm(raw.get("verdict") or raw.get("action") or "allow")
    arm = (
        wire_arm if wire_arm in {"halt", "block"} else ("block" if guardrails_failed else wire_arm)
    )
    return {
        "arm": arm,
        "approvalId": raw.get("approval_id") or raw.get("approvalId"),
        "governanceEventId": raw.get("governance_event_id") or raw.get("governanceEventId"),
        "approvalExpiresAt": raw.get("approval_expiration_time") or raw.get("approvalExpiresAt"),
        "reason": raw.get("reason")
        or (_guardrail_failure_reason(guardrails) if guardrails_failed else None),
        "riskScore": raw.get("risk_score") or raw.get("riskScore") or 0,
        "trustTier": raw.get("trust_tier") or raw.get("trustTier"),
        "alignmentScore": raw.get("alignment_score") or raw.get("alignmentScore"),
        "policyId": raw.get("policy_id") or raw.get("policyId"),
        "behavioralViolations": raw.get("behavioral_violations") or raw.get("behavioralViolations"),
        "constraints": raw.get("constraints"),
        "metadata": raw.get("metadata"),
        "fallbackUsed": raw.get("fallback_used") or raw.get("fallbackUsed"),
        "guardrailsResult": guardrails,
        "ageResult": raw.get("age_result") or raw.get("ageResult"),
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
    aliases = {
        "session_id": ("session_id", "sessionId"),
        "llm_model": ("llm_model", "llmModel"),
        "input_tokens": ("input_tokens", "inputTokens"),
        "output_tokens": ("output_tokens", "outputTokens"),
        "total_tokens": ("total_tokens", "totalTokens"),
        "has_tool_calls": ("has_tool_calls", "hasToolCalls"),
        "finish_reason": ("finish_reason", "finishReason"),
        "prompt": ("prompt",),
        "completion": ("completion",),
        "tool_name": ("tool_name", "toolName"),
        "tool_type": ("tool_type", "toolType"),
        "parent_run_id": ("parent_run_id", "parentRunId"),
        "multi_agent_session_id": ("multi_agent_session_id", "multiAgentSessionId"),
        "from_agent_did": ("from_agent_did", "fromAgentDid"),
    }
    fields: JsonDict = {}
    for target, names in aliases.items():
        for name in names:
            if name in payload and payload[name] is not None:
                fields[target] = payload[name]
                break
    if "multi_agent_session_id" not in fields and default_multi_agent_session_id:
        fields["multi_agent_session_id"] = default_multi_agent_session_id
    return fields


def _pick(source: Any, *keys: str) -> Any:
    if not isinstance(source, Mapping):
        return None
    for key in keys:
        if key in source:
            return source[key]
    return None


def _approval_deadline(value: Any) -> float:
    parsed = parse_datetime(value)
    if parsed is None:
        return float("inf")
    return parsed.timestamp()


def _expired_verdict(initial: WorkflowVerdict, activity_type: str, status: Any) -> WorkflowVerdict:
    return {
        **initial,
        "arm": "block",
        "approvalExpiresAt": _pick(status, "approval_expiration_time", "approvalExpiresAt"),
        "reason": _pick(status, "reason") or f"Approval expired for {activity_type}",
    }


def _map_guardrails_result(raw: Any) -> JsonDict | None:
    if not isinstance(raw, Mapping):
        return None
    if len(raw) == 0:
        return None
    validation_passed = (
        raw.get("validation_passed") if "validation_passed" in raw else raw.get("validationPassed")
    )
    return {
        "inputType": raw.get("input_type") or raw.get("inputType") or "activity_input",
        "redactedInput": raw.get("redacted_input") or raw.get("redactedInput"),
        "redactedOutput": raw.get("redacted_output") or raw.get("redactedOutput"),
        "validationPassed": validation_passed is not False,
        "rawLogs": raw.get("raw_logs") or raw.get("rawLogs"),
        "reasons": [
            {
                "type": str(reason.get("type") or ""),
                "field": reason.get("field"),
                "reason": str(reason.get("reason") or ""),
            }
            for reason in raw.get("reasons") or []
            if isinstance(reason, Mapping)
        ],
        "fieldResults": _map_guardrail_field_results(raw),
    }


def _guardrail_failure_reason(result: JsonDict | None) -> str:
    if result is None:
        return "Guardrails validation failed"
    reasons = result.get("reasons")
    if isinstance(reasons, list):
        for reason in reasons:
            if isinstance(reason, Mapping) and isinstance(reason.get("reason"), str):
                cleaned = _clean_guardrail_reason(reason["reason"])
                if cleaned:
                    return cleaned
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
    direct = raw.get("field_results") or raw.get("fieldResults")
    if isinstance(direct, list):
        return [dict(item) for item in direct if isinstance(item, Mapping)]
    nested = raw.get("results")
    if not isinstance(nested, list):
        return []
    mapped: list[JsonDict] = []
    for group in nested:
        if not isinstance(group, Mapping) or not isinstance(group.get("results"), list):
            continue
        for field_result in group["results"]:
            if not isinstance(field_result, Mapping):
                continue
            mapped.append(
                {
                    "field": str(field_result.get("field") or ""),
                    "status": _normalize_guardrail_field_status(field_result.get("status")),
                    "reason": field_result.get("reason"),
                }
            )
    return mapped


def _normalize_guardrail_field_status(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"allowed", "allow"}:
        return "allowed"
    if normalized in {"blocked", "block"}:
        return "blocked"
    if normalized == "redacted":
        return "redacted"
    if normalized == "transformed":
        return "transformed"
    return "skipped"


def _is_persistable_hook_span(span: Any) -> bool:
    if not isinstance(span, Mapping):
        return False
    if _has_non_empty_string(span, "semantic_type", "semanticType"):
        return True
    if _has_non_empty_string(span, "hook_type", "hookType"):
        return True
    raw_attributes = span.get("attributes")
    attributes: Mapping[str, Any] = raw_attributes if isinstance(raw_attributes, Mapping) else {}
    return (
        _has_non_empty_string(span, "http_url", "httpUrl")
        or _has_non_empty_string(span, "http_method", "httpMethod")
        or _has_non_empty_string(span, "file_path", "filePath")
        or _has_non_empty_string(span, "file_operation", "fileOperation")
        or _has_non_empty_string(span, "db_statement", "dbStatement")
        or _has_non_empty_string(span, "db_operation", "dbOperation")
        or _has_non_empty_string(span, "db_system", "dbSystem")
        or isinstance(attributes.get("url.full"), str)
        or isinstance(attributes.get("http.url"), str)
        or isinstance(attributes.get("http.method"), str)
        or isinstance(attributes.get("file.path"), str)
        or isinstance(attributes.get("file.operation"), str)
        or isinstance(attributes.get("db.statement"), str)
        or isinstance(attributes.get("db.operation"), str)
        or isinstance(attributes.get("db.system"), str)
        or isinstance(attributes.get("shell.command"), str)
        or isinstance(attributes.get("mcp.method"), str)
        or isinstance(attributes.get("openbox.tool.name"), str)
        or isinstance(attributes.get("tool.name"), str)
        or isinstance(attributes.get("tool_name"), str)
        or isinstance(attributes.get("gen_ai.system"), str)
    )


def _without_span_runtime_hints(event: Mapping[str, Any]) -> JsonDict:
    result = dict(event)
    for key in (
        "spans",
        "hook_span_parent_event_type",
        "hookSpanParentEventType",
        "ensure_hook_span_parent",
        "ensureHookSpanParent",
    ):
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
        if event.get("event_type") == "ActivityStarted":
            result["end_time"] = None
            result["duration_ns"] = None
        elif event.get("event_type") == "ActivityCompleted":
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
    for snake, camel in (
        ("span_id", "spanId"),
        ("trace_id", "traceId"),
        ("parent_span_id", "parentSpanId"),
        ("start_time", "startTime"),
        ("end_time", "endTime"),
        ("duration_ns", "durationNs"),
        ("semantic_type", "semanticType"),
        ("hook_type", "hookType"),
        ("request_body", "requestBody"),
        ("response_body", "responseBody"),
        ("request_headers", "requestHeaders"),
        ("response_headers", "responseHeaders"),
    ):
        if result.get(snake) is None and result.get(camel) is not None:
            result[snake] = result[camel]
    return result


def _has_non_empty_string(source: Mapping[str, Any], *keys: str) -> bool:
    return any(isinstance(source.get(key), str) and source[key].strip() for key in keys)


def _has_useful_span_duration(span: Mapping[str, Any]) -> bool:
    return any(isinstance(span.get(key), (int, float)) for key in ("start_time", "duration_ns"))


def _to_span_timestamp_ns(value: Any) -> int | None:
    if not isinstance(value, (int, float)):
        return None
    if value > 1_000_000_000_000_000:
        return int(value)
    if value > 1_000_000_000_000:
        return int(value * 1_000_000)
    return int(value)


def _duration_ms_to_ns(value: Any) -> int | None:
    return int(value * 1_000_000) if isinstance(value, (int, float)) else None


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
