import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const assets = [
  {
    from: resolve(root, 'ts/src/runtime/cursor/templates'),
    to: resolve(root, 'dist/runtime/cursor/templates'),
  },
  {
    from: resolve(root, 'ts/src/runtime/claude-code/templates'),
    to: resolve(root, 'dist/runtime/claude-code/templates'),
  },
] as const;

for (const asset of assets) {
  if (!existsSync(asset.from)) {
    throw new Error(`Missing runtime asset source: ${asset.from}`);
  }
  rmSync(asset.to, { recursive: true, force: true });
  mkdirSync(dirname(asset.to), { recursive: true });
  cpSync(asset.from, asset.to, { recursive: true });
}

const { exportCursorPlugin } = await import('../dist/runtime/cursor/index.js');
const { exportClaudeCodePlugin } = await import('../dist/runtime/claude-code/index.js');
const { exportCodexPlugin } = await import('../dist/runtime/codex/index.js');

exportCursorPlugin({
  out: resolve(root, 'dist/runtime/cursor/plugin/openbox'),
});

exportClaudeCodePlugin({
  out: resolve(root, 'dist/runtime/claude-code/plugin/openbox'),
});

exportCodexPlugin({
  out: resolve(root, 'dist/runtime/codex/plugin/openbox'),
});
