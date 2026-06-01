import { defineConfig } from 'tsup';

// Bundle entries map to package.json's `exports` map plus the
// package bin entry. Keep this list intentionally small.

export default defineConfig({
  entry: [
    'ts/src/index.ts',
    'ts/src/client/index.ts',
    'ts/src/core-client/index.ts',
    'ts/src/env/index.ts',
    'ts/src/env/os-paths.ts',
    'ts/src/types/index.ts',
    'ts/src/validators/index.ts',
    'ts/src/test-utils/index.ts',
    'ts/src/maturity/index.ts',
    'ts/src/cli/index.ts',
    'ts/src/approvals/index.ts',
    'ts/src/client-factory/index.ts',
    'ts/src/file-tokens/index.ts',
    'ts/src/polling/index.ts',
    'ts/src/runtime/claude-code/index.ts',
    'ts/src/runtime/cursor/index.ts',
    'ts/src/runtime/mcp/index.ts',
    'ts/src/governance/index.ts',
    'ts/src/agent-trace/index.ts',
    'ts/src/logging/index.ts',
    'ts/src/session/index.ts',
    'ts/src/install/index.ts',
    'ts/src/config/index.ts',
    'ts/src/copilotkit/index.ts',
    'ts/src/copilotkit/react.ts',
  ],
  format: ['esm'],
  dts: {
    resolve: true,
    entry: undefined,
    compilerOptions: { rootDir: 'ts/src' },
  },
  tsconfig: 'tsconfig.build.json',
  outDir: 'dist',
  clean: true,
  platform: 'node',
  sourcemap: false,
  splitting: false,
  // playwright is an optional CLI dep for E2E `verify` runs; never inline
  // it (it pulls a chromium driver). Mark its sub-modules external too.
  external: ['react', 'playwright', /^chromium-bidi/, /^playwright-core/],
});
