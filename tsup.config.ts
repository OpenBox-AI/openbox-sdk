import { defineConfig } from 'tsup';

// One bundle per public entry point. tsup walks each src/<name>.ts, follows
// the openbox-sdk path mappings (resolved via tsconfig.json `paths`), and
// emits dist/<name>.js + dist/<name>.d.ts. `noExternal` forces the workspace
// packages to be inlined so the published bundle is self-contained.

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/client.ts',
    'src/core-client.ts',
    'src/env.ts',
    'src/os-paths.ts', // Node-only sub-path; kept off `src/env.ts` so RN bundlers don't pull `os`/`path`.
    'src/types.ts',
    'src/runtime/claude-hooks.ts',
    'src/runtime/cursor-hooks.ts',
  ],
  format: ['esm'],
  dts: true,
  outDir: 'dist',
  clean: true,
  platform: 'node',
  noExternal: [/^@openbox\//],
  sourcemap: true,
  splitting: false,
});
