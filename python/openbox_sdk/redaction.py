from __future__ import annotations

from collections.abc import Mapping, Sequence
from copy import deepcopy
from typing import Any, TypeVar, cast

T = TypeVar("T")


def deep_update_object(base: T, patch: Any) -> T:
    return cast(T, _merge(deepcopy(base), patch))


def _merge(base: Any, patch: Any) -> Any:
    if isinstance(base, dict) and isinstance(patch, Mapping):
        return {**base, **{key: _merge(base.get(key), value) for key, value in patch.items()}}
    if (
        isinstance(base, list)
        and isinstance(patch, Sequence)
        and not isinstance(patch, (str, bytes))
    ):
        result = list(base)
        for index, value in enumerate(patch):
            if index < len(result):
                result[index] = _merge(result[index], value)
            else:
                result.append(deepcopy(value))
        return result
    return deepcopy(patch)


def _guardrails_result(verdict: Mapping[str, Any]) -> Mapping[str, Any] | None:
    raw = verdict.get("guardrailsResult") or verdict.get("guardrails_result")
    return raw if isinstance(raw, Mapping) else None


def has_guardrail_redaction(verdict: Mapping[str, Any]) -> bool:
    result = _guardrails_result(verdict)
    if result is None:
        return False
    field_results = result.get("fieldResults") or result.get("field_results") or []
    return any(
        isinstance(field, Mapping) and field.get("status") in {"redacted", "transformed"}
        for field in field_results
    )


def summarize_guardrail_redaction(verdict: Mapping[str, Any]) -> list[str]:
    result = _guardrails_result(verdict)
    if result is None:
        return []
    field_results = result.get("fieldResults") or result.get("field_results") or []
    return [
        str(field.get("field"))
        for field in field_results
        if isinstance(field, Mapping) and field.get("status") in {"redacted", "transformed"}
    ]


def apply_input_redaction(value: T, verdict: Mapping[str, Any]) -> T:
    result = _guardrails_result(verdict)
    if result is None or "redactedInput" not in result:
        return deepcopy(value)
    return deep_update_object(value, result["redactedInput"])


def apply_output_redaction(value: T, verdict: Mapping[str, Any]) -> T:
    result = _guardrails_result(verdict)
    if result is None:
        return deepcopy(value)
    redacted = result.get("redactedOutput") or result.get("redacted_output")
    if redacted is None:
        return deepcopy(value)
    return deep_update_object(value, redacted)
