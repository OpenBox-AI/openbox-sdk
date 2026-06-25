// Smoke test: compile the project's TypeSpec sources end-to-end and
// assert that every custom decorator we ship attaches the state it
// claims to. If the decorator wiring breaks (state-key drift,
// mis-registered namespace, missing tsp-index re-export), this test
// catches it without needing every target emitter to be in place.

import { compile, NodeHost, resolvePath } from '@typespec/compiler';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, expect, test, beforeAll } from 'vitest';

import type { Program, Model, Interface, Operation, ModelProperty } from '@typespec/compiler';

let program: Program;
let getEnvVar: typeof import('../../codegen/typespec-libs/typespec-env/src/decorators.ts').getEnvVar;
let getTokenFormat: typeof import('../../codegen/typespec-libs/typespec-env/src/decorators.ts').getTokenFormat;
let isOsPath: typeof import('../../codegen/typespec-libs/typespec-env/src/decorators.ts').isOsPath;
let getEnvConformance: typeof import('../../codegen/typespec-libs/typespec-env/src/decorators.ts').getEnvConformance;
let $cli_command: typeof import('../../codegen/typespec-libs/typespec-cli/src/decorators.ts').$cli_command;
let $cli_validator: typeof import('../../codegen/typespec-libs/typespec-cli/src/decorators.ts').$cli_validator;
let getCommand: typeof import('../../codegen/typespec-libs/typespec-cli/src/decorators.ts').getCommand;
let getFlag: typeof import('../../codegen/typespec-libs/typespec-cli/src/decorators.ts').getFlag;
let getValidator: typeof import('../../codegen/typespec-libs/typespec-cli/src/decorators.ts').getValidator;
let getCliConformance: typeof import('../../codegen/typespec-libs/typespec-cli/src/decorators.ts').getCliConformance;
let getMapsTo: typeof import('../../codegen/typespec-libs/typespec-workflow/src/decorators.ts').getMapsTo;
let getPreset: typeof import('../../codegen/typespec-libs/typespec-workflow/src/decorators.ts').getPreset;
let getVerdictModel: typeof import('../../codegen/typespec-libs/typespec-workflow/src/decorators.ts').getVerdictModel;
let getGovernProtocol: typeof import('../../codegen/typespec-libs/typespec-workflow/src/decorators.ts').getGovernProtocol;
let getSdkTargets: typeof import('../../codegen/typespec-libs/typespec-workflow/src/decorators.ts').getSdkTargets;

beforeAll(async () => {
  const root = resolvePath(import.meta.dirname, '..', '..');
  ensureTypeSpecLibsBuilt(root);
  const envDecorators = await import(
    '../../codegen/typespec-libs/typespec-env/dist/decorators.js'
  );
  const cliDecorators = await import(
    '../../codegen/typespec-libs/typespec-cli/dist/decorators.js'
  );
  const workflowDecorators = await import(
    '../../codegen/typespec-libs/typespec-workflow/dist/decorators.js'
  );
  ({ getEnvVar, getTokenFormat, isOsPath, getEnvConformance } = envDecorators);
  ({
    $cli_command,
    $cli_validator,
    getCommand,
    getFlag,
    getValidator,
    getCliConformance,
  } = cliDecorators);
  ({ getMapsTo, getPreset, getVerdictModel, getGovernProtocol, getSdkTargets } = workflowDecorators);
  const main = resolvePath(root, 'specs', 'typespec', 'main.tsp');
  program = await compile(NodeHost, main, {
    noEmit: true,
  });
  // Surface compile failures up-front; otherwise the per-test asserts
  // would all just fail with "model not found" without explaining why.
  const fatals = program.diagnostics.filter((d) => d.severity === 'error');
  if (fatals.length > 0) {
    const summary = fatals
      .map((d) => `${(d.target as { file?: { path?: string } })?.file?.path ?? '?'}: ${d.code}`)
      .slice(0, 5)
      .join('\n');
    throw new Error(`TypeSpec compile produced errors:\n${summary}`);
  }
}, 60_000);

