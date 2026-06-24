// Unit-level test for the walk-up `.openbox/claude-code/` resolver in
// `ts/src/runtime/claude-code/config.ts`. The resolver is what
// makes a project-scoped install take precedence. The resolver runs
// once at module load with `process.cwd()`; the
// exported `resolveConfigDir(startDir)` lets us drive the same
// logic from a synthetic directory tree without touching the
// parent process's cwd.
//
// Mirror coverage for the cursor adapter lives in
// claude-code-cursor-config-scope.test.ts -- same shape, different
// runtime directory name.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveConfigDir as resolveClaudeConfigDir } from '../../ts/src/runtime/claude-code/config.js';
import { resolveConfigDir as resolveCursorConfigDir } from '../../ts/src/runtime/cursor/config.js';

describe('claude-code config dir resolution', () => {
  it('walks up to a project-scoped .openbox/claude-code/config.json', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'obx-cfg-claude-'));
    const projectDir = path.join(root, 'project');
    const nestedSrc = path.join(projectDir, 'src', 'nested');
    mkdirSync(nestedSrc, { recursive: true });
    const projectHooks = path.join(projectDir, '.openbox', 'claude-code');
    mkdirSync(projectHooks, { recursive: true });
    writeFileSync(path.join(projectHooks, 'config.json'), '{}');

    // From the project root.
    expect(resolveClaudeConfigDir(projectDir)).toBe(projectHooks);
    // From a nested directory; the walk-up finds the same project state dir.
    expect(resolveClaudeConfigDir(nestedSrc)).toBe(projectHooks);
  });

  it('falls back to the start directory when no project config is found', () => {
    const isolated = mkdtempSync(path.join(tmpdir(), 'obx-cfg-claude-default-'));
    const resolved = resolveClaudeConfigDir(isolated);
    expect(resolved).toBe(path.join(isolated, '.openbox', 'claude-code'));
  });

  it('prefers the deepest .openbox/claude-code when nested project dirs each ship one', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'obx-cfg-claude-nested-'));
    const outer = path.join(root, 'outer');
    const inner = path.join(outer, 'inner');
    mkdirSync(inner, { recursive: true });

    const outerHooks = path.join(outer, '.openbox', 'claude-code');
    mkdirSync(outerHooks, { recursive: true });
    writeFileSync(path.join(outerHooks, 'config.json'), '{}');

    const innerHooks = path.join(inner, '.openbox', 'claude-code');
    mkdirSync(innerHooks, { recursive: true });
    writeFileSync(path.join(innerHooks, 'config.json'), '{}');

    // From inner, the resolver picks the inner one; the walk-up
    // stops at the closest match instead of climbing to outer.
    expect(resolveClaudeConfigDir(inner)).toBe(innerHooks);
    expect(resolveClaudeConfigDir(outer)).toBe(outerHooks);
  });

});

describe('cursor config dir resolution', () => {
  it('walks up to a project-scoped .openbox/cursor/config.json', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'obx-cfg-cursor-'));
    const projectDir = path.join(root, 'project');
    const nestedSrc = path.join(projectDir, 'src', 'nested');
    mkdirSync(nestedSrc, { recursive: true });
    const projectHooks = path.join(projectDir, '.openbox', 'cursor');
    mkdirSync(projectHooks, { recursive: true });
    writeFileSync(path.join(projectHooks, 'config.json'), '{}');

    expect(resolveCursorConfigDir(projectDir)).toBe(projectHooks);
    expect(resolveCursorConfigDir(nestedSrc)).toBe(projectHooks);
  });

  it('falls back to the start directory when no project config is found', () => {
    const isolated = mkdtempSync(path.join(tmpdir(), 'obx-cfg-cursor-default-'));
    const resolved = resolveCursorConfigDir(isolated);
    expect(resolved).toBe(path.join(isolated, '.openbox', 'cursor'));
  });
});
