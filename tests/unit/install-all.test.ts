// Unit coverage for `openbox install` (no target). Covers the detection
// rules (`planInstallAll`) and the driver (`runPlan`) without ever
// spawning a real installer.
//
// Detection is gated on:
//   - os.platform() (approver runs only on darwin)
//   - existsSync(~/.cursor) (cursor hooks installer)
//   - existsSync(~/.claude) (claude-code installer)
//   - `code` / `cursor` on PATH (extension installer)
//   - existsSync(any MCP host config) (mcp — needs at least one host)
//   - skill is OPT-IN ONLY (never auto-suggested; reach via --only or
//     the per-target subcommand)
// Targets without a host are dropped from the plan entirely (not
// shown as skipped) so bare `openbox install` only suggests work
// the machine actually wants. `--only <target>` forces inclusion.
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

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const stripAnsi = (s: string) => s.replace(ANSI_RE, '');

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
  it('on darwin with everything available, plans every auto-detect target (skill is opt-in)', () => {
    const plan = planInstallAll({}, makeEnv());
    const runnable = plan.filter((p) => !p.skipReason).map((p) => p.target);
    // skill is intentionally absent from bare-install auto-detect.
    expect(runnable).toEqual([
      'extension',
      'cursor',
      'claude-code',
      'mcp',
      'approver',
    ]);
  });

  it('skill is never auto-suggested even when both hosts exist', () => {
    const plan = planInstallAll({}, makeEnv());
    expect(plan.find((p) => p.target === 'skill')).toBeUndefined();
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

  it('drops claude-code from auto-detect when ~/.claude is absent', () => {
    const plan = planInstallAll({}, makeEnv({ exists: () => false }));
    expect(plan.find((p) => p.target === 'claude-code')).toBeUndefined();
  });

  it('runs claude-code when ~/.claude exists', () => {
    const plan = planInstallAll(
      {},
      makeEnv({ exists: (p) => p.endsWith('/.claude') }),
    );
    const cc = plan.find((p) => p.target === 'claude-code');
    expect(cc?.skipReason).toBeUndefined();
    expect(cc?.run).toBeDefined();
  });

  it('--only claude-code forces inclusion even when ~/.claude is absent', () => {
    const plan = planInstallAll(
      { only: ['claude-code'] },
      makeEnv({ exists: () => false }),
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].target).toBe('claude-code');
    expect(plan[0].skipReason).toBeUndefined();
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

  it('drops skill and mcp when no host artifacts exist', () => {
    const plan = planInstallAll(
      {},
      makeEnv({
        platform: () => 'linux',
        exists: () => false,
        hasOnPath: () => false,
      }),
    );
    expect(plan.find((p) => p.target === 'skill')).toBeUndefined();
    expect(plan.find((p) => p.target === 'mcp')).toBeUndefined();
  });

  it('--only skill forces inclusion with no host present', () => {
    const plan = planInstallAll(
      { only: ['skill'] },
      makeEnv({ exists: () => false }),
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].target).toBe('skill');
    expect(plan[0].skipReason).toBeUndefined();
  });

  it('--only mcp forces inclusion with no host present', () => {
    const plan = planInstallAll(
      { only: ['mcp'] },
      makeEnv({ exists: () => false }),
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].target).toBe('mcp');
    expect(plan[0].skipReason).toBeUndefined();
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

  it('--dry-run runs nothing but logs each target as a `would-install` row', async () => {
    const ran: string[] = [];
    const plan = [
      { target: 'skill' as const, run: () => { ran.push('skill'); } },
      { target: 'mcp' as const, run: () => { ran.push('mcp'); } },
    ];
    const summary = await runPlan(plan, { dryRun: true });
    expect(ran).toEqual([]);
    expect(summary.installed).toEqual(['skill', 'mcp']);
    const dryLines = logSpy.mock.calls
      .map((c: unknown[]) => stripAnsi(String(c[0])))
      .filter((s: string) => s.includes('would-install'));
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

  it('uninstall verb routes through `Uninstalling` action and `removed` row', async () => {
    const plan = [{ target: 'skill' as const, run: () => {} }];
    await runPlan(plan, { verb: 'uninstall' });
    const lines = logSpy.mock.calls.map((c: unknown[]) => stripAnsi(String(c[0])));
    expect(lines.some((l: string) => l.includes('Uninstalling skill…'))).toBe(true);
    expect(lines.some((l: string) => l.includes('removed') && l.includes('skill'))).toBe(true);
    expect(lines.some((l: string) => l.startsWith('done.') && l.includes('removed=1'))).toBe(true);
  });

  it('summary line emits done. with installed/skipped/failed counts', async () => {
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
      .map((c: unknown[]) => stripAnsi(String(c[0])))
      .find((l: string) => l.startsWith('done.'));
    expect(summaryLine).toBe('done. installed=1 skipped=1 failed=1');
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
