// DTO factories for backend operations. Spec-driven: every shape
// matches a typed `BackendClient` method's body parameter and is
// exercised end-to-end by the e2e suite, so drift between these
// defaults and the live wire shapes is a test failure.
//
// Public sub-path: `import { makeCreateAgentDto, ... } from '@openbox-ai/openbox-sdk/test-utils'`.
//
// Used by:
//   - the openbox-sdk e2e suite (tests/helpers/fixtures.ts re-exports)
//   - any "spin up a deterministic test agent" tooling that wants
//     the same default shape the e2e suite asserts on
//   - any consumer that needs a sensible default for backend writes

import { CANONICAL_EVENT_TYPE } from '../core-client/generated/govern.js';
import type { components } from '../types/generated/backend.js';

type CreateGuardrailDto = components['schemas']['CreateGuardrailDto'];

let counter = 0;
const ts = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export function makeCreateAgentDto(teamIds: string[], overrides: Record<string, any> = {}) {
  return {
    agent_name: `test-agent-${ts()}`,
    description: 'E2E test agent, auto cleanup',
    icon: 'robot',
    agent_type: 'temporal',
    team_ids: teamIds,
    tags: ['e2e-test'],
    attestation_mode: 'kms' as const,
    aivss_config: {
      base_security: {
        attack_vector: 2,
        attack_complexity: 1,
        privileges_required: 2,
        user_interaction: 1,
        scope: 1,
      },
      ai_specific: {
        model_robustness: 3,
        data_sensitivity: 2,
        ethical_impact: 2,
        decision_criticality: 2,
        adaptability: 3,
      },
      impact: {
        confidentiality_impact: 2,
        integrity_impact: 2,
        availability_impact: 2,
        safety_impact: 1,
      },
    },
    goal_alignment_config: {
      alignment_threshold: 70,
      drift_detection_action: 'alert_only' as const,
      evaluation_frequency: 'every_action' as const,
      llama_firewall_model: 'gpt-4o-mini' as const,
    },
    ...overrides,
  };
}

export function makeCreateGuardrailDto(overrides: Partial<CreateGuardrailDto> = {}): CreateGuardrailDto {
  return {
    name: `test-guardrail-${ts()}`,
    guardrail_type: '1',
    description: 'E2E test guardrail',
    processing_stage: '1',
    params: {},
    settings: {},
    trust_impact: 'medium' as const,
    ...overrides,
  };
}

export function makeCreatePolicyDto(overrides: Record<string, any> = {}) {
  return {
    name: `test-policy-${ts()}`,
    description: 'E2E test policy',
    rego_code: 'package openbox.policy\ndefault decision = {"verdict": "allow", "reason": ""}',
    input: {},
    trust_impact: 'low',
    ...overrides,
  };
}

export function makeCreateBehaviorRuleDto(overrides: Record<string, any> = {}) {
  return {
    rule_name: `test-rule-${ts()}`,
    description: 'E2E test behavior rule',
    priority: 50,
    trigger: 'http_post',
    states: ['http_get'],
    time_window: 300,
    verdict: 3, // BLOCK
    reject_message: 'Blocked by E2E test rule',
    trust_impact: 'low',
    ...overrides,
  };
}

export function makeUpdateAgentDto(overrides: Record<string, any> = {}) {
  return {
    description: `Updated by E2E test at ${new Date().toISOString()}`,
    ...overrides,
  };
}

export function makeGovernanceEvent(overrides: Record<string, any> = {}) {
  return {
    event_type: CANONICAL_EVENT_TYPE.ACTIVITY_STARTED,
    workflow_id: `test-wf-${ts()}`,
    workflow_type: 'e2e-test',
    run_id: `test-run-${ts()}`,
    activity_id: `act-${ts()}`,
    activity_type: 'tool_call',
    activity_input: [{ tool: 'web_search', args: { query: 'test' } }],
    source: 'workflow-telemetry',
    task_queue: 'temporal',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

export function makeUpdateAivssConfigDto(overrides: Record<string, any> = {}) {
  return {
    aivss_config: {
      base_security: {
        attack_vector: 3,
        attack_complexity: 2,
        privileges_required: 2,
        user_interaction: 1,
        scope: 1,
      },
      ai_specific: {
        model_robustness: 3,
        data_sensitivity: 3,
        ethical_impact: 2,
        decision_criticality: 2,
        adaptability: 3,
      },
      impact: {
        confidentiality_impact: 3,
        integrity_impact: 2,
        availability_impact: 2,
        safety_impact: 1,
      },
    },
    reason: 'E2E test reconfiguration',
    ...overrides,
  };
}

export function makeGoalAlignmentConfigDto(overrides: Record<string, any> = {}) {
  return {
    alignment_threshold: 70,
    drift_detection_action: 'alert_only',
    evaluation_frequency: 'every_action',
    ...overrides,
  };
}
