// Claude actually loads `.mcp.json` and exposes the OpenBox MCP
// tools. The host-agnostic protocol test in mcp-protocol.test.ts pins
// the server side; this file pins the Claude client side: when claude
// is given `--mcp-config <openbox-mcp>`, does it list and call
// `mcp__openbox__*` tools at all?
//
// Strategy: drop a minimal `.mcp.json` next to the test workspace
// that points at this checkout's OpenBox MCP server with the org
// X-API-Key and runtime key baked into the env block. Run `claude -p`
// asking it to invoke `mcp__openbox__openbox_status`. Assert the JSON envelope
// reports the tool was called and returned a non-error result.
//
// Skipped unless OPENBOX_E2E_LIVE=1, the test workspace exists,
// and an org X-API-Key is on disk (the MCP server needs it).

import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  VERDICT_MATRIX,
  type VerdictMatrixCase,
} from './fixtures/verdict-matrix.js';
import {
  SHOULD_RUN as SUITE_SHOULD_RUN,
  WORKSPACE,
  assertClaudeOnPath,
} from './helpers/claude-runner.js';

const OPENBOX = process.env.OPENBOX_CLI ?? path.resolve(import.meta.dirname, '../../dist/cli/index.js');
const PROJECT_OPENBOX = path.resolve(process.cwd(), '.openbox');
const DEFAULT_API_URL = 'http://127.0.0.1:3000';
const DEFAULT_CORE_URL = 'http://127.0.0.1:8086';
const UNIT_API_URL = 'http://localhost:18080';
const UNIT_CORE_URL = 'http://localhost:18081';
const E2E_AGENT_NAME = 'e2e-agent';
const RUNTIME_KEY_PREFIX = /^obx_(test|live)_/;

interface AgentKeyRecord {
  agentId: string;
  agentName?: string;
  runtimeKey?: string;
}

function readClaudeHookConfig(): Record<string, string> {
  const configPath = path.join(WORKSPACE, '.claude-hooks', 'config.json');
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, string>;
  } catch {
    return {};
  }
}

const hookConfig = readClaudeHookConfig();

function resolveOrgApiKey(): string | undefined {
  if (process.env.OPENBOX_BACKEND_API_KEY) return process.env.OPENBOX_BACKEND_API_KEY;
  if (process.env.OPENBOX_BACKEND_API_KEY_OVERRIDE) return process.env.OPENBOX_BACKEND_API_KEY_OVERRIDE;
  const tokens = path.join(PROJECT_OPENBOX, 'tokens');
  if (!existsSync(tokens)) return undefined;
  const text = readFileSync(tokens, 'utf-8');
  return text.match(/obx_key_[a-z0-9]+/i)?.[0];
}

function runtimeUrl(kind: 'api' | 'core'): string {
  if (kind === 'api') {
    return process.env.OPENBOX_API_URL_OVERRIDE
      ?? (process.env.OPENBOX_API_URL && process.env.OPENBOX_API_URL !== UNIT_API_URL
        ? process.env.OPENBOX_API_URL
        : DEFAULT_API_URL);
  }
  return process.env.OPENBOX_CORE_URL_OVERRIDE
    ?? hookConfig.OPENBOX_CORE_URL
    ?? (process.env.OPENBOX_CORE_URL && process.env.OPENBOX_CORE_URL !== UNIT_CORE_URL
      ? process.env.OPENBOX_CORE_URL
      : DEFAULT_CORE_URL);
}

function readAgentRecords(): AgentKeyRecord[] {
  const keys = path.join(PROJECT_OPENBOX, 'agent-keys');
  if (!existsSync(keys)) return [];
  try {
    const cache = JSON.parse(readFileSync(keys, 'utf-8')) as Record<string, AgentKeyRecord>;
    return Object.values(cache);
  } catch {
    return [];
  }
}

function resolveAgentRecord(): AgentKeyRecord | undefined {
  return readAgentRecords().find((r) => r.agentName === E2E_AGENT_NAME)
    ?? readAgentRecords().find((r) => r.agentId && r.runtimeKey);
}

function resolveRuntimeKey(): string | undefined {
  for (const candidate of [
    hookConfig.OPENBOX_API_KEY,
    process.env.OPENBOX_E2E_RUNTIME_KEY,
    process.env.OPENBOX_API_KEY,
    process.env.OPENBOX_API_KEY_OVERRIDE,
    resolveAgentRecord()?.runtimeKey,
  ]) {
    if (candidate && RUNTIME_KEY_PREFIX.test(candidate)) return candidate;
  }
  return undefined;
}

function resolveAgentId(): string | undefined {
  return process.env.OPENBOX_E2E_AGENT_ID ?? resolveAgentRecord()?.agentId;
}

const orgKey = resolveOrgApiKey();
const runtimeKey = resolveRuntimeKey();
const agentId = resolveAgentId();
const SHOULD_RUN = SUITE_SHOULD_RUN && !!orgKey;
const SHOULD_RUN_GOVERNANCE = SHOULD_RUN && !!runtimeKey;

interface ClaudeResult {
  result: string;
  permission_denials?: Array<{ tool_name: string }>;
  is_error?: boolean;
}

