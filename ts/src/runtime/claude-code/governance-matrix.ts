import {
  HOOK_EVENT_LABELS,
  HOOK_SPEC,
} from '../../core-client/generated/runtime/claude-code.js';
import {
  CLAUDE_CODE_GOVERNANCE_AUDIT as GENERATED_CLAUDE_CODE_GOVERNANCE_AUDIT,
  CLAUDE_CODE_SDK_CAPABILITY_MATRIX as GENERATED_CLAUDE_CODE_SDK_CAPABILITY_MATRIX,
  CLAUDE_CODE_SURFACE_MATRIX as GENERATED_CLAUDE_CODE_SURFACE_MATRIX,
  type ClaudeCodeGovernanceStatus,
} from '../../governance/capability-matrix.js';

export type {
  ClaudeCodeGovernanceAudit,
  ClaudeCodeGovernanceAuditSurface,
  ClaudeCodeGovernanceStatus,
  ClaudeCodeSdkCapabilityMatrixEntry,
  ClaudeCodeSurfaceMatrixEntry,
} from '../../governance/capability-matrix.js';

export interface ClaudeCodeHookMatrixEntry {
  event: string;
  status: ClaudeCodeGovernanceStatus;
  defaultInstall: boolean;
  decisionSurface: string;
  notes: string;
}

export const CLAUDE_CODE_GOVERNANCE_AUDIT = GENERATED_CLAUDE_CODE_GOVERNANCE_AUDIT;

export const CLAUDE_CODE_HOOK_MATRIX: readonly ClaudeCodeHookMatrixEntry[] = HOOK_SPEC.events.map(
  (event) => {
    const defaultInstall = event.installDefault !== false;
    const decisionSurface = event.verdictShape;
    return {
      event: event.name,
      status: claudeCodeHookStatus(event),
      defaultInstall,
      decisionSurface,
      notes: claudeCodeHookNotes(event.name, decisionSurface, defaultInstall),
    };
  },
);

function claudeCodeHookStatus(event: (typeof HOOK_SPEC.events)[number]): ClaudeCodeGovernanceStatus {
  if (event.verdictShape !== 'none') return 'implement_now';
  return event.installDefault === false ? 'diagnose_only' : 'observe_only';
}

function claudeCodeHookNotes(eventName: string, decisionSurface: string, defaultInstall: boolean): string {
  const label = HOOK_EVENT_LABELS[eventName] ?? eventName;
  if (decisionSurface === 'none') {
    return defaultInstall
      ? `${label} is generated as observe-only Claude Code telemetry.`
      : `${label} is generated as opt-in diagnostic telemetry.`;
  }
  return `${label} is generated as a Claude Code ${decisionSurface} governance surface.`;
}

export const CLAUDE_CODE_SURFACE_MATRIX = GENERATED_CLAUDE_CODE_SURFACE_MATRIX;

export const CLAUDE_CODE_SDK_CAPABILITY_MATRIX = GENERATED_CLAUDE_CODE_SDK_CAPABILITY_MATRIX;

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
    sdkCapabilities: CLAUDE_CODE_SDK_CAPABILITY_MATRIX,
  };
}
