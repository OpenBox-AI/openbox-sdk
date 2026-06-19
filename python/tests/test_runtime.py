from __future__ import annotations

import ast
import asyncio
import base64
import json
import re
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest

from openbox_sdk import (
    AsyncOpenBoxClient,
    AsyncOpenBoxCoreClient,
    MissingPermissionError,
    OpenBoxAPIError,
    OpenBoxClient,
    OpenBoxCoreClient,
    apply_input_redaction,
    apply_output_redaction,
    govern,
    govern_run,
    presets,
    sign_agent_identity_request,
)
from openbox_sdk._govern_runtime import SessionAlreadyTerminatedError, map_verdict
from openbox_sdk._utils import normalize_api_url, parse_datetime, render_path, retry_backoff_seconds
from openbox_sdk.generated.backend_client import BACKEND_ENDPOINT_MANIFEST
from openbox_sdk.generated.core_client import CORE_ENDPOINT_MANIFEST
from openbox_sdk.generated.govern import PRESET_MANIFEST
from openbox_sdk.integrations.copilotkit import openbox_copilotkit_middleware
from openbox_sdk.integrations.langgraph import (
    OpenBoxLangGraphMiddleware,
    create_openbox_graph_handler,
)
from openbox_sdk.redaction import has_guardrail_redaction, summarize_guardrail_redaction


