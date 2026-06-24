import { describe, expect, it } from 'vitest';
import {
  HOOK_EVENT_LABELS,
  HOOK_SPEC,
} from '../../ts/src/core-client/generated/runtime/codex.js';
import {
  OPENBOX_CAPABILITY_IDS,
  PROVIDER_CAPABILITY_MATRIX,
  PROVIDER_EVENT_CATALOG,
  REFERENCE_PROVIDER_PARITY_CLOSURES,
  REFERENCE_PROVIDER_RUNTIME_AUDIT,
} from '../../ts/src/governance/capability-matrix.js';
import {
  CODEX_CAPABILITY_IDS,
  CODEX_HOOK_MATRIX,
  CODEX_PROVIDER_CAPABILITY_MATRIX,
  CODEX_PROVIDER_EVENT_CATALOG,
  CODEX_REFERENCE_PROVIDER_PARITY_CLOSURES,
  CODEX_REFERENCE_PROVIDER_RUNTIME_AUDIT,
  codexGovernanceSummary,
  defaultCodexHookEvents,
  optInCodexHookEvents,
} from '../../ts/src/runtime/codex/governance-matrix.js';

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

describe('Codex governance matrix drift guard', () => {
  it('derives hook governance directly from generated HOOK_SPEC metadata', () => {
    const generatedAll = HOOK_SPEC.events.map((event) => event.name).sort();
    const matrixAll = CODEX_HOOK_MATRIX.map((entry) => entry.event).sort();

    expect(matrixAll).toEqual(generatedAll);
    expect(generatedAll).toEqual(Object.keys(HOOK_EVENT_LABELS).sort());

    const generatedDefaults = HOOK_SPEC.events
      .filter((event) => event.installDefault !== false)
      .map((event) => event.name)
      .sort();
    expect(defaultCodexHookEvents().sort()).toEqual(generatedDefaults);
    expect(optInCodexHookEvents()).toEqual(
      HOOK_SPEC.events
        .filter((event) => event.installDefault === false)
        .map((event) => event.name),
    );

    for (const entry of CODEX_HOOK_MATRIX) {
      const hookSpec = HOOK_SPEC.events.find((event) => event.name === entry.event);
      expect(hookSpec, entry.event).toBeDefined();
      if (!hookSpec) continue;
      expect(entry.defaultInstall, entry.event).toBe(hookSpec.installDefault !== false);
      expect(entry.decisionSurface, entry.event).toBe(hookSpec.verdictShape);
      expect(entry.status, entry.event).toBe(
        hookSpec.verdictShape === 'none'
          ? hookSpec.installDefault === false
            ? 'diagnose_only'
            : 'observe_only'
          : 'implement_now',
      );
    }
  });

  it('summarizes Codex governance without hand-authored hook names', () => {
    expect(codexGovernanceSummary()).toMatchObject({
      hookCount: HOOK_SPEC.events.length,
      defaultHookCount: HOOK_SPEC.events.filter((event) => event.installDefault !== false).length,
      optInHooks: optInCodexHookEvents(),
      byStatus: {
        implement_now: CODEX_HOOK_MATRIX.filter((entry) => entry.status === 'implement_now').length,
        observe_only: CODEX_HOOK_MATRIX.filter((entry) => entry.status === 'observe_only').length,
        diagnose_only: CODEX_HOOK_MATRIX.filter((entry) => entry.status === 'diagnose_only').length,
        explicit_out_of_scope: 0,
      },
      capabilityIds: CODEX_CAPABILITY_IDS,
      capabilityMatrix: CODEX_PROVIDER_CAPABILITY_MATRIX,
      parityClosures: CODEX_REFERENCE_PROVIDER_PARITY_CLOSURES,
      runtimeAudit: CODEX_REFERENCE_PROVIDER_RUNTIME_AUDIT,
      eventCatalog: CODEX_PROVIDER_EVENT_CATALOG,
      generatedCapabilityIds: OPENBOX_CAPABILITY_IDS,
    });
  });

  it('exposes generated provider governance surfaces for every Codex capability', () => {
    expect(CODEX_PROVIDER_CAPABILITY_MATRIX).toEqual(
      PROVIDER_CAPABILITY_MATRIX.filter((entry) => entry.provider === 'codex'),
    );
    expect(CODEX_REFERENCE_PROVIDER_PARITY_CLOSURES).toEqual(
      REFERENCE_PROVIDER_PARITY_CLOSURES.filter((entry) => entry.provider === 'codex'),
    );
    expect(CODEX_REFERENCE_PROVIDER_RUNTIME_AUDIT).toEqual(
      REFERENCE_PROVIDER_RUNTIME_AUDIT.filter((entry) => entry.provider === 'codex'),
    );
    expect(CODEX_PROVIDER_EVENT_CATALOG).toEqual(
      PROVIDER_EVENT_CATALOG.find((entry) => entry.provider === 'codex'),
    );

    expect(sorted(CODEX_CAPABILITY_IDS)).toEqual(sorted(OPENBOX_CAPABILITY_IDS));
    for (const entry of CODEX_REFERENCE_PROVIDER_PARITY_CLOSURES) {
      expect(OPENBOX_CAPABILITY_IDS).toContain(entry.capability);
    }
    for (const entry of CODEX_REFERENCE_PROVIDER_RUNTIME_AUDIT) {
      expect(OPENBOX_CAPABILITY_IDS).toContain(entry.capability);
    }
    expect(CODEX_PROVIDER_EVENT_CATALOG?.generatedAdapterEvents).toEqual(
      HOOK_SPEC.events.map((event) => event.name),
    );
  });
});
