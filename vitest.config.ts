import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
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
        test: {
          name: 'unit',
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
        test: {
          name: 'e2e',
          include: ['tests/e2e/**/*.test.ts'],
          setupFiles: ['./tests/setup.ts', './tests/setup-creds.ts'],
          testTimeout: 30000,
          sequence: { concurrent: false },
          fileParallelism: false,
        },
      },
      {
        test: {
          // Spec-driven wire-shape conformance.Drives
          // every spec op through the SDK against an in-process HTTP
          // capture server; no backend required. Catches SDK<->spec
          // method-name drift and silent no-op regressions.
          name: 'contract',
          include: ['tests/contract/**/*.test.ts'],
          setupFiles: ['./tests/setup.ts', './tests/setup-creds.ts'],
          testTimeout: 10000,
        },
      },
      {
        test: {
          // Hook integration: spawns `openbox cursor hook` as a
          // subprocess (the same way Cursor does), pipes a synthetic
          // stdin envelope per event, asserts the verdict shape +
          // JSONL log line. No IDE / display required; covers the
          // hook handler end-to-end without needing Cursor's agent.
          name: 'hook-integration',
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
