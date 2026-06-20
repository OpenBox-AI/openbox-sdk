import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, test } from 'vitest';
import { PROVIDER_PLUGIN_COMPONENTS } from '../../ts/src/governance/capability-matrix.js';

const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};
const syncRuntimeAssets = readFileSync(resolve(process.cwd(), 'scripts/sync-runtime-assets.ts'), 'utf8');

describe('package scripts', () => {
  test('generated cleanup covers TypeSpec-emitted contract metadata', () => {
    const cleanGenerated = packageJson.scripts['clean:generated'];

    expect(cleanGenerated).toContain('codegen/method-names.json');
    expect(cleanGenerated).toContain('codegen/method-permissions.json');
    expect(cleanGenerated).toContain('codegen/fixtures/cli-auth.json');
    expect(cleanGenerated).toContain('codegen/fixtures/env-resolution.json');
    expect(cleanGenerated).toContain('codegen/fixtures/govern-protocol.json');
    expect(cleanGenerated).toContain('codegen/fixtures/provider-capabilities.json');
    expect(cleanGenerated).toContain('codegen/fixtures/sdk-manifests.json');
    expect(cleanGenerated).toContain('codegen/fixtures/sdk-targets.json');
    expect(cleanGenerated).toContain('apps/extension/src/generated');
    expect(cleanGenerated).toContain('example/n8n/custom-node/src/generated');
  });

  test('SDK generation stays behind the generic TypeSpec command', () => {
    expect(packageJson.scripts['generate:sdks']).toBe('npm run build:codegen && npm run specs:compile');
    expect(packageJson.scripts['check:sdks']).toBe(
      'npm run generate:sdks && node scripts/check-sdks.mjs',
    );
    expect(packageJson.scripts['check:sdks']).not.toContain('cd python');
    expect(packageJson.scripts['check:sdks']).not.toContain('uv run');

    const languageSpecificGenerationCommands = Object.keys(packageJson.scripts).filter((name) =>
      /^(generate|check):(typescript|javascript|python|ts|js|py)$/.test(name),
    );
    expect(languageSpecificGenerationCommands).toEqual([]);
  });

  test('runtime plugin bundle export follows the TypeSpec provider component catalog', () => {
    const pluginProviders = PROVIDER_PLUGIN_COMPONENTS.map((entry) => entry.provider);
    expect(pluginProviders).toEqual(['codex', 'cursor', 'claude-code']);

    const expectedExports: Record<(typeof pluginProviders)[number], string> = {
      codex: 'exportCodexPlugin',
      cursor: 'exportCursorPlugin',
      'claude-code': 'exportClaudeCodePlugin',
    };

    for (const provider of pluginProviders) {
      expect(syncRuntimeAssets, `${provider} exporter`).toContain(expectedExports[provider]);
      expect(syncRuntimeAssets, `${provider} dist plugin bundle`).toContain(
        `dist/runtime/${provider}/plugin/openbox`,
      );
    }
  });
});
