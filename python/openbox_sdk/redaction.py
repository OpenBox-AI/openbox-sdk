from __future__ import annotations

from collections.abc import Mapping, Sequence
from copy import deepcopy
from typing import Any, TypeVar, cast

from .generated.runtime_contract import (
    GUARDRAIL_OUTPUT_TYPE,
    GUARDRAIL_REDACTION_STATUSES,
)

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
    raw = _pick(verdict, "guardrailsResult", "guardrails_result")
    return raw if isinstance(raw, Mapping) else None


def has_guardrail_redaction(verdict: Mapping[str, Any]) -> bool:
    result = _guardrails_result(verdict)
    if result is None:
        return False
    field_results = _field_results(result)
    has_redacted_field = any(
        isinstance(field, Mapping) and field.get("status") in GUARDRAIL_REDACTION_STATUSES
        for field in field_results
    )
    has_redaction_payload = any(
        _pick(result, key) is not None
        for key in ("redactedInput", "redacted_input", "redactedOutput", "redacted_output")
    )
    return has_redacted_field or has_redaction_payload


def summarize_guardrail_redaction(verdict: Mapping[str, Any]) -> list[str]:
    result = _guardrails_result(verdict)
    if result is None:
        return []
    field_results = _field_results(result)
    return [
        str(field.get("field"))
        for field in field_results
        if isinstance(field, Mapping) and field.get("status") in GUARDRAIL_REDACTION_STATUSES
    ]


def apply_input_redaction(value: T, verdict: Mapping[str, Any]) -> T:
    result = _guardrails_result(verdict)
    if result is None:
        return deepcopy(value)
    redacted = _pick(result, "redactedInput", "redacted_input")
    if redacted is None:
        return deepcopy(value)
    return _apply_activity_input_redaction(value, _unwrap_activity_input_redaction(redacted))


def apply_output_redaction(value: T, verdict: Mapping[str, Any]) -> T:
    result = _guardrails_result(verdict)
    if result is None:
        return deepcopy(value)
    input_type = _pick(result, "inputType", "input_type")
    redacted_output = _pick(result, "redactedOutput", "redacted_output")
    if input_type not in (None, GUARDRAIL_OUTPUT_TYPE) and redacted_output is None:
        return deepcopy(value)
    redacted = redacted_output
    if redacted is None:
        redacted = _pick(result, "redactedInput", "redacted_input")
    if redacted is None:
        return deepcopy(value)
    unwrapped = _unwrap_activity_output_redaction(redacted, value)
    return _apply_activity_output_redaction(value, unwrapped)


def _pick(source: Mapping[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in source and source[key] is not None:
            return source[key]
    return None


def _field_results(result: Mapping[str, Any]) -> list[Any]:
    field_results = _pick(result, "fieldResults", "field_results")
    return list(field_results) if isinstance(field_results, Sequence) else []


def _is_sequence(value: Any) -> bool:
    return isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray))


def _unwrap_activity_input_redaction(redacted_input: Any) -> Any:
    if not isinstance(redacted_input, Mapping):
        return redacted_input
    for key in ("input", "activity_input", "activityInput"):
        if key in redacted_input and isinstance(redacted_input[key], list):
            return redacted_input[key]
    return redacted_input


def _unwrap_activity_output_redaction(redacted_output: Any, original_output: Any) -> Any:
    if not isinstance(redacted_output, Mapping):
        return redacted_output
    if isinstance(original_output, Mapping) and "output" in original_output:
        return redacted_output
    for key in ("output", "activity_output", "activityOutput"):
        if key in redacted_output:
            return redacted_output[key]
    return redacted_output


def _apply_activity_input_redaction(value: T, redacted: Any) -> T:
    if isinstance(redacted, Mapping):
        redacted_items: list[Any] = [redacted]
    elif _is_sequence(redacted):
        redacted_items = list(redacted)
    else:
        return deepcopy(value)

    if isinstance(value, Mapping):
        if redacted_items and isinstance(redacted_items[0], Mapping):
            return deep_update_object(value, redacted_items[0])
        return cast(T, deepcopy(redacted_items[0] if redacted_items else redacted_items))
    if isinstance(value, list):
        output = deepcopy(value)
        for index, item in enumerate(redacted_items[: len(output)]):
            if isinstance(output[index], Mapping) and isinstance(item, Mapping):
                output[index] = _merge(output[index], item)
            else:
                output[index] = deepcopy(item)
        return cast(T, output)
    return cast(T, deepcopy(redacted_items[0] if redacted_items else redacted_items))


def _apply_activity_output_redaction(value: T, redacted: Any) -> T:
    if (
        isinstance(value, Mapping)
        and isinstance(redacted, Mapping)
        and not isinstance(value, list)
        and not isinstance(redacted, list)
    ):
        return deep_update_object(value, redacted)
    return cast(T, deepcopy(redacted))
