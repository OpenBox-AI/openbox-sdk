from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from typing import Any, TypeVar, cast

from ._govern_runtime import BaseGovernedSession
from ._utils import run_blocking
from .generated.govern import PRESET_CLASSES, presets

T = TypeVar("T")


def _merge_config(config: Mapping[str, Any] | None, kwargs: Mapping[str, Any]) -> dict[str, Any]:
    return {**dict(config or {}), **dict(kwargs)}


def _resolve_preset(value: Any) -> type[BaseGovernedSession]:
    if isinstance(value, str):
        preset = PRESET_CLASSES.get(value) or PRESET_CLASSES.get(value.replace("-", "_"))
        if preset is None:
            raise ValueError(f"unknown OpenBox govern preset: {value}")
        return cast(type[BaseGovernedSession], preset)
    if isinstance(value, type) and issubclass(value, BaseGovernedSession):
        return value
    raise TypeError("govern preset must be a generated preset class or preset name")


async def govern(
    config: Mapping[str, Any] | None = None,
    body: Callable[[BaseGovernedSession], Awaitable[T]] | None = None,
    **kwargs: Any,
) -> T:
    merged = _merge_config(config, kwargs)
    callback = body or merged.pop("body", None)
    if callback is None:
        raise TypeError("govern requires a body callback")
    preset_value = merged.pop("preset", None)
    if preset_value is None:
        raise TypeError("govern requires a preset")
    session = _resolve_preset(preset_value)(**merged)
    try:
        await session.workflow_started()
        result = await callback(session)
        await session.workflow_completed()
        return result
    except BaseException as exc:
        await session.workflow_failed(exc)
        raise


def govern_attach(
    config: Mapping[str, Any] | None = None,
    **kwargs: Any,
) -> BaseGovernedSession:
    merged = _merge_config(config, kwargs)
    preset_value = merged.pop("preset", None)
    if preset_value is None:
        raise TypeError("govern.attach requires a preset")
    if not merged.get("workflow_id") or not merged.get("run_id"):
        raise TypeError("govern.attach requires workflow_id and run_id")
    merged["attached"] = True
    merged["register_exit_handlers"] = bool(merged.get("register_exit_handlers", False))
    return _resolve_preset(preset_value)(**merged)


govern.attach = govern_attach  # type: ignore[attr-defined]


def govern_run(
    config: Mapping[str, Any] | None = None,
    body: Callable[[BaseGovernedSession], Awaitable[T]] | None = None,
    **kwargs: Any,
) -> T:
    async def _run() -> T:
        return await govern(config, body, **kwargs)

    return run_blocking(_run)


__all__ = [
    "BaseGovernedSession",
    "govern",
    "govern_attach",
    "govern_run",
    "presets",
]
