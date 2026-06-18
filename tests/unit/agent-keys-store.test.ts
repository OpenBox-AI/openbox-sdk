// Unit coverage for file-tokens/agent-keys.ts. The store backs
// runtime-key lookup and is also read by the MCP server's resolveApiKey
// path.
//
// File-mode and path safety are pinned by tests/unit/platform-awareness
// and tests/unit/os-paths; here we exercise behavior: round-trip
// shape, last-write-wins, prefix validation, missing-file safety.

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, existsSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const sandbox = mkdtempSync(join(tmpdir(), 'openbox-agent-keys-'));
const originalHome = process.env.OPENBOX_HOME;
process.env.OPENBOX_HOME = sandbox;

const { recordAgentKey, recallAgentKey, agentKeysPath } = await import(
  '../../ts/src/file-tokens/agent-keys.js'
);

afterAll(() => {
  if (originalHome === undefined) delete process.env.OPENBOX_HOME;
  else process.env.OPENBOX_HOME = originalHome;
  rmSync(sandbox, { recursive: true, force: true });
});

beforeEach(() => {
  // Each test starts from an empty store. Touch nothing else under
  // the sandbox so concurrent suites don't collide.
  const path = agentKeysPath();
  if (existsSync(path)) rmSync(path);
});

describe('agent-keys-store', () => {
  it('missing-store reads do not create the OpenBox data directory', () => {
    rmSync(sandbox, { recursive: true, force: true });

    expect(recallAgentKey('any-id')).toBeNull();

    expect(existsSync(sandbox)).toBe(false);
  });

  it('round-trips a recorded key', () => {
    recordAgentKey('agent-1', 'obx_live_aaaaaaaaaaaa', 'My Agent');
    const rec = recallAgentKey('agent-1');
    expect(rec).toBeTruthy();
    expect(rec?.agentId).toBe('agent-1');
    expect(rec?.runtimeKey).toBe('obx_live_aaaaaaaaaaaa');
    expect(rec?.agentName).toBe('My Agent');
    expect(rec?.recordedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('returns null for an unknown agentId', () => {
    expect(recallAgentKey('does-not-exist')).toBeNull();
  });

  it('returns null when the store file is missing entirely', () => {
    // beforeEach already deleted the file; recallAgentKey must not throw.
    expect(existsSync(agentKeysPath())).toBe(false);
    expect(recallAgentKey('any-id')).toBeNull();
  });

  it('writes the file at mode 0o600', () => {
    recordAgentKey('agent-mode', 'obx_live_modecheck', 'name');
    const stat = statSync(agentKeysPath());
    // mask off file-type bits, compare the perm triplet.
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('last-write-wins on the same agentId', () => {
    recordAgentKey('agent-x', 'obx_live_first', 'first-name');
    recordAgentKey('agent-x', 'obx_live_second', 'second-name');
    const rec = recallAgentKey('agent-x');
    expect(rec?.runtimeKey).toBe('obx_live_second');
    expect(rec?.agentName).toBe('second-name');
  });

  it('preserves other agents when one is rewritten', () => {
    recordAgentKey('a', 'obx_live_a', 'A');
    recordAgentKey('b', 'obx_live_b', 'B');
    recordAgentKey('a', 'obx_live_a2', 'A2');
    expect(recallAgentKey('a')?.runtimeKey).toBe('obx_live_a2');
    expect(recallAgentKey('b')?.runtimeKey).toBe('obx_live_b');
  });

  it('rejects non-runtime-key prefixes', () => {
    // The agent record exposes a token field that is NOT the runtime
    // key (skill memory: agent.token is not obx_live_/obx_test_).
    // The post-callback feeds whatever it sees into the store; the
    // store itself must defend against the wrong prefix.
    recordAgentKey('agent-y', 'not-a-runtime-key', 'name');
    expect(recallAgentKey('agent-y')).toBeNull();
    recordAgentKey('agent-y', '8ba3...hex...token', 'name');
    expect(recallAgentKey('agent-y')).toBeNull();
  });

  it('accepts obx_test_ keys (staging/test envs)', () => {
    recordAgentKey('agent-t', 'obx_test_xyz', 'staging');
    expect(recallAgentKey('agent-t')?.runtimeKey).toBe('obx_test_xyz');
  });

  it('tolerates a corrupt store file (returns empty, does not throw)', () => {
    mkdirSync(dirname(agentKeysPath()), { recursive: true });
    writeFileSync(agentKeysPath(), 'not valid json {{{', { mode: 0o600 });
    expect(recallAgentKey('anything')).toBeNull();
    // A subsequent record must still succeed and overwrite the
    // garbage rather than wedging the CLI.
    recordAgentKey('agent-r', 'obx_live_recover', 'r');
    expect(recallAgentKey('agent-r')?.runtimeKey).toBe('obx_live_recover');
  });

  it('no-ops on empty agentId or empty key', () => {
    recordAgentKey('', 'obx_live_xxx', 'name');
    recordAgentKey('agent-z', '', 'name');
    expect(recallAgentKey('')).toBeNull();
    expect(recallAgentKey('agent-z')).toBeNull();
  });

  it('agentKeysPath() lives under OPENBOX_HOME', () => {
    expect(agentKeysPath().startsWith(sandbox)).toBe(true);
    expect(agentKeysPath().endsWith('agent-keys')).toBe(true);
  });
});
