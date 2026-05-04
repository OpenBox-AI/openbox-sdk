import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let fakeHome: string;

beforeEach(() => {
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'openbox-enterprise-home-'));
  vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(fakeHome, { recursive: true, force: true });
});

describe('hardenCursor', () => {
  // Late import so the homedir mock is in effect when settingsPath()
  // captures the location during execution.
  async function loadModule() {
    return await import('../../ts/src/runtime/cursor/enterprise.js');
  }

  it('writes enterprise-default keys into a fresh ~/.cursor/User/settings.json', async () => {
    const { hardenCursor } = await loadModule();
    const result = hardenCursor();
    const file = path.join(fakeHome, '.cursor', 'User', 'settings.json');
    expect(result.file).toBe(file);
    const json = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(json['cursor.general.privacy']).toBe(true);
    expect(json['telemetry.telemetryLevel']).toBe('off');
    expect(json._openbox_managed.profile).toBe('enterprise-default');
  });

  it('preserves existing user-set keys outside the profile', async () => {
    const file = path.join(fakeHome, '.cursor', 'User', 'settings.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ 'editor.fontSize': 14, 'workbench.colorTheme': 'Solarized Dark' }),
    );
    const { hardenCursor } = await loadModule();
    hardenCursor();
    const after = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(after['editor.fontSize']).toBe(14);
    expect(after['workbench.colorTheme']).toBe('Solarized Dark');
    expect(after['cursor.general.privacy']).toBe(true);
  });

  it('reruns are idempotent; applied list is empty on second run', async () => {
    const { hardenCursor } = await loadModule();
    const first = hardenCursor();
    expect(first.applied.length).toBeGreaterThan(0);
    const second = hardenCursor();
    expect(second.applied).toEqual([]);
    expect(second.unchanged.length).toBe(first.applied.length);
  });

  it('enterprise-strict adds composer.disabled and cpp.disabledLanguages', async () => {
    const { hardenCursor } = await loadModule();
    hardenCursor({ profile: 'enterprise-strict' });
    const file = path.join(fakeHome, '.cursor', 'User', 'settings.json');
    const after = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(after['cursor.composer.disabled']).toBe(true);
    expect(after['cursor.cpp.disabledLanguages']).toEqual(['*']);
  });

  it('dry-run does not touch the file', async () => {
    const file = path.join(fakeHome, '.cursor', 'User', 'settings.json');
    expect(fs.existsSync(file)).toBe(false);
    const { hardenCursor } = await loadModule();
    const r = hardenCursor({ dryRun: true });
    expect(r.applied.length).toBeGreaterThan(0);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('unhardenCursor removes only the keys this profile set', async () => {
    const file = path.join(fakeHome, '.cursor', 'User', 'settings.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ 'editor.fontSize': 14 }));

    const { hardenCursor, unhardenCursor } = await loadModule();
    hardenCursor();
    const removed = unhardenCursor();
    expect(removed.removed.length).toBeGreaterThan(0);

    const after = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(after['editor.fontSize']).toBe(14);
    expect(after['cursor.general.privacy']).toBeUndefined();
    expect(after._openbox_managed).toBeUndefined();
  });

  it('throws on unknown profile name', async () => {
    const { hardenCursor } = await loadModule();
    expect(() => hardenCursor({ profile: 'bogus' as 'enterprise-default' })).toThrow(/Unknown enterprise profile/);
  });
});