class FakeCore:
    def __init__(
        self,
        *,
        evals: list[dict[str, Any]] | None = None,
        approvals: list[dict[str, Any]] | None = None,
    ) -> None:
        self.evals = list(evals or [])
        self.approvals = list(approvals or [])
        self.events: list[dict[str, Any]] = []
        self.polls: list[dict[str, Any]] = []

    async def evaluate(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        event = dict(payload)
        self.events.append(event)
        if self.evals:
            return self.evals.pop(0)
        return {"verdict": "allow", "risk_score": 0}

    async def poll_approval(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        poll = dict(payload)
        self.polls.append(poll)
        if self.approvals:
            return self.approvals.pop(0)
        return {"action": "allow", "approval_expiration_time": _future_iso()}


def _future_iso(seconds: int = 30) -> str:
    return (datetime.now(tz=UTC) + timedelta(seconds=seconds)).isoformat().replace("+00:00", "Z")


def _ts_array(file: Path, const_name: str) -> list[dict[str, Any]]:
    source = file.read_text()
    match = re.search(rf"const {const_name}\s*=\s*(\[.*?\])\s+as const", source, re.S)
    assert match is not None
    return json.loads(match.group(1))


@pytest.mark.asyncio
async def test_backend_client_auth_retry_unwrap_and_permission_preflight() -> None:
    requests: list[httpx.Request] = []
    sleeps: list[float] = []

    async def transport(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if len(requests) == 1:
            return httpx.Response(429, headers={"Retry-After": "0"}, json={"message": "retry"})
        return httpx.Response(200, json={"data": {"ok": True}})

    async def sleep(delay: float) -> None:
        sleeps.append(delay)

    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as http:
        client = AsyncOpenBoxClient(
            api_url="https://backend.example/",
            api_key="obx_key_123",
            bearer_token="jwt",
            http_client=http,
            sleep=sleep,
        )
        result = await client.request_operation("AppController_getHello")

    assert result == {"ok": True}
    assert len(requests) == 2
    assert requests[0].url == "https://backend.example/health"
    assert requests[0].headers["X-API-Key"] == "obx_key_123"
    assert "Authorization" not in requests[0].headers
    assert "Cookie" not in requests[0].headers
    assert sleeps == [0.0]

    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as http:
        client = AsyncOpenBoxClient(
            api_url="https://backend.example",
            bearer_token="jwt",
            permissions=[],
            http_client=http,
        )
        with pytest.raises(MissingPermissionError):
            await client.request_operation("AgentController_getAgents")


@pytest.mark.asyncio
async def test_backend_client_bearer_fallback() -> None:
    seen: list[httpx.Request] = []

    async def transport(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"data": {"ok": True}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as http:
        client = AsyncOpenBoxClient(
            api_url="https://backend.example",
            bearer_token="jwt",
            http_client=http,
        )
        await client.health()

    assert seen[0].headers["Authorization"] == "Bearer jwt"
    assert "X-API-Key" not in seen[0].headers


@pytest.mark.asyncio
async def test_backend_client_response_shapes_and_allowed_permissions() -> None:
    calls: list[httpx.Request] = []

    async def transport(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(204)
        if len(calls) == 2:
            return httpx.Response(200, text="plain", headers={"content-type": "text/plain"})
        if len(calls) == 3:
            return httpx.Response(400, json={"error": {"message": "bad request"}})
        return httpx.Response(200, json={"data": [{"id": "agent"}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as http:
        client = AsyncOpenBoxClient(api_url="https://backend.example", http_client=http)
        assert await client.health() is None
        assert await client.health() == "plain"
        with pytest.raises(OpenBoxAPIError, match="bad request"):
            await client.health()
        client.set_permissions(["read:agent"])
        assert await client.request_operation("AgentController_getAgents") == [{"id": "agent"}]


@pytest.mark.asyncio
async def test_core_client_validation_no_retry_signing_and_approval_expiry() -> None:
    seed = base64.b64encode(bytes(range(32))).decode("ascii")
    seen: list[httpx.Request] = []

    async def transport(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/api/v1/governance/evaluate":
            return httpx.Response(503, json={"message": "down"})
        return httpx.Response(
            200, json={"data": {"approval_expiration_time": "2000-01-01T00:00:00Z"}}
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as http:
        client = AsyncOpenBoxCoreClient(
            api_url="http://localhost:9000/",
            api_key="obx_test_runtime",
            agent_identity={"agent_did": "did:openbox:agent-1", "agent_private_key": seed},
            http_client=http,
        )
        with pytest.raises(OpenBoxAPIError):
            await client.evaluate({"event_type": "WorkflowStarted"})
        approval = await client.poll_approval(
            {"workflow_id": "w", "run_id": "r", "activity_id": "a"}
        )

    assert sum(request.url.path == "/api/v1/governance/evaluate" for request in seen) == 1
    assert seen[0].headers["x-openbox-internal"] == "true"
    assert seen[0].headers["X-OpenBox-Agent-DID"] == "did:openbox:agent-1"
    assert b'"sdk_version"' in seen[0].content
    assert approval["expired"] is True

    with pytest.raises(ValueError):
        AsyncOpenBoxCoreClient(
            api_url="https://core.example", api_key="obx_key_backend"
        )._validate_runtime_key()

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(200, json={"data": {"ok": True}})
        )
    ) as http:
        core = AsyncOpenBoxCoreClient(api_url="http://localhost:9000", http_client=http)
        assert await core.health() == {"ok": True}
        with pytest.raises(ValueError, match="runtime API key"):
            await core.validate_api_key()

    with pytest.raises(ValueError, match="https"):
        AsyncOpenBoxCoreClient(api_url="http://core.example", api_key="obx_test_runtime")


def test_signing_redaction_and_utility_helpers() -> None:
    seed = base64.b64encode(bytes(range(32))).decode("ascii")
    headers = sign_agent_identity_request(
        method="post",
        path="/api/v1/governance/evaluate",
        body={"b": 1},
        agent_did="did:openbox:agent-1",
        agent_private_key=seed,
        timestamp="2026-01-01T00:00:00Z",
        nonce="nonce",
    )
    assert headers["X-OpenBox-Agent-Signature"]
    with pytest.raises(ValueError):
        sign_agent_identity_request(
            method="post",
            path="/",
            body=None,
            agent_did="not-a-did",
            agent_private_key=seed,
        )

    original = {"nested": {"secret": "raw"}, "items": [{"x": 1}]}
    verdict = {
        "guardrailsResult": {
            "redactedInput": {"nested": {"secret": "[redacted]"}},
            "redactedOutput": {"items": [{"x": 2}, {"x": 3}]},
        }
    }
    assert apply_input_redaction(original, verdict)["nested"]["secret"] == "[redacted]"
    assert apply_output_redaction(original, verdict)["items"] == [{"x": 2}, {"x": 3}]
    assert original["nested"]["secret"] == "raw"
    assert normalize_api_url("https://api.example/") == "https://api.example"
    with pytest.raises(ValueError):
        normalize_api_url("")
    with pytest.raises(ValueError):
        normalize_api_url("api.example")
    with pytest.raises(ValueError):
        render_path("/agents/{id}")
    assert render_path("/agents/{id}", {"id": "a b"}) == "/agents/a%20b"
    assert parse_datetime(None) is None
    assert parse_datetime("not-date") is None
    assert retry_backoff_seconds(0, base_seconds=1, max_seconds=5, retry_after="2") == 2
    assert (
        retry_backoff_seconds(
            0,
            base_seconds=1,
            max_seconds=5,
            retry_after="Wed, 01 Jan 3000 00:00:00 GMT",
        )
        == 5
    )

    redaction_verdict = {
        "guardrails_result": {
            "field_results": [
                {"field": "secret", "status": "redacted"},
                {"field": "public", "status": "allowed"},
            ]
        }
    }
    assert has_guardrail_redaction(redaction_verdict) is True
    assert summarize_guardrail_redaction(redaction_verdict) == ["secret"]
    assert apply_input_redaction({"a": 1}, {}) == {"a": 1}
    assert apply_output_redaction({"a": 1}, {"guardrailsResult": {}}) == {"a": 1}


def test_generated_python_matches_typescript_manifests() -> None:
    repo = Path(__file__).parents[2]
    backend_ts = _ts_array(
        repo / "ts/src/client/generated/endpoint-manifest.ts",
        "BACKEND_ENDPOINT_MANIFEST",
    )
    core_ts = _ts_array(
        repo / "ts/src/core-client/generated/endpoint-manifest.ts",
        "CORE_ENDPOINT_MANIFEST",
    )
    govern_ts = _ts_array(repo / "ts/src/core-client/generated/govern.ts", "PRESET_MANIFEST")

    assert [item["operationId"] for item in backend_ts] == [
        item["operation_id"] for item in BACKEND_ENDPOINT_MANIFEST
    ]
    assert [item["operationId"] for item in core_ts] == [
        item["operation_id"] for item in CORE_ENDPOINT_MANIFEST
    ]
    assert [item["preset"] for item in govern_ts] == [item["preset"] for item in PRESET_MANIFEST]
    assert hasattr(AsyncOpenBoxClient, "list_agents")
    assert hasattr(AsyncOpenBoxCoreClient, "evaluate_governance")
    assert hasattr(presets.claude_code, "pre_tool_use")
    assert hasattr(presets.langgraph, "node_start")


@pytest.mark.asyncio
async def test_govern_lifecycle_pairing_approvals_hook_spans_and_terminal_sessions() -> None:
    core = FakeCore()

    async def body(session: Any) -> str:
        await session.tool({"input": [{"tool": "search"}], "output": {"ok": True}})
        return "done"

    assert await govern({"core": core, "preset": presets.default}, body) == "done"
    assert [event["event_type"] for event in core.events] == [
        "WorkflowStarted",
        "ActivityStarted",
        "ActivityCompleted",
        "WorkflowCompleted",
    ]
    assert core.events[1]["activity_id"] == core.events[2]["activity_id"]

    failed_core = FakeCore()
    with pytest.raises(RuntimeError):
        await govern(
            {"core": failed_core, "preset": presets.default},
            lambda _session: _raise_async(RuntimeError("boom")),
        )
    assert failed_core.events[-1]["event_type"] == "WorkflowFailed"
    assert failed_core.events[-1]["error"]["message"] == "boom"

    blocked_core = FakeCore(evals=[{"verdict": "allow"}, {"verdict": "block", "reason": "no"}])
    await govern({"core": blocked_core, "preset": presets.default}, lambda s: s.tool({"input": []}))
    assert [event["event_type"] for event in blocked_core.events].count("ActivityCompleted") == 0

    pending: list[Mapping[str, Any]] = []
    resolved: list[Mapping[str, Any]] = []
    approval_core = FakeCore(
        evals=[
            {"verdict": "allow"},
            {
                "verdict": "require_approval",
                "approval_id": "appr_1",
                "approval_expiration_time": _future_iso(),
            },
            {"verdict": "allow"},
        ],
        approvals=[{"action": "allow", "approval_expiration_time": _future_iso()}],
    )
    session = presets.default(
        core=approval_core,
        approval_poll_interval_seconds=0,
        on_pending_approval=lambda info: pending.append(dict(info)),
        on_approval_resolved=lambda info: resolved.append(dict(info)),
    )
    await session.tool({"input": []})
    assert approval_core.polls == [
        {
            "workflow_id": session.workflow_id,
            "run_id": session.run_id,
            "activity_id": pending[0]["activityId"],
        }
    ]
    assert resolved[0]["arm"] == "allow"

    span_core = FakeCore()
    span_session = presets.default(core=span_core)
    await span_session.observe_activity(
        "ActivityStarted",
        "ToolStarted",
        {"activity_id": "act_1", "spans": [{"stage": "started", "name": "http"}]},
    )
    assert span_core.events[-2].get("spans") is None
    assert span_core.events[-1]["hook_trigger"] is True
    assert span_core.events[-1]["activity_id"] == "act_1"

    attached = govern.attach(
        {"core": FakeCore(), "preset": presets.default, "workflow_id": "w", "run_id": "r"}
    )
    await attached.workflow_completed()
    with pytest.raises(SessionAlreadyTerminatedError):
        await attached.tool({"input": []})


@pytest.mark.asyncio
async def test_govern_runtime_edge_paths() -> None:
    core = FakeCore()
    session = presets.default(core=core, multi_agent_session_id="multi")
    assert session.is_open is False
    assert session.is_terminated is False
    await session.begin()
    await session.begin()
    assert session.is_open is True
    await session.activity(
        "SignalReceived",
        "interrupt",
        {"signalName": "pause", "signalArgs": {"x": 1}},
    )
    await session.activity("Handoff", "handoff", {"input": [{"to": "agent"}]})
    handle = await session.open_activity("Manual", {"activity_id": "manual", "input": [{"a": 1}]})
    assert handle.activity_id == "manual"
    await handle.complete({"output": {"ok": True}})
    assert core.events[-1]["status"] == "completed"
    await session.complete()
    assert session.is_terminated is True
    assert await session.complete() is None
    assert await session.fail(RuntimeError("ignored")) is None

    inline_core = FakeCore(evals=[{"verdict": "allow"}, {"verdict": "require_approval"}])
    inline = presets.default(core=inline_core, inline_approval=True)
    verdict = await inline.tool({"input": []})
    assert verdict["arm"] == "require_approval"
    assert inline_core.polls == []

    external_core = FakeCore(
        approvals=[{"action": "reject", "reason": "no", "approval_expiration_time": _future_iso()}]
    )
    external = presets.default(
        core=external_core,
        approval_poll_interval_seconds=10,
        await_external_decision=lambda _info: "approve",
    )
    rejected = await external.poll_approval(
        "activity",
        "Manual",
        {"arm": "require_approval", "approvalExpiresAt": _future_iso()},
    )
    assert rejected["arm"] == "block"

    expired = await external.poll_approval(
        "activity",
        "Manual",
        {"arm": "require_approval", "approvalExpiresAt": "2000-01-01T00:00:00Z"},
    )
    assert expired["arm"] == "block"

    guardrail = map_verdict(
        {
            "verdict": "allow",
            "guardrails_result": {
                "validation_passed": False,
                "input_type": "activity_input",
                "reasons": [{"reason": "bad\n\nThought: hidden"}],
            },
        }
    )
    assert guardrail["arm"] == "block"
    assert guardrail["reason"] == "bad"


@pytest.mark.asyncio
async def test_langgraph_and_copilotkit_integrations() -> None:
    core = FakeCore()
    middleware = OpenBoxLangGraphMiddleware(core=core, workflow_id="w", run_id="r")
    await middleware.start_activity("node_start", {"activity_id": "node-1", "input": [{"x": 1}]})
    await middleware.evaluate_hook_span(
        activity_id="node-1",
        activity_type="node_start",
        span={"stage": "completed", "name": "db"},
    )
    assert core.events[-1]["hook_trigger"] is True
    assert core.events[-1]["spans"][0]["stage"] == "completed"

    async def handler(request: Mapping[str, Any]) -> Mapping[str, Any]:
        return {"handled": request["name"]}

    result = await middleware.wrap_tool_call({"id": "tool-1", "name": "lookup"}, handler)
    assert result == {"handled": "lookup"}
    model_result = await middleware.wrap_model_call({"run_id": "model-1"}, lambda _req: "answer")
    assert model_result == "answer"

    async def failing_handler(_request: Mapping[str, Any]) -> None:
        raise RuntimeError("tool failed")

    with pytest.raises(RuntimeError, match="tool failed"):
        await middleware.wrap_tool_call({"id": "tool-2", "name": "lookup"}, failing_handler)

    class Graph:
        async def ainvoke(self, value: str) -> str:
            return value.upper()

        async def astream(self, value: str) -> Any:
            for item in value:
                yield item

    graph_core = FakeCore()
    graph_handler = create_openbox_graph_handler(
        Graph(),
        core=graph_core,
        workflow_id="gw",
        run_id="gr",
    )
    assert await graph_handler.ainvoke("ok") == "OK"
    assert graph_core.events[0]["event_type"] == "WorkflowStarted"
    assert graph_core.events[-1]["event_type"] == "WorkflowCompleted"
    assert [item async for item in graph_handler.astream("ok")] == ["o", "k"]

    copilot = object()
    composed = openbox_copilotkit_middleware(openbox=middleware, copilotkit_middleware=copilot)
    assert composed == (middleware, copilot)
    with pytest.raises(ImportError):
        openbox_copilotkit_middleware(openbox=middleware)


def test_govern_run_rejects_active_event_loop() -> None:
    assert (
        govern_run(
            {"core": FakeCore(), "preset": presets.default},
            lambda _session: _value_async("ok"),
        )
        == "ok"
    )

    async def call_sync_inside_loop() -> None:
        with pytest.raises(RuntimeError):
            govern_run(
                {"core": FakeCore(), "preset": presets.default}, lambda _session: _value_async("no")
            )

    asyncio.run(call_sync_inside_loop())

    with pytest.raises(AttributeError):
        OpenBoxClient().__getattr__("does_not_exist")
    with pytest.raises(AttributeError):
        OpenBoxCoreClient().__getattr__("does_not_exist")


def test_generated_files_parse() -> None:
    package_root = Path(__file__).parents[1] / "openbox_sdk"
    for file in package_root.glob("**/*.py"):
        ast.parse(file.read_text())


async def _raise_async(exc: Exception) -> None:
    raise exc


async def _value_async(value: str) -> str:
    return value
