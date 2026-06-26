import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const { PROVIDER_PLUGIN_COMPONENTS } = await import('../dist/governance/index.js');

function pascalProvider(provider) {
  return provider
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

async function pluginExporter(provider) {
  const runtime = await import(`../dist/runtime/${provider}/index.js`);
  const exportName = `export${pascalProvider(provider)}Plugin`;
  const exporter = runtime[exportName];
  if (typeof exporter !== 'function') {
    throw new Error(`Missing plugin exporter ${exportName} for ${provider}`);
  }
  return exporter;
}

for (const { provider } of PROVIDER_PLUGIN_COMPONENTS) {
  const templatesFrom = resolve(root, 'ts/src/runtime', provider, 'templates');
  if (existsSync(templatesFrom)) {
    const templatesTo = resolve(root, 'dist/runtime', provider, 'templates');
    rmSync(templatesTo, { recursive: true, force: true });
    mkdirSync(dirname(templatesTo), { recursive: true });
    cpSync(templatesFrom, templatesTo, { recursive: true });
  }

  const exporter = await pluginExporter(provider);
  exporter({
    out: resolve(root, 'dist/runtime', provider, 'plugin/openbox'),
  });
}
