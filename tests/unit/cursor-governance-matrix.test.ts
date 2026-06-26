import { describe, expect, it } from 'vitest';
import {
  HOOK_EVENT_LABELS,
  HOOK_SPEC,
} from '../../ts/src/core-client/generated/runtime/cursor.js';
import {
  OPENBOX_CAPABILITY_IDS,
  PROVIDER_CAPABILITY_MATRIX,
  PROVIDER_EVENT_CATALOG,
  REFERENCE_PROVIDER_PARITY_CLOSURES,
  REFERENCE_PROVIDER_RUNTIME_AUDIT,
} from '../../ts/src/governance/capability-matrix.js';
import {
  CURSOR_CAPABILITY_IDS,
  CURSOR_HOOK_MATRIX,
  CURSOR_PROVIDER_CAPABILITY_MATRIX,
  CURSOR_PROVIDER_EVENT_CATALOG,
  CURSOR_REFERENCE_PROVIDER_PARITY_CLOSURES,
  CURSOR_REFERENCE_PROVIDER_RUNTIME_AUDIT,
  cursorGovernanceSummary,
  defaultCursorHookEvents,
  optInCursorHookEvents,
} from '../../ts/src/runtime/cursor/governance-matrix.js';

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function expectedStatus(event: (typeof HOOK_SPEC.events)[number]): string {
  if (event.verdictShape === 'cursor-permission' || event.verdictShape === 'cursor-continue') {
    return 'implement_now';
  }
  if (event.verdictShape === 'none') {
    return event.installDefault === false ? 'diagnose_only' : 'observe_only';
  }
  return 'observe_only';
}

describe('Cursor governance matrix drift guard', () => {
  it('derives hook governance directly from generated HOOK_SPEC metadata', () => {
    const generatedAll = HOOK_SPEC.events.map((event) => event.name).sort();
    const matrixAll = CURSOR_HOOK_MATRIX.map((entry) => entry.event).sort();

    expect(matrixAll).toEqual(generatedAll);
    expect(generatedAll).toEqual(Object.keys(HOOK_EVENT_LABELS).sort());

    const generatedDefaults = HOOK_SPEC.events
      .filter((event) => event.installDefault !== false)
      .map((event) => event.name)
      .sort();
    expect(defaultCursorHookEvents().sort()).toEqual(generatedDefaults);
    expect(optInCursorHookEvents()).toEqual(
      HOOK_SPEC.events
        .filter((event) => event.installDefault === false)
        .map((event) => event.name),
    );

    for (const entry of CURSOR_HOOK_MATRIX) {
      const hookSpec = HOOK_SPEC.events.find((event) => event.name === entry.event);
      expect(hookSpec, entry.event).toBeDefined();
      if (!hookSpec) continue;
      expect(entry.defaultInstall, entry.event).toBe(hookSpec.installDefault !== false);
      expect(entry.decisionSurface, entry.event).toBe(hookSpec.verdictShape);
      expect(entry.status, entry.event).toBe(expectedStatus(hookSpec));
    }
  });

  it('summarizes Cursor governance without hand-authored hook names', () => {
    expect(cursorGovernanceSummary()).toMatchObject({
      hookCount: HOOK_SPEC.events.length,
      defaultHookCount: HOOK_SPEC.events.filter((event) => event.installDefault !== false).length,
      optInHooks: optInCursorHookEvents(),
      byStatus: {
        implement_now: CURSOR_HOOK_MATRIX.filter((entry) => entry.status === 'implement_now').length,
        observe_only: CURSOR_HOOK_MATRIX.filter((entry) => entry.status === 'observe_only').length,
        diagnose_only: CURSOR_HOOK_MATRIX.filter((entry) => entry.status === 'diagnose_only').length,
        explicit_out_of_scope: 0,
      },
      capabilityIds: CURSOR_CAPABILITY_IDS,
      capabilityMatrix: CURSOR_PROVIDER_CAPABILITY_MATRIX,
      parityClosures: CURSOR_REFERENCE_PROVIDER_PARITY_CLOSURES,
      runtimeAudit: CURSOR_REFERENCE_PROVIDER_RUNTIME_AUDIT,
      eventCatalog: CURSOR_PROVIDER_EVENT_CATALOG,
      generatedCapabilityIds: OPENBOX_CAPABILITY_IDS,
    });
  });

  it('exposes generated provider governance surfaces for every Cursor capability', () => {
    expect(CURSOR_PROVIDER_CAPABILITY_MATRIX).toEqual(
      PROVIDER_CAPABILITY_MATRIX.filter((entry) => entry.provider === 'cursor'),
    );
    expect(CURSOR_REFERENCE_PROVIDER_PARITY_CLOSURES).toEqual(
      REFERENCE_PROVIDER_PARITY_CLOSURES.filter((entry) => entry.provider === 'cursor'),
    );
    expect(CURSOR_REFERENCE_PROVIDER_RUNTIME_AUDIT).toEqual(
      REFERENCE_PROVIDER_RUNTIME_AUDIT.filter((entry) => entry.provider === 'cursor'),
    );
    expect(CURSOR_PROVIDER_EVENT_CATALOG).toEqual(
      PROVIDER_EVENT_CATALOG.find((entry) => entry.provider === 'cursor'),
    );

    expect(sorted(CURSOR_CAPABILITY_IDS)).toEqual(sorted(OPENBOX_CAPABILITY_IDS));
    for (const entry of CURSOR_REFERENCE_PROVIDER_PARITY_CLOSURES) {
      expect(OPENBOX_CAPABILITY_IDS).toContain(entry.capability);
    }
    for (const entry of CURSOR_REFERENCE_PROVIDER_RUNTIME_AUDIT) {
      expect(OPENBOX_CAPABILITY_IDS).toContain(entry.capability);
    }
    expect(CURSOR_PROVIDER_EVENT_CATALOG?.generatedAdapterEvents).toEqual(
      HOOK_SPEC.events.map((event) => event.name),
    );
  });
});
