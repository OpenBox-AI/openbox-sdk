// Claude actually loads `.mcp.json` and exposes the OpenBox MCP
// tools. The host-agnostic protocol test in mcp-protocol.test.ts pins
// the server side; this file pins the Claude client side: when claude
// is given `--mcp-config <openbox-mcp>`, does it list and call
// `mcp__openbox__*` tools at all?
//
// Strategy: drop a minimal `.mcp.json` next to the test project
// that points at this checkout's OpenBox MCP server with the org
// X-API-Key and runtime key baked into the env block. Run `claude -p`
// asking it to invoke `mcp__openbox__openbox_status`. Assert the JSON envelope
// reports the tool was called and returned a non-error result.
//
// Skipped unless the loopback test project exists and an org
// X-API-Key is on disk (the MCP server needs it).

import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  CLAUDE_CODE_MCP_VERDICT_MATRIX,
  type VerdictMatrixCase,
  requireProviderDriver,
} from './fixtures/verdict-matrix.js';
import {
  SHOULD_RUN as SUITE_SHOULD_RUN,
  PROJECT_DIR,
  assertClaudeOnPath,
} from './helpers/claude-runner.js';
import {
  ensureLocalGovernanceMatrix,
  localGovernanceMatrixConfigured,
} from './helpers/local-governance-matrix.js';
import { requireOpenBoxCli } from '../helpers/openbox-cli.js';

const LOCAL_CLI = requireOpenBoxCli();
const PROJECT_OPENBOX = path.resolve(process.cwd(), '.openbox');
const DEFAULT_API_URL = 'http://127.0.0.1:3000';
const DEFAULT_CORE_URL = 'http://127.0.0.1:8086';
const UNIT_API_URL = 'http://localhost:18080';
const UNIT_CORE_URL = 'http://localhost:18081';
const RUNTIME_ENV_KEYS = [
  'OPENBOX_API_KEY',
  'OPENBOX_API_URL',
  'OPENBOX_CORE_URL',
  'OPENBOX_AGENT_DID',
  'OPENBOX_AGENT_PRIVATE_KEY',
  'OPENBOX_HOME',
] as const;
type LocalGovernanceRuntime = Awaited<ReturnType<typeof ensureLocalGovernanceMatrix>>;

function readClaudeRuntimeEnv(): Record<string, string> {
  const configPath = path.join(PROJECT_DIR, '.claude', 'settings.local.json');
  if (!existsSync(configPath)) return {};
  try {
    const settings = JSON.parse(readFileSync(configPath, 'utf-8')) as {
      env?: Record<string, string>;
    };
    return settings.env ?? {};
  } catch {
    return {};
  }
}

const claudeRuntimeEnv = readClaudeRuntimeEnv();

function resolveOrgApiKey(): string | undefined {
  if (process.env.OPENBOX_BACKEND_API_KEY) return process.env.OPENBOX_BACKEND_API_KEY;
  const tokens = path.join(PROJECT_OPENBOX, 'tokens');
  if (!existsSync(tokens)) return undefined;
  const text = readFileSync(tokens, 'utf-8');
  return text.match(/obx_key_[a-z0-9]+/i)?.[0];
}

function runtimeUrl(kind: 'api' | 'core'): string {
  if (kind === 'api') {
    return (process.env.OPENBOX_API_URL && process.env.OPENBOX_API_URL !== UNIT_API_URL
        ? process.env.OPENBOX_API_URL
        : DEFAULT_API_URL);
  }
  return claudeRuntimeEnv.OPENBOX_CORE_URL
    ?? (process.env.OPENBOX_CORE_URL && process.env.OPENBOX_CORE_URL !== UNIT_CORE_URL
      ? process.env.OPENBOX_CORE_URL
      : DEFAULT_CORE_URL);
}

function claudeHookEnv(): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const key of RUNTIME_ENV_KEYS) delete env[key];
  delete env.NODE_V8_COVERAGE;
  delete env.VITEST;
  delete env.VITEST_POOL_ID;
  delete env.VITEST_WORKER_ID;
  return env;
}

const orgKey = resolveOrgApiKey();
const USING_REMOTE_RUNTIME =
  !isLoopbackUrl(runtimeUrl('api')) || !isLoopbackUrl(runtimeUrl('core'));
