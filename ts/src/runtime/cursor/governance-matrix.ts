import {
  HOOK_EVENT_LABELS,
  HOOK_SPEC,
} from '../../core-client/generated/runtime/cursor.js';
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

export type CursorGovernanceStatus =
  | 'implement_now'
  | 'observe_only'
  | 'diagnose_only'
  | 'explicit_out_of_scope';

export interface CursorHookMatrixEntry {
  event: string;
  status: CursorGovernanceStatus;
  defaultInstall: boolean;
  decisionSurface: string;
  notes: string;
}

export const CURSOR_HOOK_MATRIX: readonly CursorHookMatrixEntry[] = HOOK_SPEC.events.map(
  (event) => {
    const defaultInstall = event.installDefault !== false;
    const decisionSurface = event.verdictShape;
    return {
      event: event.name,
      status: cursorHookStatus(event),
      defaultInstall,
      decisionSurface,
      notes: cursorHookNotes(event.name, decisionSurface, defaultInstall),
    };
  },
);

export const CURSOR_PROVIDER_CAPABILITY_MATRIX: readonly ProviderCapabilityEntry[] =
  GENERATED_PROVIDER_CAPABILITY_MATRIX.filter((entry) => entry.provider === 'cursor');

export const CURSOR_REFERENCE_PROVIDER_PARITY_CLOSURES: readonly ReferenceProviderParityClosureEntry[] =
  GENERATED_REFERENCE_PROVIDER_PARITY_CLOSURES.filter((entry) => entry.provider === 'cursor');

export const CURSOR_REFERENCE_PROVIDER_RUNTIME_AUDIT: readonly ReferenceProviderRuntimeAuditEntry[] =
  GENERATED_REFERENCE_PROVIDER_RUNTIME_AUDIT.filter((entry) => entry.provider === 'cursor');

export const CURSOR_PROVIDER_EVENT_CATALOG: ProviderEventCatalogEntry | undefined =
  GENERATED_PROVIDER_EVENT_CATALOG.find((entry) => entry.provider === 'cursor');

export const CURSOR_CAPABILITY_IDS: readonly OpenBoxCapabilityId[] =
  CURSOR_PROVIDER_CAPABILITY_MATRIX.map((entry) => entry.capability);

function cursorHookStatus(event: (typeof HOOK_SPEC.events)[number]): CursorGovernanceStatus {
  if (event.verdictShape === 'cursor-permission' || event.verdictShape === 'cursor-continue') {
    return 'implement_now';
  }
  if (event.verdictShape === 'none') {
    return event.installDefault === false ? 'diagnose_only' : 'observe_only';
  }
  return 'observe_only';
}

function cursorHookNotes(eventName: string, decisionSurface: string, defaultInstall: boolean): string {
  const label = HOOK_EVENT_LABELS[eventName] ?? eventName;
  if (decisionSurface === 'none') {
    return defaultInstall
      ? `${label} is generated as observe-only Cursor telemetry.`
      : `${label} is generated as opt-in diagnostic telemetry.`;
  }
  if (decisionSurface === 'cursor-observe') {
    return `${label} is generated as Cursor observe-only governance telemetry.`;
  }
  return `${label} is generated as a Cursor ${decisionSurface} governance surface.`;
}

export function defaultCursorHookEvents(): string[] {
  return CURSOR_HOOK_MATRIX
    .filter((entry) => entry.defaultInstall && entry.status !== 'diagnose_only' && entry.status !== 'explicit_out_of_scope')
    .map((entry) => entry.event);
}

export function optInCursorHookEvents(): string[] {
  return CURSOR_HOOK_MATRIX
    .filter((entry) => !entry.defaultInstall)
    .map((entry) => entry.event);
}

export function cursorGovernanceSummary(): Record<string, unknown> {
  const byStatus = CURSOR_HOOK_MATRIX.reduce<Record<CursorGovernanceStatus, number>>(
    (acc, entry) => {
      acc[entry.status] += 1;
      return acc;
    },
    { implement_now: 0, observe_only: 0, diagnose_only: 0, explicit_out_of_scope: 0 },
  );
  return {
    hookCount: CURSOR_HOOK_MATRIX.length,
    defaultHookCount: defaultCursorHookEvents().length,
    optInHooks: optInCursorHookEvents(),
    byStatus,
    capabilityIds: CURSOR_CAPABILITY_IDS,
    capabilityMatrix: CURSOR_PROVIDER_CAPABILITY_MATRIX,
    parityClosures: CURSOR_REFERENCE_PROVIDER_PARITY_CLOSURES,
    runtimeAudit: CURSOR_REFERENCE_PROVIDER_RUNTIME_AUDIT,
    eventCatalog: CURSOR_PROVIDER_EVENT_CATALOG,
    generatedCapabilityIds: OPENBOX_CAPABILITY_IDS,
  };
}
