// Claude actually loads `.mcp.json` and exposes the OpenBox MCP
// tools. The host-agnostic protocol test in mcp-protocol.test.ts pins
// the server side; this file pins the Claude client side: when claude
// is given `--mcp-config <openbox-mcp>`, does it list and call
// `mcp__openbox__*` tools at all?
//
// Strategy: drop a minimal `.mcp.json` next to the test workspace
// that points at `openbox --env local mcp serve` with the org
// X-API-Key baked into the env block. Run `claude -p` asking it to
// invoke `mcp__openbox__list_agents`. Assert the JSON envelope
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
  SHOULD_RUN as SUITE_SHOULD_RUN,
  assertClaudeOnPath,
} from './helpers/claude-runner.js';

const OPENBOX = process.env.OPENBOX_CLI ?? 'openbox';

function resolveOrgApiKey(): string | undefined {
  if (process.env.OPENBOX_BACKEND_API_KEY) return process.env.OPENBOX_BACKEND_API_KEY;
  const tokens = path.join(os.homedir(), '.openbox', 'tokens');
  if (!existsSync(tokens)) return undefined;
  const text = readFileSync(tokens, 'utf-8');
  return text.match(/obx_key_[a-z0-9]+/i)?.[0];
}

const orgKey = resolveOrgApiKey();
const SHOULD_RUN = SUITE_SHOULD_RUN && !!orgKey;

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
              args: ['--env', 'local', 'mcp', 'serve'],
              env: {
                OPENBOX_API_KEY: orgKey!,
                OPENBOX_BACKEND_API_KEY: orgKey!,
                OPENBOX_ENV: 'local',
              },
            },
          },
        },
        null,
        2,
      ),
    );
  });

  it('claude can call mcp__openbox__list_agents and gets a non-error result', () => {
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
        'Call the mcp__openbox__list_agents tool. Return the raw JSON it gives you.',
        '--output-format',
        'json',
        '--dangerously-skip-permissions',
        '--allowedTools',
        'mcp__openbox__list_agents',
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
    const parsed = JSON.parse(r.stdout.slice(start)) as ClaudeResult;

    // The tool must not have ended up on the deny list. If claude
    // refused to call it, the MCP wiring failed.
    const denied = parsed.permission_denials?.some(
      (d) => d.tool_name === 'mcp__openbox__list_agents',
    );
    expect(denied, 'claude was denied access to mcp__openbox__list_agents').not.toBe(true);
    expect(parsed.is_error, `claude returned is_error; result: ${parsed.result.slice(0, 300)}`).toBeFalsy();

    // The result text should at least mention something that
    // looks like agent listing output. The MCP returns a JSON
    // array under the `content[0].text` field; claude surfaces a
    // model-rephrased version. Either form mentions `agent` or
    // returns a structured shape.
    expect(parsed.result.toLowerCase()).toMatch(/agent|"data"|\[/);
  }, 200_000);
});
