// Unit coverage for the unified `openbox install` / `openbox install all`
// meta-command. Covers the detection rules (`planInstallAll`) and the
// driver (`runPlan`) without ever spawning a real installer.
//
// Detection is gated on:
//   - os.platform() (approver runs only on darwin)
//   - existsSync(~/.cursor) (cursor hooks installer)
//   - `code` / `cursor` on PATH (extension installer)
// We inject these via a fake InstallAllEnv so each test pins one rule
// at a time. Mirrors the testing style of install-approver.test.ts:
// real branching exercised against fakes, no global module mocking.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  INSTALL_ALL_TARGETS,
  planInstallAll,
  planUninstallAll,
  runPlan,
  type InstallAllEnv,
} from '../../ts/src/cli/commands/install';

function makeEnv(overrides: Partial<InstallAllEnv> = {}): InstallAllEnv {
  return {
    platform: () => 'darwin',
    homedir: () => '/home/test',
    exists: () => true,
    hasOnPath: () => true,
    ...overrides,
  };
}

describe('planInstallAll - target gating', () => {
  it('on darwin with everything available, plans every target', () => {
    const plan = planInstallAll({}, makeEnv());
    const runnable = plan.filter((p) => !p.skipReason).map((p) => p.target);
    expect(runnable).toEqual([
      'skill',
      'extension',
      'cursor',
      'claude-code',
      'mcp',
      'approver',
    ]);
  });

  it('skips approver on linux', () => {
    const plan = planInstallAll({}, makeEnv({ platform: () => 'linux' }));
    const approver = plan.find((p) => p.target === 'approver');
    expect(approver?.skipReason).toMatch(/macOS only/);
  });

  it('skips approver on win32', () => {
    const plan = planInstallAll({}, makeEnv({ platform: () => 'win32' }));
    const approver = plan.find((p) => p.target === 'approver');
    expect(approver?.skipReason).toMatch(/macOS only/);
  });

  it('skips cursor when ~/.cursor is absent', () => {
    const plan = planInstallAll(
      {},
      makeEnv({
        exists: (p) => !p.endsWith('/.cursor'),
      }),
    );
    const cursor = plan.find((p) => p.target === 'cursor');
    expect(cursor?.skipReason).toMatch(/not present/);
  });

  it('runs cursor when ~/.cursor exists', () => {
    const plan = planInstallAll({}, makeEnv({ exists: () => true }));
    const cursor = plan.find((p) => p.target === 'cursor');
    expect(cursor?.skipReason).toBeUndefined();
    expect(cursor?.run).toBeDefined();
  });

  it('always runs claude-code (installer creates ~/.claude as needed)', () => {
    const plan = planInstallAll({}, makeEnv({ exists: () => false }));
    const cc = plan.find((p) => p.target === 'claude-code');
    expect(cc?.skipReason).toBeUndefined();
    expect(cc?.run).toBeDefined();
  });

  it('skips extension when neither code nor cursor is on PATH', () => {
    const plan = planInstallAll({}, makeEnv({ hasOnPath: () => false }));
    const ext = plan.find((p) => p.target === 'extension');
    expect(ext?.skipReason).toMatch(/PATH/);
  });

  it('runs extension when only `code` is on PATH', () => {
    const plan = planInstallAll(
      {},
      makeEnv({ hasOnPath: (b) => b === 'code' }),
    );
    const ext = plan.find((p) => p.target === 'extension');
    expect(ext?.skipReason).toBeUndefined();
    expect(ext?.detail).toContain('code');
    expect(ext?.detail).not.toContain('cursor');
  });

  it('runs extension when only `cursor` is on PATH', () => {
    const plan = planInstallAll(
      {},
      makeEnv({ hasOnPath: (b) => b === 'cursor' }),
    );
    const ext = plan.find((p) => p.target === 'extension');
    expect(ext?.skipReason).toBeUndefined();
    expect(ext?.detail).toContain('cursor');
    expect(ext?.detail).not.toContain('code');
  });

  it('always plans skill and mcp (no platform/path gates)', () => {
    const plan = planInstallAll(
      {},
      makeEnv({
        platform: () => 'linux',
        exists: () => false,
        hasOnPath: () => false,
      }),
    );
    const skill = plan.find((p) => p.target === 'skill');
    const mcp = plan.find((p) => p.target === 'mcp');
    expect(skill?.skipReason).toBeUndefined();
    expect(mcp?.skipReason).toBeUndefined();
  });
});

