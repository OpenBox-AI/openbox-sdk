import { describe, expect, it } from 'vitest';
import {
  HOOK_EVENT_LABELS,
  HOOK_SPEC,
} from '../../ts/src/core-client/generated/runtime/claude-code.js';
import {
  CLAUDE_CODE_GOVERNANCE_AUDIT_SURFACE as GENERATED_CLAUDE_CODE_GOVERNANCE_AUDIT_SURFACE,
} from '../../ts/src/governance/capability-matrix.js';
import {
  CLAUDE_CODE_GOVERNANCE_AUDIT,
  CLAUDE_CODE_HOOK_MATRIX,
  CLAUDE_CODE_SDK_CAPABILITY_MATRIX,
  CLAUDE_CODE_SURFACE_MATRIX,
  defaultClaudeCodeHookEvents,
  optInClaudeCodeHookEvents,
} from '../../ts/src/runtime/claude-code/governance-matrix.js';
import { GOVERNANCE_SPEC_DOMAINS } from '../helpers/governance-spec-domains.js';

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

describe('Claude Code governance matrix drift guard', () => {
  it('derives hook governance directly from generated HOOK_SPEC metadata', () => {
    const generatedAll = HOOK_SPEC.events.map((event) => event.name).sort();
    const matrixAll = CLAUDE_CODE_HOOK_MATRIX.map((entry) => entry.event).sort();

    expect(matrixAll).toEqual(generatedAll);
    expect(generatedAll).toEqual(Object.keys(HOOK_EVENT_LABELS).sort());

    const generated = HOOK_SPEC.events
      .filter((event) => event.installDefault !== false)
      .map((event) => event.name)
      .sort();
    const defaults = defaultClaudeCodeHookEvents().sort();

    expect(generated).toEqual(defaults);
    for (const entry of CLAUDE_CODE_HOOK_MATRIX) {
      const hookSpec = HOOK_SPEC.events.find((event) => event.name === entry.event);
      expect(hookSpec, entry.event).toBeDefined();
      if (!hookSpec) continue;
      const expectedStatus = hookSpec.verdictShape === 'none'
        ? hookSpec.installDefault === false
          ? 'diagnose_only'
          : 'observe_only'
        : 'implement_now';
      expect(entry.defaultInstall, entry.event).toBe(hookSpec.installDefault !== false);
      expect(entry.decisionSurface, entry.event).toBe(hookSpec.verdictShape);
      expect(entry.status, entry.event).toBe(
        expectedStatus,
      );
    }
    expect(generated).not.toContain('WorktreeCreate');
    expect(HOOK_SPEC.events.find((event) => event.name === 'WorktreeCreate')?.installDefault).toBe(false);
    expect(HOOK_SPEC.events.find((event) => event.name === 'SessionEnd')?.installDefault).toBe(false);
    expect(optInClaudeCodeHookEvents()).toEqual(
      HOOK_SPEC.events
        .filter((event) => event.installDefault === false)
        .map((event) => event.name),
    );
    expect(optInClaudeCodeHookEvents()).toEqual(expect.arrayContaining(['WorktreeCreate', 'SessionEnd']));
  });

  it('classifies every generated hook and every required surface', () => {
    const matrix = new Map(CLAUDE_CODE_HOOK_MATRIX.map((entry) => [entry.event, entry]));

    for (const event of HOOK_SPEC.events) {
      expect(matrix.get(event.name), `missing matrix entry for ${event.name}`).toBeDefined();
      expect(HOOK_EVENT_LABELS[event.name], `missing generated label for ${event.name}`).toBeTruthy();
    }

    expect(CLAUDE_CODE_SURFACE_MATRIX).toEqual(
      GENERATED_CLAUDE_CODE_GOVERNANCE_AUDIT_SURFACE.surfaces,
    );
  });

  it('derives the formal audit source set from the generated TypeSpec surface', () => {
    expect(GENERATED_CLAUDE_CODE_GOVERNANCE_AUDIT_SURFACE.source).toBe(
      'specs/typespec/govern/capabilities.tsp',
    );
    expect(CLAUDE_CODE_GOVERNANCE_AUDIT).toEqual(
      GENERATED_CLAUDE_CODE_GOVERNANCE_AUDIT_SURFACE.audit,
    );
    expect(CLAUDE_CODE_GOVERNANCE_AUDIT.installedClaudeCodeVersion).toBe('2.1.179 (Claude Code)');
    expect(CLAUDE_CODE_GOVERNANCE_AUDIT.officialDocs).toContain(
      'https://code.claude.com/docs/en/hooks',
    );
    expect(CLAUDE_CODE_GOVERNANCE_AUDIT.auditedSdkSurfaces).toContain('@openbox-ai/openbox-sdk/runtime/claude-code');
    expect(CLAUDE_CODE_GOVERNANCE_AUDIT.auditedSdkSurfaces).toContain('@openbox-ai/openbox-sdk/copilotkit');
  });

  it('maps SDK governance primitives from generated TypeSpec coverage instead of only hook names', () => {
    expect(CLAUDE_CODE_SDK_CAPABILITY_MATRIX).toEqual(
      GENERATED_CLAUDE_CODE_GOVERNANCE_AUDIT_SURFACE.sdkCapabilities,
    );
    const capabilities = new Map(
      CLAUDE_CODE_SDK_CAPABILITY_MATRIX.map((entry) => [entry.capability, entry]),
    );

    const requiredCapabilities = [
      'workflow lifecycle start',
      'workflow lifecycle complete',
      'workflow lifecycle failure',
      'split-stage activity governance',
      'single-stage activity gates',
      'goal and signal telemetry',
      'approval lifecycle',
      'guardrail transforms and constrain verdicts',
      'halt/block session state',
      'behavior-rule spans and hook-trigger evaluation',
      'MCP connector and governance tools',
      'plugin packaging and diagnostics',
      'project-scoped runtime configuration',
    ] as const;

    for (const required of requiredCapabilities) {
      const entry = capabilities.get(required);
      expect(entry, `missing SDK capability ${required}`).toBeDefined();
      expect(entry?.claudeCodeTreatment).toBe('implement_now');
      expect(entry?.tests.length, `${required} lacks test evidence`).toBeGreaterThan(0);
    }

    expect(capabilities.get('CopilotKit-specific UI/runtime wrappers')?.claudeCodeTreatment).toBe(
      'explicit_out_of_scope',
    );
    expect(capabilities.get('non-Claude presets')?.claudeCodeTreatment).toBe('diagnose_only');
  });

  it('EXHAUSTIVE_SPEC_PROOF: Claude Code governance status members are represented by generated surface matrices', () => {
    const observedStatuses = new Set<string>([
      ...CLAUDE_CODE_HOOK_MATRIX.map((entry) => entry.status),
      ...CLAUDE_CODE_SURFACE_MATRIX.map((entry) => entry.status),
      ...CLAUDE_CODE_SDK_CAPABILITY_MATRIX.map((entry) => entry.claudeCodeTreatment),
    ]);

    expect(sorted(observedStatuses)).toEqual(
      sorted(GOVERNANCE_SPEC_DOMAINS.claudeCodeGovernanceStatuses),
    );
  });
});