describe.runIf(SHOULD_RUN)('claude actually uses the openbox MCP', () => {
  let mcpConfigPath: string;

  beforeAll(() => {
    assertClaudeOnPath();
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'obx-mcp-via-claude-'));
    mcpConfigPath = path.join(tmp, '.mcp.json');
    // Point claude at the openbox MCP server. Pass the org X-API-Key
    // and the `local` env explicitly so the MCP server reaches the
    // local stack regardless of the user's default env.
    writeFileSync(
      mcpConfigPath,
      JSON.stringify(
        {
          mcpServers: {
            openbox: {
              command: OPENBOX,
              args: ['mcp', 'serve'],
              env: {
                OPENBOX_HOME: PROJECT_OPENBOX,
                OPENBOX_API_URL: runtimeUrl('api'),
                OPENBOX_CORE_URL: runtimeUrl('core'),
                ...(runtimeKey ? { OPENBOX_API_KEY: runtimeKey } : {}),
                ...(hookConfig.OPENBOX_AGENT_DID ? { OPENBOX_AGENT_DID: hookConfig.OPENBOX_AGENT_DID } : {}),
                ...(hookConfig.OPENBOX_AGENT_PRIVATE_KEY ? { OPENBOX_AGENT_PRIVATE_KEY: hookConfig.OPENBOX_AGENT_PRIVATE_KEY } : {}),
                OPENBOX_BACKEND_API_KEY: orgKey!,
              },
            },
          },
        },
        null,
        2,
      ),
    );
  });

  function runClaudeMcp(prompt: string, allowedTool: string): ClaudeResult {
    // Spawn from a fresh directory with no `.claude/` and no
    // `.claude-hooks/`. The openbox hooks live in WORKSPACE; from
    // a clean cwd the walk-up resolver finds nothing and claude
    // runs without the governance gate firing on the MCP call.
    // The governance gate on `llm_tool_call` is exercised in the
    // headless matrix; here we are pinning the MCP load + call
    // path on its own.
    const cleanCwd = path.dirname(mcpConfigPath);
    const r = spawnSync(
      'claude',
      [
        '-p',
        prompt,
        '--output-format',
        'json',
        '--dangerously-skip-permissions',
        '--allowedTools',
        allowedTool,
        '--mcp-config',
        mcpConfigPath,
        '--strict-mcp-config',
      ],
      {
        cwd: cleanCwd,
        encoding: 'utf-8',
        // Stand-alone the run lands at ~85s; under suite load with
        // a busy local stack it stretches further. Keep generous
        // headroom inside the per-test 200s ceiling.
        timeout: 180_000,
        env: { ...process.env, HITL_MAX_WAIT: '5' },
      },
    );

    expect(r.status, `claude exited ${r.status}; stderr: ${r.stderr}`).toBe(0);
    const start = r.stdout.indexOf('{');
    expect(start, 'no JSON in claude output').toBeGreaterThanOrEqual(0);
    return JSON.parse(r.stdout.slice(start)) as ClaudeResult;
  }

  it('claude can call mcp__openbox__openbox_status and gets a non-error result', () => {
    const parsed = runClaudeMcp(
      'Call the mcp__openbox__openbox_status tool. Return only the text content of the tool response.',
      'mcp__openbox__openbox_status',
    );

    // The tool must not have ended up on the deny list. If claude
    // refused to call it, the MCP wiring failed.
    const denied = parsed.permission_denials?.some(
      (d) => d.tool_name === 'mcp__openbox__openbox_status',
    );
    expect(denied, 'claude was denied access to mcp__openbox__openbox_status').not.toBe(true);
    expect(parsed.is_error, `claude returned is_error; result: ${parsed.result.slice(0, 300)}`).toBeFalsy();

    expect(parsed.result.toLowerCase()).toMatch(/connected|mcp|claude|status/);
  }, 200_000);

  describe.runIf(SHOULD_RUN_GOVERNANCE)('claude-driven MCP governance checks', () => {
    const governanceCases = VERDICT_MATRIX.filter((c) =>
      c.spanType === 'http' || c.spanType === 'db',
    );

    function governancePrompt(c: VerdictMatrixCase): string {
      const args = {
        ...(agentId ? { agent_id: agentId } : {}),
        span_type: c.spanType,
        activity_input: c.activityInput,
      };
      return [
        'Call mcp__openbox__check_governance exactly once with these JSON arguments:',
        JSON.stringify(args),
        'Return only the text content of the tool response.',
      ].join(' ');
    }

    for (const c of governanceCases) {
      it(`claude can call mcp__openbox__check_governance for ${c.spanType}`, () => {
        const parsed = runClaudeMcp(
          governancePrompt(c),
          'mcp__openbox__check_governance',
        );
        const denied = parsed.permission_denials?.some(
          (d) => d.tool_name === 'mcp__openbox__check_governance',
        );
        expect(denied, 'claude was denied access to mcp__openbox__check_governance').not.toBe(true);
        expect(parsed.is_error, `claude returned is_error; result: ${parsed.result.slice(0, 500)}`).toBeFalsy();

        const text = parsed.result.toLowerCase();
        expect(
          text.includes(c.expectedRule.toLowerCase())
            || text.includes(c.expectedVerdict.toLowerCase())
            || text.includes(c.expectedOutcome.toLowerCase()),
          `expected ${c.expectedRule}/${c.expectedVerdict}; got ${parsed.result.slice(0, 1000)}`,
        ).toBe(true);
      }, 200_000);
    }
  });
});
