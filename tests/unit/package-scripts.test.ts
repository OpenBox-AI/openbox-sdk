import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, test } from 'vitest';
import { PROVIDER_PLUGIN_COMPONENTS } from '../../ts/src/governance/capability-matrix.js';

const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};
const syncRuntimeAssets = readFileSync(resolve(process.cwd(), 'scripts/sync-runtime-assets.ts'), 'utf8');
const cleanGeneratedScript = readFileSync(resolve(process.cwd(), 'scripts/clean-generated.mjs'), 'utf8');
const generatedDriftScript = readFileSync(resolve(process.cwd(), 'scripts/check-generated-drift.ts'), 'utf8');

describe('package scripts', () => {
  test('generated cleanup and drift checks read the TypeSpec-emitted artifact inventory', () => {
    expect(packageJson.scripts['clean:generated']).toBe('node scripts/clean-generated.mjs');
    expect(packageJson.scripts['clean:generated']).not.toContain('python');
    expect(packageJson.scripts['clean:generated']).not.toContain('apps/extension');
    expect(cleanGeneratedScript).toContain('generatedArtifacts');
    expect(cleanGeneratedScript).toContain('codegen/fixtures/sdk-targets.json');
    expect(generatedDriftScript).toContain('generatedArtifacts');
    expect(generatedDriftScript).toContain('codegen/fixtures/sdk-targets.json');
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

    expect(syncRuntimeAssets).toContain("await import('../dist/governance/index.js')");
    expect(syncRuntimeAssets).toContain('PROVIDER_PLUGIN_COMPONENTS');
    expect(syncRuntimeAssets).toContain('`export${pascalProvider(provider)}Plugin`');
    expect(syncRuntimeAssets).not.toContain('exportCursorPlugin');
    expect(syncRuntimeAssets).not.toContain('exportClaudeCodePlugin');
    expect(syncRuntimeAssets).not.toContain('exportCodexPlugin');
    for (const provider of pluginProviders) {
      expect(syncRuntimeAssets, `${provider} dist plugin bundle`).toContain(
        "resolve(root, 'dist/runtime', provider, 'plugin/openbox')",
      );
    }
  });
});
