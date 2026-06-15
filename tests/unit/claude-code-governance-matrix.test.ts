import { describe, expect, it } from 'vitest';
import {
  HOOK_EVENT_LABELS,
  HOOK_SPEC,
} from '../../ts/src/core-client/generated/runtime/claude-code.js';
import {
  CLAUDE_CODE_GOVERNANCE_AUDIT,
  CLAUDE_CODE_HOOK_MATRIX,
  CLAUDE_CODE_SURFACE_MATRIX,
  defaultClaudeCodeHookEvents,
  optInClaudeCodeHookEvents,
} from '../../ts/src/runtime/claude-code/governance-matrix.js';

describe('Claude Code governance matrix drift guard', () => {
  it('keeps generated HOOK_SPEC aligned with the checked-in matrix defaults', () => {
    const generated = HOOK_SPEC.events.map((event) => event.name).sort();
    const defaults = defaultClaudeCodeHookEvents().sort();

    expect(generated).toEqual(defaults);
    expect(generated).not.toContain('WorktreeCreate');
    expect(optInClaudeCodeHookEvents()).toEqual(['WorktreeCreate']);
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
    expect(CLAUDE_CODE_GOVERNANCE_AUDIT.installedClaudeCodeVersion).toBe('2.1.177 (Claude Code)');
    expect(CLAUDE_CODE_GOVERNANCE_AUDIT.officialDocs).toEqual([
      'https://code.claude.com/docs/en/hooks',
      'https://code.claude.com/docs/en/plugins-reference',
      'https://code.claude.com/docs/en/plugins',
      'https://code.claude.com/docs/en/mcp',
      'https://code.claude.com/docs/en/skills',
      'https://code.claude.com/docs/en/settings',
      'https://code.claude.com/docs/en/tools-reference',
      'https://code.claude.com/docs/en/channels',
      'https://code.claude.com/docs/en/changelog',
    ]);
    expect(CLAUDE_CODE_GOVERNANCE_AUDIT.auditedSdkSurfaces).toContain('openbox-sdk/runtime/claude-code');
    expect(CLAUDE_CODE_GOVERNANCE_AUDIT.auditedSdkSurfaces).toContain('openbox-sdk/copilotkit');
  });
});
