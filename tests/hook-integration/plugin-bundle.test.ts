// `apps/cursor-plugin/build.sh` materializes the marketplace-shaped
// plugin bundle from canonical sources (skill/, cursor-commands/,
// cursor-rules/, cursor-agents/) plus the spec-emitted hooks.json
// (dogfooded via `openbox install cursor` against a throwaway HOME).
//
// This test runs the script and asserts the bundle's shape so a
// drift in the script, the spec, or the source dirs gets caught.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const BUNDLE = join(ROOT, 'apps', 'cursor-plugin');

beforeAll(() => {
  // Clean any previous run output so we know the script writes from
  // scratch each time.
  for (const dir of ['skills', 'commands', 'rules', 'agents', 'hooks']) {
    rmSync(join(BUNDLE, dir), { recursive: true, force: true });
  }
  rmSync(join(BUNDLE, 'mcp.json'), { force: true });

  const r = spawnSync('bash', [join(BUNDLE, 'build.sh')], {
    cwd: ROOT,
    encoding: 'utf-8',
    env: { ...process.env, OPENBOX_SKIP_EXTENSION: '1' },
  });
  if (r.status !== 0) {
    throw new Error(`build.sh failed: status ${r.status}\nstderr: ${r.stderr}\nstdout: ${r.stdout}`);
  }
});

afterAll(() => {
  // Leave the bundle in place — it's gitignored, and a built bundle
  // is the natural state when publishing to the marketplace.
});

describe('apps/cursor-plugin/build.sh — marketplace bundle layout', () => {
  it('manifest is valid JSON with the expected name + version', () => {
    const m = JSON.parse(
      readFileSync(join(BUNDLE, '.cursor-plugin', 'plugin.json'), 'utf-8'),
    );
    expect(m.name).toBe('openbox');
    expect(m.displayName).toBe('OpenBox AI Governance');
    expect(typeof m.version).toBe('string');
    expect(Array.isArray(m.keywords)).toBe(true);
    expect(m.keywords).toContain('rules');
    expect(m.keywords).toContain('agents');
    expect(m.keywords).toContain('commands');
  });

  it('marketplace.json is valid JSON with one plugin entry pointing at .', () => {
    const m = JSON.parse(
      readFileSync(join(BUNDLE, '.cursor-plugin', 'marketplace.json'), 'utf-8'),
    );
    expect(m.plugins).toHaveLength(1);
    expect(m.plugins[0].name).toBe('openbox');
    expect(m.plugins[0].source).toBe('.');
  });

  it('skills/openbox/SKILL.md is materialized', () => {
    expect(existsSync(join(BUNDLE, 'skills', 'openbox', 'SKILL.md'))).toBe(true);
  });

  it('commands/ has the 5 openbox slash-command files', () => {
    const cmds = readdirSync(join(BUNDLE, 'commands')).sort();
    expect(cmds).toEqual([
      'openbox-check.md',
      'openbox-doctor.md',
      'openbox-list-agents.md',
      'openbox-pending.md',
      'openbox-status.md',
    ]);
  });

  it('rules/openbox.mdc is materialized with alwaysApply:true', () => {
    const body = readFileSync(join(BUNDLE, 'rules', 'openbox.mdc'), 'utf-8');
    expect(body).toMatch(/alwaysApply:\s*true/);
  });

  it('agents/openbox-reviewer.md is materialized', () => {
    expect(existsSync(join(BUNDLE, 'agents', 'openbox-reviewer.md'))).toBe(true);
  });

  it('hooks/hooks.json contains every event from INSTALL_SPEC', () => {
    const hooks = JSON.parse(readFileSync(join(BUNDLE, 'hooks', 'hooks.json'), 'utf-8'));
    const eventNames = new Set(Object.keys(hooks.hooks));
    expect(eventNames.size).toBe(20);
    expect(eventNames).toEqual(new Set([
      'beforeSubmitPrompt',
      'beforeReadFile',
      'beforeShellExecution',
      'beforeMCPExecution',
      'preToolUse',
      'afterAgentResponse',
      'afterAgentThought',
      'afterShellExecution',
      'afterFileEdit',
      'afterMCPExecution',
      'postToolUse',
      'postToolUseFailure',
      'sessionStart',
      'stop',
      'beforeTabFileRead',
      'afterTabFileEdit',
      'sessionEnd',
      'preCompact',
      'subagentStart',
      'subagentStop',
    ]));
    // Each event entry is the new-shape array — never the legacy
    // `{command}` object the user explicitly forbade.
    for (const evt of eventNames) {
      expect(Array.isArray(hooks.hooks[evt]), evt).toBe(true);
      expect(hooks.hooks[evt][0]).toHaveProperty('command');
    }
  });

  it('mcp.json registers `openbox mcp serve`', () => {
    const mcp = JSON.parse(readFileSync(join(BUNDLE, 'mcp.json'), 'utf-8'));
    expect(mcp.mcpServers.openbox.command).toBe('openbox');
    expect(mcp.mcpServers.openbox.args).toEqual(['mcp', 'serve']);
  });
});
