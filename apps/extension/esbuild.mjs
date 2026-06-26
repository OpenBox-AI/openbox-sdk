import { build, context } from 'esbuild';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const src = (path) => fileURLToPath(new URL(`../../${path}`, import.meta.url));
const dev = process.argv.includes('--dev');
const watch = process.argv.includes('--watch');

const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  minify: !dev,
  sourcemap: dev,
  define: {
    'process.env.EXTENSION_DEBUG_BUILD': JSON.stringify(dev ? 'true' : 'false'),
  },
  absWorkingDir: fileURLToPath(new URL('.', import.meta.url)),
  alias: {
    '@openbox-ai/openbox-sdk': src('ts/src/index.ts'),
    '@openbox-ai/openbox-sdk/agent-trace': src('ts/src/agent-trace/index.ts'),
    '@openbox-ai/openbox-sdk/approvals': src('ts/src/approvals/index.ts'),
    '@openbox-ai/openbox-sdk/client': src('ts/src/client/index.ts'),
    '@openbox-ai/openbox-sdk/client-factory': src('ts/src/client-factory/index.ts'),
    '@openbox-ai/openbox-sdk/config': src('ts/src/config/index.ts'),
    '@openbox-ai/openbox-sdk/env': src('ts/src/env/index.ts'),
    '@openbox-ai/openbox-sdk/file-tokens': src('ts/src/file-tokens/index.ts'),
    '@openbox-ai/openbox-sdk/governance': src('ts/src/governance/index.ts'),
    '@openbox-ai/openbox-sdk/logging': src('ts/src/logging/index.ts'),
    '@openbox-ai/openbox-sdk/os-paths': src('ts/src/env/os-paths.ts'),
    '@openbox-ai/openbox-sdk/polling': src('ts/src/polling/index.ts'),
    '@openbox-ai/openbox-sdk/types': src('ts/src/types/index.ts'),
  },
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log(`watching ${repo}/apps/extension`);
} else {
  await build(options);
}