function ensureTypeSpecLibsBuilt(root: string): void {
  const libs = ['typespec-env', 'typespec-cli', 'typespec-workflow'];
  const tsc = resolvePath(root, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!existsSync(tsc)) {
    throw new Error(`TypeScript compiler not found at ${tsc}`);
  }
  for (const lib of libs) {
    const libRoot = resolvePath(root, 'codegen', 'typespec-libs', lib);
    const distIndex = resolvePath(libRoot, 'dist', 'index.js');
    if (existsSync(distIndex)) continue;
    try {
      execFileSync(process.execPath, [tsc, '-p', libRoot], {
        cwd: root,
        stdio: 'pipe',
      });
    } catch (error) {
      const stderr = Buffer.isBuffer((error as { stderr?: unknown }).stderr)
        ? ((error as { stderr: Buffer }).stderr).toString('utf-8')
        : '';
      const stdout = Buffer.isBuffer((error as { stdout?: unknown }).stdout)
        ? ((error as { stdout: Buffer }).stdout).toString('utf-8')
        : '';
      throw new Error(
        `Failed to build local TypeSpec library ${lib} before compile:\n${stdout}${stderr}`,
      );
    }
  }
}

function findModel(name: string): Model {
  for (const ns of walkNamespaces(program)) {
    const m = ns.models.get(name);
    if (m) return m;
  }
  throw new Error(`model not found: ${name}`);
}

function findInterface(name: string): Interface {
  for (const ns of walkNamespaces(program)) {
    const i = ns.interfaces.get(name);
    if (i) return i;
  }
  throw new Error(`interface not found: ${name}`);
}

function* walkNamespaces(p: Program) {
  const stack = [p.getGlobalNamespaceType()];
  while (stack.length) {
    const ns = stack.pop()!;
    yield ns;
    for (const sub of ns.namespaces.values()) stack.push(sub);
  }
}

function prop(model: Model, name: string): ModelProperty {
  const p = model.properties.get(name);
  if (!p) throw new Error(`${model.name} has no property ${name}`);
  return p;
}

function activityOp(iface: Interface, name: string): Operation {
  const op = iface.operations.get(name);
  if (!op) throw new Error(`${iface.name} has no operation ${name}`);
  return op;
}

function createStateOnlyProgram(): Program {
  const maps = new Map<unknown, Map<object, unknown>>();
  return {
    stateMap(key: unknown) {
      let map = maps.get(key);
      if (!map) {
        map = new Map<object, unknown>();
        maps.set(key, map);
      }
      return map;
    },
  } as unknown as Program;
}

describe('typespec-env', () => {
  test('@env_var attaches name + default', () => {
    const config = findModel('RuntimeConfig');
    expect(getEnvVar(program, prop(config, 'apiUrl'))?.name).toBe('OPENBOX_API_URL');
    expect(getEnvVar(program, prop(config, 'coreUrl'))?.name).toBe('OPENBOX_CORE_URL');
    expect(getEnvVar(program, prop(config, 'platformUrl'))?.name).toBe('OPENBOX_PLATFORM_URL');
    expect(getEnvVar(program, prop(config, 'authUrl'))?.name).toBe('OPENBOX_AUTH_URL');
  });

  test('@token_format attaches the regex literally', () => {
    const creds = findModel('Credentials');
    expect(getTokenFormat(program, prop(creds, 'apiKey'))).toBe(
      '^obx_(?:live|test)_[0-9a-f]{48}$',
    );

    const variant = findModel('ClientVariant');
    expect(getTokenFormat(program, prop(variant, 'value'))).toBe('^[A-Za-z0-9._+-]+$');
  });

  test('@os_path is a flag', () => {
    const creds = findModel('Credentials');
    expect(isOsPath(program, prop(creds, 'path'))).toBe(true);
    expect(isOsPath(program, prop(creds, 'apiKey'))).toBe(false);
  });

  test('@env_conformance attaches the shared env-resolution fixture', () => {
    const env = [...walkNamespaces(program)].find((ns) => ns.name === 'OpenboxEnv');
    expect(env).toBeDefined();
    const fixture = getEnvConformance(program, env!);
    expect(fixture?.name).toBe('env-resolution');
    expect((fixture?.cases as unknown[] | undefined)?.length).toBe(5);
  });
});

