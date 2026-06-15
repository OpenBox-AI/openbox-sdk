export type ClaudeCodeGovernanceStatus =
  | 'implement_now'
  | 'observe_only'
  | 'diagnose_only'
  | 'explicit_out_of_scope';

export interface ClaudeCodeHookMatrixEntry {
  event: string;
  status: ClaudeCodeGovernanceStatus;
  defaultInstall: boolean;
  decisionSurface: string;
  notes: string;
}

export interface ClaudeCodeSurfaceMatrixEntry {
  surface: string;
  status: ClaudeCodeGovernanceStatus;
  notes: string;
}

export const CLAUDE_CODE_GOVERNANCE_AUDIT = {
  capturedAt: '2026-06-15',
  installedClaudeCodeVersion: '2.1.177 (Claude Code)',
  officialDocs: [
    'https://code.claude.com/docs/en/hooks',
    'https://code.claude.com/docs/en/plugins-reference',
    'https://code.claude.com/docs/en/plugins',
    'https://code.claude.com/docs/en/mcp',
    'https://code.claude.com/docs/en/skills',
    'https://code.claude.com/docs/en/settings',
    'https://code.claude.com/docs/en/tools-reference',
    'https://code.claude.com/docs/en/channels',
    'https://code.claude.com/docs/en/changelog',
  ],
  auditedSdkSurfaces: [
    '@openbox-ai/openbox-sdk/runtime/claude-code',
    '@openbox-ai/openbox-sdk/runtime/mcp',
    '@openbox-ai/openbox-sdk/runtime/cursor',
    '@openbox-ai/openbox-sdk/copilotkit',
    '@openbox-ai/openbox-sdk/copilotkit/react',
    'apps/extension',
    'skill',
    'example/n8n',
  ],
} as const;

export const CLAUDE_CODE_HOOK_MATRIX: readonly ClaudeCodeHookMatrixEntry[] = [
  { event: 'Setup', status: 'observe_only', defaultInstall: true, decisionSurface: 'none', notes: 'CI/init preparation signal.' },
  { event: 'SessionStart', status: 'observe_only', defaultInstall: true, decisionSurface: 'none', notes: 'Starts OpenBox workflow/session lifecycle.' },
  { event: 'InstructionsLoaded', status: 'observe_only', defaultInstall: true, decisionSurface: 'none', notes: 'Audits loaded instruction sources.' },
  { event: 'UserPromptSubmit', status: 'implement_now', defaultInstall: true, decisionSurface: 'decision-block', notes: 'Prompt input gate.' },
  { event: 'UserPromptExpansion', status: 'implement_now', defaultInstall: true, decisionSurface: 'decision-block', notes: 'Slash-command expansion gate.' },
  { event: 'MessageDisplay', status: 'observe_only', defaultInstall: true, decisionSurface: 'none', notes: 'Display-only streaming text surface.' },
  { event: 'PreToolUse', status: 'implement_now', defaultInstall: true, decisionSurface: 'permission-decision', notes: 'Primary pre-action tool gate.' },
  { event: 'PermissionRequest', status: 'implement_now', defaultInstall: true, decisionSurface: 'permission-request', notes: 'Native Claude permission prompt gate.' },
  { event: 'PermissionDenied', status: 'implement_now', defaultInstall: true, decisionSurface: 'permission-denied-retry', notes: 'Can request retry after auto-mode denial.' },
  { event: 'PostToolUse', status: 'implement_now', defaultInstall: true, decisionSurface: 'decision-block', notes: 'Tool output governance.' },
  { event: 'PostToolUseFailure', status: 'implement_now', defaultInstall: true, decisionSurface: 'additional-context', notes: 'Feeds policy context after failed tool calls.' },
  { event: 'PostToolBatch', status: 'implement_now', defaultInstall: true, decisionSurface: 'decision-block', notes: 'Parallel tool batch gate before next model call.' },
  { event: 'SubagentStart', status: 'observe_only', defaultInstall: true, decisionSurface: 'none', notes: 'Subagent lifecycle start telemetry.' },
  { event: 'SubagentStop', status: 'implement_now', defaultInstall: true, decisionSurface: 'decision-block', notes: 'Subagent completion gate.' },
  { event: 'TaskCreated', status: 'implement_now', defaultInstall: true, decisionSurface: 'continue-block', notes: 'Agent-team task creation criteria.' },
  { event: 'TaskCompleted', status: 'implement_now', defaultInstall: true, decisionSurface: 'continue-block', notes: 'Agent-team task completion criteria.' },
  { event: 'Stop', status: 'implement_now', defaultInstall: true, decisionSurface: 'decision-block', notes: 'Final assistant-output/session-stop gate.' },
  { event: 'StopFailure', status: 'observe_only', defaultInstall: true, decisionSurface: 'none', notes: 'API/session failure telemetry.' },
  { event: 'TeammateIdle', status: 'implement_now', defaultInstall: true, decisionSurface: 'continue-block', notes: 'Agent-team idle/completion enforcement.' },
  { event: 'Notification', status: 'observe_only', defaultInstall: true, decisionSurface: 'none', notes: 'Notification telemetry.' },
  { event: 'ConfigChange', status: 'implement_now', defaultInstall: true, decisionSurface: 'decision-block', notes: 'Blocks non-managed config changes from applying.' },
  { event: 'CwdChanged', status: 'observe_only', defaultInstall: true, decisionSurface: 'none', notes: 'Working-directory telemetry.' },
  { event: 'FileChanged', status: 'observe_only', defaultInstall: true, decisionSurface: 'none', notes: 'Watched-file telemetry; cannot block the file change.' },
  { event: 'WorktreeCreate', status: 'explicit_out_of_scope', defaultInstall: false, decisionSurface: 'worktree-path', notes: 'Invasive hook replaces Claude Code git worktree creation and must create/return a real path.' },
  { event: 'WorktreeRemove', status: 'observe_only', defaultInstall: true, decisionSurface: 'none', notes: 'Worktree removal telemetry.' },
  { event: 'PreCompact', status: 'implement_now', defaultInstall: true, decisionSurface: 'decision-block', notes: 'Blocks unsafe compaction requests before context rewrite.' },
  { event: 'PostCompact', status: 'observe_only', defaultInstall: true, decisionSurface: 'none', notes: 'Compaction summary telemetry.' },
  { event: 'SessionEnd', status: 'observe_only', defaultInstall: true, decisionSurface: 'none', notes: 'Closes OpenBox workflow/session lifecycle.' },
  { event: 'Elicitation', status: 'implement_now', defaultInstall: true, decisionSurface: 'elicitation-response', notes: 'MCP user-input request governance.' },
  { event: 'ElicitationResult', status: 'implement_now', defaultInstall: true, decisionSurface: 'elicitation-response', notes: 'MCP elicitation response governance.' },
] as const;

