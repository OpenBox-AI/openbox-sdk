import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  configureClaudeCodeRuntime,
  installClaudeCodePlugin,
  verifyClaudeCodeInstall,
} from '../../ts/src/runtime/claude-code/index.js';
import {
  configureCodexRuntime,
  installCodex,
  installCodexPlugin,
  verifyCodexInstall,
} from '../../ts/src/runtime/codex/index.js';
import {
  configureCursorRuntime,
  installCursorPlugin,
  verifyCursorInstall,
} from '../../ts/src/runtime/cursor/index.js';
import { DEFAULT_OPENBOX_CORE_URL } from '../../ts/src/runtime/install-runtime-defaults.js';
import { verifyOpenBoxAgentsSDKConfig } from '@openbox-ai/openbox-sdk/openai-agents-sdk';
import { verifyOpenBoxAnthropicAgentSDKConfig } from '@openbox-ai/openbox-sdk/anthropic-agent-sdk';
import { createOpenBoxCopilotKitAdapter } from '@openbox-ai/openbox-sdk/copilotkit';

const temps: string[] = [];
const runtimeEnvKeys = [
  'OPENBOX_API_KEY',
  'OPENBOX_CORE_URL',
  'OPENBOX_AGENT_DID',
  'OPENBOX_AGENT_PRIVATE_KEY',
] as const;
const signedIdentity = {
  did: 'did:aip:550e8400-e29b-41d4-a716-446655440000',
  privateKey: Buffer.alloc(32, 1).toString('base64'),
};

function tempDir(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), label));
  temps.push(dir);
  return dir;
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
}

function readDotenv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    out[key] = JSON.parse(trimmed.slice(eq + 1)) as string;
  }
  return out;
}

function expectRuntimeConfig(
  project: string,
  provider: 'codex' | 'cursor',
  runtimeKey: string,
  coreUrl: string,
  approvalMode: string,
  agentIdentity?: typeof signedIdentity,
): void {
  const env = readDotenv(path.join(project, '.openbox', provider, '.env'));
  expect(env.OPENBOX_API_KEY).toBe(runtimeKey);
  expect(env.OPENBOX_CORE_URL).toBe(coreUrl);
  if (agentIdentity) {
    expect(env.OPENBOX_AGENT_DID).toBe(agentIdentity.did);
    expect(env.OPENBOX_AGENT_PRIVATE_KEY).toBe(agentIdentity.privateKey);
  }

  const config = readJson(path.join(project, '.openbox', provider, 'config.json'));
  expect(config.approvalMode).toBe(approvalMode);
  expect(config.governanceTimeout).toBe('34');
  expect(config.hitlMaxWait).toBe(600);
  expect(config.hitlPollInterval).toBe(2);
  expect(config.OPENBOX_API_KEY).toBeUndefined();
  expect(config.OPENBOX_CORE_URL).toBeUndefined();
  expect(config.OPENBOX_AGENT_DID).toBeUndefined();
  expect(config.OPENBOX_AGENT_PRIVATE_KEY).toBeUndefined();
}

function expectClaudeRuntimeConfig(
  project: string,
  runtimeKey: string,
  coreUrl: string,
  approvalMode: string,
  agentIdentity?: typeof signedIdentity,
): void {
  const settings = readJson(path.join(project, '.claude', 'settings.local.json'));
  const env = settings.env as Record<string, unknown>;
  expect(env.OPENBOX_API_KEY).toBe(runtimeKey);
  expect(env.OPENBOX_CORE_URL).toBe(coreUrl);
  if (agentIdentity) {
    expect(env.OPENBOX_AGENT_DID).toBe(agentIdentity.did);
    expect(env.OPENBOX_AGENT_PRIVATE_KEY).toBe(agentIdentity.privateKey);
  }

  const config = readJson(path.join(project, '.openbox', 'claude-code', 'config.json'));
  expect(config.approvalMode).toBe(approvalMode);
  expect(config.governanceTimeout).toBe('34');
  expect(config.hitlMaxWait).toBe(600);
  expect(config.hitlPollInterval).toBe(2);
  expect(config.OPENBOX_API_KEY).toBeUndefined();
  expect(config.OPENBOX_AGENT_PRIVATE_KEY).toBeUndefined();
}