const SHOULD_RUN = SUITE_SHOULD_RUN && !!orgKey;
const SHOULD_RUN_GOVERNANCE = SHOULD_RUN && localGovernanceMatrixConfigured();
const EXHAUSTIVE_CLAUDE_MCP = ['1', 'true', 'yes'].includes(
  String(process.env.OPENBOX_EXHAUSTIVE_CLAUDE_MCP ?? '').trim().toLowerCase(),
);
const RUN_CLAUDE_MCP_HOST_SMOKE = EXHAUSTIVE_CLAUDE_MCP || ['1', 'true', 'yes'].includes(
  String(process.env.OPENBOX_CLAUDE_MCP_HOST_SMOKE ?? '').trim().toLowerCase(),
);
let localRuntime: LocalGovernanceRuntime | undefined;

const GOVERNANCE_VERDICTS = [
  'allow',
  'constrain',
  'require_approval',
  'block',
  'halt',
  'deny',
] as const;

interface ClaudeResult {
  result: string;
  permission_denials?: Array<{ tool_name: string }>;
  is_error?: boolean;
}

interface PlatformSession {
  id?: string;
  status?: string;
  workflow_id?: string;
  started_at?: string;
  completed_at?: string;
}

function isLoopbackUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function rowsFromEnvelope(body: unknown): unknown[] {
  const root = asRecord(body);
  const data = root?.data;
  if (Array.isArray(data)) return data;
  const nested = asRecord(data)?.data;
  return Array.isArray(nested) ? nested : [];
}

function parseJsonObjectFromText(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim()
    ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  expect(candidate.length, `no JSON object in claude result: ${text.slice(0, 500)}`).toBeGreaterThan(0);
  return JSON.parse(candidate) as Record<string, unknown>;
}

function assertRemoteGovernanceResult(parsed: ClaudeResult, c: VerdictMatrixCase): void {
  const body = parseJsonObjectFromText(parsed.result);
  const verdict = String(body.verdict ?? '');
  const ageResult = asRecord(body.age_result);

  expect(typeof body.governance_event_id, `missing governance_event_id: ${parsed.result.slice(0, 1000)}`).toBe('string');
  expect(GOVERNANCE_VERDICTS, `unexpected verdict for ${c.spanType}: ${parsed.result.slice(0, 1000)}`).toContain(
    verdict as (typeof GOVERNANCE_VERDICTS)[number],
  );
  expect(verdict, `wrong verdict for ${c.id}: ${parsed.result.slice(0, 1000)}`).toBe(
    c.expectedVerdict,
  );
  expect(ageResult?.total_spans, `missing AGE span count: ${parsed.result.slice(0, 1000)}`).toBe(1);
  expect(body.governance_checks_incomplete ?? ageResult?.governance_checks_incomplete ?? false).toBe(false);
}

