import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
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
          setupFiles: ['./tests/setup.ts'],
          testTimeout: 30000,
          sequence: { concurrent: false },
          fileParallelism: false,
        },
      },
    ],
  },
});
