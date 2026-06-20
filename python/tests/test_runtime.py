from __future__ import annotations

import ast
import asyncio
import base64
import json
import re
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, cast

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
from openbox_sdk.generated.capability_matrix import (
    GOAL_SIGNAL_GUARDS,
    GUARDRAIL_CAPABILITY_GUARDS,
    HITL_CAPABILITY_GUARDS,
    HOOK_CAPABILITY_GUARDS,
    INSTALL_DOCTOR_CAPABILITY_GUARDS,
    MCP_CAPABILITY_GUARDS,
    MCP_PROMPT_SURFACES,
    MCP_RESOURCE_TEMPLATE_SURFACES,
    MCP_SKILL_REFERENCE_SURFACES,
    MCP_TOOL_SURFACES,
    N8N_INTEGRATION_SURFACE,
    OPENBOX_CAPABILITY_IDS,
    OPENBOX_PROVIDER_IDS,
    OPENBOX_SUPPORT_TIERS,
    PLUGIN_CAPABILITY_GUARDS,
    POLICY_EVALUATION_GUARDS,
    PROVIDER_CAPABILITY_MATRIX,
    PROVIDER_EVENT_CATALOG,
    PROVIDER_PLUGIN_COMPONENTS,
    PUBLIC_INTEGRATION_SUPPORT,
    RULES_INSTRUCTION_CAPABILITY_GUARDS,
    SKILL_CAPABILITY_GUARDS,
    SUBAGENTS_AGENTS_CAPABILITY_GUARDS,
    TRACING_CAPABILITY_GUARDS,
    USAGE_COST_CAPABILITY_GUARDS,
)
from openbox_sdk.generated.core_client import CORE_ENDPOINT_MANIFEST
from openbox_sdk.generated.govern import PRESET_MANIFEST
from openbox_sdk.generated.permissions import PATH_PERMISSION_RULES
from openbox_sdk.generated.sdk_targets import (
    CLEAN_ARTIFACTS,
    GENERATED_ARTIFACTS,
    LOCAL_CI,
    SDK_TARGET_IDS,
    SDK_TARGET_MANIFEST,
    SDK_TARGETS,
    SECURITY_AUDIT,
)
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


def _provider_capability_fixture() -> dict[str, Any]:
    repo = Path(__file__).parents[2]
    fixture = json.loads((repo / "codegen/fixtures/provider-capabilities.json").read_text())
    assert isinstance(fixture, dict)
    return cast(dict[str, Any], fixture)


def _sdk_manifest_fixture() -> dict[str, Any]:
    repo = Path(__file__).parents[2]
    fixture = json.loads((repo / "codegen/fixtures/sdk-manifests.json").read_text())
    assert isinstance(fixture, dict)
    return cast(dict[str, Any], fixture)


def _sdk_targets_fixture() -> dict[str, Any]:
    repo = Path(__file__).parents[2]
    fixture = json.loads((repo / "codegen/fixtures/sdk-targets.json").read_text())
    assert isinstance(fixture, dict)
    return cast(dict[str, Any], fixture)


def _endpoint_manifest_for_fixture(manifest: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "operationId": item["operation_id"],
            "path": item["path"],
            "verb": item["verb"],
            "pathPattern": item["path_pattern"],
        }
        for item in manifest
    ]


def _codegen_json(name: str) -> dict[str, Any]:
    repo = Path(__file__).parents[2]
    data = json.loads((repo / "codegen" / name).read_text())
    assert isinstance(data, dict)
    return cast(dict[str, Any], data)


def _permission_regex_for_path_pattern(path_pattern: str) -> str:
    escaped = re.sub(r"([.*+?^${}()|\[\]\\])", r"\\\1", path_pattern)
    escaped = escaped.replace("\\{x\\}", "[^/]+")
    return f"^{escaped}$"


