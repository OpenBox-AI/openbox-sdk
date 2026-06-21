from __future__ import annotations

import json
import re
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

import httpx
import pytest

from openbox_sdk import AsyncOpenBoxClient, AsyncOpenBoxCoreClient, RequestPreflightError
from openbox_sdk.generated.backend_client import BACKEND_ENDPOINT_MANIFEST
from openbox_sdk.generated.request_preflight import (
    BACKEND_REQUEST_PREFLIGHT_RULES,
    CORE_REQUEST_PREFLIGHT_RULES,
    validate_backend_request,
    validate_core_request,
)

Rule = dict[str, Any]
Validator = Callable[[str, str, Mapping[str, Any] | None, Any], None]

CASE_KINDS = [
    "rules",
    "valid",
    "invalid",
    "array_type",
    "enum",
    "enum_member",
    "format",
    "integer",
    "max_items",
    "max_length",
    "maximum",
    "min_items",
    "minimum",
    "type",
]

KNOWN_GOVERNANCE_GAP_CLOSURE_CASES: list[Rule] = [
    {
        "id": "approval-status-invalid-query-not-rejected",
        "operations": [
            "AgentController_getPendingApprovals",
            "AgentController_getApprovalHistory",
            "OrganizationController_getApprovals",
        ],
        "location": "query.status",
        "enum": ["pending", "approved", "rejected", "expired"],
    },
    {
        "id": "core-governance-attempt-min-not-rejected",
        "operations": ["evaluateGovernance"],
        "location": "body.attempt",
        "type": "integer",
        "minimum": 1,
        "integer": True,
    },
    {
        "id": "core-governance-timestamp-format-not-rejected",
        "operations": ["evaluateGovernance"],
        "location": "body.timestamp",
        "type": "string",
        "format": "date-time",
    },
    {
        "id": "core-governance-cost-type-not-rejected",
        "operations": ["evaluateGovernance"],
        "location": "body.cost_usd",
        "type": "number",
        "format": "double",
    },
    {
        "id": "backend-agent-evaluations-query-boundaries-not-rejected",
        "operations": ["AgentController_getAgentEvaluations"],
        "location": "query.page|query.perPage|query.pattern",
        "page_minimum": 0,
        "per_page_minimum": 1,
        "pattern_max_length": 255,
    },
]

EXPECTED_RAW_SEMANTIC_GAP_CONSTRAINT_KEYS = [
    "backend:AgentController_getAgentEvaluations:query.page:minimum",
    "backend:AgentController_getAgentEvaluations:query.pattern:maxLength",
    "backend:AgentController_getAgentEvaluations:query.perPage:minimum",
    "backend:AgentController_getApprovalHistory:query.status:enum",
    "backend:AgentController_getPendingApprovals:query.status:enum",
    "backend:OrganizationController_getApprovals:query.status:enum",
    "core:evaluateGovernance:body.attempt:minimum",
    "core:evaluateGovernance:body.cost_usd:format",
    "core:evaluateGovernance:body.cost_usd:type",
    "core:evaluateGovernance:body.timestamp:format",
]


def test_generated_python_request_preflight_matches_openapi_constraints() -> None:
    assert _normalize_rules(BACKEND_REQUEST_PREFLIGHT_RULES) == _extract_request_rules(
        "OpenboxBackend.json"
    )
    assert _normalize_rules(CORE_REQUEST_PREFLIGHT_RULES) == _extract_request_rules(
        "OpenboxCore.json"
    )


def test_python_backend_request_preflight_exhausts_every_generated_constraint() -> None:
    result = _exercise_rules(BACKEND_REQUEST_PREFLIGHT_RULES, validate_backend_request)
    assert result == _expected_case_counts(BACKEND_REQUEST_PREFLIGHT_RULES)
    assert result["rules"] == len(BACKEND_REQUEST_PREFLIGHT_RULES)
    assert result["valid"] > 0
    assert result["invalid"] > 0
    assert result["enum_member"] > 0
    assert result["minimum"] > 0
    assert result["max_length"] > 0
    assert result["min_items"] > 0
    assert result["type"] > 0


def test_python_core_request_preflight_exhausts_every_generated_constraint() -> None:
    result = _exercise_rules(CORE_REQUEST_PREFLIGHT_RULES, validate_core_request)
    assert result == _expected_case_counts(CORE_REQUEST_PREFLIGHT_RULES)
    assert result["rules"] == len(CORE_REQUEST_PREFLIGHT_RULES)
    assert result["valid"] > 0
    assert result["invalid"] > 0
    assert result["enum_member"] > 0
    assert result["integer"] > 0
    assert result["minimum"] > 0
    assert result["format"] > 0
    assert result["type"] > 0


