#!/usr/bin/env node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);

function candidateFromEnv() {
  const value = process.env.OPENBOX_CLI;
  if (!value) return undefined;
  const resolved = path.resolve(value);
  return existsSync(resolved) ? resolved : undefined;
}

function projectRoots() {
  const roots = [];
  if (process.env.CLAUDE_PROJECT_DIR) roots.push(process.env.CLAUDE_PROJECT_DIR);
  roots.push(process.cwd());
  const out = [];
  for (const root of roots) {
    let cur = path.resolve(root);
    for (let i = 0; i < 8; i += 1) {
      if (!out.includes(cur)) out.push(cur);
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }
  return out;
}

function candidateFromProjectNodeModules() {
  for (const root of projectRoots()) {
    const candidate = path.join(root, 'node_modules', '@openbox-ai', 'openbox-sdk', 'dist', 'cli', 'index.js');
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

const cli = candidateFromEnv() ?? candidateFromProjectNodeModules();
if (!cli) {
  console.error('OpenBox SDK CLI not found for project-scoped Claude Code plugin. Set OPENBOX_CLI to this project\'s SDK dist/cli/index.js, or install @openbox-ai/openbox-sdk in the project.');
  process.exit(127);
}

const result = spawnSync(process.execPath, [cli, ...args], {
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(127);
}
process.exit(result.status ?? 1);
