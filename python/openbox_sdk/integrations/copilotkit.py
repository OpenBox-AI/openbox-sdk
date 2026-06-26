from __future__ import annotations

from typing import Any

from .langgraph import OpenBoxLangGraphMiddleware


def openbox_copilotkit_middleware(
    *,
    openbox: OpenBoxLangGraphMiddleware | None = None,
    copilotkit_middleware: Any | None = None,
    **openbox_options: Any,
) -> tuple[Any, ...]:
    openbox_middleware = openbox or OpenBoxLangGraphMiddleware(**openbox_options)
    copilotkit = copilotkit_middleware or _load_copilotkit_middleware()
    return (openbox_middleware, copilotkit)


def _load_copilotkit_middleware() -> Any:
    try:
        module = __import__("copilotkit.langgraph", fromlist=["CopilotKitMiddleware"])
    except ImportError as exc:
        raise ImportError(
            "Install openbox-sdk[copilotkit] or pass copilotkit_middleware explicitly."
        ) from exc
    middleware = vars(module).get("CopilotKitMiddleware")
    if middleware is None:
        raise ImportError("copilotkit.langgraph.CopilotKitMiddleware was not found")
    return middleware()


__all__ = ["openbox_copilotkit_middleware"]
