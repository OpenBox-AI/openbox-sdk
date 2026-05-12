// Unit-level test for the walk-up `.claude-hooks/` resolver in
// `ts/src/runtime/claude-code/config.ts`. The resolver is what
// makes a project-scoped install (config under <cwd>/.claude-hooks/)
// take precedence over the global ~/.claude-hooks/ one. The
// resolver runs once at module load with `process.cwd()`; the
// exported `resolveConfigDir(startDir)` lets us drive the same
// logic from a synthetic directory tree without touching the
// parent process's cwd.
//
// Mirror coverage for the cursor adapter lives in
// claude-code-cursor-config-scope.test.ts -- same shape, different
// hook directory name.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { resolveConfigDir as resolveClaudeConfigDir } from '../../ts/src/runtime/claude-code/config.js';
import { resolveConfigDir as resolveCursorConfigDir } from '../../ts/src/runtime/cursor/config.js';

describe('claude-code config dir resolution', () => {
  it('walks up to a project-scoped .claude-hooks/config.json', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'obx-cfg-claude-'));
    const projectDir = path.join(root, 'project');
    const nestedSrc = path.join(projectDir, 'src', 'nested');
    mkdirSync(nestedSrc, { recursive: true });
    const projectHooks = path.join(projectDir, '.claude-hooks');
    mkdirSync(projectHooks, { recursive: true });
    writeFileSync(path.join(projectHooks, 'config.json'), '{}');

    // From the project root.
    expect(resolveClaudeConfigDir(projectDir)).toBe(projectHooks);
    // From a nested directory; the walk-up finds the same .claude-hooks/.
    expect(resolveClaudeConfigDir(nestedSrc)).toBe(projectHooks);
  });

  it('falls back to the global ~/.claude-hooks when no project config is found', () => {
    const isolated = mkdtempSync(path.join(tmpdir(), 'obx-cfg-claude-fallback-'));
    const resolved = resolveClaudeConfigDir(isolated);
    expect(resolved).toBe(path.join(homedir(), '.claude-hooks'));
  });

  it('prefers the deepest .claude-hooks when nested project dirs each ship one', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'obx-cfg-claude-nested-'));
    const outer = path.join(root, 'outer');
    const inner = path.join(outer, 'inner');
    mkdirSync(inner, { recursive: true });

    const outerHooks = path.join(outer, '.claude-hooks');
    mkdirSync(outerHooks, { recursive: true });
    writeFileSync(path.join(outerHooks, 'config.json'), '{}');

    const innerHooks = path.join(inner, '.claude-hooks');
    mkdirSync(innerHooks, { recursive: true });
    writeFileSync(path.join(innerHooks, 'config.json'), '{}');

    // From inner, the resolver picks the inner one; the walk-up
    // stops at the closest match instead of climbing to outer.
    expect(resolveClaudeConfigDir(inner)).toBe(innerHooks);
    expect(resolveClaudeConfigDir(outer)).toBe(outerHooks);
  });
});

describe('cursor config dir resolution', () => {
  it('walks up to a project-scoped .cursor-hooks/config.json', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'obx-cfg-cursor-'));
    const projectDir = path.join(root, 'project');
    const nestedSrc = path.join(projectDir, 'src', 'nested');
    mkdirSync(nestedSrc, { recursive: true });
    const projectHooks = path.join(projectDir, '.cursor-hooks');
    mkdirSync(projectHooks, { recursive: true });
    writeFileSync(path.join(projectHooks, 'config.json'), '{}');

    expect(resolveCursorConfigDir(projectDir)).toBe(projectHooks);
    expect(resolveCursorConfigDir(nestedSrc)).toBe(projectHooks);
  });

  it('falls back to the global ~/.cursor-hooks when no project config is found', () => {
    const isolated = mkdtempSync(path.join(tmpdir(), 'obx-cfg-cursor-fallback-'));
    const resolved = resolveCursorConfigDir(isolated);
    expect(resolved).toBe(path.join(homedir(), '.cursor-hooks'));
  });
});