export const CLAUDE_CODE_SURFACE_MATRIX: readonly ClaudeCodeSurfaceMatrixEntry[] = [
  { surface: 'hooks', status: 'implement_now', notes: 'Generated from TypeSpec and installed by the Claude Code plugin.' },
  { surface: 'skills', status: 'implement_now', notes: 'OpenBox skill ships under plugin skills/openbox.' },
  { surface: 'commands', status: 'implement_now', notes: 'Compatibility command markdown files remain for Claude slash entrypoints.' },
  { surface: 'agents', status: 'implement_now', notes: 'OpenBox reviewer agent ships in the plugin.' },
  { surface: 'MCP', status: 'implement_now', notes: 'OpenBox MCP server exposes status, doctor, approvals, agents, rules, policies, and governance checks.' },
  { surface: 'plugin settings', status: 'diagnose_only', notes: 'Only agent/subagentStatusLine are currently supported by Claude Code plugin settings.' },
  { surface: 'monitors', status: 'diagnose_only', notes: 'Documented as opt-in because monitors run unsandboxed and project-scope plugins do not load them.' },
  { surface: 'LSP', status: 'explicit_out_of_scope', notes: 'No OpenBox language server exists; official LSP plugins should be installed separately.' },
  { surface: 'bin', status: 'diagnose_only', notes: 'OpenBox relies on the installed openbox binary; doctor reports command resolution.' },
  { surface: 'managed settings', status: 'diagnose_only', notes: 'Enterprise policy belongs to managed Claude Code deployment, not SDK mutation.' },
  { surface: 'channels', status: 'diagnose_only', notes: 'Research preview MCP push channel surface; standard MCP remains the connector path.' },
  { surface: 'built-in tool permissions', status: 'implement_now', notes: 'PreToolUse/PermissionRequest routing covers current built-in tool names and dynamic mcp__ tools.' },
] as const;

export function defaultClaudeCodeHookEvents(): string[] {
  return CLAUDE_CODE_HOOK_MATRIX
    .filter((entry) => entry.defaultInstall && entry.status !== 'diagnose_only' && entry.status !== 'explicit_out_of_scope')
    .map((entry) => entry.event);
}

export function optInClaudeCodeHookEvents(): string[] {
  return CLAUDE_CODE_HOOK_MATRIX
    .filter((entry) => !entry.defaultInstall)
    .map((entry) => entry.event);
}

export function claudeCodeGovernanceSummary(): Record<string, unknown> {
  const byStatus = CLAUDE_CODE_HOOK_MATRIX.reduce<Record<ClaudeCodeGovernanceStatus, number>>(
    (acc, entry) => {
      acc[entry.status] += 1;
      return acc;
    },
    { implement_now: 0, observe_only: 0, diagnose_only: 0, explicit_out_of_scope: 0 },
  );
  return {
    audit: CLAUDE_CODE_GOVERNANCE_AUDIT,
    hookCount: CLAUDE_CODE_HOOK_MATRIX.length,
    defaultHookCount: defaultClaudeCodeHookEvents().length,
    optInHooks: optInClaudeCodeHookEvents(),
    byStatus,
    surfaces: CLAUDE_CODE_SURFACE_MATRIX,
  };
}
