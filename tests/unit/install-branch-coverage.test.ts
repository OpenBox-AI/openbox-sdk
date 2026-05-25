import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findBuiltApproverApp,
  findVsix,
  installApprover,
  installExtension,
  installMobile,
  parseHostScope,
  pickHosts,
  pickMcpTargets,
  planInstallAll,
  planUninstallAll,
  registerInstallCommands,
  runPlan,
  uninstallApprover,
  uninstallExtension,
} from '../../ts/src/cli/commands/install.js';
import { setArgvForTesting } from '../../ts/src/cli/non-interactive.js';
import { Command } from 'commander';

const temps: string[] = [];
const originalEnv = { ...process.env };
const originalCwd = process.cwd();

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'openbox-install-branch-'));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  process.env = { ...originalEnv };
  process.chdir(originalCwd);
  setArgvForTesting(null);
  vi.restoreAllMocks();
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('install command branch coverage', () => {
  it('covers approver install/uninstall filesystem branches', () => {
    const root = tempDir();
    const dest = join(root, 'Applications');
    const explicit = join(root, 'OpenBox Approver.app');
    mkdirSync(explicit, { recursive: true });
    writeFileSync(join(explicit, 'marker.txt'), 'explicit');
    mkdirSync(join(dest, 'OpenBox Approver.app'), { recursive: true });
    process.env.OPENBOX_APPROVER_APP_PATH = explicit;

    installApprover({ dest, cleanBuild: true });

    expect(readFileSync(join(dest, 'OpenBox Approver.app', 'marker.txt'), 'utf8')).toBe(
      'explicit',
    );
    expect(existsSync(explicit)).toBe(true);

    uninstallApprover(dest);
    expect(existsSync(join(dest, 'OpenBox Approver.app'))).toBe(false);
    uninstallApprover(dest);
  });

  it('removes workspace-sourced approver bundle when cleanBuild is set', () => {
    const root = tempDir();
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'openbox-sdk' }));
    const bundle = join(root, 'target/release/bundle/macos/OpenBox Approver.app');
    mkdirSync(bundle, { recursive: true });
    writeFileSync(join(bundle, 'marker.txt'), 'workspace');
    const dest = join(root, 'Applications');
    mkdirSync(dest, { recursive: true });

    delete process.env.OPENBOX_APPROVER_APP_PATH;
    delete process.env.OPENBOX_APPROVER_APP_DIR;
    process.chdir(root);
    installApprover({ dest, cleanBuild: true });

    expect(existsSync(join(dest, 'OpenBox Approver.app', 'marker.txt'))).toBe(true);
    expect(existsSync(bundle)).toBe(false);
  });

  it('covers approver lookup failures and malformed workspace markers', () => {
    const root = tempDir();
    process.env.OPENBOX_APPROVER_APP_PATH = join(root, 'missing.app');
    process.env.OPENBOX_APPROVER_APP_DIR = join(root, 'missing-dir');
    writeFileSync(join(root, 'package.json'), '{not json');

    expect(() => findBuiltApproverApp(root)).toThrow(/Couldn't find/);

    rmSync(join(root, 'package.json'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'other' }));
    expect(() => findBuiltApproverApp(root)).toThrow(/Couldn't find/);
  });

  it('covers host target helpers and extension skip paths', () => {
    expect(pickHosts({ code: true })).toEqual(['code']);
    expect(pickHosts({ cursor: true })).toEqual(['cursor']);
    expect(pickHosts({ code: true, cursor: true })).toEqual(['code', 'cursor']);
    expect(pickMcpTargets({})).toBeUndefined();
    expect(pickMcpTargets({ claudeDesktop: true, cursor: true, claudeCode: true })).toEqual([
      'claude-desktop',
      'cursor',
      'claude-code',
    ]);
    expect(parseHostScope(undefined, 'cursor')).toBe('global');
    expect(parseHostScope('PROJECT', 'cursor')).toBe('project');
    expect(parseHostScope('local', 'claude-code')).toBe('local');

    const originalExit = process.exit;
    (process as unknown as { exit: (code?: number) => never }).exit = ((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never;
    try {
      expect(() => parseHostScope('bad', 'cursor')).toThrow('exit:2');
      expect(() => parseHostScope('local', 'cursor')).toThrow('exit:2');
    } finally {
      (process as unknown as { exit: typeof originalExit }).exit = originalExit;
    }

    process.env.OPENBOX_SKIP_EXTENSION = '1';
    expect(() => installExtension({ code: true })).not.toThrow();
    expect(() => uninstallExtension({ cursor: true })).not.toThrow();
  });

  it('covers findVsix failure and mobile info surface', () => {
    expect(findVsix()).toMatch(/openbox-.*\.vsix$/);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    installMobile();
    expect(log.mock.calls.flat().join('\n')).toContain('apps.apple.com');
  });

  it('covers install/uninstall all CLI error branches and machine-mode summary', async () => {
    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => {}, writeOut: () => {} });
    registerInstallCommands(program);

    const originalExit = process.exit;
    (process as unknown as { exit: (code?: number) => never }).exit = ((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never;
    try {
      await expect(program.parseAsync(['node', 'openbox', 'install'])).rejects.toThrow(
        'exit:2',
      );
      await expect(
        program.parseAsync(['node', 'openbox', 'install', '--only', 'bad']),
      ).rejects.toThrow('exit:2');
      await expect(
        program.parseAsync(['node', 'openbox', 'uninstall', '--only', 'bad']),
      ).rejects.toThrow('exit:2');
    } finally {
      (process as unknown as { exit: typeof originalExit }).exit = originalExit;
    }

    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    setArgvForTesting(['node', 'openbox', '--json']);
    await runPlan(
      [
        { target: 'skill', skipReason: 'skip' },
        { target: 'mcp', detail: 'details', run: () => undefined },
      ],
      { verb: 'uninstall' },
    );
    expect(output.mock.calls.flat().join('\n')).toContain('"removed"');
  });

  it('covers plan uninstall run closures for skill present and absent cases', async () => {
    const home = tempDir();
    const claudeSkill = join(home, '.claude/skills/openbox');
    const cursorSkill = join(home, '.cursor/skills/openbox');
    mkdirSync(claudeSkill, { recursive: true });
    mkdirSync(cursorSkill, { recursive: true });

    const env = {
      platform: () => 'darwin' as NodeJS.Platform,
      homedir: () => home,
      exists: (p: string) => existsSync(p),
      hasOnPath: (bin: string) => bin === 'cursor',
    };
    const [skill] = planUninstallAll({ only: ['skill'] }, env);
    await skill.run?.();
    expect(existsSync(claudeSkill)).toBe(false);
    expect(existsSync(cursorSkill)).toBe(false);
    await skill.run?.();

    const plan = planInstallAll(
      { only: ['extension', 'mcp', 'approver'] },
      {
        platform: () => 'linux',
        homedir: () => home,
        exists: () => false,
        hasOnPath: () => false,
      },
    );
    expect(plan.map((entry) => [entry.target, entry.skipReason])).toEqual([
      ['extension', 'neither `code` nor `cursor` on PATH'],
      ['mcp', undefined],
      ['approver', 'macOS only'],
    ]);
  });
});
