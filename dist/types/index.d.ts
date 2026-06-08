import { v as components$1 } from '../responses-C2s9PwZF.js';
export { A as Agent, a as ApiKey, b as ApiKeyResponse, c as Approval, d as ApprovalsMetrics, e as Assessment, f as AuditExport, g as AuditLog, h as Backend, B as BehaviorRule, C as CreateAgentResponse, i as CsrfToken, G as Guardrail, M as Member, j as MessageResponse, O as OrgApprovalsResponse, k as OrgFeatures, l as OrgSettings, m as Organization, P as PaginatedResponse, n as Policy, S as Session, o as SsoStatus, T as Team, p as TrustEvent, q as TrustHistory, r as TrustTierChange, U as UserProfile, s as UserRole, V as Violation, W as Webhook, t as WebhookDelivery } from '../responses-C2s9PwZF.js';

type Schema<K extends keyof components$1['schemas']> = components$1['schemas'][K];
interface PaginationQuery {
    page?: number;
    perPage?: number;
}
interface MetricsQuery {
    fromTime?: string;
    toTime?: string;
}
interface ApprovalListQuery extends PaginationQuery {
    search?: string;
    status?: 'pending' | 'approved' | 'rejected' | 'expired';
    tiers?: string[];
    agent_id?: string;
    team_ids?: string[];
    activity_types?: string[];
    fromTime?: string;
    toTime?: string;
    organization_id?: string;
}
interface SessionListQuery extends PaginationQuery {
    status?: 'pending' | 'completed' | 'failed' | 'blocked' | 'halted';
    fromTime?: string;
    toTime?: string;
    duration?: '<1min' | '1-5mins' | '5-15mins' | '>15mins';
    search?: string;
}
interface AuditLogQuery extends PaginationQuery {
    eventType?: 'policy_change' | 'guardrail_change' | 'agent_session' | 'agent_risk_configuration_change' | 'agent_goal_alignment_configuration_change' | 'role_change' | 'security_event' | 'settings_update' | 'team_management' | 'member_management' | 'invitation';
    actorId?: string;
    result?: 'success' | 'failed' | 'denied' | 'warning' | 'approved' | 'allowed';
    search?: string;
    startDate?: string;
    endDate?: string;
}
interface ExportHistoryQuery extends PaginationQuery {
    status?: 'pending' | 'processing' | 'completed' | 'failed';
    startDate?: string;
    endDate?: string;
}
interface GetAgentViolationsQuery extends PaginationQuery {
    fromTime?: string;
    toTime?: string;
    search?: string;
    pattern?: string;
    status?: string;
    sourceType?: string;
    activity_types?: string[];
}
type BaseSecurityConfig = Schema<'BaseSecurityDto'>;
type AISpecificConfig = Schema<'AISpecificDto'>;
type ImpactConfig = Schema<'ImpactDto'>;
type AivssConfig = Schema<'AivssConfigDto'>;
type GoalAlignmentConfig = Schema<'GoalAlignmentConfigDto'>;
type LoginDto = Schema<'LoginDto'>;
type ForgotPasswordDto = Schema<'ForgotPasswordDto'>;
type ResetPasswordDto = Schema<'ResetPasswordDto'>;
type ChangePasswordDto = Schema<'ChangePasswordDto'>;
type CreateOrganizationDto = Schema<'CreateOrganizationDto'>;
type SendWelcomeEmailDto = Schema<'SendWelcomeEmailDto'>;
type CreateAgentDto = Schema<'CreateAgentDto'>;
type UpdateAgentDto = Schema<'UpdateAgentDto'>;
type TrustImpact = 'none' | 'low' | 'medium' | 'high';
type CreateGuardrailDto = Schema<'CreateGuardrailDto'>;
type UpdateGuardrailDto = Schema<'UpdateGuardrailDto'>;
type CreatePolicyDto = Schema<'CreatePolicyDto'>;
type UpdatePolicyDto = Schema<'UpdatePolicyDto'>;
type BehaviorTrigger = 'http_request' | 'db_query' | 'file_operation' | 'function_call' | 'on_workflow_completed' | 'on_workflow_failed' | 'on_workflow_started' | 'on_signal_received' | 'temporal_workflow_event' | 'on_activity_started' | 'on_activity_completed' | 'on_activity_input' | 'on_activity_output' | 'on_signal' | 'on_query' | 'on_timer' | 'on_message' | 'on_error' | 'on_state_change' | 'shell_execution' | 'internal' | 'mcp_tool_call';
type BehaviorVerdict = 0 | 1 | 2 | 3 | 4;
type CreateBehaviorRuleDto = Schema<'CreateBehaviorRuleDto'>;
type UpdateBehavioralRuleDto = Schema<'UpdateBehavioralRuleDto'>;
type UpdateBehaviorRuleDto = UpdateBehavioralRuleDto;
type TestGuardrailDto = Schema<'TestGuardrailDto'>;
type EvaluateRegoDto = Schema<'EvaluateRegoDto'>;
type UpdateOrgSettingsDto = Schema<'UpdateOrganizationSettingsDto'>;
type CreateUserDto = Schema<'CreateUserDto'>;
type UpdateMemberDto = Schema<'UpdateMemberDto'>;
type InviteUserDto = Schema<'InviteUserDto'>;
type AssignRolesDto = Schema<'AssignRolesDto'>;
type RemoveMembersDto = Schema<'RemoveMembersDto'>;
type CreateTeamDto = Schema<'CreateTeamDto'>;
type UpdateTeamDto = Schema<'UpdateTeamDto'>;
type DeleteTeamsDto = Schema<'DeleteTeamsDto'>;
type AddTeamMembersDto = Schema<'AddTeamMembersDto'>;
type DeleteTeamMembersDto = Schema<'DeleteTeamMembersDto'>;
type ExportAuditLogsDto = Schema<'ExportAuditLogsDto'>;
type PreviewExportDto = Schema<'PreviewExportDto'>;
type CreateApiKeyDto = Schema<'CreateApiKeyDto'>;
type UpdateApiKeyDto = Schema<'UpdateApiKeyDto'>;
type CreateWebhookDto = Schema<'CreateWebhookDto'>;
type UpdateWebhookDto = Schema<'UpdateWebhookDto'>;
type ConfigureOidcDto = Record<string, unknown>;
type ConfigureSamlDto = Record<string, unknown>;
type EnforceSsoDto = Record<string, unknown>;

