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
// Skipped unless the loopback test workspace exists and an org
// X-API-Key is on disk (the MCP server needs it).

import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  VERDICT_MATRIX,
  type VerdictMatrixCase,
} from './fixtures/verdict-matrix.js';
import {
  SHOULD_RUN as SUITE_SHOULD_RUN,
  PLUGIN_DIR,
  WORKSPACE,
  assertClaudeOnPath,
  hookLogSince,
  snapshotHookLog,
} from './helpers/claude-runner.js';
import { requireOpenBoxCli } from '../helpers/openbox-cli.js';

const OPENBOX = requireOpenBoxCli();
const PROJECT_OPENBOX = path.resolve(process.cwd(), '.openbox');
const REAL_DB_MCP = path.resolve(import.meta.dirname, 'fixtures/real-db-mcp-server.mjs');
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
  return hookConfig.OPENBOX_CORE_URL
    ?? (process.env.OPENBOX_CORE_URL && process.env.OPENBOX_CORE_URL !== UNIT_CORE_URL
      ? process.env.OPENBOX_CORE_URL
      : DEFAULT_CORE_URL);
}

function claudeHookEnv(): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const key of RUNTIME_ENV_KEYS) delete env[key];
  return { ...env, OPENBOX_CLI: OPENBOX };
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
    process.env.OPENBOX_API_KEY,
    resolveAgentRecord()?.runtimeKey,
  ]) {
    if (candidate && RUNTIME_KEY_PREFIX.test(candidate)) return candidate;
  }
  return undefined;
}

function resolveAgentId(): string | undefined {
  return process.env.OPENBOX_AGENT_ID ?? resolveAgentRecord()?.agentId;
}

const orgKey = resolveOrgApiKey();
const runtimeKey = resolveRuntimeKey();
const agentId = resolveAgentId();
const USING_REMOTE_RUNTIME =
  !isLoopbackUrl(runtimeUrl('api')) || !isLoopbackUrl(runtimeUrl('core'));
const SHOULD_RUN = SUITE_SHOULD_RUN && !!orgKey;
const SHOULD_RUN_GOVERNANCE = SHOULD_RUN && !!runtimeKey;
const SHOULD_RUN_REAL_DB = SHOULD_RUN_GOVERNANCE && realDbAvailable();

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

interface GovernanceDbEvent {
  event_type?: string;
  activity_type?: string;
  span_count?: number;
  verdict?: number;
  reason?: string;
  input?: unknown;
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
  expect(ageResult?.total_spans, `missing AGE span count: ${parsed.result.slice(0, 1000)}`).toBe(1);
  expect(body.fallback_used ?? ageResult?.fallback_used ?? false).toBe(false);
}

