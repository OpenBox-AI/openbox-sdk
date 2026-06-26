import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, test } from 'vitest';
import { PROVIDER_PLUGIN_COMPONENTS } from '../../ts/src/governance/capability-matrix.js';

const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};
const sdkTargetsFixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'codegen/fixtures/sdk-targets.json'), 'utf8'),
) as {
  packageScripts: {
    scripts: Array<{
      name: string;
      command: string;
      kind: string;
    }>;
  };
};
const syncRuntimeAssets = readFileSync(resolve(process.cwd(), 'scripts/sync-runtime-assets.mjs'), 'utf8');
const runSpecCommandScript = readFileSync(resolve(process.cwd(), 'scripts/run-spec-command.mjs'), 'utf8');
const runRootPipelineScript = readFileSync(resolve(process.cwd(), 'scripts/run-root-pipeline.mjs'), 'utf8');
const runSdkGenerationScript = readFileSync(resolve(process.cwd(), 'scripts/run-sdk-generation.mjs'), 'utf8');
const syncPackageScriptsScript = readFileSync(resolve(process.cwd(), 'scripts/sync-package-scripts.mjs'), 'utf8');
const buildCodegenScript = readFileSync(resolve(process.cwd(), 'scripts/build-codegen.mjs'), 'utf8');
const runBundleBuildScript = readFileSync(resolve(process.cwd(), 'scripts/run-bundle-build.mjs'), 'utf8');
const cleanScript = readFileSync(resolve(process.cwd(), 'scripts/clean.mjs'), 'utf8');
const localCiScript = readFileSync(resolve(process.cwd(), 'scripts/run-local-ci.mjs'), 'utf8');
const runTestsScript = readFileSync(resolve(process.cwd(), 'scripts/run-tests.mjs'), 'utf8');
const runQualityScript = readFileSync(resolve(process.cwd(), 'scripts/run-quality.mjs'), 'utf8');
const runGeneratedCheckScript = readFileSync(resolve(process.cwd(), 'scripts/run-generated-check.mjs'), 'utf8');
const specStepsScript = readFileSync(resolve(process.cwd(), 'scripts/lib/spec-steps.mjs'), 'utf8');
const localGovernanceMatrixHelper = readFileSync(
  resolve(process.cwd(), 'tests/hook-integration/helpers/local-governance-matrix.ts'),
  'utf8',
);
const cleanGeneratedScript = readFileSync(resolve(process.cwd(), 'scripts/clean-generated.mjs'), 'utf8');
const generatedDriftScript = readFileSync(resolve(process.cwd(), 'scripts/check-generated-drift.ts'), 'utf8');
const checkSdksScript = readFileSync(resolve(process.cwd(), 'scripts/check-sdks.mjs'), 'utf8');
const securityAuditScript = readFileSync(resolve(process.cwd(), 'scripts/security-audit.mjs'), 'utf8');
const specDriftScript = readFileSync(resolve(process.cwd(), 'scripts/spec-drift.ts'), 'utf8');
const localStackAlignmentScript = readFileSync(
  resolve(process.cwd(), 'scripts/check-local-stack-alignment.mjs'),
  'utf8',
);