def _expected_python_permission_rules() -> list[list[Any]]:
    permissions_by_operation = _codegen_json("method-permissions.json")
    operations = {entry["operation_id"] for entry in BACKEND_ENDPOINT_MANIFEST}
    missing_operations = sorted(set(permissions_by_operation) - operations)
    assert missing_operations == []

    expected: list[list[Any]] = []
    for entry in BACKEND_ENDPOINT_MANIFEST:
        permissions = permissions_by_operation.get(entry["operation_id"])
        if not isinstance(permissions, list) or not permissions:
            continue
        expected.append(
            [
                entry["verb"],
                _permission_regex_for_path_pattern(str(entry["path_pattern"])),
                entry["method_name"],
                permissions,
            ]
        )
    return expected


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
    assert "expired" not in approval

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

    original: dict[str, Any] = {"nested": {"secret": "raw"}, "items": [{"x": 1}]}
    verdict = {
        "guardrailsResult": {
            "redactedInput": {"nested": {"secret": "[redacted]"}},
            "redactedOutput": {"items": [{"x": 2}, {"x": 3}]},
        }
    }
    assert apply_input_redaction(original, verdict)["nested"]["secret"] == "[redacted]"
    assert apply_output_redaction(original, verdict)["items"] == [{"x": 2}, {"x": 3}]
    assert original["nested"]["secret"] == "raw"
    snake_verdict = {
        "guardrails_result": {
            "input_type": "activity_input",
            "redacted_input": {"input": [{"nested": {"secret": "[snake]"}}]},
        }
    }
    assert apply_input_redaction([original], snake_verdict)[0]["nested"]["secret"] == "[snake]"
    output_fallback_verdict = {
        "guardrails_result": {
            "input_type": "activity_output",
            "redacted_input": {"output": {"nested": {"secret": "[output]"}}},
        }
    }
    assert (
        apply_output_redaction(original, output_fallback_verdict)["nested"]["secret"]
        == "[output]"
    )
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
    assert (
        has_guardrail_redaction(
            {"guardrails_result": {"input_type": "activity_input", "redacted_input": []}}
        )
        is True
    )
    assert apply_input_redaction({"a": 1}, {}) == {"a": 1}
    assert apply_output_redaction({"a": 1}, {"guardrailsResult": {}}) == {"a": 1}


def test_generated_python_matches_typespec_sdk_manifest_fixture() -> None:
    fixture = _sdk_manifest_fixture()

    assert fixture["generatedBy"] == "codegen/emitters/typespec-emitter"
    assert "specs/typespec/backend/main.tsp" in fixture["sources"]
    assert _endpoint_manifest_for_fixture(BACKEND_ENDPOINT_MANIFEST) == fixture[
        "backendEndpointManifest"
    ]
    assert _endpoint_manifest_for_fixture(CORE_ENDPOINT_MANIFEST) == fixture[
        "coreEndpointManifest"
    ]
    assert PRESET_MANIFEST == fixture["governPresetManifest"]
    assert hasattr(AsyncOpenBoxClient, "list_agents")
    assert hasattr(AsyncOpenBoxCoreClient, "evaluate_governance")
    assert hasattr(presets.claude_code, "pre_tool_use")
    assert hasattr(presets.langgraph, "node_start")


def test_generated_python_matches_typespec_capability_fixture() -> None:
    fixture = _provider_capability_fixture()

    assert fixture["generatedBy"] == "codegen/emitters/typespec-emitter"
    assert fixture["source"] == "specs/typespec/govern/capabilities.tsp"
    assert OPENBOX_CAPABILITY_IDS == fixture["capabilityIds"]
    assert OPENBOX_PROVIDER_IDS == fixture["providerIds"]
    assert OPENBOX_SUPPORT_TIERS == fixture["supportTiers"]
    assert PROVIDER_CAPABILITY_MATRIX == fixture["providerCapabilityMatrix"]
    assert PROVIDER_EVENT_CATALOG == fixture["providerEventCatalog"]
    assert PROVIDER_PLUGIN_COMPONENTS == fixture["providerPluginComponents"]
    assert PUBLIC_INTEGRATION_SUPPORT == fixture["publicIntegrationSupport"]
    assert GOAL_SIGNAL_GUARDS == fixture["goalSignalGuards"]
    assert USAGE_COST_CAPABILITY_GUARDS == fixture["usageCostCapabilityGuards"]
    assert TRACING_CAPABILITY_GUARDS == fixture["tracingCapabilityGuards"]
    assert HITL_CAPABILITY_GUARDS == fixture["hitlCapabilityGuards"]
    assert GUARDRAIL_CAPABILITY_GUARDS == fixture["guardrailCapabilityGuards"]
    assert POLICY_EVALUATION_GUARDS == fixture["policyEvaluationGuards"]
    assert RULES_INSTRUCTION_CAPABILITY_GUARDS == fixture["rulesInstructionCapabilityGuards"]
    assert HOOK_CAPABILITY_GUARDS == fixture["hookCapabilityGuards"]
    assert SUBAGENTS_AGENTS_CAPABILITY_GUARDS == fixture["subagentsAgentsCapabilityGuards"]
    assert PLUGIN_CAPABILITY_GUARDS == fixture["pluginCapabilityGuards"]
    assert SKILL_CAPABILITY_GUARDS == fixture["skillCapabilityGuards"]
    assert MCP_CAPABILITY_GUARDS == fixture["mcpCapabilityGuards"]
    assert INSTALL_DOCTOR_CAPABILITY_GUARDS == fixture["installDoctorCapabilityGuards"]
    assert MCP_TOOL_SURFACES == fixture["mcpToolSurfaces"]
    assert MCP_PROMPT_SURFACES == fixture["mcpPromptSurfaces"]
    assert MCP_RESOURCE_TEMPLATE_SURFACES == fixture["mcpResourceTemplateSurfaces"]
    assert MCP_SKILL_REFERENCE_SURFACES == fixture["mcpSkillReferenceSurfaces"]
    assert N8N_INTEGRATION_SURFACE == fixture["n8nIntegrationSurface"]


