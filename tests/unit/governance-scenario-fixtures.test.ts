import { describe, expect, it } from 'vitest';
import { CANONICAL_VERDICT_ARMS } from '../../ts/src/core-client/generated/govern.js';
import { LOCAL_STACK_SCENARIO_PATHS } from '../../ts/src/governance/capability-matrix.js';
import {
  makeGuardrailRunTestConformanceCases,
  makeOpaAliasDecisionConformanceCase,
  makeOpaUnavailableFailClosedConformanceCase,
  makeOpaUnsupportedConstrainConformanceCase,
  makeOpaVerdictMatrixConformanceCase,
} from '../helpers/fixtures';
import { GOVERNANCE_SPEC_DOMAINS } from '../helpers/governance-spec-domains';

const SCENARIO_ONLY_OPA_SEMANTICS = ['llm_gen_ai', 'mcp_tool_call'] as const;

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function eventActivityInput(event: { activity_input?: unknown }): Record<string, unknown> {
  const input = event.activity_input;
  if (!Array.isArray(input) || !input[0] || typeof input[0] !== 'object') {
    throw new Error(`Expected event activity_input[0], got ${JSON.stringify(input)}`);
  }
  return input[0] as Record<string, unknown>;
}

function firstSpan(event: { spans?: unknown }): Record<string, unknown> {
  const spans = event.spans;
  if (!Array.isArray(spans) || !spans[0] || typeof spans[0] !== 'object') {
    throw new Error(`Expected event spans[0], got ${JSON.stringify(spans)}`);
  }
  return spans[0] as Record<string, unknown>;
}

describe('governance scenario fixtures', () => {
  it('builds the OPA verdict matrix as every supported verdict by every governed semantic surface', () => {
    const matrix = makeOpaVerdictMatrixConformanceCase();
    const expectedVerdicts = sorted(
      [...CANONICAL_VERDICT_ARMS].filter((verdict) => verdict !== 'constrain'),
    );
    const expectedSemantics = sorted([
      ...GOVERNANCE_SPEC_DOMAINS.behaviorRuleTriggers,
      ...SCENARIO_ONLY_OPA_SEMANTICS,
    ]);

    expect(sorted(new Set(matrix.cases.map((entry) => entry.expected.verdict)))).toEqual(
      expectedVerdicts,
    );
    expect(sorted(new Set(matrix.cases.map((entry) => entry.semanticType)))).toEqual(
      expectedSemantics,
    );
    expect(matrix.cases).toHaveLength(expectedVerdicts.length * expectedSemantics.length);

    for (const semanticType of expectedSemantics) {
      const cases = matrix.cases.filter((entry) => entry.semanticType === semanticType);
      expect(sorted(new Set(cases.map((entry) => entry.expected.verdict))), semanticType).toEqual(
        expectedVerdicts,
      );
      expect(new Set(cases.map((entry) => String(entry.activityInput.matrix_case))).size).toBe(
        expectedVerdicts.length,
      );
      for (const testCase of cases) {
        expect(eventActivityInput(testCase.event).matrix_case, testCase.name).toBe(
          testCase.activityInput.matrix_case,
        );
        expect(firstSpan(testCase.event).semantic_type, testCase.name).toBe(semanticType);
      }
    }

    expect(matrix.policyBody.rego_code).toContain('input.activity_input[_].matrix_case');
    for (const testCase of matrix.cases) {
      expect(matrix.policyBody.rego_code).toContain(String(testCase.activityInput.matrix_case));
    }
  });

  it('links every generated OPA local-stack scenario to a fixture path', () => {
    const scenarioIds: Set<string> = new Set(LOCAL_STACK_SCENARIO_PATHS.map((entry) => entry.id));
    const opaScenarioIds = LOCAL_STACK_SCENARIO_PATHS
      .filter((entry) => entry.id.startsWith('opa-'))
      .map((entry) => entry.id)
      .sort();
    const matrix = makeOpaVerdictMatrixConformanceCase();
    const aliasCase = makeOpaAliasDecisionConformanceCase();
    const constrainCase = makeOpaUnsupportedConstrainConformanceCase();
    const unavailableCase = makeOpaUnavailableFailClosedConformanceCase();
    const coveredScenarioIds = new Set([
      ...matrix.cases.map((entry) => entry.scenarioId),
      aliasCase.scenarioId,
      constrainCase.scenarioId,
      unavailableCase.scenarioId,
    ]);

    expect([...coveredScenarioIds].every((id) => scenarioIds.has(id))).toBe(true);
    expect(sorted(coveredScenarioIds)).toEqual(opaScenarioIds);
    expect(aliasCase.cases.map((entry) => entry.decision).sort()).toEqual([
      'continue',
      'require-approval',
      'stop',
    ]);
  });

  it('keeps guardrail run-test outcomes aligned to every finite field status', () => {
    const cases = makeGuardrailRunTestConformanceCases();
    expect(sorted(new Set(cases.map((entry) => entry.expected.fieldStatus)))).toEqual(
      sorted(GOVERNANCE_SPEC_DOMAINS.coreGuardrailFieldStatuses),
    );
  });
});