describe('package scripts', () => {
  test('root package scripts match the TypeSpec-emitted script surface exactly', () => {
    const specScripts = Object.fromEntries(
      sdkTargetsFixture.packageScripts.scripts.map((script) => [script.name, script.command]),
    );
    const allowedKinds = new Set(['spec-runner', 'lifecycle-alias', 'compatibility-alias']);

    expect(packageJson.scripts).toEqual(specScripts);
    expect(sdkTargetsFixture.packageScripts.scripts.every((script) => allowedKinds.has(script.kind))).toBe(
      true,
    );
  });

  test('SDK generation reads the TypeSpec-emitted pipeline', () => {
    expect(packageJson.scripts['generate:sdks']).toBe('node scripts/run-sdk-generation.mjs');
    expect(packageJson.scripts['generate:sdks']).not.toContain('build:codegen');
    expect(packageJson.scripts['generate:sdks']).not.toContain('specs:compile');
    expect(runSdkGenerationScript).toContain('sdkGeneration.steps');
    expect(runSdkGenerationScript).toContain('bootstrapSteps');
    expect(runSdkGenerationScript).toContain("from './lib/spec-steps.mjs'");
    expect(syncPackageScriptsScript).toContain('packageScripts');
    expect(syncPackageScriptsScript).toContain('package.json');
  });

  test('root build and SDK check read TypeSpec-emitted pipelines', () => {
    expect(packageJson.scripts.build).toBe('node scripts/run-root-pipeline.mjs build');
    expect(packageJson.scripts['check:sdks']).toBe(
      'node scripts/run-root-pipeline.mjs check-sdks',
    );
    expect(packageJson.scripts['ci:local-stack']).toBe(
      'node scripts/run-root-pipeline.mjs local-stack',
    );
    expect(packageJson.scripts.build).not.toContain('generate:sdks');
    expect(packageJson.scripts['check:sdks']).not.toContain('check-sdks.mjs');
    expect(packageJson.scripts['ci:local-stack']).not.toContain('test:e2e');
    expect(runRootPipelineScript).toContain('rootPipelines');
    expect(runRootPipelineScript).toContain('bootstrapPipelines');
    expect(runRootPipelineScript).toContain("from './lib/spec-steps.mjs'");
  });

  test('TypeSpec commands read the TypeSpec-emitted command table', () => {
    expect(packageJson.scripts['specs:compile']).toBe(
      'node scripts/run-spec-command.mjs compile',
    );
    expect(packageJson.scripts['specs:watch']).toBe('node scripts/run-spec-command.mjs watch');
    expect(packageJson.scripts['specs:compile']).not.toContain('tsp compile');
    expect(packageJson.scripts['specs:watch']).not.toContain('--watch');
    expect(runSpecCommandScript).toContain('specCommands.commands');
    expect(runSpecCommandScript).toContain('bootstrapCommands');
    expect(runSpecCommandScript).toContain("from './lib/spec-steps.mjs'");
  });

  test('codegen build reads the TypeSpec-emitted pipeline', () => {
    expect(packageJson.scripts['build:codegen']).toBe('node scripts/build-codegen.mjs');
    expect(packageJson.scripts['build:codegen']).not.toContain('-w typespec-');
    expect(buildCodegenScript).toContain('codegenBuild.steps');
    expect(buildCodegenScript).toContain('deriveBootstrapSteps');
    expect(buildCodegenScript).toContain("from './lib/spec-steps.mjs'");
    expect(specStepsScript).toContain('codegen/fixtures/sdk-targets.json');
    expect(buildCodegenScript).not.toContain("'typespec-env'");
    expect(buildCodegenScript).not.toContain('"typespec-env"');
    expect(buildCodegenScript).not.toContain("'typespec-emitter'");
    expect(buildCodegenScript).not.toContain('"typespec-emitter"');
  });

  test('bundle build reads the TypeSpec-emitted pipeline', () => {
    expect(packageJson.scripts['build:bundle']).toBe('node scripts/run-bundle-build.mjs');
    expect(packageJson.scripts['build:bundle']).not.toContain('tsup');
    expect(packageJson.scripts['build:bundle']).not.toContain('sync-runtime-assets');
    expect(runBundleBuildScript).toContain('bundleBuild.steps');
    expect(runBundleBuildScript).toContain("from './lib/spec-steps.mjs'");
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
    expect(packageJson.scripts['check:generated-drift']).toBe(
      'node scripts/run-generated-check.mjs drift',
    );
    expect(packageJson.scripts['lint:generated-banners']).toBe(
      'node scripts/run-generated-check.mjs banners',
    );
    expect(cleanGeneratedScript).toContain('generatedArtifacts');
    expect(cleanGeneratedScript).toContain('codegen/fixtures/sdk-targets.json');
    expect(cleanGeneratedScript).not.toContain('driftCheckFiles');
    expect(generatedDriftScript).toContain('generatedArtifacts');
    expect(generatedDriftScript).toContain('driftCheckFiles');
    expect(generatedDriftScript).toContain('codegen/fixtures/sdk-targets.json');
    expect(runGeneratedCheckScript).toContain('generatedChecks.commands');
    expect(runGeneratedCheckScript).toContain("from './lib/spec-steps.mjs'");
  });

  test('SDK generation stays behind the generic TypeSpec command', () => {
    expect(packageJson.scripts['generate:sdks']).toBe('node scripts/run-sdk-generation.mjs');
    expect(packageJson.scripts['check:sdks']).toBe(
      'node scripts/run-root-pipeline.mjs check-sdks',
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
    expect(localCiScript).toContain("from './lib/spec-steps.mjs'");
    expect(specStepsScript).toContain('codegen/fixtures/sdk-targets.json');
  });

  test('generated command runner scopes local e2e run identity per step', () => {
    expect(specStepsScript).toContain('OPENBOX_E2E_RUN_ID');
    expect(specStepsScript).toContain('rootE2eRunId');
    expect(specStepsScript).toContain('runIdPath');
    expect(specStepsScript).toContain('envForStep(step)');
    expect(specStepsScript).not.toContain('env: { ...process.env, ...step.env }');
  });

  test('local governance matrix helper defaults to isolated agent state', () => {
    expect(localGovernanceMatrixHelper).toContain('OPENBOX_E2E_SHARED_AGENT');
    expect(localGovernanceMatrixHelper).toContain('localAgentName()');
    expect(localGovernanceMatrixHelper).toContain('readAgentRecords(): AgentKeyRecord[]');
    expect(localGovernanceMatrixHelper).toContain('if (!sharedAgentMode()) return [];');
    expect(localGovernanceMatrixHelper).toContain('if (sharedAgentMode()) recordAgentKey');
    expect(localGovernanceMatrixHelper).toContain('const inflight = new Map');
    expect(localGovernanceMatrixHelper).not.toContain('process.env.OPENBOX_AGENT_ID =');
    expect(localGovernanceMatrixHelper).not.toContain('process.env.OPENBOX_API_KEY =');
  });

  test('local stack checker validates live OPA bundle polling config', () => {
    expect(localStackAlignmentScript).toContain('/v1/config');
    expect(localStackAlignmentScript).toContain('validateOpaRuntimeConfig');
    expect(localStackAlignmentScript).toContain('host.docker.internal');
    expect(localStackAlignmentScript).toContain('expectedOpaBundleResource');
    expect(localStackAlignmentScript).toContain('bundle.tar.gz');
    expect(localStackAlignmentScript).toContain('coreWorkerCommandPattern');
    expect(localStackAlignmentScript).toContain('go\\\\s+run\\\\s+\\\\./cmd/core');
    expect(localStackAlignmentScript).toContain('env visibility skipped; ${coreEnvLabel} validated');
    expect(localStackAlignmentScript).not.toContain('launchctl');
    expect(localStackAlignmentScript).not.toContain('openbox-core-local');
    expect(localStackAlignmentScript).not.toContain('OPA config file not found');
    expect(localStackAlignmentScript).not.toContain('set OPENBOX_OPA_CONFIG_PATH');
  });

  test('root test scripts read the TypeSpec-emitted suite routing table', () => {
    expect(packageJson.scripts.test).toBe('node scripts/run-tests.mjs');
    expect(packageJson.scripts['test:unit']).toBe('node scripts/run-tests.mjs unit');
    expect(packageJson.scripts['test:openapi-mock']).toBe(
      'node scripts/run-tests.mjs openapi-mock',
    );
    expect(packageJson.scripts['test:specmatic']).toBeUndefined();
    expect(packageJson.scripts['test:karate']).toBeUndefined();
    expect(packageJson.scripts['test:contract']).toBe('node scripts/run-tests.mjs contract');
    expect(packageJson.scripts['test:providers']).toBe(
      'node scripts/run-tests.mjs provider-adapters',
    );
    expect(packageJson.scripts['test:hook-install']).toBe(
      'node scripts/run-tests.mjs hook-install',
    );
    expect(packageJson.scripts['test:hook-runtime']).toBe(
      'node scripts/run-tests.mjs hook-runtime',
    );
    expect(packageJson.scripts['test:mcp-protocol']).toBe(
      'node scripts/run-tests.mjs mcp-protocol',
    );
    expect(packageJson.scripts['test:hook-claude-host']).toBe(
      'node scripts/run-tests.mjs hook-claude-host',
    );
    expect(packageJson.scripts['test:anthropic-agent-sdk-local-stack']).toBe(
      'node scripts/run-tests.mjs anthropic-agent-sdk-local-stack',
    );
    expect(packageJson.scripts['test:copilotkit-local-stack']).toBe(
      'node scripts/run-tests.mjs copilotkit-local-stack',
    );
    expect(packageJson.scripts['test:n8n-local-stack']).toBe(
      'node scripts/run-tests.mjs n8n-local-stack',
    );
    expect(packageJson.scripts['test:hook-integration']).toBe(
      'node scripts/run-tests.mjs hook-integration',
    );
    expect(packageJson.scripts['test:e2e']).toBe('node scripts/run-tests.mjs e2e');
    expect(packageJson.scripts['test:e2e:governance']).toBe(
      'node scripts/run-tests.mjs local-stack-alignment e2e-governance-domains e2e-governance-policies e2e-governance-request-query-boundaries e2e-governance-core e2e-governance-faults',
    );
    expect(packageJson.scripts['test:e2e:platform']).toBe(
      'node scripts/run-tests.mjs e2e-platform',
    );
    expect(packageJson.scripts['test:e2e:opa-unavailable']).toBe(
      'node scripts/run-isolated-opa-unavailable.mjs',
    );
    for (const name of [
      'test',
      'test:unit',
      'test:openapi-mock',
      'test:contract',
      'test:providers',
      'test:hook-install',
      'test:hook-runtime',
      'test:mcp-protocol',
      'test:hook-claude-host',
      'test:anthropic-agent-sdk-local-stack',
      'test:copilotkit-local-stack',
      'test:n8n-local-stack',
      'test:hook-integration',
      'test:e2e',
      'test:e2e:governance',
      'test:e2e:platform',
      'test:e2e:opa-unavailable',
    ]) {
      expect(packageJson.scripts[name]).not.toContain('vitest');
    }
    expect(runTestsScript).toContain('testSuites');
    expect(runTestsScript).toContain('testSuites.defaultSuites');
    expect(runTestsScript).toContain('testSuites.suites');
    expect(runTestsScript).toContain("from './lib/spec-steps.mjs'");
  });

  test('quality scripts read the TypeSpec-emitted command table', () => {
    expect(packageJson.scripts.lint).toBe('node scripts/run-quality.mjs lint');
    expect(packageJson.scripts.format).toBe('node scripts/run-quality.mjs format');
    expect(packageJson.scripts.lint).not.toContain('ts/src');
    expect(packageJson.scripts.format).not.toContain('ts/src');
    expect(runQualityScript).toContain('qualityCommands.commands');
    expect(runQualityScript).toContain("from './lib/spec-steps.mjs'");
  });

  test('generic SDK check validates spec-bound extension manifests', () => {
    expect(checkSdksScript).toContain("from './lib/spec-steps.mjs'");
    expect(checkSdksScript).toContain('extensionManifest');
    expect(checkSdksScript).toContain('contributes.views');
    expect(checkSdksScript).toContain('contributes.configuration.properties');
    expect(checkSdksScript).toContain('does not match TypeSpec manifest');
    expect(checkSdksScript).not.toContain('node:child_process');
    expect(checkSdksScript).not.toContain('spawnSync');
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

  test('service drift reads TypeSpec-emitted service/tier metadata', () => {
    expect(specDriftScript).toContain('codegen/fixtures/sdk-targets.json');
    expect(specDriftScript).toContain('fixture.serviceDrift');
    expect(specDriftScript).toContain('SERVICE_DRIFT.services');
    expect(specDriftScript).toContain('SERVICE_DRIFT.tiers');
    expect(specDriftScript).toContain('outputPathTemplate');
    expect(specDriftScript).not.toContain("const SERVICES = new Set(['backend', 'core'])");
    expect(specDriftScript).not.toContain("const TIERS = new Set(['prod', 'staging', 'develop', 'main'])");
    expect(specDriftScript).not.toContain('`/tmp/upstream-${service}-${tier}.json`');
    expect(specDriftScript).not.toContain('`/tmp/spec-drift-${service}-${tier}.md`');
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
