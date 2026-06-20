import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, test } from 'vitest';
import { PROVIDER_PLUGIN_COMPONENTS } from '../../ts/src/governance/capability-matrix.js';

const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};
const syncRuntimeAssets = readFileSync(resolve(process.cwd(), 'scripts/sync-runtime-assets.ts'), 'utf8');
const buildCodegenScript = readFileSync(resolve(process.cwd(), 'scripts/build-codegen.mjs'), 'utf8');
const cleanScript = readFileSync(resolve(process.cwd(), 'scripts/clean.mjs'), 'utf8');
const localCiScript = readFileSync(resolve(process.cwd(), 'scripts/run-local-ci.mjs'), 'utf8');
const cleanGeneratedScript = readFileSync(resolve(process.cwd(), 'scripts/clean-generated.mjs'), 'utf8');
const generatedDriftScript = readFileSync(resolve(process.cwd(), 'scripts/check-generated-drift.ts'), 'utf8');
const checkSdksScript = readFileSync(resolve(process.cwd(), 'scripts/check-sdks.mjs'), 'utf8');
const securityAuditScript = readFileSync(resolve(process.cwd(), 'scripts/security-audit.mjs'), 'utf8');

describe('package scripts', () => {
  test('codegen build reads the TypeSpec-emitted pipeline', () => {
    expect(packageJson.scripts['build:codegen']).toBe('node scripts/build-codegen.mjs');
    expect(packageJson.scripts['build:codegen']).not.toContain('-w typespec-');
    expect(buildCodegenScript).toContain('codegenBuild.steps');
    expect(buildCodegenScript).toContain('codegen/fixtures/sdk-targets.json');
    expect(buildCodegenScript).toContain('deriveBootstrapSteps');
    expect(buildCodegenScript).not.toContain("'typespec-env'");
    expect(buildCodegenScript).not.toContain('"typespec-env"');
    expect(buildCodegenScript).not.toContain("'typespec-emitter'");
    expect(buildCodegenScript).not.toContain('"typespec-emitter"');
  });

  test('root clean reads TypeSpec-emitted clean artifact inventory', () => {
    expect(packageJson.scripts.clean).toBe('node scripts/clean.mjs');
    expect(packageJson.scripts.clean).not.toContain('rm -rf');
    expect(packageJson.scripts.clean).not.toContain('apps/extension');
    expect(cleanScript).toContain('cleanArtifacts');
    expect(cleanScript).toContain('codegen/fixtures/sdk-targets.json');
    expect(cleanScript).toContain('scripts/clean-generated.mjs');
  });

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

  test('local CI reads the TypeSpec-emitted pipeline', () => {
    expect(packageJson.scripts['ci:local']).toBe('node scripts/run-local-ci.mjs');
    expect(packageJson.scripts['ci:local']).not.toContain('vitest');
    expect(packageJson.scripts['ci:local']).not.toContain('spectral');
    expect(localCiScript).toContain('localCi.steps');
    expect(localCiScript).toContain('codegen/fixtures/sdk-targets.json');
  });

  test('generic SDK check validates spec-bound extension manifests', () => {
    expect(checkSdksScript).toContain('extensionManifest');
    expect(checkSdksScript).toContain('contributes.views');
    expect(checkSdksScript).toContain('contributes.configuration.properties');
    expect(checkSdksScript).toContain('does not match TypeSpec manifest');
  });

  test('security audit reads TypeSpec-emitted audit commands and annotated exclusions', () => {
    expect(packageJson.scripts['audit:security']).toBe('node scripts/security-audit.mjs');
    expect(securityAuditScript).toContain('codegen/fixtures/sdk-targets.json');
    expect(securityAuditScript).toContain('securityAudit.commands');
    expect(securityAuditScript).toContain('securityAudit.secretScanExcludes');
    expect(securityAuditScript).not.toContain("--prefix', 'example/n8n/custom-node'");
    expect(securityAuditScript).not.toContain('const steps =');
    expect(securityAuditScript).not.toContain('const secretScanExcludes = new Set([');
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