describe('planInstallAll - filters', () => {
  it('--skip excludes named targets', () => {
    const plan = planInstallAll({ skip: ['mcp'] }, makeEnv());
    const mcp = plan.find((p) => p.target === 'mcp');
    expect(mcp?.skipReason).toMatch(/--skip/);
  });

  it('--skip is repeatable', () => {
    const plan = planInstallAll({ skip: ['mcp', 'skill'] }, makeEnv());
    expect(plan.find((p) => p.target === 'mcp')?.skipReason).toMatch(/--skip/);
    expect(plan.find((p) => p.target === 'skill')?.skipReason).toMatch(
      /--skip/,
    );
  });

  it('--only restricts to named targets', () => {
    const plan = planInstallAll({ only: ['extension'] }, makeEnv());
    expect(plan).toHaveLength(1);
    expect(plan[0].target).toBe('extension');
  });

  it('--only is repeatable', () => {
    const plan = planInstallAll(
      { only: ['extension', 'skill'] },
      makeEnv(),
    );
    expect(plan.map((p) => p.target).sort()).toEqual(['extension', 'skill']);
  });

  it('--skip and --only together throw', () => {
    expect(() =>
      planInstallAll({ skip: ['mcp'], only: ['extension'] }, makeEnv()),
    ).toThrow(/mutually exclusive/);
  });

  it('rejects unknown --skip target', () => {
    expect(() => planInstallAll({ skip: ['bogus'] }, makeEnv())).toThrow(
      /Unknown --skip target/,
    );
  });

  it('rejects unknown --only target', () => {
    expect(() => planInstallAll({ only: ['bogus'] }, makeEnv())).toThrow(
      /Unknown --only target/,
    );
  });

  it('exposes the canonical target list in run order', () => {
    expect(INSTALL_ALL_TARGETS).toEqual([
      'skill',
      'extension',
      'cursor',
      'claude-code',
      'mcp',
      'approver',
    ]);
  });
});

describe('runPlan - driver', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('--dry-run runs nothing but logs each target', async () => {
    const ran: string[] = [];
    const plan = [
      { target: 'skill' as const, run: () => { ran.push('skill'); } },
      { target: 'mcp' as const, run: () => { ran.push('mcp'); } },
    ];
    const summary = await runPlan(plan, { dryRun: true });
    expect(ran).toEqual([]);
    expect(summary.installed).toEqual(['skill', 'mcp']);
    const dryLines = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .filter((s: string) => s.startsWith('Would install:'));
    expect(dryLines).toHaveLength(2);
  });

  it('continues past a failing target and reports it in the summary', async () => {
    const ran: string[] = [];
    const plan = [
      { target: 'skill' as const, run: () => { ran.push('skill'); } },
      {
        target: 'mcp' as const,
        run: () => {
          throw new Error('boom');
        },
      },
      { target: 'extension' as const, run: () => { ran.push('extension'); } },
    ];
    const summary = await runPlan(plan);
    expect(ran).toEqual(['skill', 'extension']);
    expect(summary.installed).toEqual(['skill', 'extension']);
    expect(summary.failed).toEqual([{ target: 'mcp', error: 'boom' }]);
  });

  it('emits skipped entries verbatim without invoking run', async () => {
    let ranAny = false;
    const plan = [
      {
        target: 'approver' as const,
        skipReason: 'macOS only',
        run: () => {
          ranAny = true;
        },
      },
      { target: 'skill' as const, run: () => {} },
    ];
    const summary = await runPlan(plan);
    expect(ranAny).toBe(false);
    expect(summary.skipped).toEqual([
      { target: 'approver', reason: 'macOS only' },
    ]);
    expect(summary.installed).toEqual(['skill']);
  });

  it('uninstall verb flips the log strings', async () => {
    const plan = [{ target: 'skill' as const, run: () => {} }];
    await runPlan(plan, { verb: 'uninstall' });
    const lines = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(lines.some((l: string) => l.startsWith('Uninstalling skill'))).toBe(true);
    expect(lines.some((l: string) => l.includes('Uninstalled:'))).toBe(true);
  });

  it('summary line lists Installed, Skipped, and Failed when each is present', async () => {
    const plan = [
      { target: 'skill' as const, run: () => {} },
      { target: 'mcp' as const, skipReason: 'because' },
      {
        target: 'extension' as const,
        run: () => {
          throw new Error('nope');
        },
      },
    ];
    await runPlan(plan);
    const summaryLine = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .find((l: string) => l.startsWith('\nInstalled:'));
    expect(summaryLine).toContain('Installed: skill.');
    expect(summaryLine).toContain('Skipped: mcp (because).');
    expect(summaryLine).toContain('Failed: extension (nope).');
  });
});

describe('planUninstallAll - mirror', () => {
  it('inherits skip/only validation from install plan', () => {
    expect(() =>
      planUninstallAll({ skip: ['mcp'], only: ['skill'] }, makeEnv()),
    ).toThrow(/mutually exclusive/);
  });

  it('mirrors gating: approver skipped on linux', () => {
    const plan = planUninstallAll({}, makeEnv({ platform: () => 'linux' }));
    const approver = plan.find((p) => p.target === 'approver');
    expect(approver?.skipReason).toMatch(/macOS only/);
  });

  it('mirrors gating: cursor skipped when ~/.cursor missing', () => {
    const plan = planUninstallAll(
      {},
      makeEnv({ exists: (p) => !p.endsWith('/.cursor') }),
    );
    const cursor = plan.find((p) => p.target === 'cursor');
    expect(cursor?.skipReason).toMatch(/not present/);
  });
});
