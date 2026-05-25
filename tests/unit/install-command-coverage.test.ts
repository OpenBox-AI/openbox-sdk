import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';

import {
  findBuiltApproverApp,
  planInstallAll,
  planUninstallAll,
  registerInstallCommands,
  runPlan,
  type InstallAllEnv,
} from '../../ts/src/cli/commands/install.ts';

const temps: string[] = [];
const oldApproverPath = process.env.OPENBOX_APPROVER_APP_PATH;
const oldApproverDir = process.env.OPENBOX_APPROVER_APP_DIR;
const oldHome = process.env.HOME;
const oldSkipExtension = process.env.OPENBOX_SKIP_EXTENSION;
const oldAssumeYes = process.env.OPENBOX_ASSUME_YES;

function tempDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), name));
  temps.push(dir);
  return dir;
}

function fakeEnv(opts: {
  platform?: NodeJS.Platform;
  home?: string;
  paths?: string[];
  bins?: string[];
} = {}): InstallAllEnv {
  const paths = new Set(opts.paths ?? []);
  const bins = new Set(opts.bins ?? []);
  return {
    platform: () => opts.platform ?? 'darwin',
    homedir: () => opts.home ?? '/home/tester',
    exists: (p) => paths.has(p),
    hasOnPath: (bin) => bins.has(bin),
  };
}

afterEach(() => {
  if (oldApproverPath === undefined) delete process.env.OPENBOX_APPROVER_APP_PATH;
  else process.env.OPENBOX_APPROVER_APP_PATH = oldApproverPath;
  if (oldApproverDir === undefined) delete process.env.OPENBOX_APPROVER_APP_DIR;
  else process.env.OPENBOX_APPROVER_APP_DIR = oldApproverDir;
  if (oldHome === undefined) delete process.env.HOME;
  else process.env.HOME = oldHome;
  if (oldSkipExtension === undefined) delete process.env.OPENBOX_SKIP_EXTENSION;
  else process.env.OPENBOX_SKIP_EXTENSION = oldSkipExtension;
  if (oldAssumeYes === undefined) delete process.env.OPENBOX_ASSUME_YES;
  else process.env.OPENBOX_ASSUME_YES = oldAssumeYes;
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function runInstallCli(args: string[]): Promise<void> {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => undefined,
    writeErr: () => undefined,
  });
  registerInstallCommands(program);
  await program.parseAsync(args, { from: 'user' });
}

