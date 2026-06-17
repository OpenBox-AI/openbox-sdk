import { describe, expect, it } from 'vitest';
import {
  HOOK_EVENT_LABELS,
  HOOK_SPEC,
} from '../../ts/src/core-client/generated/runtime/claude-code.js';
import {
  CLAUDE_CODE_GOVERNANCE_AUDIT,
  CLAUDE_CODE_HOOK_MATRIX,
  CLAUDE_CODE_SDK_CAPABILITY_MATRIX,
  CLAUDE_CODE_SURFACE_MATRIX,
  defaultClaudeCodeHookEvents,
  optInClaudeCodeHookEvents,
} from '../../ts/src/runtime/claude-code/governance-matrix.js';

describe('Claude Code governance matrix drift guard', () => {
  const officialHookEvents = [
    'SessionStart',
    'Setup',
    'InstructionsLoaded',
    'UserPromptSubmit',
    'UserPromptExpansion',
    'MessageDisplay',
    'PreToolUse',
    'PermissionRequest',
    'PostToolUse',
    'PostToolUseFailure',
    'PostToolBatch',
    'PermissionDenied',
    'Notification',
    'SubagentStart',
    'SubagentStop',
    'TaskCreated',
    'TaskCompleted',
    'Stop',
    'StopFailure',
    'TeammateIdle',
    'ConfigChange',
    'CwdChanged',
    'FileChanged',
    'WorktreeCreate',
    'WorktreeRemove',
    'PreCompact',
    'PostCompact',
    'SessionEnd',
    'Elicitation',
    'ElicitationResult',
  ].sort();

  it('keeps generated HOOK_SPEC aligned with the checked-in official hook matrix', () => {
    const generatedAll = HOOK_SPEC.events.map((event) => event.name).sort();
    const matrixAll = CLAUDE_CODE_HOOK_MATRIX.map((entry) => entry.event).sort();

    expect(matrixAll).toEqual(officialHookEvents);
    expect(generatedAll).toEqual(officialHookEvents.filter((event) => event !== 'WorktreeCreate'));

    const generated = HOOK_SPEC.events
      .filter((event) => event.installDefault !== false)
      .map((event) => event.name)
      .sort();
    const defaults = defaultClaudeCodeHookEvents().sort();

    expect(generated).toEqual(defaults);
    expect(generated).not.toContain('WorktreeCreate');
    expect(HOOK_SPEC.events.find((event) => event.name === 'SessionEnd')?.installDefault).toBe(false);
    expect(optInClaudeCodeHookEvents()).toEqual(['WorktreeCreate', 'SessionEnd']);
  });

  it('classifies every generated hook and every required surface', () => {
    const matrix = new Map(CLAUDE_CODE_HOOK_MATRIX.map((entry) => [entry.event, entry]));

    for (const event of HOOK_SPEC.events) {
      expect(matrix.get(event.name), `missing matrix entry for ${event.name}`).toBeDefined();
      expect(HOOK_EVENT_LABELS[event.name], `missing generated label for ${event.name}`).toBeTruthy();
    }

    expect(new Set(CLAUDE_CODE_SURFACE_MATRIX.map((entry) => entry.surface))).toEqual(
      new Set([
        'hooks',
        'skills',
        'commands',
        'agents',
        'MCP',
        'plugin settings',
        'monitors',
        'LSP',
        'bin',
        'managed settings',
        'channels',
        'built-in tool permissions',
      ]),
    );
  });

  it('records the formal audit source set and installed Claude Code version', () => {
    expect(CLAUDE_CODE_GOVERNANCE_AUDIT.installedClaudeCodeVersion).toBe('2.1.179 (Claude Code)');
    expect(CLAUDE_CODE_GOVERNANCE_AUDIT.officialDocs).toEqual([
      'https://code.claude.com/docs/en/hooks',
      'https://code.claude.com/docs/en/plugins-reference',
      'https://code.claude.com/docs/en/plugins',
      'https://code.claude.com/docs/en/mcp',
      'https://code.claude.com/docs/en/skills',
      'https://code.claude.com/docs/en/commands',
      'https://code.claude.com/docs/en/agents',
      'https://code.claude.com/docs/en/settings',
      'https://code.claude.com/docs/en/tools-reference',
      'https://code.claude.com/docs/en/channels',
      'https://code.claude.com/docs/en/changelog',
    ]);
    expect(CLAUDE_CODE_GOVERNANCE_AUDIT.auditedSdkSurfaces).toContain('@openbox-ai/openbox-sdk/runtime/claude-code');
    expect(CLAUDE_CODE_GOVERNANCE_AUDIT.auditedSdkSurfaces).toContain('@openbox-ai/openbox-sdk/copilotkit');
  });

  it('maps SDK governance primitives to Claude Code coverage instead of only hook names', () => {
    const capabilities = new Map(
      CLAUDE_CODE_SDK_CAPABILITY_MATRIX.map((entry) => [entry.capability, entry]),
    );

    for (const required of [
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
    ]) {
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
});
