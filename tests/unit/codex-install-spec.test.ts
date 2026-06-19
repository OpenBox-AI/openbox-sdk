import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOOK_SPEC } from '../../ts/src/core-client/generated/runtime/codex.js';
import {
  installCodex,
  uninstallCodex,
  verifyCodexInstall,
} from '../../ts/src/runtime/codex/index.js';

const EXPECTED_EVENTS = [
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'Stop',
];

describe('codex HOOK_SPEC', () => {
  it('exposes the project-local Codex hook events in spec order', () => {
    expect(HOOK_SPEC.events.map((event) => event.name)).toEqual(EXPECTED_EVENTS);
    expect(HOOK_SPEC.style).toBe('codex-array');
    expect(HOOK_SPEC.command).toBe('openbox codex hook');
  });

  it('installs and removes only project-local Codex files', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'openbox-codex-install-'));
    installCodex({ cwd });

    const hooksFile = path.join(cwd, '.codex', 'hooks.json');
    const configFile = path.join(cwd, '.codex-hooks', 'config.json');
    const hooks = JSON.parse(readFileSync(hooksFile, 'utf-8')) as any;
    expect(hooks.hooks.PreToolUse[0].hooks[0]).toMatchObject({
      type: 'command',
      command: 'openbox codex hook',
      timeout: 86400,
    });
    expect(readFileSync(configFile, 'utf-8')).toContain('hitlEnabled');

    const checks = verifyCodexInstall({ cwd });
    expect(checks.filter((check) => check.status === 'fail')).toEqual([]);

    uninstallCodex({ cwd });
    const after = JSON.parse(readFileSync(hooksFile, 'utf-8')) as any;
    expect(after.hooks).toBeUndefined();
  });
});
