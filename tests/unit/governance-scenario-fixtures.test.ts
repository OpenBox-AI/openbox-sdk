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
import {
  ANTHROPIC_AGENT_SDK_VERDICT_MATRIX,
  CLAUDE_CODE_HOOK_VERDICT_MATRIX,
  CLAUDE_CODE_HOOK_STDIN_VERDICT_MATRIX,
  CLAUDE_CODE_MCP_VERDICT_MATRIX,
  CODEX_HOOK_STDIN_VERDICT_MATRIX,
  COPILOTKIT_RUNTIME_VERDICT_MATRIX,
  CURSOR_HOOK_STDIN_VERDICT_MATRIX,
  LOCAL_GOVERNANCE_UNDRIVABLE_TRIGGERS,
  LOCAL_GOVERNANCE_VERDICT_MATRIX,
  MCP_VERDICT_MATRIX,
  N8N_RUNTIME_VERDICT_MATRIX,
  OPENAI_AGENTS_SDK_VERDICT_MATRIX,
  providerDriver,
  shouldSeedRule,
} from '../hook-integration/fixtures/verdict-matrix';

const SCENARIO_ONLY_OPA_SEMANTICS = ['llm_gen_ai', 'mcp_tool_call'] as const;

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function matrixIdsExcept(...excludedIds: string[]): string[] {
  const excluded = new Set(excludedIds);
  return sorted(
    LOCAL_GOVERNANCE_VERDICT_MATRIX
      .filter((entry) => !excluded.has(entry.id))
      .map((entry) => entry.id),
  );
}

