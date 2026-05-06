// Cursor bundle installers — slash commands, project rules, plugin
// agents. Each kind copies a flat directory of markdown files into
// `~/.cursor/<kind>/`. Tests run against tmpdir targets so the real
// ~/.cursor/ is never touched.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  installCursorCommands,
  uninstallCursorCommands,
  installCursorRules,
  uninstallCursorRules,
  installCursorAgents,
  uninstallCursorAgents,
} from '../../ts/src/runtime/cursor/commands.js';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openbox-bundle-test-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('installCursorCommands', () => {
  it('copies every cursor-commands/*.md into the target dir', () => {
    const dst = path.join(tmp, 'commands');
    installCursorCommands({ target: dst });
    const files = fs.readdirSync(dst).sort();
    // Pin the names so a typo / missing file is caught.
    expect(files).toEqual([
      'openbox-check.md',
      'openbox-doctor.md',
      'openbox-list-agents.md',
      'openbox-pending.md',
      'openbox-status.md',
    ]);
  });

  it('each command file has a YAML frontmatter with name+description', () => {
    const dst = path.join(tmp, 'commands');
    installCursorCommands({ target: dst });
    for (const f of fs.readdirSync(dst)) {
      const body = fs.readFileSync(path.join(dst, f), 'utf-8');
      expect(body, f).toMatch(/^---\n[\s\S]*?name:[\s\S]*?description:[\s\S]*?\n---/);
    }
  });

  it('uninstall removes only the files it shipped', () => {
    const dst = path.join(tmp, 'commands');
    installCursorCommands({ target: dst });
    // plant an unrelated file
    fs.writeFileSync(path.join(dst, 'user-custom.md'), 'mine');
    uninstallCursorCommands({ target: dst });
    expect(fs.readdirSync(dst)).toEqual(['user-custom.md']);
  });

  it('uninstall on a missing dir is a no-op', () => {
    const dst = path.join(tmp, 'never-created');
    expect(() => uninstallCursorCommands({ target: dst })).not.toThrow();
  });
});

describe('installCursorRules', () => {
  it('copies cursor-rules/openbox.mdc into the target dir', () => {
    const dst = path.join(tmp, 'rules');
    installCursorRules({ target: dst });
    expect(fs.readdirSync(dst)).toEqual(['openbox.mdc']);
  });

  it('the rule has alwaysApply:true so it loads in every chat', () => {
    const dst = path.join(tmp, 'rules');
    installCursorRules({ target: dst });
    const body = fs.readFileSync(path.join(dst, 'openbox.mdc'), 'utf-8');
    expect(body).toMatch(/alwaysApply:\s*true/);
  });

  it('uninstall removes the rule but spares unrelated .mdc files', () => {
    const dst = path.join(tmp, 'rules');
    installCursorRules({ target: dst });
    fs.writeFileSync(path.join(dst, 'team.mdc'), '---\nalwaysApply:true\n---');
    uninstallCursorRules({ target: dst });
    expect(fs.readdirSync(dst)).toEqual(['team.mdc']);
  });
});

describe('installCursorAgents', () => {
  it('copies cursor-agents/openbox-reviewer.md into the target dir', () => {
    const dst = path.join(tmp, 'agents');
    installCursorAgents({ target: dst });
    expect(fs.readdirSync(dst)).toEqual(['openbox-reviewer.md']);
  });

  it('the reviewer agent is spec-driven (mentions spec-driven CLI calls)', () => {
    const dst = path.join(tmp, 'agents');
    installCursorAgents({ target: dst });
    const body = fs.readFileSync(path.join(dst, 'openbox-reviewer.md'), 'utf-8');
    // The rule of the agent: never invent endpoints. Pin that line so
    // a future edit can't quietly delete the safeguard.
    expect(body).toMatch(/Never invent endpoints/);
    // And it routes through real CLI subcommands, not raw HTTP.
    expect(body).toMatch(/openbox behavior list/);
    expect(body).toMatch(/openbox core evaluate/);
  });

  it('uninstall removes the agent but spares unrelated *.md', () => {
    const dst = path.join(tmp, 'agents');
    installCursorAgents({ target: dst });
    fs.writeFileSync(path.join(dst, 'user-agent.md'), '---\nname:mine\n---');
    uninstallCursorAgents({ target: dst });
    expect(fs.readdirSync(dst)).toEqual(['user-agent.md']);
  });
});

describe('round-trip', () => {
  it('install then uninstall leaves a tracked-files-only delta', () => {
    const dst = path.join(tmp, 'commands');
    fs.mkdirSync(dst);
    fs.writeFileSync(path.join(dst, 'pre-existing.md'), 'mine');
    const before = new Set(fs.readdirSync(dst));
    installCursorCommands({ target: dst });
    uninstallCursorCommands({ target: dst });
    const after = new Set(fs.readdirSync(dst));
    expect(after).toEqual(before);
  });
});
