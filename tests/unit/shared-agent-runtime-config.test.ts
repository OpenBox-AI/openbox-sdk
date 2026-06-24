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
  installCodex,
  installCodexPlugin,
  verifyCodexInstall,
} from '../../ts/src/runtime/codex/index.js';
import {
  installCursorPlugin,
  verifyCursorInstall,
} from '../../ts/src/runtime/cursor/index.js';
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

function expectRuntimeConfig(
  file: string,
  runtimeKey: string,
  coreUrl: string,
  approvalMode: string,
  agentIdentity?: typeof signedIdentity,
): void {
  const config = readJson(file);
  expect(config.OPENBOX_API_KEY).toBe(runtimeKey);
  expect(config.OPENBOX_CORE_URL).toBe(coreUrl);
  expect(config.approvalMode).toBe(approvalMode);
  expect(config.governanceTimeout).toBe('34');
  expect(config.hitlMaxWait).toBe(600);
  expect(config.hitlPollInterval).toBe(2);
  if (agentIdentity) {
    expect(config.OPENBOX_AGENT_DID).toBe(agentIdentity.did);
    expect(config.OPENBOX_AGENT_PRIVATE_KEY).toBe(agentIdentity.privateKey);
  }
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
    expectRuntimeConfig(
      path.join(claudeProject, '.claude-hooks', 'config.json'),
      runtimeKey,
      coreUrl,
      'remote',
      signedIdentity,
    );
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
      path.join(codexProject, '.codex-hooks', 'config.json'),
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
      path.join(cursorProject, '.cursor-hooks', 'config.json'),
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
      fs.writeFileSync(
        path.join(claudeProject, '.claude-hooks', 'config.json'),
        JSON.stringify({ OPENBOX_API_KEY: runtimeKey, OPENBOX_CORE_URL: invalidCoreUrl }) + '\n',
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
      fs.writeFileSync(
        path.join(codexProject, '.codex-hooks', 'config.json'),
        JSON.stringify({ OPENBOX_API_KEY: runtimeKey, OPENBOX_CORE_URL: invalidCoreUrl }) + '\n',
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
      fs.writeFileSync(
        path.join(cursorProject, '.cursor-hooks', 'config.json'),
        JSON.stringify({ OPENBOX_API_KEY: runtimeKey, OPENBOX_CORE_URL: invalidCoreUrl }) + '\n',
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

});