function matrixIds(entries: ReadonlyArray<{ id: string }>): string[] {
  return sorted(entries.map((entry) => entry.id));
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
    const expectedSemantics = sorted(new Set([
      ...GOVERNANCE_SPEC_DOMAINS.behaviorRuleTriggers,
      ...SCENARIO_ONLY_OPA_SEMANTICS,
    ]));

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

  it('covers every SDK-drivable behavior-rule trigger in the local governance matrix', () => {
    const specTriggers = new Set(GOVERNANCE_SPEC_DOMAINS.behaviorRuleTriggers);
    const undrivableEntries: ReadonlyArray<{ trigger: string }> =
      LOCAL_GOVERNANCE_UNDRIVABLE_TRIGGERS;
    const undrivable = new Set<string>(undrivableEntries.map((entry) => entry.trigger));
    const ruleBackedMatrix = LOCAL_GOVERNANCE_VERDICT_MATRIX.filter(
      shouldSeedRule,
    );
    const drivenTriggers = new Set(ruleBackedMatrix.map((entry) => entry.expectedTrigger));
    const expectedDrivenTriggers = [...specTriggers].filter((trigger) => !undrivable.has(trigger));

    expect(sorted(drivenTriggers)).toEqual(sorted(expectedDrivenTriggers));
    expect(sorted(undrivable)).toEqual(
      sorted([...undrivable].filter((trigger) => specTriggers.has(trigger))),
    );
    expect(new Set(ruleBackedMatrix.map((entry) => entry.expectedRule)).size).toBe(
      ruleBackedMatrix.length,
    );
    for (const entry of ruleBackedMatrix) {
      expect(specTriggers.has(entry.expectedTrigger), entry.expectedRule).toBe(true);
    }
  });

  it('EXHAUSTIVE_SPEC_PROOF: local governance verdict matrix covers every local governance span verdict and outcome member', () => {
    expect(sorted(new Set(LOCAL_GOVERNANCE_VERDICT_MATRIX.map((entry) => entry.spanType)))).toEqual(
      sorted(GOVERNANCE_SPEC_DOMAINS.localGovernanceSpanTypes),
    );
    expect(sorted(new Set(LOCAL_GOVERNANCE_VERDICT_MATRIX.map((entry) => entry.expectedVerdict)))).toEqual(
      sorted(GOVERNANCE_SPEC_DOMAINS.localGovernanceVerdicts),
    );
    expect(sorted(new Set(LOCAL_GOVERNANCE_VERDICT_MATRIX.map((entry) => entry.expectedOutcome)))).toEqual(
      sorted(GOVERNANCE_SPEC_DOMAINS.localGovernanceOutcomes),
    );
  });

  it('declares Claude Code provider drivers in the generated verdict matrix', () => {
    const claudeDriverIds = sorted([
      ...CLAUDE_CODE_HOOK_VERDICT_MATRIX,
      ...CLAUDE_CODE_HOOK_STDIN_VERDICT_MATRIX,
      ...CLAUDE_CODE_MCP_VERDICT_MATRIX,
    ].map((entry) => entry.id));

    expect(claudeDriverIds).toEqual(matrixIds(LOCAL_GOVERNANCE_VERDICT_MATRIX));
    expect(CLAUDE_CODE_HOOK_VERDICT_MATRIX.map((entry) => entry.id).sort()).toEqual([
      'file-write-block',
      'shell-block',
    ]);
    expect(CLAUDE_CODE_HOOK_STDIN_VERDICT_MATRIX.map((entry) => entry.id).sort()).toEqual([
      'db-delete-halt',
      'db-generic-block',
      'db-insert-block',
      'db-update-approval',
      'file-delete-halt',
      'file-read-approval',
    ]);
    expect(CLAUDE_CODE_MCP_VERDICT_MATRIX.map((entry) => entry.id).sort()).toEqual([
      'db-select-constrain',
      'file-open-block',
      'http-delete-halt',
      'http-generic-constrain',
      'http-get-constrain',
      'http-patch-approval',
      'http-post-halt',
      'http-put-block',
      'llm-completion-approval',
      'llm-embedding-approval',
      'llm-tool-call-approval',
      'mcp-tool-allow',
    ]);

    for (const entry of CLAUDE_CODE_HOOK_VERDICT_MATRIX) {
      const driver = providerDriver(entry, 'claude-code', 'hook');
      expect(driver?.tool, entry.id).toMatch(/^(Bash|Write)$/);
      expect(driver?.prompt ?? driver?.promptTemplate, entry.id).toBeTruthy();
    }
    for (const entry of CLAUDE_CODE_HOOK_STDIN_VERDICT_MATRIX) {
      const driver = providerDriver(entry, 'claude-code', 'hook-stdin');
      expect(driver?.event, entry.id).toBe('PreToolUse');
      if (entry.spanType === 'db') {
        expect(driver?.tool, entry.id).toBe('mcp__postgres__query');
      } else if (entry.spanType === 'file_delete') {
        expect(driver?.tool, entry.id).toBe('Delete');
      } else {
        expect(driver?.tool, entry.id).toBe('Read');
      }
      expect(driver?.prompt ?? driver?.promptTemplate, entry.id).toBeUndefined();
    }
    for (const entry of CLAUDE_CODE_MCP_VERDICT_MATRIX) {
      expect(providerDriver(entry, 'claude-code', 'mcp')?.tool, entry.id).toBe(
        'mcp__openbox__check_governance',
      );
    }
  });

  it('declares host MCP drivers for semantic rows that native hooks cannot observe', () => {
    const gapIds = [
      'llm-embedding-approval',
      'llm-tool-call-approval',
      'file-open-block',
    ];
    for (const provider of ['claude-code', 'codex', 'cursor']) {
      for (const id of gapIds) {
        const entry = LOCAL_GOVERNANCE_VERDICT_MATRIX.find((candidate) => candidate.id === id);
        expect(entry, id).toBeDefined();
        expect(providerDriver(entry!, provider, 'mcp'), `${provider}/${id}`).toMatchObject({
          tool: 'mcp__openbox__check_governance',
        });
      }
    }
  });

  it('declares Codex hook stdin drivers for every official-hook-drivable local verdict case', () => {
    expect(matrixIds(CODEX_HOOK_STDIN_VERDICT_MATRIX)).toEqual(
      matrixIdsExcept('llm-embedding-approval', 'llm-tool-call-approval', 'file-open-block'),
    );

    for (const entry of CODEX_HOOK_STDIN_VERDICT_MATRIX) {
      const driver = providerDriver(entry, 'codex', 'hook-stdin');
      if (entry.spanType === 'llm') {
        expect(driver, entry.id).toMatchObject({ event: 'UserPromptSubmit', tool: 'prompt' });
      } else {
        expect(driver?.event, entry.id).toBe('PreToolUse');
        expect(driver?.tool, entry.id).toBeTruthy();
      }
    }
  });

  it('declares Cursor hook stdin drivers for every official-hook-drivable local verdict case', () => {
    expect(matrixIds(CURSOR_HOOK_STDIN_VERDICT_MATRIX)).toEqual(
      matrixIdsExcept('llm-embedding-approval', 'llm-tool-call-approval'),
    );

    for (const entry of CURSOR_HOOK_STDIN_VERDICT_MATRIX) {
      const driver = providerDriver(entry, 'cursor', 'hook-stdin');
      if (entry.spanType === 'llm') {
        expect(driver, entry.id).toMatchObject({ event: 'beforeSubmitPrompt', tool: 'prompt' });
      } else if (entry.spanType === 'db' || entry.spanType === 'http' || entry.spanType === 'mcp') {
        expect(driver?.event, entry.id).toBe('beforeMCPExecution');
        expect(driver?.tool, entry.id).toBeTruthy();
      } else if (entry.spanType === 'file_open') {
        expect(driver?.event, entry.id).toBe('beforeTabFileRead');
        expect(driver?.tool, entry.id).toBe('TabRead');
      } else {
        expect(driver?.event, entry.id).toMatch(/^(beforeReadFile|preToolUse|beforeShellExecution)$/);
        expect(driver?.tool, entry.id).toBeTruthy();
      }
    }
  });

  it('declares OpenAI Agents SDK wrapper drivers for every official-SDK-drivable local verdict case', () => {
    expect(matrixIds(OPENAI_AGENTS_SDK_VERDICT_MATRIX)).toEqual(
      matrixIdsExcept('llm-embedding-approval'),
    );

    for (const entry of OPENAI_AGENTS_SDK_VERDICT_MATRIX) {
      const driver = providerDriver(entry, 'openai-agents-sdk', 'sdk-wrapper');
      expect(driver?.event, entry.id).toMatch(/^(run|tool\.execute)$/);
      expect(driver?.tool, entry.id).toBeTruthy();
      if (entry.spanType === 'llm') {
        expect(driver?.tool, entry.id).toBe('runWithOpenBox');
      } else {
        expect(driver?.event, entry.id).toBe('tool.execute');
      }
    }
  });

  it('declares Anthropic Agent SDK wrapper drivers for every official-SDK-drivable local verdict case', () => {
    expect(matrixIds(ANTHROPIC_AGENT_SDK_VERDICT_MATRIX)).toEqual(
      matrixIdsExcept('llm-embedding-approval'),
    );

    for (const entry of ANTHROPIC_AGENT_SDK_VERDICT_MATRIX) {
      const driver = providerDriver(entry, 'anthropic-agent-sdk', 'sdk-wrapper');
      expect(driver?.event, entry.id).toMatch(/^(UserPromptSubmit|PreToolUse)$/);
      expect(driver?.tool, entry.id).toBeTruthy();
      if (entry.spanType === 'llm') {
        expect(driver?.event, entry.id).toBe('UserPromptSubmit');
        expect(driver?.tool, entry.id).toBe('prompt');
      } else {
        expect(driver?.event, entry.id).toBe('PreToolUse');
      }
    }
  });

  it('declares CopilotKit runtime adapter drivers for every official-adapter-drivable local verdict case', () => {
    expect(matrixIds(COPILOTKIT_RUNTIME_VERDICT_MATRIX)).toEqual(
      matrixIdsExcept('llm-embedding-approval'),
    );

    for (const entry of COPILOTKIT_RUNTIME_VERDICT_MATRIX) {
      const driver = providerDriver(entry, 'copilotkit', 'runtime-adapter');
      expect(driver?.event, entry.id).toMatch(/^(governPrompt|governToolInput)$/);
      expect(driver?.tool, entry.id).toBeTruthy();
      if (entry.spanType === 'llm') {
        expect(driver?.event, entry.id).toBe('governPrompt');
        expect(driver?.tool, entry.id).toBe('prompt');
      } else {
        expect(driver?.event, entry.id).toBe('governToolInput');
      }
    }
  });

  it('declares n8n runtime helper drivers for the full local verdict matrix', () => {
    expect(matrixIds(N8N_RUNTIME_VERDICT_MATRIX)).toEqual(
      matrixIds(LOCAL_GOVERNANCE_VERDICT_MATRIX),
    );

    for (const entry of N8N_RUNTIME_VERDICT_MATRIX) {
      const driver = providerDriver(entry, 'n8n', 'runtime-helper');
      expect(driver).toMatchObject({
        event: 'governance-check',
        tool: 'emitN8nGovernanceCheck',
      });
    }
  });

  it('declares MCP protocol drivers for the full local verdict matrix', () => {
    expect(matrixIds(MCP_VERDICT_MATRIX)).toEqual(
      matrixIds(LOCAL_GOVERNANCE_VERDICT_MATRIX),
    );

    for (const entry of MCP_VERDICT_MATRIX) {
      const driver = providerDriver(entry, 'mcp', 'mcp');
      expect(driver).toMatchObject({
        event: 'tools/call',
        tool: 'check_governance',
      });
    }
  });
});
