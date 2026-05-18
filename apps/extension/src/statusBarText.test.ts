// Pure-function coverage for the status-bar text builders.
//
// The string shapes here are user-visible: every release of the
// extension has to keep them stable so the user can scan the bar
// at a glance and know the current state. These tests pin every
// branch (idle-gate annotation, count vs no count, debug vs release).

import { describe, it, expect } from 'vitest';
import { buildIdleStatusBar, envTagFor } from './statusBarText';

const baseInput = {
  env: 'staging' as const,
  count: 0,
  debugBuild: false,
  preWriteGateActive: false,
  tabObserverEnabled: false,
  tabObserverActive: false,
  fileOpGateEnabled: false,
  haveAgent: false,
};

describe('buildIdleStatusBar - text shape', () => {
  it('release build, idle, nothing to say: just the icon', () => {
    const out = buildIdleStatusBar(baseInput);
    expect(out.text).toBe('$(openbox-logo)');
    expect(out.tooltip).toBeUndefined();
  });

  it('release build, count > 0: icon + "N Pending"', () => {
    const out = buildIdleStatusBar({ ...baseInput, count: 6 });
    expect(out.text).toBe('$(openbox-logo) 6 Pending');
  });

  it('debug build, no count: still just the icon', () => {
    const out = buildIdleStatusBar({ ...baseInput, debugBuild: true });
    expect(out.text).toBe('$(openbox-logo)');
  });

  it('debug build with count: no connection profile suffix', () => {
    const out = buildIdleStatusBar({ ...baseInput, debugBuild: true, count: 3 });
    expect(out.text).toBe('$(openbox-logo) 3 Pending');
  });

  it('different env values are not exposed in status text', () => {
    expect(buildIdleStatusBar({ ...baseInput, env: 'local', debugBuild: true }).text)
      .toBe('$(openbox-logo)');
    expect(buildIdleStatusBar({ ...baseInput, env: 'production', debugBuild: true }).text)
      .toBe('$(openbox-logo)');
  });
});

describe('buildIdleStatusBar - idle-gate annotation', () => {
  it('preWriteGate.active=true with no agent: gates-idle suffix appended', () => {
    const out = buildIdleStatusBar({ ...baseInput, preWriteGateActive: true });
    expect(out.text).toBe('$(openbox-logo) gates idle (no agent)');
    expect(out.tooltip).toMatch(/Active gates are turned on/);
    expect(out.tooltip).toMatch(/openbox\.agentId/);
  });

  it('preWriteGate.active + haveAgent: no idle annotation, just the icon', () => {
    const out = buildIdleStatusBar({
      ...baseInput,
      preWriteGateActive: true,
      haveAgent: true,
    });
    expect(out.text).toBe('$(openbox-logo)');
    expect(out.tooltip).toBeUndefined();
  });

  it('tabObserver enabled BUT not active: no idle annotation', () => {
    const out = buildIdleStatusBar({
      ...baseInput,
      tabObserverEnabled: true,
      tabObserverActive: false,
    });
    expect(out.text).toBe('$(openbox-logo)');
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

  it('any gate active + count: full composition without env suffix', () => {
    const out = buildIdleStatusBar({
      ...baseInput,
      preWriteGateActive: true,
      count: 6,
    });
    expect(out.text).toBe('$(openbox-logo) 6 Pending · gates idle (no agent)');
  });
});

describe('envTagFor - boot/error tag', () => {
  it('release build: just the action text (icon already identifies us)', () => {
    expect(envTagFor('Set API Key', 'staging', false)).toBe('Set API Key');
    expect(envTagFor('No Token', 'production', false)).toBe('No Token');
  });

  it('debug build: still hides env suffix', () => {
    expect(envTagFor('Set API Key', 'staging', true)).toBe('Set API Key');
    expect(envTagFor('Error', 'local', true)).toBe('Error');
  });
});