/**
 * JWT token utilities for automatic token refresh.
 */
/**
 * Decodes the expiry timestamp from a JWT token without verifying the signature.
 * Returns the expiry time in milliseconds, or null if the token cannot be decoded.
 */
declare function decodeJwtExpiry(token: string): number | null;
/**
 * Returns true if the given JWT token is expired or will expire within the
 * specified buffer (default 60 seconds).
 */
declare function isTokenExpired(token: string, bufferMs?: number): boolean;

/**
 * This file was auto-generated by openapi-typescript.
 * Do not make direct changes to the file.
 */
interface paths {
    "/": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Health check
         * @description Returns the literal string `hello world`. Used by load balancers and uptime probes.
         */
        get: operations["healthCheck"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/validate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Validate the bearer API key
         * @description Verifies the `Authorization: Bearer <obx_live_*|obx_test_*>` header
         *     against the agent registry. Returns the resolved agent identity
         *     and the `live` vs `test` environment derived from the prefix.
         */
        get: operations["validateApiKey"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/governance/approval": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Poll approval status
         * @description SDK polls this after a `require_approval` verdict. Lookup is by
         *     `(workflow_id, run_id, activity_id)`; the tuple uniquely
         *     identifies the activity attempt awaiting human decision.
         *
         *     This endpoint uses the same runtime agent authentication as
         *     `/governance/evaluate`, so agents can only poll approvals they own.
         */
        post: operations["pollApproval"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/governance/evaluate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Evaluate a governance event
         * @description Receives one event from a governed workflow and returns a verdict.
         *     The wire format multiplexes five `event_type` values
         *     (WorkflowStarted, WorkflowCompleted, WorkflowFailed,
         *     ActivityStarted, ActivityCompleted, SignalReceived) onto a single
         *     struct; populate only the fields relevant to the event type.
         *
         *     Internally fans out to: token validation -> session check ->
         *     dedup -> OPA policy -> guardrails -> AGE behavioral compliance ->
         *     goal alignment -> attestation. Verdict is the highest-priority
         *     result across all branches. Default workflow timeout is 30s.
         *
         *     The SDK MUST propagate the original `WorkflowID` / `RunID` /
         *     `ActivityID` across paired Started/Completed events for dedup
         *     and approval polling to work.
         */
        post: operations["evaluateGovernance"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
type webhooks = Record<string, never>;
interface components {
    schemas: {
        AGEAlignmentResult: {
            is_aligned: boolean;
            /** Format: double */
            score: number;
        };
        /**
         * @description Output of the agent-governance evaluation: behavioral compliance,
         *     alignment scoring, and trust update.
         */
        AGEResult: {
            allowed: boolean;
            verdict: components["schemas"]["Verdict"];
            reason?: string;
            /** @description True if LlamaFirewall ran for this event. */
            goal_alignment_checked: boolean;
            /** @description True if alignment score crossed the agent's threshold. */
            goal_drifted: boolean;
            fallback_used: boolean;
            final_trust_score?: components["schemas"]["AGETrustScore"];
            span_results: components["schemas"]["AGESpanResult"][];
            /** Format: int32 */
            total_spans: number;
            /** Format: int32 */
            violations_count: number;
            /** Format: int64 */
            response_time_ms: number;
        };
        AGESpanResult: {
            span_id: string;
            semantic_type: string;
            /** @description Free-form behavioral evaluator output. Null when not evaluated. */
            behavioral_result: unknown;
            alignment_result?: components["schemas"]["AGEAlignmentResult"];
            trust_score_after?: components["schemas"]["AGETrustScore"];
            /** Format: date-time */
            timestamp: string;
        };
        AGETrustScore: {
            /** Format: double */
            trust_score: number;
            /** Format: int32 */
            trust_tier: number;
            /** Format: double */
            behavioral_compliance: number;
            /** Format: double */
            alignment_consistency: number;
            /** Format: double */
            aivss_baseline: number;
        };
        /**
         * @description Response from `/auth/validate`. `environment` is derived from the
         *     token prefix (`obx_live_*` -> `live`, `obx_test_*` -> `test`,
         *     anything else -> `unknown`).
         */
        AgentValidationResponse: {
            valid: boolean;
            /**
             * @description False if the agent record exists but is suspended/disabled.
             *     (The 401 path handles unknown / malformed tokens; this flag
             *     distinguishes a known-but-inactive agent.)
             */
            active: boolean;
            /** Format: uuid */
            agent_id: string;
            agent_name: string;
            /** @enum {string} */
            environment: "live" | "test" | "unknown";
            message: string;
        };
        /**
         * @description Lookup tuple for `/governance/approval`. The server only
         *     validates non-empty strings after authenticating the runtime agent.
         */
        ApprovalStatusRequest: {
            workflow_id: string;
            run_id: string;
            activity_id: string;
        };
        ApprovalStatusResponse: {
            /**
             * Format: uuid
             * @description Governance event ID.
             */
            id: string;
            action: components["schemas"]["LegacyAction"];
            reason?: string;
            /**
             * Format: date-time
             * @description Absent when the request hasn't entered the approval flow yet
             *     or when no expiration was set on the policy.
             */
            approval_expiration_time?: string;
        };
        CoreError: {
            /** @description HTTP status echoed in the body. */
            code: number;
            message: string;
        };
        ErrorInfo: {
            type: string;
            message: string;
            stack_trace?: string;
            cause?: components["schemas"]["ErrorInfo"];
            /** @description Application-level error classifier, e.g. Temporal's `ApplicationError` type. */
            error_type?: string;
            non_retryable?: boolean;
        };
        /**
         * @description Discriminator for the unified `GovernanceEventPayload`.
         * @enum {string}
         */
        EventType: "WorkflowStarted" | "WorkflowCompleted" | "WorkflowFailed" | "ActivityStarted" | "ActivityCompleted" | "SignalReceived";
        /**
         * @description Unified event payload; all six event types share this shape, and
         *     only the fields relevant to that type are populated. The SDK
         *     keeps `workflow_id` and `run_id` constant across one workflow
         *     run; `activity_id` is per-action and pairs ActivityStarted with
         *     ActivityCompleted.
         *
         *     The `required` block here lists every field the Go struct
         *     always emits / accepts as a non-pointer string. The handler's
         *     explicit validation is narrower (`event_type`, `workflow_id`,
         *     `run_id` only); clients that cannot fill the others should
         *     send empty strings rather than omit the keys.
         */
        GovernanceEventPayload: {
            /** @description Originating system. Conventionally `workflow-telemetry`. */
            source: string;
            event_type: components["schemas"]["EventType"];
            workflow_id: string;
            run_id: string;
            /** @description Implementation-specific workflow class name. */
            workflow_type: string;
            /**
             * @description Originating SDK / runtime.
             * @enum {string}
             */
            task_queue: "langgraph" | "temporal" | "mastra" | "claude-code" | "cursor" | "generic";
            /** Format: date-time */
            timestamp: string;
            /**
             * @description Server-populated from the `X-OpenBox-SDK-Version` header on
             *     ingest. Clients should set the header, not this field;
             *     included here because the JSON shape carries it forward.
             */
            sdk_version?: string;
            /** @description Set on `WorkflowStarted` for child workflows. */
            parent_workflow_id?: string;
            /**
             * @description Set on `WorkflowCompleted`/`WorkflowFailed`.
             * @enum {string}
             */
            status?: "completed" | "failed" | "cancelled" | "terminated";
            /** @description Set on Activity* and SignalReceived events. */
            activity_id?: string;
            /**
             * @description Canonical activity type. Examples: `PromptSubmission`,
             *     `LLMCompleted`, `ToolCompleted`, `FileRead`, `FileEdit`,
             *     `ShellExecution`, `MCPToolCall`. See sdk-implementation-guide for
             *     the full list.
             */
            activity_type?: string;
            /**
             * Format: int32
             * @description Retry counter, set on Activity* events.
             */
            attempt?: number;
            /**
             * @description Activity input payload. The Go server accepts any JSON value
             *     but the SDKs always wrap as an array (`[{...}]`); passing a
             *     bare object yields a 422 from the validation layer.
             */
            activity_input?: unknown[] | Record<string, never>;
            /** @description Activity output payload, set on `ActivityCompleted`. */
            activity_output?: unknown;
            /** @description Set on `SignalReceived`. */
            signal_name?: string;
            /** @description Set on `SignalReceived`. */
            signal_args?: unknown;
            /** @description Activity start time in epoch milliseconds. */
            start_time?: number;
            /** @description Activity end time in epoch milliseconds. */
            end_time?: number;
            /** @description Convenience field; equals `end_time - start_time`. */
            duration_ms?: number;
            /**
             * Format: int32
             * @description Length of `spans` array. Server validates the count.
             */
            span_count?: number;
            spans?: components["schemas"]["SpanData"][];
            /**
             * @description `true` if this evaluation was triggered mid-activity by an
             *     HTTP/DB/file/function hook (claude-code/cursor hooks). Server
             *     short-circuits dedup against the most recent span only.
             */
            hook_trigger?: boolean;
            error?: components["schemas"]["ErrorInfo"];
        };
        /**
         * @description Public verdict envelope returned from `/governance/evaluate`.
         *     The wire shape strips internal observability fields like
         *     `_governance_event_id`.
         *
         *     SDKs should branch on `verdict`. The legacy `action` field
         *     carries the v1.0 string and is kept for backward compatibility
         *     but tracks `verdict`.
         */
        GovernanceVerdictResponse: {
            /**
             * Format: uuid
             * @description Stable identifier for this evaluation; key for approval polling.
             */
            governance_event_id: string;
            verdict: components["schemas"]["Verdict"];
            /**
             * Format: double
             * @description Aggregate risk in [0, 1] across all evaluation branches.
             */
            risk_score: number;
            action: components["schemas"]["LegacyAction"];
            /**
             * Format: int32
             * @description Agent trust tier at the moment of evaluation.
             */
            trust_tier?: number;
            /** @description Behavior-rule names that triggered. */
            behavioral_violations?: string[];
            /** @description Set on `require_approval`; opaque ID returned for approval clients. */
            approval_id?: string;
            /** @description Set on `constrain`; enforcement hints for transformed output. */
            constraints?: string[];
            /**
             * Format: date-time
             * @description Wall-clock deadline for the approval; SDK stops polling after
             *     this. The value is set by core when the verdict is
             *     REQUIRE_APPROVAL: from `behavior_rule.approval_timeout` if the
             *     trigger was a behavior_rule, or from a server-side default
             *     (~30m observed) if the trigger was an OPA policy. OPA policies
             *     cannot configure the timeout; `CreatePolicyDto` has no
             *     `approval_timeout` field and the Rego return shape carries
             *     only `{decision, reason}`. To control the window, attach a
             *     behavior_rule with `--verdict 2 --approval-timeout <seconds>`.
             */
            approval_expiration_time?: string;
            /** @description True if any evaluation branch used a fallback path. */
            fallback_used: boolean;
            reason?: string;
            /** @description Policy that produced the verdict, when applicable. */
            policy_id?: string;
            metadata?: {
                [key: string]: unknown;
            };
            guardrails_result?: components["schemas"]["GuardrailsResult"];
            age_result?: components["schemas"]["AGEResult"];
        };
        GuardrailFieldResult: {
            field: string;
            /** Format: int32 */
            order: number;
            /** @enum {string} */
            status: "allowed" | "blocked" | "redacted" | "skipped";
            reason?: string;
        };
        GuardrailReason: {
            type: string;
            field: string;
            reason: string;
        };
        /** @description SDK-facing guardrail report; one entry per guardrail type that ran. */
        GuardrailsResult: {
            /** @enum {string} */
            input_type: "activity_input" | "activity_output";
            /**
             * @description Redacted or transformed payload as decided by the guardrail
             *     service. Free-form: string for text content, object for
             *     structured payloads such as tool args.
             */
            redacted_input: unknown;
            /** @description Raw guardrail-service output, retained for debugging. */
            raw_logs: {
                [key: string]: unknown;
            };
            /** @description False when any field result is `blocked`. */
            validation_passed: boolean;
            reasons: components["schemas"]["GuardrailReason"][];
            results: components["schemas"]["GuardrailsVerdictResult"][];
        };
        GuardrailsVerdictResult: {
            guardrail_type: string;
            results: components["schemas"]["GuardrailFieldResult"][];
        };
        /**
         * @description v1.0 action string, kept on responses for backwards compatibility
         *     with older SDKs. New code should branch on `verdict`.
         * @enum {string}
         */
        LegacyAction: "allow" | "constrain" | "require_approval" | "block" | "halt" | "continue" | "stop";
        /**
         * @description Single OTel-style span. Root-level fields (`http_method`,
         *     `db_operation`, `file_path`, `function`, …) replace the earlier
         *     attribute-bag layout; emitters MUST populate the typed fields
         *     instead of stuffing them into `attributes`. `semantic_type` is
         *     computed by the server (`ComputeSemanticTypeFromSpan`) when the
         *     SDK doesn't set it.
         */
        SpanData: {
            span_id: string;
            trace_id: string;
            parent_span_id?: string;
            name: string;
            /** @description OTel SpanKind. Conventionally one of CLIENT, SERVER, INTERNAL, PRODUCER, CONSUMER. */
            kind?: string;
            /**
             * Format: int64
             * @description Epoch nanoseconds.
             */
            start_time: number;
            /**
             * Format: int64
             * @description Epoch nanoseconds.
             */
            end_time: number;
            /** Format: int64 */
            duration_ns?: number;
            /** @description Free-form attribute bag for fields not yet promoted to root. */
            attributes?: {
                [key: string]: unknown;
            };
            status?: components["schemas"]["SpanStatus"];
            events?: components["schemas"]["SpanEvent"][];
            request_headers?: {
                [key: string]: string;
            };
            response_headers?: {
                [key: string]: string;
            };
            request_body?: string;
            response_body?: string;
            /**
             * @description Server-computed bucket. Examples: `http_get`, `llm_completion`,
             *     `database_select`, `file_read`, `shell_execution`. SDK can
             *     pre-compute and send; server overrides if mismatched.
             */
            semantic_type?: string;
            /**
             * @default completed
             * @enum {string}
             */
            stage: "started" | "completed";
            /** @description Free-form payload. Map for attestation; string for file ops. */
            data?: unknown;
            /**
             * @description SDK v2 hook source.
             * @enum {string}
             */
            hook_type?: "http_request" | "db_query" | "file_operation" | "function_call";
            /** @description Per-span dedup keys. */
            attribute_key_identifiers?: string[];
            /** @description Per-span error string (separate from envelope `error`). */
            error?: string;
            http_method?: string;
            http_url?: string;
            /** Format: int32 */
            http_status_code?: number;
            db_system?: string;
            db_name?: string;
            db_operation?: string;
            db_statement?: string;
            server_address?: string;
            /** Format: int32 */
            server_port?: number;
            /** Format: int32 */
            rowcount?: number;
            file_path?: string;
            file_mode?: string;
            file_operation?: string;
            /** Format: int64 */
            bytes_read?: number;
            /** Format: int64 */
            bytes_written?: number;
            /** Format: int32 */
            lines_count?: number;
            function?: string;
            module?: string;
            /** @description Function call args. Free-form (object/array/null). */
            args?: unknown;
            /** @description Function call result. Free-form (any/null). */
            result?: unknown;
        };
        SpanEvent: {
            name: string;
            /**
             * Format: int64
             * @description Epoch nanoseconds.
             */
            timestamp: number;
            attributes: {
                [key: string]: unknown;
            };
        };
        SpanStatus: {
            /** @enum {string} */
            code: "OK" | "ERROR" | "UNSET";
            description?: string;
        };
        /**
         * @description Five-tier graduated response. Priority order (highest first):
         *     `halt` > `block` > `require_approval` > `constrain` > `allow`.
         *
         *     Wire format is the lowercase string. The Go server also accepts
         *     the integer form (0..4) on input for backward compatibility,
         *     but always emits the string. `constrain` is a valid runtime verdict
         *     for transformed or redacted data and consumers must handle it as an
         *     allowed-but-modified path.
         * @enum {string}
         */
        Verdict: "allow" | "constrain" | "require_approval" | "block" | "halt";
    };
    responses: never;
    parameters: {
        /** @description SDK semver identifier; surfaces in observability. */
        "Parameters.SdkVersionHeader": string;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
type $defs = Record<string, never>;
interface operations {
    healthCheck: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The request has succeeded. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
        };
    };
    validateApiKey: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The request has succeeded. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AgentValidationResponse"];
                };
            };
            /** @description Access is unauthorized. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CoreError"];
                };
            };
        };
    };
    pollApproval: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ApprovalStatusRequest"];
            };
        };
        responses: {
            /** @description The request has succeeded. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApprovalStatusResponse"];
                };
            };
            /** @description The server could not understand the request due to invalid syntax. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CoreError"];
                };
            };
            /** @description The server cannot find the requested resource. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CoreError"];
                };
            };
        };
    };
    evaluateGovernance: {
        parameters: {
            query?: never;
            header?: {
                /** @description SDK semver identifier; surfaces in observability. */
                "x-open-box-sdk-version"?: components["parameters"]["Parameters.SdkVersionHeader"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GovernanceEventPayload"];
            };
        };
        responses: {
            /** @description The request has succeeded. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GovernanceVerdictResponse"];
                };
            };
            /** @description The server could not understand the request due to invalid syntax. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CoreError"];
                };
            };
            /** @description Access is unauthorized. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CoreError"];
                };
            };
            /** @description Server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CoreError"];
                };
            };
        };
    };
}

type core_$defs = $defs;
type core_components = components;
type core_operations = operations;
type core_paths = paths;
type core_webhooks = webhooks;
declare namespace core {
  export type { core_$defs as $defs, core_components as components, core_operations as operations, core_paths as paths, core_webhooks as webhooks };
}

export { type AISpecificConfig, type AddTeamMembersDto, type AivssConfig, type ApprovalListQuery, type AssignRolesDto, type AuditLogQuery, type BaseSecurityConfig, type BehaviorTrigger, type BehaviorVerdict, type ChangePasswordDto, type ConfigureOidcDto, type ConfigureSamlDto, core as Core, type CreateAgentDto, type CreateApiKeyDto, type CreateBehaviorRuleDto, type CreateGuardrailDto, type CreateOrganizationDto, type CreatePolicyDto, type CreateTeamDto, type CreateUserDto, type CreateWebhookDto, type DeleteTeamMembersDto, type DeleteTeamsDto, type EnforceSsoDto, type EvaluateRegoDto, type ExportAuditLogsDto, type ExportHistoryQuery, type ForgotPasswordDto, type GetAgentViolationsQuery, type GoalAlignmentConfig, type ImpactConfig, type InviteUserDto, type LoginDto, type MetricsQuery, type PaginationQuery, type PreviewExportDto, type RemoveMembersDto, type ResetPasswordDto, type SendWelcomeEmailDto, type SessionListQuery, type TestGuardrailDto, type TrustImpact, type UpdateAgentDto, type UpdateApiKeyDto, type UpdateBehaviorRuleDto, type UpdateBehavioralRuleDto, type UpdateGuardrailDto, type UpdateMemberDto, type UpdateOrgSettingsDto, type UpdatePolicyDto, type UpdateTeamDto, type UpdateWebhookDto, decodeJwtExpiry, isTokenExpired };
