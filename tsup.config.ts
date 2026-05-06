import { defineConfig } from 'tsup';

// Bundle entries map 1:1 to package.json's `exports` map. tsup follows
// relative imports natively; no path mappings, no workspace name magic.
//
// Entry → published artifact:
//   ts/src/index.ts                  → dist/index.js                  → openbox-sdk
//   ts/src/client/index.ts           → dist/client/index.js           → openbox-sdk/client
//   ts/src/core-client/index.ts      → dist/core-client/index.js      → openbox-sdk/core-client
//   ts/src/env/index.ts              → dist/env/index.js              → openbox-sdk/env
//   ts/src/env/os-paths.ts           → dist/env/os-paths.js           → openbox-sdk/os-paths
//   ts/src/types/index.ts            → dist/types/index.js            → openbox-sdk/types
//   ts/src/validators/index.ts       → dist/validators/index.js       → openbox-sdk/validators
//   ts/src/test-utils/index.ts       → dist/test-utils/index.js       → openbox-sdk/test-utils
//   ts/src/maturity/index.ts         → dist/maturity/index.js         → openbox-sdk/maturity
//   ts/src/cli/index.ts              → dist/cli/index.js              → openbox-sdk/cli + bin "openbox"
//   ts/src/runtime/claude-hooks.ts   → dist/runtime/claude-hooks.js   → openbox-sdk/runtime/claude-hooks
//   ts/src/runtime/cursor-hooks.ts   → dist/runtime/cursor-hooks.js   → openbox-sdk/runtime/cursor-hooks

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
    'ts/src/approvals/mocks/index.ts',
    'ts/src/client-factory/index.ts',
    'ts/src/file-tokens/index.ts',
    'ts/src/polling/index.ts',
    'ts/src/runtime/claude-code/index.ts',
    'ts/src/runtime/cursor/index.ts',
    'ts/src/runtime/mcp/index.ts',
    'ts/src/governance/index.ts',
  ],
  format: ['esm'],
  dts: { resolve: true, entry: undefined, compilerOptions: { rootDir: 'ts/src' } },
  tsconfig: 'tsconfig.build.json',
  outDir: 'dist',
  clean: true,
  platform: 'node',
  sourcemap: true,
  splitting: false,
  // playwright is an optional CLI dep for E2E `verify` runs; never inline
  // it (it pulls a chromium driver). Mark its sub-modules external too.
  external: ['playwright', /^chromium-bidi/, /^playwright-core/],
});