async function readPlatformSessionsSince(fromTime: string): Promise<PlatformSession[]> {
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

function realDbAvailable(): boolean {
  const r = spawnSync('docker', ['ps', '--format', '{{.Names}}'], {
    encoding: 'utf-8',
    timeout: 5_000,
  });
  return r.status === 0 && r.stdout.split('\n').includes('openbox-postgres');
}

function psqlScalar(sql: string): string {
  const r = spawnSync(
    'docker',
    [
      'exec',
      'openbox-postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      'openbox',
      '-t',
      '-A',
      '-c',
      sql,
    ],
    {
      encoding: 'utf-8',
      timeout: 15_000,
    },
  );
  expect(r.status, `psql failed: ${r.stderr || r.stdout}`).toBe(0);
  return r.stdout.trim();
}

function psqlExec(sql: string): void {
  const r = spawnSync(
    'docker',
    [
      'exec',
      'openbox-postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      'openbox',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    {
      encoding: 'utf-8',
      timeout: 15_000,
    },
  );
  expect(r.status, `psql failed: ${r.stderr || r.stdout}`).toBe(0);
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function readGovernanceDbEvent(marker: string): GovernanceDbEvent | null {
  const escapedMarker = marker.replaceAll("'", "''");
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const text = psqlScalar(`
      SELECT json_build_object(
        'event_type', event_type,
        'activity_type', activity_type,
        'span_count', span_count,
        'verdict', verdict,
        'reason', coalesce(reason, ''),
        'input', input,
        'output', output
      )::text
      FROM governance_events
      WHERE activity_type = 'DatabaseQuery'
        AND (
          input::text LIKE '%${escapedMarker}%'
          OR output::text LIKE '%${escapedMarker}%'
        )
      ORDER BY
        CASE WHEN event_type = 'ActivityStarted' THEN 0 ELSE 1 END,
        created_at DESC
      LIMIT 1
    `);
    if (text) return JSON.parse(text) as GovernanceDbEvent;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  return null;
}

describe.runIf(SHOULD_RUN)('claude actually uses the openbox MCP', () => {
  let mcpConfigPath: string;
  let realDbPluginDir: string;

  beforeAll(() => {
    assertClaudeOnPath();
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'obx-mcp-via-claude-'));
    mcpConfigPath = path.join(tmp, '.mcp.json');
    realDbPluginDir = path.join(tmp, 'openbox');
    cpSync(PLUGIN_DIR, realDbPluginDir, { recursive: true });
    const pluginMcpPath = path.join(realDbPluginDir, '.mcp.json');
    const pluginMcpConfig = JSON.parse(readFileSync(pluginMcpPath, 'utf-8')) as {
      mcpServers?: Record<string, unknown>;
    };
    writeFileSync(
      pluginMcpPath,
      JSON.stringify(
        {
          ...pluginMcpConfig,
          mcpServers: {
            ...(pluginMcpConfig.mcpServers ?? {}),
            realdb: {
              command: process.execPath,
              args: [REAL_DB_MCP],
            },
          },
        },
        null,
        2,
      ),
    );
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
        env: process.env,
      },
    );

    expect(r.status, `claude exited ${r.status}; stderr: ${r.stderr}`).toBe(0);
    const start = r.stdout.indexOf('{');
    expect(start, 'no JSON in claude output').toBeGreaterThanOrEqual(0);
    return JSON.parse(r.stdout.slice(start)) as ClaudeResult;
  }

  function runGovernedPluginMcp(prompt: string, allowedTool: string): ClaudeResult {
    const r = spawnSync(
      'claude',
      [
        '-p',
        prompt,
        '--output-format',
        'json',
        '--dangerously-skip-permissions',
        '--plugin-dir',
        realDbPluginDir,
        '--setting-sources',
        'user',
        '--allowedTools',
        allowedTool,
      ],
      {
        cwd: WORKSPACE,
        encoding: 'utf-8',
        timeout: 200_000,
        env: claudeHookEnv(),
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

  describe.runIf(SHOULD_RUN_REAL_DB)('claude-governed real database MCP tool', () => {
    it('runs a real Postgres query and records governed DatabaseQuery evidence', async () => {
      const probeId = `obx_real_db_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const secret = `db_secret_${Math.random().toString(36).slice(2)}_${Date.now()}`;
      psqlExec(`
        CREATE TABLE IF NOT EXISTS openbox_e2e_probe (
          probe_id text PRIMARY KEY,
          secret text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      psqlExec(`
        INSERT INTO openbox_e2e_probe (probe_id, secret)
        VALUES (${sqlLiteral(probeId)}, ${sqlLiteral(secret)})
        ON CONFLICT (probe_id) DO UPDATE SET secret = EXCLUDED.secret
      `);
      const query = `SELECT secret FROM openbox_e2e_probe WHERE probe_id = '${probeId}'`;
      const toolName = 'mcp__plugin_openbox_realdb__query_database';
      const fromTime = new Date().toISOString();
      const hookOffset = snapshotHookLog();
      const parsed = runGovernedPluginMcp(
        [
          `Call ${toolName} exactly once with this JSON:`,
          JSON.stringify({ query, operation: 'QUERY', system: 'postgresql' }),
          'Return only the stdout value from the tool response.',
        ].join(' '),
        toolName,
      );

      const denied = parsed.permission_denials?.some(
        (d) => d.tool_name === toolName,
      );
      expect(denied, 'claude was denied access to the real DB MCP tool').not.toBe(true);
      expect(parsed.is_error, `claude returned is_error; result: ${parsed.result.slice(0, 500)}`).toBeFalsy();
      expect(parsed.result).toContain(secret);

      if (USING_REMOTE_RUNTIME) {
        const hookEvents = hookLogSince(hookOffset);
        const eventNames = hookEvents.map((line) => line.event);
        expect(hookEvents.length, 'no Claude Code hook events were logged for the real DB MCP call').toBeGreaterThan(0);
        for (const line of hookEvents) {
          expect(line.error ?? null, `hook ${line.event} failed`).toBeNull();
        }
        expect(eventNames).toContain('userPromptSubmit');
        expect(eventNames).toContain('preToolUse');
        expect(eventNames).toContain('postToolUse');
        expect(eventNames).toContain('postToolBatch');
        expect(eventNames).toContain('stop');

        const sessions = await readPlatformSessionsSince(fromTime);
        expect(sessions.length, `no remote platform session found after ${fromTime}`).toBeGreaterThan(0);
        expect(sessions.some((session) => session.status === 'completed')).toBe(true);
        return;
      }

      const event = readGovernanceDbEvent(probeId);
      expect(event, `no DatabaseQuery event found for ${probeId}`).not.toBeNull();
      expect(event?.event_type).toBe('ActivityStarted');
      expect(event?.activity_type).toBe('DatabaseQuery');
      expect(event?.span_count).toBe(1);
      expect(event?.verdict, `unexpected DatabaseQuery event: ${JSON.stringify(event)}`).toBe(1);
      expect(event?.reason ?? '').toContain('e2e-constrain-db');
    }, 240_000);
  });
});
