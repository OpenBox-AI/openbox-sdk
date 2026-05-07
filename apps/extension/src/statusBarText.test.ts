// Pure-function coverage for the status-bar text builders.
//
// The string shapes here are user-visible: every release of the
// extension has to keep them stable so the user can scan the bar
// at a glance and know the current state. These tests pin every
// branch (env suffix variants, idle-gate annotation, count vs no
// count, debug vs release, mock vs live).

import { describe, it, expect } from 'vitest';
import { buildIdleStatusBar, envTagFor } from './statusBarText';

const baseInput = {
  env: 'staging' as const,
  count: 0,
  mockAuth: false,
  debugBuild: false,
  preWriteGateActive: false,
  tabObserverEnabled: false,
  tabObserverActive: false,
  fileOpGateEnabled: false,
  haveAgent: false,
};

describe('buildIdleStatusBar - text shape', () => {
  it('release build, no mock, no count: "$(shield) OpenBox" with no suffix', () => {
    const out = buildIdleStatusBar(baseInput);
    expect(out.text).toBe('$(shield) OpenBox');
    expect(out.tooltip).toBeUndefined();
  });

  it('release build, no mock, count > 0: "$(shield) N Pending"', () => {
    const out = buildIdleStatusBar({ ...baseInput, count: 6 });
    expect(out.text).toBe('$(shield) 6 Pending');
  });

  it('debug build, no mock: env tag is appended', () => {
    const out = buildIdleStatusBar({ ...baseInput, debugBuild: true });
    expect(out.text).toBe('$(shield) OpenBox · staging');
  });

  it('debug build with count: env tag appended after Pending', () => {
    const out = buildIdleStatusBar({ ...baseInput, debugBuild: true, count: 3 });
    expect(out.text).toBe('$(shield) 3 Pending · staging');
  });

  it('mock auth: MOCK suffix wins regardless of debug flag', () => {
    const release = buildIdleStatusBar({ ...baseInput, mockAuth: true });
    const debug = buildIdleStatusBar({ ...baseInput, mockAuth: true, debugBuild: true });
    expect(release.text).toBe('$(shield) OpenBox · MOCK · staging');
    expect(debug.text).toBe('$(shield) OpenBox · MOCK · staging');
  });

  it('mock auth + count: MOCK suffix between count and env', () => {
    const out = buildIdleStatusBar({ ...baseInput, mockAuth: true, count: 6 });
    expect(out.text).toBe('$(shield) 6 Pending · MOCK · staging');
  });

  it('different env values land in the suffix verbatim', () => {
    expect(buildIdleStatusBar({ ...baseInput, env: 'local', debugBuild: true }).text)
      .toBe('$(shield) OpenBox · local');
    expect(buildIdleStatusBar({ ...baseInput, env: 'production', debugBuild: true }).text)
      .toBe('$(shield) OpenBox · production');
  });
});

describe('buildIdleStatusBar - idle-gate annotation', () => {
  it('preWriteGate.active=true with no agent: " · gates idle (no agent)" appended', () => {
    const out = buildIdleStatusBar({ ...baseInput, preWriteGateActive: true });
    expect(out.text).toBe('$(shield) OpenBox · gates idle (no agent)');
    expect(out.tooltip).toMatch(/Active gates are turned on/);
    expect(out.tooltip).toMatch(/openbox\.agentId/);
  });

  it('preWriteGate.active + haveAgent: no idle annotation, no tooltip override', () => {
    const out = buildIdleStatusBar({
      ...baseInput,
      preWriteGateActive: true,
      haveAgent: true,
    });
    expect(out.text).toBe('$(shield) OpenBox');
    expect(out.tooltip).toBeUndefined();
  });

  it('tabObserver enabled BUT not active: no idle annotation', () => {
    const out = buildIdleStatusBar({
      ...baseInput,
      tabObserverEnabled: true,
      tabObserverActive: false,
    });
    expect(out.text).toBe('$(shield) OpenBox');
  });

  it('tabObserver enabled AND active, no agent: idle annotation', () => {
    const out = buildIdleStatusBar({
      ...baseInput,
      tabObserverEnabled: true,
      tabObserverActive: true,
    });
    expect(out.text).toMatch(/gates idle \(no agent\)$/);
  });

  it('fileOpGate enabled, no agent: idle annotation', () => {
    const out = buildIdleStatusBar({ ...baseInput, fileOpGateEnabled: true });
    expect(out.text).toMatch(/gates idle \(no agent\)$/);
  });

  it('any gate active + count + mock auth: full composition', () => {
    const out = buildIdleStatusBar({
      ...baseInput,
      preWriteGateActive: true,
      mockAuth: true,
      count: 6,
    });
    expect(out.text).toBe('$(shield) 6 Pending · MOCK · staging · gates idle (no agent)');
  });
});

describe('envTagFor - boot/error tag', () => {
  it('release build hides env name from transient state', () => {
    expect(envTagFor('Set API Key', 'staging', false)).toBe('OpenBox: Set API Key');
    expect(envTagFor('No Token', 'production', false)).toBe('OpenBox: No Token');
  });

  it('debug build carries env in transient state for development visibility', () => {
    expect(envTagFor('Set API Key', 'staging', true)).toBe('OpenBox · staging: Set API Key');
    expect(envTagFor('Error', 'local', true)).toBe('OpenBox · local: Error');
  });
});
