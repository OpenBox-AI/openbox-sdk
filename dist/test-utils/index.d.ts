/**
 * Builds governance payloads with properly constructed spans for testing.
 * Handles all gate attributes, semantic type detection workarounds, and
 * payload structure so callers don't need to know the internals.
 */
/** Single source of truth for governance smoke-test span vocabulary.
 *  Adding a new shorthand is one entry here + one branch in `buildSpan`
 *  below. */
declare const SPAN_TYPES: readonly ["llm", "file_read", "file_write", "shell", "http", "db", "mcp"];
type SpanType = (typeof SPAN_TYPES)[number];
interface SpanOptions {
    type: SpanType;
    activityType?: string;
    /** Match the official temporal-sdk-python convention: hook-level
     *  events from `hook_governance.py` set `hook_trigger: true`;
     *  activity-level events from `activity_interceptor.py` do not. The
     *  hook path
     *  triggers `CheckApprovalCacheActivity` server-side which hits Redis.
     *  Default to false here so test payloads match the activity-level
     *  convention; flip to true when explicitly testing hook flows. */
    hookTrigger?: boolean;
    prompt?: string;
    model?: string;
    filePath?: string;
    content?: string;
    command?: string;
    cwd?: string;
    method?: string;
    url?: string;
    dbSystem?: string;
    dbOperation?: string;
    dbStatement?: string;
    toolName?: string;
    server?: string;
    toolInput?: string;
}
interface BuiltPayload {
    source: string;
    event_type: string;
    workflow_id: string;
    run_id: string;
    workflow_type: string;
    activity_id: string;
    activity_type: string;
    task_queue: string;
    attempt: number;
    timestamp: string;
    hook_trigger: boolean;
    activity_input: unknown[];
    spans: Record<string, unknown>[];
    span_count: number;
}
declare function buildTestPayload(opts: SpanOptions): BuiltPayload;

declare function makeCreateAgentDto(teamIds: string[], overrides?: Record<string, any>): {
    agent_name: string;
    description: string;
    icon: string;
    agent_type: string;
    team_ids: string[];
    tags: string[];
    attestation_mode: "kms";
    aivss_config: {
        base_security: {
            attack_vector: number;
            attack_complexity: number;
            privileges_required: number;
            user_interaction: number;
            scope: number;
        };
        ai_specific: {
            model_robustness: number;
            data_sensitivity: number;
            ethical_impact: number;
            decision_criticality: number;
            adaptability: number;
        };
        impact: {
            confidentiality_impact: number;
            integrity_impact: number;
            availability_impact: number;
            safety_impact: number;
        };
    };
    goal_alignment_config: {
        alignment_threshold: number;
        drift_detection_action: "alert_only";
        evaluation_frequency: "every_action";
        llama_firewall_model: "gpt-4o-mini";
    };
};
declare function makeCreateGuardrailDto(overrides?: Record<string, any>): {
    name: string;
    guardrail_type: string;
    description: string;
    processing_stage: string;
    params: {};
    settings: {};
    trust_impact: "medium";
};
declare function makeCreatePolicyDto(overrides?: Record<string, any>): {
    name: string;
    description: string;
    rego_code: string;
    input: {};
    trust_impact: string;
};
declare function makeCreateBehaviorRuleDto(overrides?: Record<string, any>): {
    rule_name: string;
    description: string;
    priority: number;
    trigger: string;
    states: string[];
    time_window: number;
    verdict: number;
    reject_message: string;
    trust_impact: string;
};
declare function makeUpdateAgentDto(overrides?: Record<string, any>): {
    description: string;
};
declare function makeGovernanceEvent(overrides?: Record<string, any>): {
    event_type: string;
    workflow_id: string;
    workflow_type: string;
    run_id: string;
    activity_id: string;
    activity_type: string;
    activity_input: {
        tool: string;
        args: {
            query: string;
        };
    }[];
    source: string;
    task_queue: string;
    timestamp: string;
};
declare function makeUpdateAivssConfigDto(overrides?: Record<string, any>): {
    aivss_config: {
        base_security: {
            attack_vector: number;
            attack_complexity: number;
            privileges_required: number;
            user_interaction: number;
            scope: number;
        };
        ai_specific: {
            model_robustness: number;
            data_sensitivity: number;
            ethical_impact: number;
            decision_criticality: number;
            adaptability: number;
        };
        impact: {
            confidentiality_impact: number;
            integrity_impact: number;
            availability_impact: number;
            safety_impact: number;
        };
    };
    reason: string;
};
declare function makeGoalAlignmentConfigDto(overrides?: Record<string, any>): {
    alignment_threshold: number;
    drift_detection_action: string;
    evaluation_frequency: string;
};

export { SPAN_TYPES, type SpanOptions, type SpanType, buildTestPayload, makeCreateAgentDto, makeCreateBehaviorRuleDto, makeCreateGuardrailDto, makeCreatePolicyDto, makeGoalAlignmentConfigDto, makeGovernanceEvent, makeUpdateAgentDto, makeUpdateAivssConfigDto };