async function readPlatformSessionsSince(fromTime: string): Promise<PlatformSession[]> {
  const agentId = localRuntime?.agentId ?? process.env.OPENBOX_AGENT_ID;
  expect(agentId, 'OPENBOX_AGENT_ID is required for remote platform session proof').toBeTruthy();
  expect(orgKey, 'OPENBOX_BACKEND_API_KEY is required for remote platform session proof').toBeTruthy();

  let rows: unknown[] = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await fetch(
      `${runtimeUrl('api')}/agent/${agentId}/sessions?perPage=10&fromTime=${encodeURIComponent(fromTime)}`,
      { headers: { 'X-API-Key': orgKey! } },
    );
    expect(response.status, `session query failed for ${runtimeUrl('api')}`).toBe(200);
    rows = rowsFromEnvelope(await response.json());
    if (rows.length > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return rows.map((row) => asRecord(row) ?? {}) as PlatformSession[];
}

describe.runIf(SHOULD_RUN)('claude actually uses the openbox MCP', () => {
  let mcpConfigPath: string;

  beforeAll(async () => {
    assertClaudeOnPath();
    if (SHOULD_RUN_GOVERNANCE) localRuntime = await ensureLocalGovernanceMatrix();
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
              command: LOCAL_CLI,
              args: ['mcp', 'serve'],
              env: {
                OPENBOX_HOME: PROJECT_OPENBOX,
                OPENBOX_API_URL: runtimeUrl('api'),
                OPENBOX_CORE_URL: runtimeUrl('core'),
                ...(localRuntime?.runtimeKey ? { OPENBOX_API_KEY: localRuntime.runtimeKey } : {}),
                ...(localRuntime?.agentId ? { OPENBOX_AGENT_ID: localRuntime.agentId } : {}),
                ...(claudeRuntimeEnv.OPENBOX_AGENT_DID ? { OPENBOX_AGENT_DID: claudeRuntimeEnv.OPENBOX_AGENT_DID } : {}),
                ...(claudeRuntimeEnv.OPENBOX_AGENT_PRIVATE_KEY ? { OPENBOX_AGENT_PRIVATE_KEY: claudeRuntimeEnv.OPENBOX_AGENT_PRIVATE_KEY } : {}),
                OPENBOX_BACKEND_API_KEY: orgKey!,
              },
            },
          },
        },
        null,
        2,
      ),
    );
  }, 90_000);

  function runClaudeMcp(prompt: string, allowedTool: string): ClaudeResult {
    // Spawn from a fresh directory with no `.claude/` and no
    // `.openbox/claude-code/`. The openbox hooks live in PROJECT_DIR; from
    // a clean cwd the walk-up resolver finds nothing and claude
    // runs without the governance gate firing on the MCP call.
    // The governance gate on `mcp_tool_call` is exercised in the
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
        '--no-session-persistence',
        '--session-id',
        randomUUID(),
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
        env: claudeHookEnv(),
      },
    );

    expect(r.status, `claude exited ${r.status}; stderr: ${r.stderr}`).toBe(0);
    const start = r.stdout.indexOf('{');
    expect(start, 'no JSON in claude output').toBeGreaterThanOrEqual(0);
    return JSON.parse(r.stdout.slice(start)) as ClaudeResult;
  }

  // In governance local-stack mode, the check_governance cases below
  // already prove Claude MCP load + call using governed tool inputs.
  it.runIf(!SHOULD_RUN_GOVERNANCE)('claude can call mcp__openbox__openbox_status and gets a non-error result', () => {
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

  describe.runIf(SHOULD_RUN_GOVERNANCE && RUN_CLAUDE_MCP_HOST_SMOKE)('claude-driven MCP governance checks', () => {
    const governanceCases = EXHAUSTIVE_CLAUDE_MCP
      ? CLAUDE_CODE_MCP_VERDICT_MATRIX
      : CLAUDE_CODE_MCP_VERDICT_MATRIX.filter((entry) => entry.id === 'mcp-tool-allow');

    it.runIf(!EXHAUSTIVE_CLAUDE_MCP)('uses the deterministic MCP smoke lane in CI', () => {
      expect(governanceCases.map((entry) => entry.id)).toEqual(['mcp-tool-allow']);
    });

    function governancePrompt(c: VerdictMatrixCase): string {
      const args = {
        ...(localRuntime?.agentId ? { agent_id: localRuntime.agentId } : {}),
        span_type: c.spanType,
        activity_input: c.activityInput,
      };
      return [
        'Call mcp__openbox__check_governance exactly once with exactly these JSON arguments:',
        JSON.stringify(args),
        'Preserve every nested activity_input key and value exactly; do not omit, infer, rename, or default any field.',
        'Return only the text content of the tool response.',
      ].join(' ');
    }

    for (const c of governanceCases) {
      it(`claude can call mcp__openbox__check_governance for ${c.id}`, () => {
        const driver = requireProviderDriver(c, 'claude-code', 'mcp');
        const parsed = runClaudeMcp(
          governancePrompt(c),
          driver.tool,
        );
        const denied = parsed.permission_denials?.some(
          (d) => d.tool_name === driver.tool,
        );
        expect(denied, `claude was denied access to ${driver.tool}`).not.toBe(true);
        expect(parsed.is_error, `claude returned is_error; result: ${parsed.result.slice(0, 500)}`).toBeFalsy();

        if (USING_REMOTE_RUNTIME) {
          assertRemoteGovernanceResult(parsed, c);
          return;
        }

        const text = parsed.result.toLowerCase();
        expect(
          text.includes(c.expectedRule.toLowerCase())
            || text.includes(c.expectedVerdict.toLowerCase()),
          `expected ${c.expectedRule}/${c.expectedVerdict}; got ${parsed.result.slice(0, 1000)}`,
        ).toBe(true);
      }, 200_000);
    }
  });

});