def test_generated_python_matches_typespec_sdk_target_fixture() -> None:
    fixture = _sdk_targets_fixture()

    assert fixture["generatedBy"] == "codegen/emitters/typespec-emitter"
    assert fixture["source"] == "specs/typespec/sdk/main.tsp"
    assert SDK_TARGET_MANIFEST == {
        "cleanArtifacts": fixture["cleanArtifacts"],
        "generatedArtifacts": fixture["generatedArtifacts"],
        "localCi": fixture["localCi"],
        "securityAudit": fixture["securityAudit"],
        "targets": fixture["targets"],
    }
    assert CLEAN_ARTIFACTS == fixture["cleanArtifacts"]
    assert GENERATED_ARTIFACTS == fixture["generatedArtifacts"]
    assert LOCAL_CI == fixture["localCi"]
    assert SECURITY_AUDIT == fixture["securityAudit"]
    assert SDK_TARGETS == fixture["targets"]
    assert SDK_TARGET_IDS == [target["id"] for target in fixture["targets"]]


def test_generated_python_permission_rules_match_backend_permission_map() -> None:
    assert PATH_PERMISSION_RULES == _expected_python_permission_rules()


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

    async def blocked_body(session: Any) -> Mapping[str, Any]:
        return cast(Mapping[str, Any], await session.tool({"input": []}))

    await govern({"core": blocked_core, "preset": presets.default}, blocked_body)
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
        {
            "activity_id": "act_1",
            "start_time": 1_700_000_000_000,
            "spans": [
                {
                    "stage": "started",
                    "semanticType": "http_get",
                    "startTime": 1_700_000_000_000,
                    "durationNs": 0,
                    "events": [
                        {
                            "attributes": {"keep": "yes"},
                            "name": 42,
                            "timestamp": "bad",
                        }
                    ],
                    "status": {"code": 42},
                    "requestHeaders": {"authorization": "Bearer test", "n": 1},
                    "attributes": {"url.full": "https://example.com"},
                }
            ],
        },
    )
    assert span_core.events[-2]["hook_trigger"] is False
    assert "spans" not in span_core.events[-2]
    assert "span_count" not in span_core.events[-2]
    assert span_core.events[-1]["hook_trigger"] is True
    assert span_core.events[-1]["span_count"] == 1
    assert span_core.events[-1]["activity_id"] == "act_1"
    started_hook_span = span_core.events[-1]["spans"][0]
    assert started_hook_span["activity_id"] == "act_1"
    assert started_hook_span["semantic_type"] == "http_get"
    assert started_hook_span["start_time"] == 1_700_000_000_000_000_000
    assert started_hook_span["end_time"] is None
    assert started_hook_span["duration_ns"] is None
    assert "status" not in started_hook_span
    assert started_hook_span["events"] == [
        {"attributes": {"keep": "yes"}, "name": "", "timestamp": 0}
    ]
    assert started_hook_span["request_headers"] == {"authorization": "Bearer test"}
    assert started_hook_span["attributes"]["http.url"] == "https://example.com"

    handle = await span_session.open_activity(
        "ToolStarted",
        {
            "activity_id": "act_2",
            "spans": [{"stage": "started", "semantic_type": "internal"}],
        },
    )
    await handle.complete({"spans": [{"stage": "completed", "semantic_type": "internal"}]})
    completed_parent = next(
        event
        for event in span_core.events
        if event.get("activity_id") == "act_2"
        and event["event_type"] == "ActivityCompleted"
        and event["hook_trigger"] is False
    )
    completed_hook = next(
        event
        for event in span_core.events
        if event.get("activity_id") == "act_2"
        and event["event_type"] == "ActivityStarted"
        and event["hook_trigger"] is True
        and event["spans"][0]["stage"] == "completed"
    )
    assert "spans" not in completed_parent
    assert "span_count" not in completed_parent
    assert completed_hook["span_count"] == 1

    camel_handle = await span_session.open_activity(
        "ToolStarted",
        {
            "activityId": "act_camel",
            "startTime": 1_700_000_000_000,
            "spans": [{"stage": "started", "semantic_type": "internal"}],
        },
    )
    await camel_handle.complete(
        {
            "endTime": 1_700_000_000_025,
            "durationMs": 25,
            "hookSpanParentEventType": "ActivityStarted",
            "spans": [{"stage": "completed", "semantic_type": "internal"}],
        }
    )
    camel_completed_parent = next(
        event
        for event in span_core.events
        if event.get("activity_id") == "act_camel"
        and event["event_type"] == "ActivityCompleted"
        and event["hook_trigger"] is False
    )
    camel_completed_hook = next(
        event
        for event in span_core.events
        if event.get("activity_id") == "act_camel"
        and event["event_type"] == "ActivityStarted"
        and event["hook_trigger"] is True
        and event["spans"][0]["stage"] == "completed"
    )
    assert camel_completed_parent["start_time"] == 1_700_000_000_000
    assert camel_completed_parent["end_time"] == 1_700_000_000_025
    assert camel_completed_parent["duration_ms"] == 25
    assert camel_completed_hook["span_count"] == 1

    attached = cast(
        Any,
        govern.attach(
            {"core": FakeCore(), "preset": presets.default, "workflow_id": "w", "run_id": "r"}
        ),
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

    approved_after_elapsed_timestamp = await external.poll_approval(
        "activity",
        "Manual",
        {"arm": "require_approval", "approvalExpiresAt": "2000-01-01T00:00:00Z"},
    )
    assert approved_after_elapsed_timestamp["arm"] == "allow"

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
    assert map_verdict({"verdict": 2})["arm"] == "require_approval"
    assert map_verdict({"guardrails_result": {}})["guardrailsResult"] is None
    assert (
        map_verdict({"guardrails_result": {"input_type": "activity_input"}})["guardrailsResult"][
            "validationPassed"
        ]
        is True
    )
    alias_verdict = map_verdict(
        {
            "verdict": "constrain",
            "risk_score": 0,
            "trust_tier": 0,
            "alignment_score": 0,
            "behavioral_violations": [],
            "fallback_used": False,
            "age_result": {},
            "guardrails_result": {
                "input_type": "activity_input",
                "redacted_output": {},
                "raw_logs": {},
                "field_results": [
                    {"field": "direct_cmd", "status": "transformed", "reason": "direct row"}
                ],
                "results": [
                    {
                        "guardrail_type": "pii",
                        "results": [{"field": "cmd", "status": "block", "reason": "token"}],
                    }
                ],
            },
        }
    )
    assert alias_verdict["riskScore"] == 0
    assert alias_verdict["trustTier"] == 0
    assert alias_verdict["alignmentScore"] == 0
    assert alias_verdict["behavioralViolations"] == []
    assert alias_verdict["fallbackUsed"] is False
    assert alias_verdict["ageResult"] == {}
    assert alias_verdict["guardrailsResult"]["redactedOutput"] == {}
    assert alias_verdict["guardrailsResult"]["rawLogs"] == {}
    assert alias_verdict["guardrailsResult"]["fieldResults"] == [
        {"field": "direct_cmd", "status": "transformed", "reason": "direct row"},
        {"field": "cmd", "status": "blocked", "reason": "token"},
    ]
    output_guardrail = map_verdict(
        {
            "verdict": "allow",
            "guardrails_result": {
                "validation_passed": False,
                "input_type": "activity_output",
                "reasons": [{"reason": "first"}, {"reason": "second"}],
            },
        }
    )
    assert output_guardrail["arm"] == "block"
    assert output_guardrail["reason"] == "first; second"


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

    tool_request: Mapping[str, Any] = {"id": "tool-1", "name": "lookup"}
    result: Mapping[str, Any] = await middleware.wrap_tool_call(tool_request, handler)
    assert result == {"handled": "lookup"}
    tool_events = [event for event in core.events if event.get("activity_id") == "tool-1"]
    assert tool_events[0]["event_type"] == "ActivityStarted"
    assert tool_events[0]["hook_trigger"] is False
    assert "spans" not in tool_events[0]
    assert tool_events[1]["event_type"] == "ActivityStarted"
    assert tool_events[1]["hook_trigger"] is True
    assert tool_events[1]["spans"][0]["stage"] == "started"
    assert tool_events[1]["spans"][0]["attributes"]["openbox.tool.name"] == "lookup"
    assert tool_events[1]["spans"][0]["attributes"]["tool.name"] == "lookup"
    completed_tool_hook = next(
        event
        for event in tool_events
        if event["event_type"] == "ActivityStarted"
        and event["hook_trigger"] is True
        and event["spans"][0]["stage"] == "completed"
    )
    assert completed_tool_hook["span_count"] == 1

    unnamed_request: Mapping[str, Any] = {"id": "tool-unnamed"}
    unnamed_result = await middleware.wrap_tool_call(
        unnamed_request,
        lambda _req: {"ok": True},
    )
    assert unnamed_result == {"ok": True}
    unnamed_parent = next(
        event
        for event in core.events
        if event.get("activity_id") == "tool-unnamed"
        and event["event_type"] == "ActivityStarted"
        and event["hook_trigger"] is False
    )
    assert unnamed_parent["activity_type"] == "AgentAction"

    model_payload = {
        "content": "answer",
        "usage_metadata": {"input_tokens": 8, "output_tokens": 3},
        "response_metadata": {"model_name": "gpt-4.1-mini", "finish_reason": "stop"},
    }
    model_request: Mapping[str, Any] = {
        "run_id": "model-1",
        "model": "gpt-4.1-mini",
        "messages": [{"role": "user", "content": "say hi"}],
    }
    model_result = await middleware.wrap_model_call(
        model_request,
        lambda _req: model_payload,
    )
    assert model_result == model_payload
    model_events = [event for event in core.events if event.get("activity_id") == "model-1"]
    assert not [event for event in model_events if event["hook_trigger"] is True]
    model_completed = next(
        event for event in model_events if event["event_type"] == "ActivityCompleted"
    )
    assert model_completed["llm_model"] == "gpt-4.1-mini"
    assert model_completed["input_tokens"] == 8
    assert model_completed["output_tokens"] == 3
    assert model_completed["total_tokens"] == 11
    assert model_completed["has_tool_calls"] is False
    assert model_completed["finish_reason"] == "stop"
    assert model_completed["completion"] == "answer"

    approval_core = FakeCore(
        evals=[
            {"verdict": "allow"},
            {
                "verdict": "require_approval",
                "approval_id": "appr-lg",
                "approval_expiration_time": _future_iso(),
            }
        ],
        approvals=[{"action": "allow", "approval_expiration_time": _future_iso()}],
    )
    approval_middleware = OpenBoxLangGraphMiddleware(
        core=approval_core,
        workflow_id="aw",
        run_id="ar",
    )
    approval_tool_request: Mapping[str, Any] = {"id": "tool-approval", "name": "lookup"}
    assert await approval_middleware.wrap_tool_call(
        approval_tool_request,
        handler,
    ) == {"handled": "lookup"}
    assert approval_core.polls == [
        {"workflow_id": "aw", "run_id": "ar", "activity_id": "tool-approval"}
    ]

    blocked_core = FakeCore(evals=[{"verdict": "allow"}, {"verdict": "block", "reason": "denied"}])
    blocked_middleware = OpenBoxLangGraphMiddleware(
        core=blocked_core,
        workflow_id="bw",
        run_id="br",
    )
    called = False

    async def blocked_handler(_request: Mapping[str, Any]) -> None:
        nonlocal called
        called = True

    blocked_tool_request: Mapping[str, Any] = {"id": "tool-blocked", "name": "lookup"}
    with pytest.raises(RuntimeError, match="denied"):
        await blocked_middleware.wrap_tool_call(
            blocked_tool_request,
            blocked_handler,
        )
    assert called is False

    async def failing_handler(_request: Mapping[str, Any]) -> None:
        raise RuntimeError("tool failed")

    failing_tool_request: Mapping[str, Any] = {"id": "tool-2", "name": "lookup"}
    with pytest.raises(RuntimeError, match="tool failed"):
        await middleware.wrap_tool_call(failing_tool_request, failing_handler)

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
