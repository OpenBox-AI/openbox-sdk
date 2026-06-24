import {
  HOOK_EVENT_LABELS,
  HOOK_SPEC,
} from '../../core-client/generated/runtime/codex.js';
import {
  OPENBOX_CAPABILITY_IDS,
  PROVIDER_CAPABILITY_MATRIX as GENERATED_PROVIDER_CAPABILITY_MATRIX,
  PROVIDER_EVENT_CATALOG as GENERATED_PROVIDER_EVENT_CATALOG,
  REFERENCE_PROVIDER_PARITY_CLOSURES as GENERATED_REFERENCE_PROVIDER_PARITY_CLOSURES,
  REFERENCE_PROVIDER_RUNTIME_AUDIT as GENERATED_REFERENCE_PROVIDER_RUNTIME_AUDIT,
  type OpenBoxCapabilityId,
  type ProviderCapabilityEntry,
  type ProviderEventCatalogEntry,
  type ReferenceProviderParityClosureEntry,
  type ReferenceProviderRuntimeAuditEntry,
} from '../../governance/capability-matrix.js';

export type CodexGovernanceStatus =
  | 'implement_now'
  | 'observe_only'
  | 'diagnose_only'
  | 'explicit_out_of_scope';

export interface CodexHookMatrixEntry {
  event: string;
  status: CodexGovernanceStatus;
  defaultInstall: boolean;
  decisionSurface: string;
  notes: string;
}

export const CODEX_HOOK_MATRIX: readonly CodexHookMatrixEntry[] = HOOK_SPEC.events.map(
  (event) => {
    const defaultInstall = event.installDefault !== false;
    const decisionSurface = event.verdictShape;
    return {
      event: event.name,
      status: codexHookStatus(event),
      defaultInstall,
      decisionSurface,
      notes: codexHookNotes(event.name, decisionSurface, defaultInstall),
    };
  },
);

export const CODEX_PROVIDER_CAPABILITY_MATRIX: readonly ProviderCapabilityEntry[] =
  GENERATED_PROVIDER_CAPABILITY_MATRIX.filter((entry) => entry.provider === 'codex');

export const CODEX_REFERENCE_PROVIDER_PARITY_CLOSURES: readonly ReferenceProviderParityClosureEntry[] =
  GENERATED_REFERENCE_PROVIDER_PARITY_CLOSURES.filter((entry) => entry.provider === 'codex');

export const CODEX_REFERENCE_PROVIDER_RUNTIME_AUDIT: readonly ReferenceProviderRuntimeAuditEntry[] =
  GENERATED_REFERENCE_PROVIDER_RUNTIME_AUDIT.filter((entry) => entry.provider === 'codex');

export const CODEX_PROVIDER_EVENT_CATALOG: ProviderEventCatalogEntry | undefined =
  GENERATED_PROVIDER_EVENT_CATALOG.find((entry) => entry.provider === 'codex');

export const CODEX_CAPABILITY_IDS: readonly OpenBoxCapabilityId[] =
  CODEX_PROVIDER_CAPABILITY_MATRIX.map((entry) => entry.capability);

function codexHookStatus(event: (typeof HOOK_SPEC.events)[number]): CodexGovernanceStatus {
  if (event.verdictShape !== 'none') return 'implement_now';
  return event.installDefault === false ? 'diagnose_only' : 'observe_only';
}

function codexHookNotes(eventName: string, decisionSurface: string, defaultInstall: boolean): string {
  const label = HOOK_EVENT_LABELS[eventName] ?? eventName;
  if (decisionSurface === 'none') {
    return defaultInstall
      ? `${label} is generated as observe-only Codex telemetry.`
      : `${label} is generated as opt-in diagnostic telemetry.`;
  }
  return `${label} is generated as a Codex ${decisionSurface} governance surface.`;
}

export function defaultCodexHookEvents(): string[] {
  return CODEX_HOOK_MATRIX
    .filter((entry) => entry.defaultInstall && entry.status !== 'diagnose_only' && entry.status !== 'explicit_out_of_scope')
    .map((entry) => entry.event);
}

export function optInCodexHookEvents(): string[] {
  return CODEX_HOOK_MATRIX
    .filter((entry) => !entry.defaultInstall)
    .map((entry) => entry.event);
}

export function codexGovernanceSummary(): Record<string, unknown> {
  const byStatus = CODEX_HOOK_MATRIX.reduce<Record<CodexGovernanceStatus, number>>(
    (acc, entry) => {
      acc[entry.status] += 1;
      return acc;
    },
    { implement_now: 0, observe_only: 0, diagnose_only: 0, explicit_out_of_scope: 0 },
  );
  return {
    hookCount: CODEX_HOOK_MATRIX.length,
    defaultHookCount: defaultCodexHookEvents().length,
    optInHooks: optInCodexHookEvents(),
    byStatus,
    capabilityIds: CODEX_CAPABILITY_IDS,
    capabilityMatrix: CODEX_PROVIDER_CAPABILITY_MATRIX,
    parityClosures: CODEX_REFERENCE_PROVIDER_PARITY_CLOSURES,
    runtimeAudit: CODEX_REFERENCE_PROVIDER_RUNTIME_AUDIT,
    eventCatalog: CODEX_PROVIDER_EVENT_CATALOG,
    generatedCapabilityIds: OPENBOX_CAPABILITY_IDS,
  };
}