async function withRuntimeEnvCleared<T>(fn: () => Promise<T> | T): Promise<T> {
  const saved = new Map<string, string | undefined>();
  for (const key of runtimeEnvKeys) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  try {
    return await fn();
  } finally {
    for (const key of runtimeEnvKeys) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('shared OpenBox agent runtime configuration', () => {
  it('fills the production Core URL for lean coding-agent credential installs', () => {
    const runtimeKey = `obx_test_${'0'.repeat(48)}`;
    const claudeProject = tempDir('openbox-lean-core-claude-');
    const codexProject = tempDir('openbox-lean-core-codex-');
    const cursorProject = tempDir('openbox-lean-core-cursor-');

    configureClaudeCodeRuntime({
      cwd: claudeProject,
      apiKey: runtimeKey,
      agentIdentity: signedIdentity,
    });
    configureCodexRuntime({
      cwd: codexProject,
      apiKey: runtimeKey,
      agentIdentity: signedIdentity,
    });
    configureCursorRuntime({
      cwd: cursorProject,
      apiKey: runtimeKey,
      agentIdentity: signedIdentity,
    });

    const claudeEnv = readJson(path.join(claudeProject, '.claude', 'settings.local.json')).env as Record<string, unknown>;
    expect(claudeEnv).toMatchObject({
      OPENBOX_API_KEY: runtimeKey,
      OPENBOX_CORE_URL: DEFAULT_OPENBOX_CORE_URL,
      OPENBOX_AGENT_DID: signedIdentity.did,
      OPENBOX_AGENT_PRIVATE_KEY: signedIdentity.privateKey,
    });
    expect(readDotenv(path.join(codexProject, '.openbox', 'codex', '.env'))).toMatchObject({
      OPENBOX_API_KEY: runtimeKey,
      OPENBOX_CORE_URL: DEFAULT_OPENBOX_CORE_URL,
      OPENBOX_AGENT_DID: signedIdentity.did,
      OPENBOX_AGENT_PRIVATE_KEY: signedIdentity.privateKey,
    });
    expect(readDotenv(path.join(cursorProject, '.openbox', 'cursor', '.env'))).toMatchObject({
      OPENBOX_API_KEY: runtimeKey,
      OPENBOX_CORE_URL: DEFAULT_OPENBOX_CORE_URL,
      OPENBOX_AGENT_DID: signedIdentity.did,
      OPENBOX_AGENT_PRIVATE_KEY: signedIdentity.privateKey,
    });
  });

  it('preserves existing local Core URLs when credential installs omit --core-url', () => {
    const runtimeKey = `obx_test_${'1'.repeat(48)}`;
    const localCoreUrl = 'http://127.0.0.1:8086';
    const claudeProject = tempDir('openbox-preserve-core-claude-');
    const codexProject = tempDir('openbox-preserve-core-codex-');
    const cursorProject = tempDir('openbox-preserve-core-cursor-');

    configureClaudeCodeRuntime({
      cwd: claudeProject,
      apiKey: runtimeKey,
      coreUrl: localCoreUrl,
      agentIdentity: signedIdentity,
    });
    configureCodexRuntime({
      cwd: codexProject,
      apiKey: runtimeKey,
      coreUrl: localCoreUrl,
      agentIdentity: signedIdentity,
    });
    configureCursorRuntime({
      cwd: cursorProject,
      apiKey: runtimeKey,
      coreUrl: localCoreUrl,
      agentIdentity: signedIdentity,
    });

    configureClaudeCodeRuntime({ cwd: claudeProject, apiKey: runtimeKey });
    configureCodexRuntime({ cwd: codexProject, apiKey: runtimeKey });
    configureCursorRuntime({ cwd: cursorProject, apiKey: runtimeKey });

    const claudeEnv = readJson(path.join(claudeProject, '.claude', 'settings.local.json')).env as Record<string, unknown>;
    expect(claudeEnv.OPENBOX_CORE_URL).toBe(localCoreUrl);
    expect(readDotenv(path.join(codexProject, '.openbox', 'codex', '.env')).OPENBOX_CORE_URL).toBe(localCoreUrl);
    expect(readDotenv(path.join(cursorProject, '.openbox', 'cursor', '.env')).OPENBOX_CORE_URL).toBe(localCoreUrl);
  });

  it('wires the same agent runtime key through each provider official surface', async () => {
    const runtimeKey = `obx_test_${'a'.repeat(48)}`;
    const coreUrl = 'http://127.0.0.1:8086';

    const claudeProject = tempDir('openbox-shared-agent-claude-');
    installClaudeCodePlugin({
      cwd: claudeProject,
      runtime: {
        apiKey: runtimeKey,
        coreUrl,
        approvalMode: 'remote',
        governanceTimeout: 34,
        hitlMaxWait: 600,
        hitlPollInterval: 2,
        agentIdentity: signedIdentity,
      },
    });
    expectClaudeRuntimeConfig(claudeProject, runtimeKey, coreUrl, 'remote', signedIdentity);
    expect(
      (await verifyClaudeCodeInstall({
        cwd: claudeProject,
        includeRuntime: true,
        validateRuntime: false,
      })).find((check) => check.name === 'runtime'),
    ).toMatchObject({ status: 'pass' });

    const codexProject = tempDir('openbox-shared-agent-codex-');
    installCodex({ cwd: codexProject });
    installCodexPlugin({
      cwd: codexProject,
      runtime: {
        apiKey: runtimeKey,
        coreUrl,
        approvalMode: 'defer',
        governanceTimeout: 34,
        hitlMaxWait: 600,
        hitlPollInterval: 2,
        agentIdentity: signedIdentity,
      },
    });
    expectRuntimeConfig(
      codexProject,
      'codex',
      runtimeKey,
      coreUrl,
      'defer',
      signedIdentity,
    );
    expect(
      (await verifyCodexInstall({
        cwd: codexProject,
        includeRuntime: true,
        validateRuntime: false,
      })).find((check) => check.name === 'runtime'),
    ).toMatchObject({ status: 'pass' });

    const cursorProject = tempDir('openbox-shared-agent-cursor-');
    installCursorPlugin({
      cwd: cursorProject,
      runtime: {
        apiKey: runtimeKey,
        coreUrl,
        approvalMode: 'inline',
        governanceTimeout: 34,
        hitlMaxWait: 600,
        hitlPollInterval: 2,
        agentIdentity: signedIdentity,
      },
    });
    expectRuntimeConfig(
      cursorProject,
      'cursor',
      runtimeKey,
      coreUrl,
      'inline',
      signedIdentity,
    );
    expect(
      (await verifyCursorInstall({
        cwd: cursorProject,
        includeRuntime: true,
        validateRuntime: false,
      })).find((check) => check.name === 'runtime'),
    ).toMatchObject({ status: 'pass' });

    expect(verifyOpenBoxAgentsSDKConfig({ apiKey: runtimeKey, coreUrl, agentIdentity: signedIdentity })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'api-key', status: 'pass' }),
        expect.objectContaining({ name: 'core-url', status: 'pass' }),
      ]),
    );

    expect(verifyOpenBoxAnthropicAgentSDKConfig({ apiKey: runtimeKey, coreUrl, agentIdentity: signedIdentity })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'api-key', status: 'pass' }),
        expect.objectContaining({ name: 'core-url', status: 'pass' }),
      ]),
    );

    const copilot = createOpenBoxCopilotKitAdapter({ apiKey: runtimeKey, coreUrl, agentIdentity: signedIdentity });
    expect(copilot.isEnabled()).toBe(true);
    expect(() => copilot.getCoreClient()).not.toThrow();
  });

  it('fails host runtime readiness on invalid Core URLs without live validation', async () => {
    await withRuntimeEnvCleared(async () => {
      const runtimeKey = `obx_test_${'b'.repeat(48)}`;
      const invalidCoreUrl = 'http://api.example.test';

      const claudeProject = tempDir('openbox-invalid-core-claude-');
      installClaudeCodePlugin({ cwd: claudeProject });
      fs.mkdirSync(path.join(claudeProject, '.claude'), { recursive: true });
      fs.writeFileSync(
        path.join(claudeProject, '.claude', 'settings.local.json'),
        JSON.stringify({ env: { OPENBOX_API_KEY: runtimeKey, OPENBOX_CORE_URL: invalidCoreUrl } }) + '\n',
      );
      expect(
        (await verifyClaudeCodeInstall({
          cwd: claudeProject,
          includeRuntime: true,
          validateRuntime: false,
        })).find((check) => check.name === 'runtime'),
      ).toMatchObject({ status: 'fail', detail: expect.stringContaining('invalid OPENBOX_CORE_URL') });

      const codexProject = tempDir('openbox-invalid-core-codex-');
      installCodex({ cwd: codexProject });
      installCodexPlugin({ cwd: codexProject });
      fs.mkdirSync(path.join(codexProject, '.openbox', 'codex'), { recursive: true });
      fs.writeFileSync(
        path.join(codexProject, '.openbox', 'codex', '.env'),
        `OPENBOX_API_KEY=${JSON.stringify(runtimeKey)}\nOPENBOX_CORE_URL=${JSON.stringify(invalidCoreUrl)}\n`,
      );
      expect(
        (await verifyCodexInstall({
          cwd: codexProject,
          includeRuntime: true,
          validateRuntime: false,
        })).find((check) => check.name === 'runtime'),
      ).toMatchObject({ status: 'fail', detail: expect.stringContaining('invalid OPENBOX_CORE_URL') });

      const cursorProject = tempDir('openbox-invalid-core-cursor-');
      installCursorPlugin({ cwd: cursorProject });
      fs.mkdirSync(path.join(cursorProject, '.openbox', 'cursor'), { recursive: true });
      fs.writeFileSync(
        path.join(cursorProject, '.openbox', 'cursor', '.env'),
        `OPENBOX_API_KEY=${JSON.stringify(runtimeKey)}\nOPENBOX_CORE_URL=${JSON.stringify(invalidCoreUrl)}\n`,
      );
      expect(
        (await verifyCursorInstall({
          cwd: cursorProject,
          includeRuntime: true,
          validateRuntime: false,
        })).find((check) => check.name === 'runtime'),
      ).toMatchObject({ status: 'fail', detail: expect.stringContaining('invalid OPENBOX_CORE_URL') });
    });
  });

  it('rejects empty runtime keys before writing host runtime config', () => {
    const runtimeKey = `obx_test_${'d'.repeat(48)}`;
    const claudeProject = tempDir('openbox-empty-key-claude-');
    const codexProject = tempDir('openbox-empty-key-codex-');
    const cursorProject = tempDir('openbox-empty-key-cursor-');

    expect(() => configureClaudeCodeRuntime({ cwd: claudeProject, apiKey: '   ' })).toThrow(
      'OPENBOX_API_KEY must not be empty',
    );
    expect(() => configureCodexRuntime({ cwd: codexProject, apiKey: '' })).toThrow(
      'OPENBOX_API_KEY must not be empty',
    );
    expect(() => configureCursorRuntime({ cwd: cursorProject, apiKey: '  ' })).toThrow(
      'OPENBOX_API_KEY must not be empty',
    );

    configureClaudeCodeRuntime({ cwd: claudeProject, apiKey: ` ${runtimeKey} ` });
    const env = readJson(path.join(claudeProject, '.claude', 'settings.local.json')).env as Record<string, unknown>;
    expect(env.OPENBOX_API_KEY).toBe(runtimeKey);
  });

});
