import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { describe, expect, test } from 'vitest';

interface CommandStep {
  id: string;
  label: string;
  command: string;
  args?: string[];
  workingDirectory: string;
  env?: Record<string, string>;
}

interface ParallelStepGroup {
  id: string;
  label: string;
  parallel: true;
  steps: CommandStep[];
}

type PipelineStep = CommandStep | ParallelStepGroup;

interface SdkTargetsFixture {
  generatedBy: string;
  source: string;
  regenerate: string;
  generatedArtifacts: {
    generatedRoots: string[];
    generatedFiles: string[];
    driftCheckFiles?: string[];
    nestedGeneratedFiles: Array<{
      root: string;
      suffixes: string[];
    }>;
  };
  codegenBuild: {
    steps: CommandStep[];
  };
  sdkGeneration: {
    steps: CommandStep[];
  };
  specCommands: {
    commands: CommandStep[];
  };
  serviceDrift: {
    script: string;
    services: string[];
    tiers: string[];
    commands: Array<{
      id: string;
      label: string;
      command: string;
      args?: string[];
      workingDirectory: string;
      outputPathTemplate: string;
      behavior: string;
    }>;
    upstreamSources: Array<{
      service: string;
      tier: string;
      source: string;
    }>;
    policy: string;
  };
  rootPipelines: {
    pipelines: Array<{
      id: string;
      label: string;
      steps: PipelineStep[];
    }>;
  };
  testSuites: {
    defaultSuites: string[];
    suites: PipelineStep[];
  };
  localStackProofLanes: {
    policy: string;
    lanes: Array<{
      id: string;
      label: string;
      kind: string;
      suiteId: string;
      command: string;
      parallelSafe: boolean;
      localStackRequired: boolean;
      isolation: string;
      requiredEnv: string[];
      proofFiles: string[];
      coverage: {
        checklistAreas: string[];
        providers: string[];
        domains: string[];
        subsystems: string[];
      };
    }>;
  };
  bundleBuild: {
    steps: CommandStep[];
  };
  qualityCommands: {
    commands: CommandStep[];
  };
  generatedChecks: {
    commands: CommandStep[];
  };
  packageSurface: {
    packageName: string;
    bin: Array<{
      name: string;
      path: string;
    }>;
    files: string[];
    exports: Array<{
      subpath: string;
      types: string;
      importPath: string;
    }>;
  };
  packageScripts: {
    scripts: Array<{
      name: string;
      command: string;
      kind: string;
    }>;
  };
  scriptInventory: {
    entries: Array<{
      path: string;
      category: string;
      canonicalSurface: string;
      role: string;
    }>;
  };
  cleanArtifacts: {
    paths: string[];
    nestedNames: Array<{
      root: string;
      names: string[];
    }>;
    filePatterns: Array<{
      root: string;
      prefix: string;
      suffix: string;
    }>;
  };
  securityAudit: {
    commands: CommandStep[];
    secretScanExcludes: Array<{
      path: string;
      reason: string;
    }>;
  };
  localCi: {
    steps: PipelineStep[];
  };
  targets: Array<{
    id: string;
    label: string;
    kind?: string;
    workingDirectory: string;
    commands: Array<{
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }>;
  }>;
}

function readSdkTargetsFixture(): SdkTargetsFixture {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'codegen/fixtures/sdk-targets.json'), 'utf8'),
  ) as SdkTargetsFixture;
}

function isParallelGroup(step: PipelineStep): step is ParallelStepGroup {
  return 'steps' in step;
}

function isCommandStep(step: PipelineStep | undefined): step is CommandStep {
  return step !== undefined && !isParallelGroup(step);
}

function flattenPipelineSteps(steps: PipelineStep[]): PipelineStep[] {
  const out: PipelineStep[] = [];
  for (const step of steps) {
    out.push(step);
    if (isParallelGroup(step)) {
      out.push(...flattenPipelineSteps(step.steps));
    }
  }
  return out;
}

function listFilesRecursive(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root).sort()) {
    const path = join(root, entry);
    if (path.split('/').includes('__pycache__') || path.endsWith('.pyc')) {
      continue;
    }
    const stat = statSync(path);
    if (stat.isDirectory()) {
      out.push(...listFilesRecursive(path));
    } else if (stat.isFile()) {
      out.push(path);
    }
  }
  return out;
}