describe('install command planning', () => {
  it('locates the approver bundle from explicit path, explicit dir, and workspace build output', () => {
    const app = join(tempDir('openbox-app-path-'), 'OpenBox Approver.app');
    mkdirSync(app, { recursive: true });
    process.env.OPENBOX_APPROVER_APP_PATH = app;
    expect(findBuiltApproverApp('/nowhere')).toEqual({ path: app, source: 'env-path' });

    delete process.env.OPENBOX_APPROVER_APP_PATH;
    const appDir = tempDir('openbox-app-dir-');
    const appInDir = join(appDir, 'OpenBox Approver.app');
    mkdirSync(appInDir, { recursive: true });
    process.env.OPENBOX_APPROVER_APP_DIR = appDir;
    expect(findBuiltApproverApp('/nowhere')).toEqual({ path: appInDir, source: 'env-dir' });

    delete process.env.OPENBOX_APPROVER_APP_DIR;
    const root = tempDir('openbox-root-');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'openbox-sdk' }));
    const workspaceApp = join(root, 'target/release/bundle/macos/OpenBox Approver.app');
    mkdirSync(workspaceApp, { recursive: true });
    expect(findBuiltApproverApp(join(root, 'nested/project'))).toEqual({
      path: workspaceApp,
      source: 'workspace',
    });
  });

  it('validates only/skip options and creates install plans for detected hosts', () => {
    const home = '/Users/tester';
    const env = fakeEnv({
      platform: 'darwin',
      home,
      bins: ['code', 'cursor'],
      paths: [
        join(home, '.cursor'),
        join(home, '.claude'),
        join(home, 'Library/Application Support/Claude'),
      ],
    });

    expect(() => planInstallAll({ only: ['bad'] }, env)).toThrow(/Unknown --only/);
    expect(() => planInstallAll({ skip: ['bad'] }, env)).toThrow(/Unknown --skip/);
    expect(() => planInstallAll({ skip: ['cursor'], only: ['cursor'] }, env)).toThrow(/mutually exclusive/);

    const plan = planInstallAll({ only: ['skill', 'extension', 'cursor', 'claude-code', 'mcp', 'approver'] }, env);
    expect(plan.map((entry) => [entry.target, entry.skipReason ?? entry.detail])).toEqual([
      ['skill', 'hosts: claude, cursor'],
      ['extension', 'hosts: code, cursor'],
      ['cursor', join(home, '.cursor')],
      ['claude-code', join(home, '.claude/settings.json')],
      ['mcp', 'hosts: claude-desktop, cursor, claude-code'],
      ['approver', '/Applications'],
    ]);

    const skipped = planInstallAll({ only: ['extension', 'approver'], skip: undefined }, fakeEnv({ platform: 'linux' }));
    expect(skipped.map((entry) => [entry.target, entry.skipReason])).toEqual([
      ['extension', 'neither `code` nor `cursor` on PATH'],
      ['approver', 'macOS only'],
    ]);
  });

  it('mirrors uninstall plans and runPlan records skipped, dry-run, success, and failure entries', async () => {
    const env = fakeEnv({ paths: ['/home/tester/.cursor'], bins: ['cursor'] });
    const uninstall = planUninstallAll({ only: ['extension', 'cursor'] }, env);
    expect(uninstall.map((entry) => entry.target)).toEqual(['extension', 'cursor']);

    const calls: string[] = [];
    const result = await runPlan(
      [
        { target: 'skill', skipReason: 'excluded' },
        { target: 'extension', detail: 'dry' },
        {
          target: 'cursor',
          run: () => {
            calls.push('cursor');
          },
        },
        {
          target: 'mcp',
          run: () => {
            throw new Error('boom');
          },
        },
      ],
      { dryRun: true },
    );
    expect(result).toEqual({
      installed: ['extension', 'cursor', 'mcp'],
      skipped: [{ target: 'skill', reason: 'excluded' }],
      failed: [],
    });
    expect(calls).toEqual([]);

    const real = await runPlan(
      [
        {
          target: 'cursor',
          run: () => {
            calls.push('cursor');
          },
        },
        {
          target: 'mcp',
          run: () => {
            throw new Error('boom');
          },
        },
      ],
      { verb: 'uninstall' },
    );
    expect(real.installed).toEqual(['cursor']);
    expect(real.failed).toEqual([{ target: 'mcp', error: 'boom' }]);
    expect(calls).toEqual(['cursor']);
  });

  it('executes safe install/uninstall subcommands against a disposable HOME', async () => {
    const home = tempDir('openbox-install-home-');
    const project = tempDir('openbox-install-project-');
    process.env.HOME = home;
    process.env.OPENBOX_SKIP_EXTENSION = '1';
    process.env.OPENBOX_ASSUME_YES = '1';

    await runInstallCli(['install', 'extension']);
    await runInstallCli(['uninstall', 'extension']);
    await runInstallCli(['install', 'mobile']);
    await runInstallCli(['install', 'mcp', '--cursor', '--scope', 'project', '--cwd', project]);
    await runInstallCli(['uninstall', 'mcp', '--cursor', '--scope', 'project', '--cwd', project]);
    await runInstallCli(['install', 'claude-code', '--scope', 'project', '--cwd', project, '--no-mcp']);
    await runInstallCli(['uninstall', 'claude-code', '--scope', 'project', '--cwd', project, '--no-mcp']);
    await runInstallCli(['install', 'cursor', '--scope', 'project', '--cwd', project, '--no-harden']);
    await runInstallCli(['uninstall', 'cursor', '--scope', 'project', '--cwd', project]);
  });
});
