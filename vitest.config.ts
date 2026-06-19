import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const sdkAliasMap = {
  '@openbox-ai/openbox-sdk': src('./ts/src/index.ts'),
  '@openbox-ai/openbox-sdk/agent-trace': src('./ts/src/agent-trace/index.ts'),
  '@openbox-ai/openbox-sdk/anthropic-agent-sdk': src('./ts/src/anthropic-agent-sdk/index.ts'),
  '@openbox-ai/openbox-sdk/openai-agents-sdk': src('./ts/src/openai-agents-sdk/index.ts'),
  '@openbox-ai/openbox-sdk/approvals': src('./ts/src/approvals/index.ts'),
  '@openbox-ai/openbox-sdk/client': src('./ts/src/client/index.ts'),
  '@openbox-ai/openbox-sdk/client-factory': src('./ts/src/client-factory/index.ts'),
  '@openbox-ai/openbox-sdk/config': src('./ts/src/config/index.ts'),
  '@openbox-ai/openbox-sdk/core-client': src('./ts/src/core-client/index.ts'),
  '@openbox-ai/openbox-sdk/env': src('./ts/src/env/index.ts'),
  '@openbox-ai/openbox-sdk/file-tokens': src('./ts/src/file-tokens/index.ts'),
  '@openbox-ai/openbox-sdk/governance': src('./ts/src/governance/index.ts'),
  '@openbox-ai/openbox-sdk/install': src('./ts/src/install/index.ts'),
  '@openbox-ai/openbox-sdk/logging': src('./ts/src/logging/index.ts'),
  '@openbox-ai/openbox-sdk/maturity': src('./ts/src/maturity/index.ts'),
  '@openbox-ai/openbox-sdk/os-paths': src('./ts/src/env/os-paths.ts'),
  '@openbox-ai/openbox-sdk/polling': src('./ts/src/polling/index.ts'),
  '@openbox-ai/openbox-sdk/runtime/claude-code': src('./ts/src/runtime/claude-code/index.ts'),
  '@openbox-ai/openbox-sdk/runtime/codex': src('./ts/src/runtime/codex/index.ts'),
  '@openbox-ai/openbox-sdk/runtime/cursor': src('./ts/src/runtime/cursor/index.ts'),
  '@openbox-ai/openbox-sdk/runtime/mcp': src('./ts/src/runtime/mcp/index.ts'),
  '@openbox-ai/openbox-sdk/session': src('./ts/src/session/index.ts'),
  '@openbox-ai/openbox-sdk/test-utils': src('./ts/src/test-utils/index.ts'),
  '@openbox-ai/openbox-sdk/types': src('./ts/src/types/index.ts'),
  '@openbox-ai/openbox-sdk/validators': src('./ts/src/validators/index.ts'),
  '@openbox-ai/openbox-sdk/copilotkit': src('./ts/src/copilotkit/index.ts'),
  '@openbox-ai/openbox-sdk/copilotkit/react': src('./ts/src/copilotkit/react.ts'),
};

const sdkAliases = Object.entries(sdkAliasMap)
  .sort(([left], [right]) => right.length - left.length)
  .map(([find, replacement]) => ({
    find: find === '@openbox-ai/openbox-sdk' ? /^@openbox-ai\/openbox-sdk$/ : find,
    replacement,
  }));

const sdkSelfReferencePlugin = () => ({
  name: 'openbox-sdk-source-self-reference',
  enforce: 'pre' as const,
  resolveId(source: string) {
    return sdkAliasMap[source as keyof typeof sdkAliasMap] ?? null;
  },
});

export default defineConfig({
  plugins: [sdkSelfReferencePlugin()],
  resolve: {
    alias: sdkAliases,
  },
  test: {
    alias: sdkAliases,
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Root-level coverage config; applies when running without
    // --project filters AND is also re-attached per project below
    // (vitest 4 does not propagate root coverage to project configs).
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      include: ['ts/src/**/*.ts'],
      // Spec-driven SDK: one bug in spec = bug in every language
      // emitter. We do NOT exclude application code from coverage .
      // every line ships to consumers and so every line gets tested.
      // Only skip generated/types/d.ts (re-derived from spec; tested
      // by spec-coverage drift) and cli/index.ts (the bin's
      // top-level parseAsync runs whatever's in argv and exits;
      // testing it in-process leaks state into sibling tests; instead
      // every `openbox <verb>` call in the e2e suite exercises the
      // full bin path against a real shell).
      exclude: [
        'ts/src/**/generated/**',
        'ts/src/**/*.d.ts',
        'ts/src/**/types/**',
        'ts/src/cli/index.ts',
      ],
      // Enforce 80% coverage for shipped TS source.
      reportOnFailure: true,
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
    projects: [
      {
        plugins: [sdkSelfReferencePlugin()],
        resolve: { alias: sdkAliases },
        test: {
          name: 'unit',
          alias: sdkAliases,
          include: [
            'tests/unit/**/*.test.ts',
            // App-level tests (extension, future apps) live next to source.
            'apps/*/src/**/*.test.ts',
          ],
          setupFiles: ['./tests/setup.ts'],
          testTimeout: 5000,
        },
      },
      {
        plugins: [sdkSelfReferencePlugin()],
        resolve: { alias: sdkAliases },
        test: {
          name: 'e2e',
          alias: sdkAliases,
          include: ['tests/e2e/**/*.test.ts'],
          setupFiles: ['./tests/setup.ts', './tests/setup-creds.ts'],
          testTimeout: 30000,
          sequence: { concurrent: false },
          fileParallelism: false,
        },
      },
      {
        plugins: [sdkSelfReferencePlugin()],
        resolve: { alias: sdkAliases },
        test: {
          // Spec-driven wire-shape conformance.Drives
          // every spec op through the SDK against an in-process HTTP
          // capture server; no backend required. Catches SDK<->spec
          // method-name drift and silent no-op regressions.
          name: 'contract',
          alias: sdkAliases,
          include: ['tests/contract/**/*.test.ts'],
          setupFiles: ['./tests/setup.ts', './tests/setup-creds.ts'],
          testTimeout: 10000,
        },
      },
      {
        plugins: [sdkSelfReferencePlugin()],
        resolve: { alias: sdkAliases },
        test: {
          // Hook integration: spawns `openbox cursor hook` as a
          // subprocess (the same way Cursor does), pipes a synthetic
          // stdin envelope per event, asserts the verdict shape +
          // JSONL log line. No IDE / display required; covers the
          // hook handler end-to-end without needing Cursor's agent.
          name: 'hook-integration',
          alias: sdkAliases,
          include: ['tests/hook-integration/**/*.test.ts'],
          setupFiles: ['./tests/setup.ts'],
          testTimeout: 30000,
          sequence: { concurrent: false },
          fileParallelism: false,
        },
      },
    ],
  },
});
