// Unit coverage for `findBuiltApproverApp()` in cli/commands/install.ts.
// Pins the discovery contract: env-var overrides win, otherwise we walk up
// from cwd to the openbox-sdk workspace root and probe known cargo build
// output paths. Tests use a real tmpdir sandbox so we exercise the actual
// fs.existsSync / fs.readFileSync paths instead of hand-mocked nodes.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findBuiltApproverApp } from '../../ts/src/cli/commands/install';

const BUNDLE = 'OpenBox Approver.app';

function makeFakeWorkspace(root: string): void {
  // Marker package.json with the openbox-sdk name; the discovery walks up
  // until it finds this file with the right name field.
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'openbox-sdk' }));
}

function placeBundle(root: string, ...segs: string[]): string {
  const dir = join(root, ...segs);
  mkdirSync(dir, { recursive: true });
  const bundle = join(dir, BUNDLE);
  // The bundle is a directory on macOS; a plain dir is enough for existsSync.
  mkdirSync(bundle);
  return bundle;
}

describe('findBuiltApproverApp', () => {
  let sandbox: string;
  const savedPath = process.env.OPENBOX_APPROVER_APP_PATH;
  const savedDir = process.env.OPENBOX_APPROVER_APP_DIR;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'openbox-install-approver-'));
    delete process.env.OPENBOX_APPROVER_APP_PATH;
    delete process.env.OPENBOX_APPROVER_APP_DIR;
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
    if (savedPath === undefined) delete process.env.OPENBOX_APPROVER_APP_PATH;
    else process.env.OPENBOX_APPROVER_APP_PATH = savedPath;
    if (savedDir === undefined) delete process.env.OPENBOX_APPROVER_APP_DIR;
    else process.env.OPENBOX_APPROVER_APP_DIR = savedDir;
  });

  it('honors OPENBOX_APPROVER_APP_PATH and reports source=env-path', () => {
    const explicit = join(sandbox, 'custom', BUNDLE);
    mkdirSync(explicit, { recursive: true });
    process.env.OPENBOX_APPROVER_APP_PATH = explicit;

    const located = findBuiltApproverApp(sandbox);
    expect(located.path).toBe(explicit);
    expect(located.source).toBe('env-path');
  });

  it('falls through OPENBOX_APPROVER_APP_PATH when the file does not exist', () => {
    // Set the env var to a non-existent path; expect the workspace fallback to
    // run instead of returning the bogus value.
    makeFakeWorkspace(sandbox);
    const built = placeBundle(sandbox, 'target', 'release', 'bundle', 'macos');
    process.env.OPENBOX_APPROVER_APP_PATH = join(sandbox, 'does', 'not', 'exist', BUNDLE);

    const located = findBuiltApproverApp(sandbox);
    expect(located.path).toBe(built);
    expect(located.source).toBe('workspace');
  });

  it('honors OPENBOX_APPROVER_APP_DIR and reports source=env-dir', () => {
    const dir = join(sandbox, 'somewhere');
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, BUNDLE));
    process.env.OPENBOX_APPROVER_APP_DIR = dir;

    const located = findBuiltApproverApp(sandbox);
    expect(located.path).toBe(join(dir, BUNDLE));
    expect(located.source).toBe('env-dir');
  });

  it('finds workspace cargo target/ build (Bug 1 fix)', () => {
    makeFakeWorkspace(sandbox);
    const built = placeBundle(sandbox, 'target', 'release', 'bundle', 'macos');

    const located = findBuiltApproverApp(sandbox);
    expect(located.path).toBe(built);
    expect(located.source).toBe('workspace');
  });

  it('finds per-crate src-tauri/target/ alt layout', () => {
    makeFakeWorkspace(sandbox);
    const built = placeBundle(
      sandbox,
      'apps',
      'approver',
      'src-tauri',
      'target',
      'release',
      'bundle',
      'macos',
    );

    const located = findBuiltApproverApp(sandbox);
    expect(located.path).toBe(built);
    expect(located.source).toBe('workspace');
  });

  it('finds per-crate apps/approver/target/ alt layout', () => {
    makeFakeWorkspace(sandbox);
    const built = placeBundle(
      sandbox,
      'apps',
      'approver',
      'target',
      'release',
      'bundle',
      'macos',
    );

    const located = findBuiltApproverApp(sandbox);
    expect(located.path).toBe(built);
    expect(located.source).toBe('workspace');
  });

  it('prefers the workspace target/ layout over alt layouts when both exist', () => {
    makeFakeWorkspace(sandbox);
    const primary = placeBundle(sandbox, 'target', 'release', 'bundle', 'macos');
    placeBundle(sandbox, 'apps', 'approver', 'target', 'release', 'bundle', 'macos');

    const located = findBuiltApproverApp(sandbox);
    expect(located.path).toBe(primary);
  });

  it('walks up from a nested subdirectory to find the workspace root', () => {
    makeFakeWorkspace(sandbox);
    const built = placeBundle(sandbox, 'target', 'release', 'bundle', 'macos');
    const nested = join(sandbox, 'ts', 'src', 'cli', 'commands');
    mkdirSync(nested, { recursive: true });

    const located = findBuiltApproverApp(nested);
    expect(located.path).toBe(built);
    expect(located.source).toBe('workspace');
  });

  it('throws the not-found error when no env vars and no workspace marker is reachable', () => {
    // sandbox has no package.json; walking up from inside it lands in the OS
    // tmpdir which also has no openbox-sdk marker. Discovery must fail.
    const deeplyNested = join(
      sandbox,
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g',
      'h',
      'i',
      'j',
    );
    mkdirSync(deeplyNested, { recursive: true });

    expect(() => findBuiltApproverApp(deeplyNested)).toThrow(/Couldn't find/);
  });

  it('caps the walk-up so it does not traverse the entire filesystem', () => {
    // Plant a workspace marker 9 directories above the start point; the cap
    // is 8, so it must not be reached. A correctly-capped walk produces the
    // not-found error rather than a stale resolution.
    makeFakeWorkspace(sandbox);
    placeBundle(sandbox, 'target', 'release', 'bundle', 'macos');
    let deep = sandbox;
    for (let i = 0; i < 9; i++) {
      deep = join(deep, `lvl${i}`);
    }
    mkdirSync(deep, { recursive: true });

    expect(() => findBuiltApproverApp(deep)).toThrow(/Couldn't find/);
  });

  it('throws when OPENBOX_APPROVER_APP_DIR is set but the bundle is missing', () => {
    process.env.OPENBOX_APPROVER_APP_DIR = join(sandbox, 'empty');
    mkdirSync(process.env.OPENBOX_APPROVER_APP_DIR, { recursive: true });

    expect(() => findBuiltApproverApp(sandbox)).toThrow(/Couldn't find/);
  });

  it('ignores a package.json whose name is not openbox-sdk', () => {
    // A walk-up traversing some unrelated package.json must not stop there.
    writeFileSync(
      join(sandbox, 'package.json'),
      JSON.stringify({ name: 'unrelated-pkg' }),
    );
    placeBundle(sandbox, 'target', 'release', 'bundle', 'macos');

    expect(() => findBuiltApproverApp(sandbox)).toThrow(/Couldn't find/);
  });

  it('tolerates an unparseable package.json during walk-up', () => {
    // Walk should skip a malformed package.json rather than crash.
    writeFileSync(join(sandbox, 'package.json'), '{ this is not json');
    expect(() => findBuiltApproverApp(sandbox)).toThrow(/Couldn't find/);
  });
});