def test_python_known_governance_gap_closures_are_generated() -> None:
    backend = _normalize_rules(BACKEND_REQUEST_PREFLIGHT_RULES)
    core = _normalize_rules(CORE_REQUEST_PREFLIGHT_RULES)

    for case in KNOWN_GOVERNANCE_GAP_CLOSURE_CASES:
        if case["id"] == "approval-status-invalid-query-not-rejected":
            for operation_id in case["operations"]:
                _assert_query_rule(
                    backend,
                    str(operation_id),
                    "status",
                    {"enum": case["enum"]},
                )
        elif case["id"] == "core-governance-attempt-min-not-rejected":
            _assert_body_rule(
                core,
                "evaluateGovernance",
                ["attempt"],
                {"type": case["type"], "minimum": case["minimum"], "integer": case["integer"]},
            )
        elif case["id"] == "core-governance-timestamp-format-not-rejected":
            _assert_body_rule(
                core,
                "evaluateGovernance",
                ["timestamp"],
                {"type": case["type"], "format": case["format"]},
            )
        elif case["id"] == "core-governance-cost-type-not-rejected":
            _assert_body_rule(
                core,
                "evaluateGovernance",
                ["cost_usd"],
                {"type": case["type"], "format": case["format"]},
            )
        elif case["id"] == "backend-agent-evaluations-query-boundaries-not-rejected":
            _assert_query_rule(
                backend,
                "AgentController_getAgentEvaluations",
                "page",
                {"minimum": case["page_minimum"]},
            )
            _assert_query_rule(
                backend,
                "AgentController_getAgentEvaluations",
                "perPage",
                {"minimum": case["per_page_minimum"]},
            )
            _assert_query_rule(
                backend,
                "AgentController_getAgentEvaluations",
                "pattern",
                {"max_length": case["pattern_max_length"]},
            )
        else:
            raise AssertionError(f"unhandled gap closure case: {case['id']}")


def test_python_known_governance_gap_closures_cover_every_raw_constraint_key() -> None:
    cases = _raw_semantic_gap_constraint_cases()
    assert [case["key"] for case in cases] == EXPECTED_RAW_SEMANTIC_GAP_CONSTRAINT_KEYS