describe('typespec-cli', () => {
  test('@cli_command attaches name + description', () => {
    const program = createStateOnlyProgram();
    const auth = { name: 'Auth' } as Interface;
    $cli_command({ program } as never, auth, 'auth', 'Set the OpenBox X-API-Key');
    const c = getCommand(program, auth);
    expect(c?.name).toBe('auth');
    expect(c?.description).toMatch(/X-API-Key/);
  });

  test('@cli_validator attaches the named validator to the API-key field', () => {
    const program = createStateOnlyProgram();
    const apiKey = { name: 'apiKey' } as ModelProperty;
    $cli_validator({ program } as never, apiKey, 'validateApiKeyFormat');
    expect(getValidator(program, apiKey)).toBe('validateApiKeyFormat');
  });

  test('@cli_conformance attaches the shared auth fixture', () => {
    const cli = [...walkNamespaces(program)].find((ns) => ns.name === 'OpenboxCli');
    expect(cli).toBeDefined();
    const fixture = getCliConformance(program, cli!);
    expect(fixture?.name).toBe('cli-auth');
    expect((fixture?.cases as unknown[] | undefined)?.length).toBe(6);
  });
});

describe('typespec-workflow', () => {
  test('@preset captures the lowercase-hyphen name', () => {
    const claudeCode = findInterface('ClaudeCodePreset');
    expect(getPreset(program, claudeCode)?.name).toBe('claude-code');

    const langchain = findInterface('LangChainPreset');
    expect(getPreset(program, langchain)?.name).toBe('langchain');

    const custom = findInterface('CustomPreset');
    expect(getPreset(program, custom)?.name).toBe('custom');
  });

  test('@maps_to captures eventType + activityType', () => {
    const claudeCode = findInterface('ClaudeCodePreset');
    const preTool = getMapsTo(program, activityOp(claudeCode, 'preToolUse'));
    expect(preTool?.eventType).toBe('ActivityStarted');
    expect(preTool?.activityType).toBe('PreToolUse');

    const postTool = getMapsTo(program, activityOp(claudeCode, 'postToolUse'));
    expect(postTool?.eventType).toBe('ActivityCompleted');
    expect(postTool?.activityType).toBe('PostToolUse');
  });

  test('@maps_to on SignalReceived (LangGraph interrupt)', () => {
    const langgraph = findInterface('LangGraphPreset');
    const interrupt = getMapsTo(program, activityOp(langgraph, 'interrupt'));
    expect(interrupt?.eventType).toBe('SignalReceived');
    expect(interrupt?.activityType).toBe('interrupt');
  });

  test('CustomPreset has the free-form `activity` operation but no @maps_to', () => {
    const custom = findInterface('CustomPreset');
    const op = activityOp(custom, 'activity');
    expect(getMapsTo(program, op)).toBeUndefined();
  });

  test('@verdict singleton resolves', () => {
    const verdict = getVerdictModel(program);
    expect(verdict?.name).toBe('WorkflowVerdict');
  });

  test('@governProtocol attaches the shared lifecycle fixture', () => {
    const govern = [...walkNamespaces(program)].find((ns) => ns.name === 'OpenboxGovern');
    expect(govern).toBeDefined();
    const fixture = getGovernProtocol(program, govern!);
    expect(fixture?.name).toBe('govern-protocol');
    expect((fixture?.cases as unknown[] | undefined)?.length).toBe(3);
  });

  test('@sdkTargets attaches the shared SDK validation manifest', () => {
    const sdk = [...walkNamespaces(program)].find((ns) => ns.name === 'OpenboxSdk');
    expect(sdk).toBeDefined();
    const fixture = getSdkTargets(program, sdk!);
    const cleanArtifacts =
      fixture?.cleanArtifacts as
        | {
            paths: string[];
            nestedNames: Array<{ root: string; names: string[] }>;
            filePatterns: Array<{ root: string; prefix: string; suffix: string }>;
          }
        | undefined;
    const generatedArtifacts =
      fixture?.generatedArtifacts as
        | {
            generatedRoots: string[];
            generatedFiles: string[];
            driftCheckFiles?: string[];
            nestedGeneratedFiles: Array<{ root: string; suffixes: string[] }>;
          }
        | undefined;
    const packageSurface =
      fixture?.packageSurface as
        | {
            packageName: string;
            bin: Array<{ name: string; path: string }>;
            files: string[];
            exports: Array<{ subpath: string; types: string; importPath: string }>;
          }
        | undefined;
    const codegenBuild =
      fixture?.codegenBuild as
        | {
            steps: Array<{ id: string; command: string; workingDirectory: string }>;
          }
        | undefined;
    const sdkGeneration =
      fixture?.sdkGeneration as
        | {
            steps: Array<{ id: string; command: string; workingDirectory: string }>;
          }
        | undefined;
    const specCommands =
      fixture?.specCommands as
        | {
            commands: Array<{ id: string; command: string; workingDirectory: string }>;
          }
        | undefined;
    const rootPipelines =
      fixture?.rootPipelines as
        | {
            pipelines: Array<{
              id: string;
              steps: Array<{
                id: string;
                command?: string;
                args?: string[];
                workingDirectory?: string;
                steps?: Array<{ id: string; command: string; args?: string[]; workingDirectory: string }>;
              }>;
            }>;
          }
        | undefined;
    const testSuites =
      fixture?.testSuites as
        | {
            defaultSuites: string[];
            suites: Array<{
              id: string;
              command?: string;
              workingDirectory?: string;
              steps?: Array<{ id: string; command: string; workingDirectory: string }>;
            }>;
          }
        | undefined;
    const bundleBuild =
      fixture?.bundleBuild as
        | {
            steps: Array<{ id: string; command: string; workingDirectory: string }>;
          }
        | undefined;
    const qualityCommands =
      fixture?.qualityCommands as
        | {
            commands: Array<{ id: string; command: string; workingDirectory: string }>;
          }
        | undefined;
    const generatedChecks =
      fixture?.generatedChecks as
        | {
            commands: Array<{ id: string; command: string; workingDirectory: string }>;
          }
        | undefined;
    const securityAudit =
      fixture?.securityAudit as
        | {
            commands: Array<{ id: string; command: string; workingDirectory: string }>;
            secretScanExcludes: Array<{ path: string; reason: string }>;
          }
        | undefined;
    const localCi =
      fixture?.localCi as
        | {
            steps: Array<{
              id: string;
              command?: string;
              workingDirectory?: string;
              env?: Record<string, string>;
              steps?: Array<{ id: string; command: string; workingDirectory: string }>;
            }>;
          }
        | undefined;
    const targets =
      fixture?.targets as
        | Array<{
            id: string;
            kind?: string;
            commands: unknown[];
            extensionManifest?: {
              packageName: string;
              metadata?: {
                license?: string;
                engines?: { vscode?: string };
              };
              activationEvents: string[];
              views: string[];
              commands: string[];
              configurationKeys: string[];
            };
          }>
        | undefined;
    expect(targets?.map((target) => target.id)).toEqual([
      'typescript',
      'python',
      'extension',
      'n8n-custom-node',
    ]);
    expect(targets?.map((target) => target.kind)).toEqual(['sdk', 'sdk', 'app', 'app']);
    expect(targets?.every((target) => target.commands.length > 0)).toBe(true);
    const extension = targets?.find((target) => target.id === 'extension');
    expect(extension?.extensionManifest?.packageName).toBe('openbox');
    expect(extension?.extensionManifest?.metadata?.license).toBe('MIT');
    expect(extension?.extensionManifest?.metadata?.engines?.vscode).toBe('^1.85.0');
    expect(extension?.extensionManifest?.activationEvents).toContain('onStartupFinished');
    expect(extension?.extensionManifest?.views).toContain('openbox.approvals');
    expect(extension?.extensionManifest?.commands).toContain('openbox.approve');
    expect(extension?.extensionManifest?.configurationKeys).toContain('openbox.agentId');
    expect(generatedArtifacts?.generatedFiles).toContain('codegen/fixtures/sdk-targets.json');
    expect(generatedArtifacts?.driftCheckFiles).toEqual(['package.json']);
    expect(generatedArtifacts?.nestedGeneratedFiles).toEqual([{ root: 'ts/src', suffixes: ['.ts', '.d.ts'] }]);
    expect(cleanArtifacts?.paths).toEqual([
      'dist',
      'dist-pack',
      'apps/extension/dist',
      '.coverage',
      '.openbox/cache',
      '.openbox/locks',
    ]);
    expect(cleanArtifacts?.nestedNames).toEqual([
      { root: 'codegen', names: ['dist', 'tsconfig.tsbuildinfo'] },
    ]);
    expect(cleanArtifacts?.filePatterns).toEqual([
      { root: 'apps/extension', prefix: 'openbox-', suffix: '.vsix' },
    ]);
    expect(packageSurface?.packageName).toBe('@openbox-ai/openbox-sdk');
    expect(packageSurface?.bin).toEqual([{ name: 'openbox', path: './dist/cli/index.js' }]);
    expect(packageSurface?.files).toEqual(['dist', 'skill']);
    expect(packageSurface?.exports.map((entry) => entry.subpath)).toEqual(
      expect.arrayContaining(['.', './runtime/n8n', './openai-agents-sdk']),
    );
    expect(codegenBuild?.steps.map((entry) => entry.id)).toEqual([
      'typespec-env',
      'typespec-cli',
      'typespec-workflow',
      'typespec-emitter',
    ]);
    expect(codegenBuild?.steps.every((entry) => entry.command === 'npm')).toBe(true);
    expect(sdkGeneration?.steps.map((entry) => entry.id)).toEqual([
      'build-codegen',
      'specs-compile',
      'sync-package-scripts',
      'write-governance-checklist',
    ]);
    expect(sdkGeneration?.steps.map((entry) => entry.command)).toEqual([
      'npm',
      'npm',
      'node',
      'node',
    ]);
    expect(specCommands?.commands.map((entry) => entry.id)).toEqual(['compile', 'watch']);
    expect(specCommands?.commands.every((entry) => entry.command === 'npx')).toBe(true);
    expect(rootPipelines?.pipelines.map((entry) => entry.id)).toEqual(['build', 'check-sdks', 'local-stack']);
    expect(rootPipelines?.pipelines.find((entry) => entry.id === 'build')?.steps.map((entry) => entry.id)).toEqual([
      'generate-sdks',
      'bundle-build',
    ]);
    expect(rootPipelines?.pipelines.find((entry) => entry.id === 'local-stack')?.steps.map((entry) => entry.id)).toEqual([
      'ci-local',
      'live-provider-governance-lanes',
      'live-domain-governance-lanes',
      'isolated-unavailable-lanes',
      'live-platform-e2e',
    ]);
    expect(
      rootPipelines?.pipelines
        .find((entry) => entry.id === 'local-stack')
        ?.steps.find((entry) => entry.id === 'live-provider-governance-lanes')?.args,
    ).toEqual([
      'run',
      'local-stack:lane',
      '--',
      'claude-code-host-governance',
      'claude-code-stdin-governance',
      'codex-governance',
      'cursor-governance',
      'openai-agents-sdk-governance',
      'anthropic-agent-sdk-governance',
      'copilotkit-governance',
      'n8n-governance',
      'kms-signing-governance',
      'llamafirewall-governance',
    ]);
    expect(
      rootPipelines?.pipelines
        .find((entry) => entry.id === 'local-stack')
        ?.steps.find((entry) => entry.id === 'live-domain-governance-lanes')?.args,
    ).toEqual([
      'run',
      'local-stack:lane',
      '--',
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
    ]);
    expect(
      rootPipelines?.pipelines
        .find((entry) => entry.id === 'local-stack')
        ?.steps.find((entry) => entry.id === 'isolated-unavailable-lanes')?.args,
    ).toEqual([
      'run',
      'local-stack:lane',
      '--',
      'isolated-opa-unavailable',
      'isolated-guardrail-unavailable',
      'isolated-age-unavailable',
    ]);
    expect(testSuites?.defaultSuites).toEqual([
      'unit',
      'openapi-mock',
      'contract',
    ]);
    expect(testSuites?.suites.map((entry) => entry.id)).toEqual([
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
    expect(testSuites?.suites.map((entry) => (entry.steps ? 'parallel' : entry.command))).toEqual([
      'npx',
      'npx',
      'npx',
      'npx',
      'npx',
      'npx',
      'npx',
      'node',
      'npx',
      'npx',
      'npx',
      'npx',
      'npx',
      'npx',
      'npx',
      'npx',
      'npx',
      'npx',
      'npx',
      'npx',
      'npx',
      'npx',
      'npm',
      'npx',
      'npm',
      'parallel',
      'npx',
      'npx',
      'npx',
      'parallel',
      'npx',
      'npx',
    ]);
    expect(bundleBuild?.steps.map((entry) => entry.id)).toEqual(['tsup', 'runtime-assets']);
    expect(bundleBuild?.steps.map((entry) => entry.command)).toEqual(['npx', 'node']);
    expect(qualityCommands?.commands.map((entry) => entry.id)).toEqual(['lint', 'format']);
    expect(qualityCommands?.commands.every((entry) => entry.command === 'npx')).toBe(true);
    expect(generatedChecks?.commands.map((entry) => entry.id)).toEqual(['drift', 'banners']);
    expect(generatedChecks?.commands.every((entry) => entry.command === 'node')).toBe(true);
    expect(securityAudit?.commands.map((entry) => entry.id)).toEqual([
      'root-npm-audit',
      'n8n-npm-audit',
    ]);
    expect(securityAudit?.commands.map((entry) => entry.workingDirectory)).toEqual([
      '.',
      'example/n8n/custom-node',
    ]);
    expect(securityAudit?.secretScanExcludes.every((entry) => entry.reason.length > 20)).toBe(true);
    expect(localCi?.steps.map((entry) => entry.id)).toEqual([
      'generated-drift',
      'check-sdks',
      'host-integration-lanes',
      'coverage',
      'build',
      'post-build-quality',
    ]);
    expect(
      localCi?.steps.find((entry) => entry.id === 'host-integration-lanes')?.steps?.map((entry) => entry.id),
    ).toEqual(['hook-install', 'hook-runtime', 'mcp-protocol']);
    expect(
      localCi?.steps.find((entry) => entry.id === 'post-build-quality')?.steps?.map((entry) => entry.id),
    ).toEqual(['generated-banners', 'openapi-lint', 'npm-audit', 'security-audit']);
    expect(localCi?.steps.find((entry) => entry.id === 'coverage')?.env?.OPENBOX_CLI).toBe(
      './scripts/openbox-cli-dev.mjs',
    );
  });
});