describe('SDK target validation manifest', () => {
  test('is emitted from TypeSpec and covers every target', () => {
    const fixture = readSdkTargetsFixture();

    expect(fixture.generatedBy).toBe('codegen/emitters/typespec-emitter');
    expect(fixture.source).toBe('specs/typespec/sdk/main.tsp');
    expect(fixture.regenerate).toBe('npm run specs:compile');
    expect(fixture.targets.map((target) => target.id)).toEqual([
      'typescript',
      'python',
      'extension',
      'n8n-custom-node',
    ]);
    expect(fixture.targets.map((target) => target.kind)).toEqual(['sdk', 'sdk', 'app', 'app']);
  });

  test('declares generated artifact cleanup and drift inventory', () => {
    const fixture = readSdkTargetsFixture();

    expect(fixture.generatedArtifacts.generatedRoots).toEqual([
      'specs/generated',
      'python/openbox_sdk/generated',
      'apps/extension/src/generated',
      'example/n8n/custom-node/src/generated',
    ]);
    expect(fixture.generatedArtifacts.generatedFiles).toEqual([
      'codegen/method-names.json',
      'codegen/method-permissions.json',
      'codegen/fixtures/cli-auth.json',
      'codegen/fixtures/boundary-domains.json',
      'codegen/fixtures/env-resolution.json',
      'codegen/fixtures/govern-protocol.json',
      'codegen/fixtures/governance-domains.json',
      'codegen/fixtures/provider-capabilities.json',
      'codegen/fixtures/sdk-manifests.json',
      'codegen/fixtures/sdk-targets.json',
      'docs/governance-artifacts/capability-checklist.md',
      'docs/governance-artifacts/capability-checklist.csv',
      'docs/governance-artifacts/summary.csv',
    ]);
    expect(fixture.generatedArtifacts.driftCheckFiles).toEqual(['package.json']);
    expect(fixture.generatedArtifacts.nestedGeneratedFiles).toEqual([
      { root: 'ts/src', suffixes: ['.ts', '.d.ts'] },
    ]);
  });

  test('declares the codegen build pipeline without package-script workspace lists', () => {
    const fixture = readSdkTargetsFixture();
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts['build:codegen']).toBe('node scripts/build-codegen.mjs');
    expect(packageJson.scripts['build:codegen']).not.toContain('-w typespec-');
    expect(fixture.codegenBuild.steps).toEqual([
      {
        id: 'typespec-env',
        label: 'TypeSpec env library',
        command: 'npm',
        args: ['run', 'build', '-w', 'typespec-env'],
        workingDirectory: '.',
      },
      {
        id: 'typespec-cli',
        label: 'TypeSpec CLI library',
        command: 'npm',
        args: ['run', 'build', '-w', 'typespec-cli'],
        workingDirectory: '.',
      },
      {
        id: 'typespec-workflow',
        label: 'TypeSpec workflow library',
        command: 'npm',
        args: ['run', 'build', '-w', 'typespec-workflow'],
        workingDirectory: '.',
      },
      {
        id: 'typespec-emitter',
        label: 'OpenBox TypeSpec emitter',
        command: 'npm',
        args: ['run', 'build', '-w', 'typespec-emitter'],
        workingDirectory: '.',
      },
    ]);
  });

  test('declares SDK generation stages outside package scripts', () => {
    const fixture = readSdkTargetsFixture();
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts['generate:sdks']).toBe('node scripts/run-sdk-generation.mjs');
    expect(fixture.sdkGeneration.steps).toEqual([
      {
        id: 'build-codegen',
        label: 'Codegen package build',
        command: 'npm',
        args: ['run', 'build:codegen'],
        workingDirectory: '.',
      },
      {
        id: 'specs-compile',
        label: 'TypeSpec contract compile',
        command: 'npm',
        args: ['run', 'specs:compile'],
        workingDirectory: '.',
      },
      {
        id: 'sync-package-scripts',
        label: 'Sync package scripts',
        command: 'node',
        args: ['scripts/sync-package-scripts.mjs'],
        workingDirectory: '.',
      },
      {
        id: 'write-governance-checklist',
        label: 'Write governance checklist artifacts',
        command: 'node',
        args: ['scripts/write-governance-checklist.mjs'],
        workingDirectory: '.',
      },
    ]);
  });

  test('declares TypeSpec commands outside package scripts', () => {
    const fixture = readSdkTargetsFixture();
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts['specs:compile']).toBe(
      'node scripts/run-spec-command.mjs compile',
    );
    expect(packageJson.scripts['specs:watch']).toBe('node scripts/run-spec-command.mjs watch');
    expect(fixture.specCommands.commands).toEqual([
      {
        id: 'compile',
        label: 'TypeSpec contract compile',
        command: 'npx',
        args: ['tsp', 'compile', 'specs/typespec'],
        workingDirectory: '.',
      },
      {
        id: 'watch',
        label: 'TypeSpec contract watch',
        command: 'npx',
        args: ['tsp', 'compile', 'specs/typespec', '--watch'],
        workingDirectory: '.',
      },
    ]);
  });

  test('declares service drift as a TypeSpec-owned operational script', () => {
    const fixture = readSdkTargetsFixture();

    expect(fixture.serviceDrift.script).toBe('scripts/spec-drift.ts');
    expect(fixture.serviceDrift.services).toEqual(['backend', 'core']);
    expect(fixture.serviceDrift.tiers).toEqual(['prod', 'staging', 'develop', 'main']);
    expect(fixture.serviceDrift.commands.map((command) => command.id)).toEqual([
      'fetch',
      'diff',
    ]);
    expect(fixture.serviceDrift.commands).toEqual([
      {
        id: 'fetch',
        label: 'Fetch upstream service contract',
        command: 'node',
        args: [
          '--experimental-strip-types',
          'scripts/spec-drift.ts',
          'fetch',
          '--service',
          '<service>',
          '--tier',
          '<tier>',
        ],
        workingDirectory: '.',
        outputPathTemplate: '/tmp/upstream-<service>-<tier>.json',
        behavior:
          'Resolve deployed OpenAPI or upstream route inventory for the requested service/tier pair. Unsupported pairs write an explicit skip marker.',
      },
      {
        id: 'diff',
        label: 'Diff emitted TypeSpec contract against upstream',
        command: 'node',
        args: [
          '--experimental-strip-types',
          'scripts/spec-drift.ts',
          'diff',
          '--service',
          '<service>',
          '--tier',
          '<tier>',
        ],
        workingDirectory: '.',
        outputPathTemplate: '/tmp/spec-drift-<service>-<tier>.md',
        behavior:
          'Compare specs/generated/openapi3 against the fetched upstream snapshot and report drift without failing the process.',
      },
    ]);
    expect(
      fixture.serviceDrift.upstreamSources.map((entry) => `${entry.service}:${entry.tier}`),
    ).toEqual([
      'backend:prod',
      'backend:staging',
      'backend:develop',
      'backend:main',
      'core:prod',
      'core:staging',
      'core:develop',
      'core:main',
    ]);
    expect(fixture.serviceDrift.policy).toContain('report-only operational check');
    expect(fixture.serviceDrift.policy).toContain('must not author SDK artifacts');
  });

  test('declares root build, check, and local-stack pipelines outside package scripts', () => {
    const fixture = readSdkTargetsFixture();
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      scripts: Record<string, string>;
    };
    const pipelines = Object.fromEntries(
      fixture.rootPipelines.pipelines.map((pipeline) => [pipeline.id, pipeline]),
    );

    expect(packageJson.scripts.build).toBe('node scripts/run-root-pipeline.mjs build');
    expect(packageJson.scripts['check:sdks']).toBe(
      'node scripts/run-root-pipeline.mjs check-sdks',
    );
    expect(packageJson.scripts['ci:local-stack']).toBe(
      'node scripts/run-root-pipeline.mjs local-stack',
    );
    expect(fixture.rootPipelines.pipelines.map((pipeline) => pipeline.id)).toEqual([
      'build',
      'check-sdks',
      'local-stack',
    ]);
    expect(pipelines.build?.steps.map((step) => step.id)).toEqual([
      'generate-sdks',
      'bundle-build',
    ]);
    expect(pipelines['check-sdks']?.steps.map((step) => step.id)).toEqual([
      'generate-sdks',
      'validate-targets',
    ]);
    expect(pipelines['local-stack']?.steps.map((step) => step.id)).toEqual([
      'ci-local',
      'live-governance-lanes',
      'live-platform-e2e',
    ]);
    const governanceLanes = pipelines['local-stack']?.steps.at(1);
    if (!governanceLanes || !isParallelGroup(governanceLanes)) {
      throw new Error('live-governance-lanes must be a parallel group');
    }
    expect(governanceLanes.steps.map((step) => step.id)).toEqual([
      'hook-claude-host',
      'hook-claude-stdin-local-stack',
      'hook-codex-local-stack',
      'hook-cursor-local-stack',
      'openai-agents-sdk-local-stack',
      'anthropic-agent-sdk-local-stack',
      'copilotkit-local-stack',
      'n8n-local-stack',
      'kms-signing-local-stack',
      'live-governance-e2e',
      'local-llamafirewall',
    ]);
    expect(governanceLanes.steps.at(0)).toEqual({
      id: 'hook-claude-host',
      label: 'Live Claude host governance tests',
      command: 'npm',
      args: ['run', 'test:hook-claude-host'],
      workingDirectory: '.',
    });
    expect(governanceLanes.steps.at(1)).toEqual({
      id: 'hook-claude-stdin-local-stack',
      label: 'Live Claude hook stdin governance tests',
      command: 'npm',
      args: ['run', 'test:hook-claude-stdin-local-stack'],
      workingDirectory: '.',
    });
    expect(governanceLanes.steps.at(2)).toEqual({
      id: 'hook-codex-local-stack',
      label: 'Live Codex hook governance tests',
      command: 'npm',
      args: ['run', 'test:hook-codex-local-stack'],
      workingDirectory: '.',
    });
    expect(governanceLanes.steps.at(3)).toEqual({
      id: 'hook-cursor-local-stack',
      label: 'Live Cursor hook governance tests',
      command: 'npm',
      args: ['run', 'test:hook-cursor-local-stack'],
      workingDirectory: '.',
    });
    expect(governanceLanes.steps.at(4)).toEqual({
      id: 'openai-agents-sdk-local-stack',
      label: 'Live OpenAI Agents SDK governance tests',
      command: 'npm',
      args: ['run', 'test:openai-agents-sdk-local-stack'],
      workingDirectory: '.',
    });
    expect(governanceLanes.steps.at(5)).toEqual({
      id: 'anthropic-agent-sdk-local-stack',
      label: 'Live Anthropic Agent SDK governance tests',
      command: 'npm',
      args: ['run', 'test:anthropic-agent-sdk-local-stack'],
      workingDirectory: '.',
    });
    expect(governanceLanes.steps.at(6)).toEqual({
      id: 'copilotkit-local-stack',
      label: 'Live CopilotKit governance tests',
      command: 'npm',
      args: ['run', 'test:copilotkit-local-stack'],
      workingDirectory: '.',
    });
    expect(governanceLanes.steps.at(7)).toEqual({
      id: 'n8n-local-stack',
      label: 'Live n8n governance tests',
      command: 'npm',
      args: ['run', 'test:n8n-local-stack'],
      workingDirectory: '.',
    });
    expect(governanceLanes.steps.at(8)).toEqual({
      id: 'kms-signing-local-stack',
      label: 'Live local KMS signing governance tests',
      command: 'npm',
      args: ['run', 'test:kms-signing-local-stack'],
      workingDirectory: '.',
    });
    expect(governanceLanes.steps.at(9)).toEqual({
      id: 'live-governance-e2e',
      label: 'Live governance local-stack e2e',
      command: 'npm',
      args: ['run', 'test:e2e:governance'],
      workingDirectory: '.',
    });
    expect(governanceLanes.steps.at(10)).toEqual({
      id: 'local-llamafirewall',
      label: 'Local LlamaFirewall e2e',
      command: 'npm',
      args: ['run', 'test:e2e:llamafirewall'],
      workingDirectory: '.',
    });
    expect(pipelines['local-stack']?.steps.at(2)).toEqual({
      id: 'live-platform-e2e',
      label: 'Live platform local-stack e2e',
      command: 'npm',
      args: ['run', 'test:e2e:platform'],
      workingDirectory: '.',
    });
    expect(pipelines['check-sdks']?.steps.at(-1)).toEqual({
      id: 'validate-targets',
      label: 'Validate SDK targets',
      command: 'node',
      args: ['scripts/check-sdks.mjs'],
      workingDirectory: '.',
    });
  });

  test('declares root test suite routing outside package scripts', () => {
    const fixture = readSdkTargetsFixture();
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      scripts: Record<string, string>;
    };

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
    expect(packageJson.scripts['test:openai-agents-sdk-local-stack']).toBe(
      'node scripts/run-tests.mjs openai-agents-sdk-local-stack',
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
    expect(packageJson.scripts['test:kms-signing-local-stack']).toBe(
      'node scripts/run-tests.mjs kms-signing-local-stack',
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
    expect(fixture.testSuites.defaultSuites).toEqual(['unit', 'openapi-mock', 'contract']);
    expect(fixture.testSuites.suites.map((suite) => suite.id)).toEqual([
      'unit',
      'openapi-mock',
      'contract',
      'provider-adapters',
      'hook-install',
      'hook-runtime',
      'mcp-protocol',
      'hook-claude-host',
      'hook-claude-headless-write',
      'hook-claude-headless-shell',
      'hook-claude-stdin-local-stack',
      'hook-claude-events-tool',
      'hook-claude-events-lifecycle',
      'hook-claude-subagent',
      'hook-claude-host-rest',
      'hook-codex-local-stack',
      'hook-cursor-local-stack',
      'openai-agents-sdk-local-stack',
      'anthropic-agent-sdk-local-stack',
      'copilotkit-local-stack',
      'n8n-local-stack',
      'kms-signing-local-stack',
      'local-llamafirewall',
      'hook-integration',
      'local-stack-alignment',
      'e2e-governance-domains',
      'e2e-governance-policies',
      'e2e-governance-request-query-boundaries',
      'e2e-governance-core',
      'e2e-governance-faults',
      'e2e-platform',
      'e2e',
    ]);
    const hookInstall = fixture.testSuites.suites.find((suite) => suite.id === 'hook-install');
    if (!isCommandStep(hookInstall)) throw new Error('hook-install must be a command step');
    expect(hookInstall.args).toEqual(
      expect.arrayContaining([
        'tests/hook-integration/claude-code-install.test.ts',
        'tests/hook-integration/install-cursor-integration.test.ts',
      ]),
    );
    const hookClaudeHost = fixture.testSuites.suites.find(
      (suite) => suite.id === 'hook-claude-host',
    );
    if (!isCommandStep(hookClaudeHost)) throw new Error('hook-claude-host must be a command step');
    expect(hookClaudeHost.args).toEqual(
      expect.arrayContaining([
        'hook-claude-headless-write',
        'hook-claude-headless-shell',
        'hook-claude-events-tool',
        'hook-claude-events-lifecycle',
        'hook-claude-subagent',
        'hook-claude-host-rest',
      ]),
    );
    const governanceDomains = fixture.testSuites.suites.find(
      (suite) => suite.id === 'e2e-governance-domains',
    );
    if (!governanceDomains || !isParallelGroup(governanceDomains)) {
      throw new Error('e2e-governance-domains must be a parallel group');
    }
    expect(governanceDomains.steps.map((step) => step.id)).toEqual([
      'e2e-governance-approvals',
      'e2e-governance-audit-logs',
      'e2e-governance-behavior-rules',
      'e2e-governance-goal-alignment',
      'e2e-governance-guardrails',
      'e2e-governance-observability',
      'e2e-governance-sdk-preflight-closures',
      'e2e-governance-sessions',
      'e2e-governance-trust',
      'e2e-governance-violations',
    ]);
    expect(governanceDomains.steps.map((step) => step.env?.OPENBOX_E2E_DOMAIN)).toEqual([
      'approvals',
      'audit-logs',
      'behavior-rules',
      'goal-alignment',
      'guardrails',
      'observability',
      'sdk-preflight-closures',
      'sessions',
      'trust',
      'violations',
    ]);
    const governanceFaults = fixture.testSuites.suites.find(
      (suite) => suite.id === 'e2e-governance-faults',
    );
    if (!governanceFaults || !isParallelGroup(governanceFaults)) {
      throw new Error('e2e-governance-faults must be a parallel group');
    }
    expect(governanceFaults.steps.map((step) => step.id)).toEqual([
      'isolated-opa-unavailable',
      'isolated-guardrail-unavailable',
      'isolated-age-unavailable',
    ]);
  });

  test('declares independently runnable local-stack governance proof lanes', () => {
    const fixture = readSdkTargetsFixture();
    const lanes = fixture.localStackProofLanes.lanes;
    const suiteIds = new Set(flattenPipelineSteps(fixture.testSuites.suites).map((step) => step.id));

    expect(fixture.localStackProofLanes.policy).toContain('independently runnable');
    expect(fixture.localStackProofLanes.policy).toContain('must not stop shared local services');
    expect(lanes.map((lane) => lane.id)).toEqual([
      'sdk-direct-governance',
      'approvals-governance',
      'audit-logs-governance',
      'behavior-rules-governance',
      'goal-alignment-governance',
      'guardrails-pii-governance',
      'observability-governance',
      'sessions-governance',
      'trust-age-governance',
      'violations-governance',
      'opa-rego-governance',
      'request-query-boundaries-governance',
      'claude-code-host-governance',
      'claude-code-stdin-governance',
      'codex-governance',
      'cursor-governance',
      'mcp-protocol-governance',
      'openai-agents-sdk-governance',
      'anthropic-agent-sdk-governance',
      'copilotkit-governance',
      'n8n-governance',
      'kms-signing-governance',
      'llamafirewall-governance',
      'isolated-opa-unavailable',
      'isolated-guardrail-unavailable',
      'isolated-age-unavailable',
      'platform-local-stack-e2e',
    ]);
    expect(new Set(lanes.map((lane) => lane.id)).size).toBe(lanes.length);

    for (const lane of lanes) {
      expect(suiteIds.has(lane.suiteId), `${lane.id} suite ${lane.suiteId}`).toBe(true);
      expect(lane.command).toBe(`npm run local-stack:lane -- ${lane.id}`);
      expect(typeof lane.parallelSafe).toBe('boolean');
      expect(typeof lane.localStackRequired).toBe('boolean');
      expect(lane.isolation.length).toBeGreaterThan(3);
      expect(lane.proofFiles.length, lane.id).toBeGreaterThan(0);
      for (const proofFile of lane.proofFiles) {
        expect(existsSync(resolve(process.cwd(), proofFile)), `${lane.id} proof ${proofFile}`).toBe(true);
      }
      if (lane.localStackRequired) {
        expect(lane.requiredEnv, lane.id).toEqual(
          expect.arrayContaining([
            'OPENBOX_API_URL',
            'OPENBOX_CORE_URL',
            'OPENBOX_BACKEND_API_KEY',
          ]),
        );
      } else {
        expect(lane.requiredEnv, lane.id).toEqual([]);
      }
      expect(Object.values(lane.coverage).every(Array.isArray), lane.id).toBe(true);
    }

    const coveredAreas = new Set(lanes.flatMap((lane) => lane.coverage.checklistAreas));
    expect([...coveredAreas].sort()).toEqual(
      expect.arrayContaining([
        'SDK Direct Governance',
        'Claude Code Governance',
        'Codex Governance',
        'Cursor Governance',
        'MCP Protocol Governance',
        'OpenAI Agent SDK Governance',
        'Anthropic Agent SDK Governance',
        'CopilotKit Governance',
        'n8n Governance',
      ]),
    );

    const providers = new Set(lanes.flatMap((lane) => lane.coverage.providers));
    expect([...providers].sort()).toEqual(
      expect.arrayContaining([
        'anthropic-agent-sdk',
        'claude-code',
        'codex',
        'copilotkit',
        'cursor',
        'mcp',
        'n8n',
        'openai-agents-sdk',
      ]),
    );

    const domains = new Set(lanes.flatMap((lane) => lane.coverage.domains));
    expect([...domains].sort()).toEqual(
      expect.arrayContaining([
        'age',
        'approvals',
        'audit-logs',
        'backend/core',
        'behavior-rules',
        'goal-alignment',
        'guardrails',
        'kms',
        'observability',
        'opa',
        'platform',
        'rego',
        'request-query-boundaries',
        'sessions',
        'trust',
        'violations',
      ]),
    );

    const subsystems = new Set(lanes.flatMap((lane) => lane.coverage.subsystems));
    expect([...subsystems].sort()).toEqual(
      expect.arrayContaining([
        'AGE',
        'KMS/local signing/attestation',
        'LlamaFirewall',
        'OPA/Rego policy',
        'PII/redaction',
        'approval/HITL',
        'audit logs',
        'behavior rules',
        'cost',
        'fail closed',
        'fault handling',
        'goal alignment',
        'guardrails',
        'hooks',
        'mcp',
        'session state',
        'tool',
        'tracing/spans',
        'usage',
      ]),
    );
  });

  test('declares bundle build stages outside package scripts', () => {
    const fixture = readSdkTargetsFixture();
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts['build:bundle']).toBe('node scripts/run-bundle-build.mjs');
    expect(fixture.bundleBuild.steps).toEqual([
      {
        id: 'tsup',
        label: 'TypeScript bundle',
        command: 'npx',
        args: ['tsup'],
        workingDirectory: '.',
      },
      {
        id: 'runtime-assets',
        label: 'Runtime asset sync',
        command: 'node',
        args: ['--experimental-strip-types', 'scripts/sync-runtime-assets.ts'],
        workingDirectory: '.',
      },
    ]);
  });

  test('declares quality commands outside package scripts', () => {
    const fixture = readSdkTargetsFixture();
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.lint).toBe('node scripts/run-quality.mjs lint');
    expect(packageJson.scripts.format).toBe('node scripts/run-quality.mjs format');
    expect(fixture.qualityCommands.commands).toEqual([
      {
        id: 'lint',
        label: 'Root TypeScript lint',
        command: 'npx',
        args: ['eslint', 'ts/src'],
        workingDirectory: '.',
      },
      {
        id: 'format',
        label: 'Root TypeScript format',
        command: 'npx',
        args: ['prettier', '--write', 'ts/src'],
        workingDirectory: '.',
      },
    ]);
  });

  test('declares generated checks outside package scripts', () => {
    const fixture = readSdkTargetsFixture();
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts['check:generated-drift']).toBe(
      'node scripts/run-generated-check.mjs drift',
    );
    expect(packageJson.scripts['lint:generated-banners']).toBe(
      'node scripts/run-generated-check.mjs banners',
    );
    expect(fixture.generatedChecks.commands).toEqual([
      {
        id: 'drift',
        label: 'Generated drift',
        command: 'node',
        args: ['--experimental-strip-types', 'scripts/check-generated-drift.ts'],
        workingDirectory: '.',
      },
      {
        id: 'banners',
        label: 'Generated banners',
        command: 'node',
        args: ['--experimental-strip-types', 'scripts/check-generated-banners.ts'],
        workingDirectory: '.',
      },
    ]);
  });

  test('declares root clean artifacts without package-script path lists', () => {
    const fixture = readSdkTargetsFixture();

    expect(fixture.cleanArtifacts.paths).toEqual([
      'dist',
      'dist-pack',
      'apps/extension/dist',
      '.coverage',
      '.openbox/cache',
      '.openbox/locks',
    ]);
    expect(fixture.cleanArtifacts.nestedNames).toEqual([
      { root: 'codegen', names: ['dist', 'tsconfig.tsbuildinfo'] },
    ]);
    expect(fixture.cleanArtifacts.filePatterns).toEqual([
      { root: 'apps/extension', prefix: 'openbox-', suffix: '.vsix' },
    ]);
  });

  test('declares the root package export surface', () => {
    const fixture = readSdkTargetsFixture();
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      name: string;
      bin: Record<string, string>;
      files: string[];
      exports: Record<string, { types: string; import: string }>;
    };
    const expectedExports = Object.fromEntries(
      fixture.packageSurface.exports.map((entry) => [
        entry.subpath,
        { types: entry.types, import: entry.importPath },
      ]),
    );

    expect(packageJson.name).toBe(fixture.packageSurface.packageName);
    expect(packageJson.bin).toEqual(
      Object.fromEntries(fixture.packageSurface.bin.map((entry) => [entry.name, entry.path])),
    );
    expect(packageJson.files).toEqual(fixture.packageSurface.files);
    expect(packageJson.exports).toEqual(expectedExports);
    expect(fixture.packageSurface.exports.map((entry) => entry.subpath)).toEqual(
      expect.arrayContaining([
        './openai-agents-sdk',
        './anthropic-agent-sdk',
        './copilotkit',
        './runtime/n8n',
      ]),
    );
  });

  test('declares every root package script as a spec-owned router or explicit alias', () => {
    const fixture = readSdkTargetsFixture();
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      scripts: Record<string, string>;
    };
    const expectedScripts = Object.fromEntries(
      fixture.packageScripts.scripts.map((script) => [script.name, script.command]),
    );

    expect(packageJson.scripts).toEqual(expectedScripts);
    expect(
      fixture.packageScripts.scripts.every((script) =>
        ['spec-runner', 'lifecycle-alias', 'compatibility-alias'].includes(script.kind),
      ),
    ).toBe(true);
    expect(
      fixture.packageScripts.scripts
        .filter((script) => script.kind === 'lifecycle-alias')
        .map((script) => script.name),
    ).toEqual(['prepublishOnly']);
    expect(
      fixture.packageScripts.scripts
        .filter((script) => script.kind === 'compatibility-alias')
        .map((script) => script.name),
    ).toEqual(['specs:all']);
    expect(Object.keys(packageJson.scripts)).toEqual(
      expect.arrayContaining([
        'guardrails:hub:provenance',
        'guardrails:hub:record',
        'guardrails:hub:replay',
        'local:fe',
        'local:llamafirewall',
        'local-stack:lane',
      ]),
    );
    expect(
      Object.keys(packageJson.scripts).filter((script) =>
        /:(python|py|typescript|ts|js)$/.test(script),
      ),
    ).toEqual([]);
  });

  test('declares every repository script in the TypeSpec-emitted script inventory', () => {
    const fixture = readSdkTargetsFixture();
    const scriptPaths = listFilesRecursive('scripts').sort();
    const inventory = fixture.scriptInventory.entries;
    const inventoryPaths = inventory.map((entry) => entry.path).sort();

    expect(inventoryPaths).toEqual(scriptPaths);
    expect(new Set(inventoryPaths).size).toBe(inventoryPaths.length);
    for (const entry of inventory) {
      expect(entry.category.length).toBeGreaterThan(3);
      expect(entry.canonicalSurface.length).toBeGreaterThan(3);
      expect(entry.role.length).toBeGreaterThan(40);
    }

    expect(inventory.find((entry) => entry.path === 'scripts/spec-drift.ts')).toMatchObject({
      category: 'service-drift',
      canonicalSurface: 'serviceDrift',
    });
    expect(inventory.find((entry) => entry.path === 'scripts/openbox-cli-dev.mjs')).toMatchObject({
      category: 'developer-launcher',
    });
    expect(
      inventory.find((entry) => entry.path === 'scripts/local-llamafirewall-server.py'),
    ).toMatchObject({
      category: 'local-stack-adapter',
    });
    expect(
      inventory.find((entry) => entry.path === 'scripts/start-llamafirewall.mjs'),
    ).toMatchObject({
      category: 'local-stack-launcher',
    });
    expect(inventory.find((entry) => entry.path === 'scripts/start-local-fe.mjs')).toMatchObject({
      category: 'local-stack-launcher',
      canonicalSurface: 'packageScripts.scripts',
    });
    expect(
      inventory.find((entry) => entry.path === 'scripts/run-local-stack-lane.mjs'),
    ).toMatchObject({
      category: 'spec-runner',
      canonicalSurface: 'localStackProofLanes.lanes',
    });
    expect(inventory.find((entry) => entry.path === 'scripts/lib/spec-steps.mjs')).toMatchObject({
      category: 'runner-framework',
      canonicalSurface: 'codegen/fixtures/sdk-targets.json',
    });
  });

  test('declares security audit commands and annotated secret-scan excludes', () => {
    const fixture = readSdkTargetsFixture();

    expect(fixture.securityAudit.commands).toEqual([
      {
        id: 'root-npm-audit',
        label: 'root npm audit',
        command: 'npm',
        args: ['audit'],
        workingDirectory: '.',
      },
      {
        id: 'n8n-npm-audit',
        label: 'n8n npm audit',
        command: 'npm',
        args: ['audit'],
        workingDirectory: 'example/n8n/custom-node',
      },
    ]);
    expect(fixture.securityAudit.secretScanExcludes.map((entry) => entry.path)).toEqual(
      expect.arrayContaining([
        'codegen/fixtures/cli-auth.json',
        'codegen/fixtures/env-resolution.json',
        'specs/typespec/cli/main.tsp',
        'specs/typespec/env/main.tsp',
      ]),
    );
    expect(fixture.securityAudit.secretScanExcludes.every((entry) => entry.reason.length > 20)).toBe(true);
  });

  test('declares local CI as a target-neutral pipeline', () => {
    const fixture = readSdkTargetsFixture();

    expect(fixture.localCi.steps.map((step) => step.id)).toEqual([
      'generated-drift',
      'check-sdks',
      'host-integration-lanes',
      'coverage',
      'build',
      'post-build-quality',
    ]);
    const hostIntegration = fixture.localCi.steps.find((step) => step.id === 'host-integration-lanes');
    if (!hostIntegration || !isParallelGroup(hostIntegration)) {
      throw new Error('host-integration-lanes must be a parallel group');
    }
    expect(hostIntegration.steps.map((step) => step.id)).toEqual([
      'hook-install',
      'hook-runtime',
      'mcp-protocol',
    ]);
    const postBuild = fixture.localCi.steps.find((step) => step.id === 'post-build-quality');
    if (!postBuild || !isParallelGroup(postBuild)) {
      throw new Error('post-build-quality must be a parallel group');
    }
    expect(postBuild.steps.map((step) => step.id)).toEqual([
      'generated-banners',
      'openapi-lint',
      'npm-audit',
      'security-audit',
    ]);
    const coverage = fixture.localCi.steps.find((step) => step.id === 'coverage');
    if (!isCommandStep(coverage)) throw new Error('coverage must be a command step');
    expect(coverage.env).toEqual({
      OPENBOX_CLI: './scripts/openbox-cli-dev.mjs',
    });
    expect(coverage.args).toEqual([
      'vitest',
      'run',
      '--coverage',
      '--project',
      'unit',
      '--project',
      'openapi-mock',
      '--project',
      'contract',
      '--coverage.reporter=lcov',
    ]);
    const build = fixture.localCi.steps.find((step) => step.id === 'build');
    if (!isCommandStep(build)) throw new Error('build must be a command step');
    expect(build.env).toEqual({
      NODE_OPTIONS: '--max-old-space-size=4096',
    });
    expect(
      fixture.localCi.steps.every((step) =>
        isParallelGroup(step)
          ? step.steps.every((child) => child.workingDirectory === '.')
          : step.workingDirectory === '.',
      ),
    ).toBe(true);
  });

  test('keeps root validation generic while target commands remain native', () => {
    const fixture = readSdkTargetsFixture();
    const byTarget = Object.fromEntries(fixture.targets.map((target) => [target.id, target]));

    expect(byTarget.typescript?.workingDirectory).toBe('.');
    expect(byTarget.typescript?.commands.map((command) => command.command)).toEqual([
      'npm',
      'npx',
      'npm',
    ]);
    expect(byTarget.typescript?.commands.at(-1)?.env).toEqual({
      OPENBOX_CLI: './scripts/openbox-cli-dev.mjs',
    });

    expect(byTarget.python?.workingDirectory).toBe('python');
    expect(byTarget.python?.commands.map((command) => command.command)).toEqual([
      'uv',
      'uv',
      'uv',
      'uv',
    ]);

    expect(byTarget.extension?.workingDirectory).toBe('apps/extension');
    expect(byTarget.extension?.commands).toEqual([
      { command: 'npm', args: ['run', 'build'] },
      { command: 'npm', args: ['run', 'test'] },
    ]);

    expect(byTarget['n8n-custom-node']?.workingDirectory).toBe('example/n8n/custom-node');
    expect(byTarget['n8n-custom-node']?.commands).toEqual([
      { command: 'npm', args: ['ci', '--ignore-scripts'] },
      { command: 'npm', args: ['run', 'build'] },
      { command: 'npm', args: ['run', 'smoke:load'] },
    ]);
  });
});