@pytest.mark.asyncio
async def test_python_clients_apply_generated_preflight_before_transport() -> None:
    requests: list[httpx.Request] = []

    async def transport(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"data": {"ok": True}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as http:
        client = AsyncOpenBoxClient(
            api_url="https://backend.example",
            api_key="obx_key_123",
            http_client=http,
        )
        query_rule, query_constraint = _first_query_invalid_case(BACKEND_REQUEST_PREFLIGHT_RULES)
        with pytest.raises(RequestPreflightError):
            await client.request_operation(
                str(query_rule["operation_id"]),
                path_params=_path_params(str(query_rule["path"])),
                params={str(query_constraint["name"]): "__openbox_invalid_enum__"},
            )

        body_rule, body_constraint, invalid_body = _first_body_invalid_case(
            BACKEND_REQUEST_PREFLIGHT_RULES
        )
        with pytest.raises(RequestPreflightError):
            await client.request_operation(
                str(body_rule["operation_id"]),
                path_params=_path_params(str(body_rule["path"])),
                data=_body_with_path_value(body_constraint["path"], invalid_body["value"]),
            )

    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as http:
        client = AsyncOpenBoxCoreClient(
            api_url="https://core.example",
            api_key="obx_test_runtime",
            http_client=http,
        )
        body_rule, body_constraint, invalid_body = _first_body_invalid_case(
            CORE_REQUEST_PREFLIGHT_RULES
        )
        with pytest.raises(RequestPreflightError):
            await client.request_operation(
                str(body_rule["operation_id"]),
                path_params=_path_params(str(body_rule["path"])),
                data=_body_with_path_value(body_constraint["path"], invalid_body["value"]),
            )

    assert requests == []


@pytest.mark.asyncio
async def test_python_clients_block_every_raw_semantic_gap_constraint_before_transport() -> None:
    requests: list[httpx.Request] = []
    cases = _raw_semantic_gap_constraint_cases()
    assert [case["key"] for case in cases] == EXPECTED_RAW_SEMANTIC_GAP_CONSTRAINT_KEYS

    async def transport(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"data": {"ok": True}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as http:
        backend = AsyncOpenBoxClient(
            api_url="https://backend.example",
            api_key="obx_key_123",
            http_client=http,
        )
        core = AsyncOpenBoxCoreClient(
            api_url="https://core.example",
            api_key="obx_test_runtime",
            http_client=http,
        )

        for case in cases:
            client = backend if case["service"] == "backend" else core
            with pytest.raises(RequestPreflightError) as excinfo:
                await client.request_operation(
                    str(case["operation_id"]),
                    path_params=_path_params(str(case["path"])),
                    params=case.get("query"),
                    data=case.get("data"),
                )
            assert excinfo.value.operation_id == case["operation_id"], case["key"]
            assert excinfo.value.location == case["location"], case["key"]

    assert requests == []


@pytest.mark.asyncio
async def test_python_clients_block_known_governance_gaps_before_transport() -> None:
    requests: list[httpx.Request] = []

    async def transport(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"data": {"ok": True}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as http:
        client = AsyncOpenBoxClient(
            api_url="https://backend.example",
            api_key="obx_key_123",
            http_client=http,
        )
        for operation_id in [
            "AgentController_getPendingApprovals",
            "AgentController_getApprovalHistory",
        ]:
            with pytest.raises(RequestPreflightError) as excinfo:
                await client.request_operation(
                    operation_id,
                    path_params={"agentId": "agent-1"},
                    params={"status": "__openbox_invalid_enum__"},
                )
            assert excinfo.value.operation_id == operation_id
            assert excinfo.value.location == "query.status"

        with pytest.raises(RequestPreflightError) as org_excinfo:
            await client.request_operation(
                "OrganizationController_getApprovals",
                path_params={"organizationId": "org-1"},
                params={"status": "__openbox_invalid_enum__"},
            )
        assert org_excinfo.value.operation_id == "OrganizationController_getApprovals"
        assert org_excinfo.value.location == "query.status"

        for member_ids in ["not-an-array", [], [f"user-{index}" for index in range(101)]]:
            with pytest.raises(RequestPreflightError) as remove_excinfo:
                await client.request_operation(
                    "OrganizationController_removeMembers",
                    path_params={"organizationId": "org-1"},
                    data={"memberIds": member_ids},
                )
            assert remove_excinfo.value.operation_id == "OrganizationController_removeMembers"
            assert remove_excinfo.value.location == "body.memberIds"

        for method, path_params, operation_id in [
            (
                client.get_pending_approvals,
                {"agentId": "agent-1"},
                "AgentController_getPendingApprovals",
            ),
            (
                client.get_approval_history,
                {"agentId": "agent-1"},
                "AgentController_getApprovalHistory",
            ),
            (
                client.get_org_approvals,
                {"organizationId": "org-1"},
                "OrganizationController_getApprovals",
            ),
        ]:
            with pytest.raises(RequestPreflightError) as public_status_excinfo:
                await method(
                    path_params=path_params,
                    query={"status": "__openbox_invalid_enum__"},
                )
            assert public_status_excinfo.value.operation_id == operation_id
            assert public_status_excinfo.value.location == "query.status"

        agent_evaluations_rule = _rule_for(
            _normalize_rules(BACKEND_REQUEST_PREFLIGHT_RULES),
            "AgentController_getAgentEvaluations",
        )
        assert sorted(query["name"] for query in agent_evaluations_rule["query"]) == [
            "page",
            "pattern",
            "perPage",
        ]
        for query_constraint in agent_evaluations_rule["query"]:
            invalid_case = _invalid_cases(query_constraint)[0]
            with pytest.raises(RequestPreflightError) as public_query_excinfo:
                await client.get_agent_violations(
                    path_params={"agentId": "agent-1"},
                    query={query_constraint["name"]: invalid_case["value"]},
                )
            assert public_query_excinfo.value.operation_id == "AgentController_getAgentEvaluations"
            assert public_query_excinfo.value.location == f"query.{query_constraint['name']}"

        for member_ids in ["not-an-array", [], [f"user-{index}" for index in range(101)]]:
            with pytest.raises(RequestPreflightError) as public_remove_excinfo:
                await client.remove_members(
                    path_params={"organizationId": "org-1"},
                    data={"memberIds": member_ids},
                )
            assert (
                public_remove_excinfo.value.operation_id
                == "OrganizationController_removeMembers"
            )
            assert public_remove_excinfo.value.location == "body.memberIds"

    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as http:
        client = AsyncOpenBoxCoreClient(
            api_url="https://core.example",
            api_key="obx_test_runtime",
            http_client=http,
        )
        for attempt in [0, 0.5]:
            with pytest.raises(RequestPreflightError) as core_excinfo:
                await client.evaluate(
                    {
                        "event_type": "ActivityStarted",
                        "workflow_id": "wf-1",
                        "run_id": "run-1",
                        "workflow_type": "unit-test",
                        "task_queue": "langchain",
                        "source": "workflow-telemetry",
                        "timestamp": "2026-06-21T00:00:00Z",
                        "activity_id": "act-1",
                        "activity_type": "my-activity",
                        "attempt": attempt,
                    }
                )
            assert core_excinfo.value.operation_id == "evaluateGovernance"
            assert core_excinfo.value.location == "body.attempt"

        with pytest.raises(RequestPreflightError) as timestamp_excinfo:
            await client.evaluate(
                {
                    "event_type": "ActivityStarted",
                    "workflow_id": "wf-1",
                    "run_id": "run-1",
                    "workflow_type": "unit-test",
                    "task_queue": "langchain",
                    "source": "workflow-telemetry",
                    "timestamp": "not-a-date-time",
                    "activity_id": "act-1",
                    "activity_type": "my-activity",
                }
            )
        assert timestamp_excinfo.value.operation_id == "evaluateGovernance"
        assert timestamp_excinfo.value.location == "body.timestamp"

        with pytest.raises(RequestPreflightError) as cost_excinfo:
            await client.evaluate(
                {
                    "event_type": "ActivityStarted",
                    "workflow_id": "wf-1",
                    "run_id": "run-1",
                    "workflow_type": "unit-test",
                    "task_queue": "langchain",
                    "source": "workflow-telemetry",
                    "timestamp": "2026-06-21T00:00:00Z",
                    "activity_id": "act-1",
                    "activity_type": "my-activity",
                    "cost_usd": "not-a-number",
                }
            )
        assert cost_excinfo.value.operation_id == "evaluateGovernance"
        assert cost_excinfo.value.location == "body.cost_usd"

    assert requests == []


@pytest.mark.asyncio
async def test_python_public_backend_methods_block_transport_gated_constraints_before_transport(
) -> None:
    requests: list[httpx.Request] = []

    async def transport(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"data": {"ok": True}})

    cases = _transport_gated_public_method_constraints()
    case_keys = [str(case["key"]) for case in cases]
    assert case_keys == _transport_gated_public_method_constraint_keys()
    assert len(case_keys) > 0

    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as http:
        client = AsyncOpenBoxClient(
            api_url="https://backend.example",
            api_key="obx_key_123",
            http_client=http,
        )

        for case in cases:
            method = getattr(client, case["method_name"])
            with pytest.raises(RequestPreflightError) as excinfo:
                await method(
                    path_params=_path_params(str(case["path"])),
                    query=case.get("query"),
                    data=case.get("data"),
                )
            assert excinfo.value.operation_id == case["operation_id"], case["key"]
            assert excinfo.value.location == case["location"], case["key"]

    assert requests == []


def _exercise_rules(rules: list[Rule], validate: Validator) -> dict[str, int]:
    counts = _empty_case_counts()
    for rule in _normalize_rules(rules):
        counts["rules"] += 1
        rendered_path = _concrete_path(str(rule["path"]))
        for query_rule in rule.get("query") or []:
            location = f"query.{query_rule['name']}"
            for value in _valid_values(query_rule):
                validate(str(rule["method"]), rendered_path, {query_rule["name"]: value}, None)
                counts["valid"] += 1
                if query_rule.get("enum") is not None:
                    counts["enum_member"] += 1
            for test_case in _invalid_cases(query_rule):
                _assert_rejects(
                    validate,
                    rule,
                    location,
                    {query_rule["name"]: test_case["value"]},
                    None,
                )
                _record_invalid_case(counts, test_case)

        for body_rule in rule.get("body") or []:
            location = f"body.{'.'.join(body_rule['path'])}"
            for value in _valid_values(body_rule):
                validate(
                    str(rule["method"]),
                    rendered_path,
                    None,
                    _body_with_path_value(body_rule["path"], value),
                )
                counts["valid"] += 1
                if body_rule.get("enum") is not None:
                    counts["enum_member"] += 1
            for test_case in _invalid_cases(
                body_rule,
                include_array_type=True,
                include_body_type=True,
            ):
                _assert_rejects(
                    validate,
                    rule,
                    location,
                    None,
                    _body_with_path_value(body_rule["path"], test_case["value"]),
                )
                _record_invalid_case(counts, test_case)
    return counts


def _expected_case_counts(rules: list[Rule]) -> dict[str, int]:
    counts = _empty_case_counts()
    for rule in _normalize_rules(rules):
        counts["rules"] += 1
        for query_rule in rule.get("query") or []:
            valid_values = _valid_values(query_rule)
            counts["valid"] += len(valid_values)
            if query_rule.get("enum") is not None:
                counts["enum_member"] += len(valid_values)
            for test_case in _invalid_cases(query_rule):
                _record_invalid_case(counts, test_case)

        for body_rule in rule.get("body") or []:
            valid_values = _valid_values(body_rule)
            counts["valid"] += len(valid_values)
            if body_rule.get("enum") is not None:
                counts["enum_member"] += len(valid_values)
            for test_case in _invalid_cases(
                body_rule,
                include_array_type=True,
                include_body_type=True,
            ):
                _record_invalid_case(counts, test_case)
    return counts


def _empty_case_counts() -> dict[str, int]:
    return dict.fromkeys(CASE_KINDS, 0)


def _record_invalid_case(counts: dict[str, int], test_case: Rule) -> None:
    kind = str(test_case["kind"])
    assert kind in counts, f"unexpected invalid request preflight case kind: {kind}"
    counts[kind] += 1
    counts["invalid"] += 1


def _transport_gated_public_method_constraints() -> list[Rule]:
    endpoints = {
        str(entry["operation_id"]): entry
        for entry in BACKEND_ENDPOINT_MANIFEST
    }
    cases: list[Rule] = []
    for rule in _normalize_rules(BACKEND_REQUEST_PREFLIGHT_RULES):
        operation_id = str(rule["operation_id"])
        if not _is_transport_or_feature_gated_operation(operation_id):
            continue
        endpoint = endpoints[operation_id]
        for query_rule in rule.get("query") or []:
            location = f"query.{query_rule['name']}"
            for kind in _executable_constraint_kinds(query_rule, include_type=False):
                cases.append(
                    {
                        "key": _constraint_key("backend", operation_id, location, kind),
                        "operation_id": operation_id,
                        "method_name": endpoint["method_name"],
                        "path": endpoint["path"],
                        "location": location,
                        "kind": kind,
                        "query": {
                            query_rule["name"]: _invalid_value_for_constraint(query_rule, kind)
                        },
                    }
                )
        for body_rule in rule.get("body") or []:
            location = f"body.{'.'.join(body_rule['path'])}"
            for kind in _executable_constraint_kinds(body_rule, include_type=True):
                cases.append(
                    {
                        "key": _constraint_key("backend", operation_id, location, kind),
                        "operation_id": operation_id,
                        "method_name": endpoint["method_name"],
                        "path": endpoint["path"],
                        "location": location,
                        "kind": kind,
                        "data": _body_with_path_value(
                            body_rule["path"],
                            _invalid_value_for_constraint(body_rule, kind),
                        ),
                    }
                )
    return sorted(
        cases,
        key=lambda case: (
            str(case["operation_id"]),
            str(case["location"]),
            str(case["kind"]),
        ),
    )


def _transport_gated_public_method_constraint_keys() -> list[str]:
    keys: list[str] = []
    for rule in _normalize_rules(BACKEND_REQUEST_PREFLIGHT_RULES):
        operation_id = str(rule["operation_id"])
        if not _is_transport_or_feature_gated_operation(operation_id):
            continue
        for query_rule in rule.get("query") or []:
            location = f"query.{query_rule['name']}"
            for kind in _executable_constraint_kinds(query_rule, include_type=False):
                keys.append(_constraint_key("backend", operation_id, location, kind))
        for body_rule in rule.get("body") or []:
            location = f"body.{'.'.join(body_rule['path'])}"
            for kind in _executable_constraint_kinds(body_rule, include_type=True):
                keys.append(_constraint_key("backend", operation_id, location, kind))
    return sorted(keys)


def _raw_semantic_gap_constraint_cases() -> list[Rule]:
    cases: list[Rule] = []
    expected_keys = set(EXPECTED_RAW_SEMANTIC_GAP_CONSTRAINT_KEYS)
    for service, rules in [
        ("backend", _normalize_rules(BACKEND_REQUEST_PREFLIGHT_RULES)),
        ("core", _normalize_rules(CORE_REQUEST_PREFLIGHT_RULES)),
    ]:
        for rule in rules:
            operation_id = str(rule["operation_id"])
            for query_rule in rule.get("query") or []:
                location = f"query.{query_rule['name']}"
                for kind in _executable_constraint_kinds(query_rule, include_type=False):
                    key = _constraint_key(service, operation_id, location, kind)
                    if key not in expected_keys:
                        continue
                    cases.append(
                        {
                            "key": key,
                            "service": service,
                            "operation_id": operation_id,
                            "path": rule["path"],
                            "location": location,
                            "kind": kind,
                            "query": {
                                query_rule["name"]: _invalid_value_for_constraint(
                                    query_rule,
                                    kind,
                                )
                            },
                        }
                    )
            for body_rule in rule.get("body") or []:
                location = f"body.{'.'.join(body_rule['path'])}"
                for kind in _executable_constraint_kinds(body_rule, include_type=True):
                    key = _constraint_key(service, operation_id, location, kind)
                    if key not in expected_keys:
                        continue
                    invalid_value = _invalid_value_for_constraint(body_rule, kind)
                    cases.append(
                        {
                            "key": key,
                            "service": service,
                            "operation_id": operation_id,
                            "path": rule["path"],
                            "location": location,
                            "kind": kind,
                            "data": _semantic_gap_body(rule, body_rule, invalid_value),
                        }
                    )
    return sorted(cases, key=lambda case: str(case["key"]))


def _constraint_key(service: str, operation_id: str, location: str, kind: str) -> str:
    return f"{service}:{operation_id}:{location}:{_canonical_constraint_kind(kind)}"


def _canonical_constraint_kind(kind: str) -> str:
    return {
        "max_items": "maxItems",
        "max_length": "maxLength",
        "min_items": "minItems",
    }.get(kind, kind)


def _semantic_gap_body(rule: Rule, body_rule: Rule, invalid_value: Any) -> Any:
    body = (
        _base_core_governance_payload()
        if rule.get("operation_id") == "evaluateGovernance"
        else {}
    )
    path = body_rule["path"]
    if len(path) == 1 and path[0] != "*":
        return {**body, str(path[0]): invalid_value}
    return _body_with_path_value(path, invalid_value)


def _base_core_governance_payload() -> dict[str, Any]:
    return {
        "event_type": "ActivityStarted",
        "workflow_id": "wf-1",
        "run_id": "run-1",
        "workflow_type": "unit-test",
        "task_queue": "langchain",
        "source": "workflow-telemetry",
        "timestamp": "2026-06-21T00:00:00Z",
        "activity_id": "act-1",
        "activity_type": "my-activity",
    }


def _is_transport_or_feature_gated_operation(operation_id: str) -> bool:
    return (
        operation_id.startswith("ApiKeyController_")
        or operation_id.startswith("WebhookController_")
        or operation_id
        in {
            "OrganizationController_getMembers",
            "OrganizationController_sendWelcomeEmail",
        }
    )


def _executable_constraint_kinds(rule: Rule, *, include_type: bool) -> list[str]:
    kinds: list[str] = []
    if include_type and rule.get("type") is not None:
        kinds.append("type")
    if rule.get("enum") is not None:
        kinds.append("enum")
    if rule.get("format") is not None:
        kinds.append("format")
    if rule.get("integer") is True:
        kinds.append("integer")
    if rule.get("maximum") is not None:
        kinds.append("maximum")
    if rule.get("max_items") is not None:
        kinds.append("max_items")
    if rule.get("max_length") is not None:
        kinds.append("max_length")
    if rule.get("minimum") is not None:
        kinds.append("minimum")
    if rule.get("min_items") is not None:
        kinds.append("min_items")
    return kinds


def _invalid_value_for_constraint(rule: Rule, kind: str) -> Any:
    cases = _invalid_cases(rule, include_array_type=True, include_body_type=True)
    found = next((case for case in cases if case["kind"] == kind), None)
    assert found is not None, f"missing invalid value for {kind}: {rule}"
    return found["value"]


def _assert_rejects(
    validate: Validator,
    rule: Rule,
    location: str,
    query: Mapping[str, Any] | None,
    body: Any,
) -> None:
    with pytest.raises(RequestPreflightError) as excinfo:
        validate(str(rule["method"]), _concrete_path(str(rule["path"])), query, body)
    assert excinfo.value.operation_id == rule["operation_id"]
    assert excinfo.value.location == location


def _invalid_cases(
    rule: Rule,
    *,
    include_array_type: bool = False,
    include_body_type: bool = False,
) -> list[Rule]:
    cases: list[Rule] = []
    if include_array_type and (
        rule.get("min_items") is not None or rule.get("max_items") is not None
    ):
        cases.append({"kind": "array_type", "value": "not-an-array"})
    if include_body_type and rule.get("type") == "string":
        cases.append({"kind": "type", "value": 42})
    if include_body_type and rule.get("type") in {"number", "integer"}:
        cases.append({"kind": "type", "value": "not-a-number"})
    if rule.get("enum") is not None:
        cases.append({"kind": "enum", "value": "__openbox_invalid_enum__"})
    if rule.get("format") == "uuid":
        cases.append({"kind": "format", "value": "not-a-uuid"})
    if rule.get("format") == "date-time":
        cases.append({"kind": "format", "value": "not-a-date-time"})
    if rule.get("format") == "double":
        cases.append({"kind": "format", "value": "not-a-number"})
    if rule.get("integer") is True:
        cases.append({"kind": "integer", "value": _fractional_within_range(rule)})
    if rule.get("minimum") is not None:
        cases.append({"kind": "minimum", "value": float(rule["minimum"]) - 1})
    if rule.get("maximum") is not None:
        cases.append({"kind": "maximum", "value": float(rule["maximum"]) + 1})
    if rule.get("max_length") is not None:
        cases.append({"kind": "max_length", "value": "x" * (int(rule["max_length"]) + 1)})
    if rule.get("min_items") is not None:
        length = max(0, int(rule["min_items"]) - 1)
        cases.append({"kind": "min_items", "value": [f"item-{index}" for index in range(length)]})
    if rule.get("max_items") is not None:
        length = int(rule["max_items"]) + 1
        cases.append({"kind": "max_items", "value": [f"item-{index}" for index in range(length)]})
    return cases


def _valid_values(rule: Rule) -> list[Any]:
    if rule.get("enum") is not None:
        return [str(value) for value in rule["enum"]]
    if rule.get("min_items") is not None or rule.get("max_items") is not None:
        return _valid_array_values(rule)

    values: list[Any] = []
    if rule.get("format") == "uuid":
        values.append("00000000-0000-4000-8000-000000000000")
    if rule.get("format") == "date-time":
        values.append("2026-06-21T00:00:00.000Z")
    if rule.get("minimum") is not None:
        values.append(int(rule["minimum"]) if rule.get("integer") is True else rule["minimum"])
    if rule.get("maximum") is not None:
        values.append(int(rule["maximum"]) if rule.get("integer") is True else rule["maximum"])
    if rule.get("integer") is True and not values:
        values.append(1)
    if rule.get("type") == "number" and not values:
        values.append(0)
    if rule.get("max_length") is not None:
        values.append("x" * int(rule["max_length"]))
    if not values:
        values.append("valid")
    return _unique_values(values)


def _valid_array_values(rule: Rule) -> list[list[str]]:
    values: list[list[str]] = []
    if rule.get("min_items") is not None:
        length = int(rule["min_items"])
        values.append([f"item-{index}" for index in range(length)])
    if rule.get("max_items") is not None:
        length = int(rule["max_items"])
        values.append([f"item-{index}" for index in range(length)])
    return _unique_values(values)


def _unique_values(values: list[Any]) -> list[Any]:
    unique: list[Any] = []
    encoded: set[str] = set()
    for value in values:
        key = json.dumps(value, sort_keys=True)
        if key in encoded:
            continue
        encoded.add(key)
        unique.append(value)
    return unique


def _fractional_within_range(rule: Rule) -> float:
    minimum = float(rule.get("minimum", 0))
    candidate = minimum + 0.5
    if rule.get("maximum") is not None and candidate > float(rule["maximum"]):
        return float(rule["maximum"]) - 0.5
    return candidate


def _body_with_path_value(path: list[str], value: Any) -> Any:
    if not path:
        return value
    head, *tail = path
    if head == "*":
        return [_body_with_path_value(tail, value)]
    return {head: _body_with_path_value(tail, value)}


def _first_query_invalid_case(rules: list[Rule]) -> tuple[Rule, Rule]:
    for rule in _normalize_rules(rules):
        for query_rule in rule.get("query") or []:
            if _invalid_cases(query_rule):
                return rule, query_rule
    raise AssertionError("expected at least one generated query preflight constraint")


def _first_body_invalid_case(rules: list[Rule]) -> tuple[Rule, Rule, Rule]:
    for rule in _normalize_rules(rules):
        for body_rule in rule.get("body") or []:
            cases = _invalid_cases(body_rule, include_array_type=True)
            if cases:
                return rule, body_rule, cases[0]
    raise AssertionError("expected at least one generated body preflight constraint")


def _assert_query_rule(
    rules: list[Rule],
    operation_id: str,
    name: str,
    expected: Rule,
) -> None:
    rule = _rule_for(rules, operation_id)
    found = next(
        (entry for entry in rule.get("query", []) if entry.get("name") == name),
        None,
    )
    assert found is not None, f"missing query rule {operation_id}.{name}"
    for key, value in expected.items():
        assert found.get(key) == value


def _assert_body_rule(
    rules: list[Rule],
    operation_id: str,
    path: list[str],
    expected: Rule,
) -> None:
    rule = _rule_for(rules, operation_id)
    found = next(
        (entry for entry in rule.get("body", []) if entry.get("path") == path),
        None,
    )
    assert found is not None, f"missing body rule {operation_id}.{'.'.join(path)}"
    for key, value in expected.items():
        assert found.get(key) == value


def _rule_for(rules: list[Rule], operation_id: str) -> Rule:
    found = next(
        (entry for entry in rules if entry.get("operation_id") == operation_id),
        None,
    )
    assert found is not None, f"missing request preflight rule for {operation_id}"
    return found


def _extract_request_rules(openapi_name: str) -> list[Rule]:
    openapi = json.loads((_repo_root() / "specs/generated/openapi3" / openapi_name).read_text())
    methods = {"get", "post", "put", "patch", "delete"}
    out: list[Rule] = []
    for path, item in (openapi.get("paths") or {}).items():
        for method, operation in item.items():
            operation_id = operation.get("operationId")
            if method not in methods or not operation_id:
                continue
            query = _collect_query_rules(operation.get("parameters") or [], openapi)
            body_schema = (
                operation.get("requestBody", {})
                .get("content", {})
                .get("application/json", {})
                .get("schema")
            )
            body = _collect_body_rules(_resolve_schema(body_schema, openapi), openapi, [])
            if not query and not body:
                continue
            out.append(
                {
                    "operation_id": operation_id,
                    "method": method.upper(),
                    "path": path,
                    "path_pattern": _path_pattern(path),
                    "query": query or None,
                    "body": body or None,
                }
            )
    return _normalize_rules(out)


def _collect_query_rules(parameters: list[Rule], openapi: Rule) -> list[Rule]:
    out: list[Rule] = []
    for parameter in parameters:
        if (
            parameter.get("in") != "query"
            or not parameter.get("name")
            or not parameter.get("schema")
        ):
            continue
        constraints = _constraints_from_schema(_resolve_schema(parameter["schema"], openapi))
        if constraints:
            out.append({"name": parameter["name"], **constraints})
    return sorted(out, key=lambda entry: str(entry["name"]))


def _collect_body_rules(
    schema: Rule | None,
    openapi: Rule,
    path: list[str],
    seen: set[str] | None = None,
) -> list[Rule]:
    if not schema:
        return []
    seen = set(seen or set())
    resolved = _resolve_schema(schema, openapi, seen)
    out: list[Rule] = []
    constraints = _constraints_from_schema(resolved)
    if path and constraints:
        out.append({"path": path, **constraints})

    for branch in [
        *(resolved.get("allOf") or []),
        *(resolved.get("oneOf") or []),
        *(resolved.get("anyOf") or []),
    ]:
        out.extend(_collect_body_rules(branch, openapi, path, set(seen)))
    for key, property_schema in (resolved.get("properties") or {}).items():
        out.extend(_collect_body_rules(property_schema, openapi, [*path, key], set(seen)))
    if resolved.get("items") and path:
        out.extend(_collect_body_rules(resolved["items"], openapi, [*path, "*"], set(seen)))
    return out


def _constraints_from_schema(schema: Rule) -> Rule | None:
    enum_values = [value for value in schema.get("enum", []) if isinstance(value, str)]
    has_constraint = (
        bool(schema.get("format"))
        or bool(enum_values)
        or isinstance(schema.get("minimum"), int | float)
        or isinstance(schema.get("maximum"), int | float)
        or isinstance(schema.get("maxLength"), int)
        or isinstance(schema.get("minItems"), int)
        or isinstance(schema.get("maxItems"), int)
        or schema.get("type") == "integer"
    )
    if not has_constraint:
        return None
    out: Rule = {}
    if schema.get("type"):
        out["type"] = schema["type"]
    if schema.get("format"):
        out["format"] = schema["format"]
    if enum_values:
        out["enum"] = enum_values
    if isinstance(schema.get("minimum"), int | float):
        out["minimum"] = schema["minimum"]
    if isinstance(schema.get("maximum"), int | float):
        out["maximum"] = schema["maximum"]
    if isinstance(schema.get("maxLength"), int):
        out["max_length"] = schema["maxLength"]
    if isinstance(schema.get("minItems"), int):
        out["min_items"] = schema["minItems"]
    if isinstance(schema.get("maxItems"), int):
        out["max_items"] = schema["maxItems"]
    if schema.get("type") == "integer":
        out["integer"] = True
    return out


def _resolve_schema(schema: Rule | None, openapi: Rule, seen: set[str] | None = None) -> Rule:
    if not schema:
        return {}
    ref = schema.get("$ref")
    if not ref:
        return schema
    seen = seen if seen is not None else set()
    if ref in seen:
        return schema
    seen.add(str(ref))
    prefix = "#/components/schemas/"
    if not str(ref).startswith(prefix):
        return schema
    name = str(ref)[len(prefix) :]
    resolved = (openapi.get("components", {}).get("schemas", {}) or {}).get(name)
    return _resolve_schema(resolved, openapi, seen) if resolved else schema


def _normalize_rules(rules: list[Rule]) -> list[Rule]:
    normalized: list[Rule] = []
    for rule in rules:
        entry = {
            key: value
            for key, value in rule.items()
            if value is not None and key not in {"query", "body"}
        }
        if rule.get("query") is not None:
            entry["query"] = sorted(rule["query"], key=lambda item: str(item["name"]))
        if rule.get("body") is not None:
            entry["body"] = sorted(rule["body"], key=lambda item: ".".join(item["path"]))
        normalized.append(entry)
    return sorted(normalized, key=lambda item: (str(item["operation_id"]), str(item["method"])))


def _path_pattern(path: str) -> str:
    return "^" + "".join(
        "[^/]+"
        if part.startswith("{") and part.endswith("}")
        else re.sub(r"([.*+?^${}()|\[\]\\])", r"\\\1", part)
        for part in re.split(r"(\{[^}]+\})", path)
    ) + "$"


def _concrete_path(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "00000000-0000-4000-8000-000000000000", path)


def _path_params(path: str) -> dict[str, str]:
    return {
        match.group(1): "00000000-0000-4000-8000-000000000000"
        for match in re.finditer(r"\{([^}]+)\}", path)
    }


def _repo_root() -> Path:
    return Path(__file__).parents[2]
