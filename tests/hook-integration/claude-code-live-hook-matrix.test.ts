// Live direct hook matrix for Claude Code events that `claude -p` cannot
// force deterministically. Runs the real project hook subprocess against
// a real Core URL using project-local `.claude-hooks/config.json`.
//
// Skipped unless OPENBOX_E2E_LIVE_HOOK_MATRIX=1.

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HOOK_SPEC } from '../../ts/src/core-client/generated/runtime/claude-code.js';
import { requireOpenBoxCli } from '../helpers/openbox-cli.js';

const OPENBOX = requireOpenBoxCli();
const SHOULD_RUN = process.env.OPENBOX_E2E_LIVE_HOOK_MATRIX === '1';

function firstEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return undefined;
}

function requireLiveConfig(): Record<string, string> {
  const coreUrl = firstEnv('OPENBOX_STAGING_CLAUDE_CODE_E2E_CORE_URL', 'OPENBOX_CORE_URL');
  const runtimeKey = firstEnv('OPENBOX_STAGING_CLAUDE_CODE_E2E_RUNTIME_KEY', 'OPENBOX_API_KEY');
  const agentDid = firstEnv('OPENBOX_STAGING_CLAUDE_CODE_E2E_AGENT_DID', 'OPENBOX_AGENT_DID');
  const agentPrivateKey = firstEnv(
    'OPENBOX_STAGING_CLAUDE_CODE_E2E_AGENT_PRIVATE_KEY',
    'OPENBOX_AGENT_PRIVATE_KEY',
  );
  const missing = [
    ['OPENBOX_CORE_URL', coreUrl],
    ['OPENBOX_API_KEY', runtimeKey],
    ['OPENBOX_AGENT_DID', agentDid],
    ['OPENBOX_AGENT_PRIVATE_KEY', agentPrivateKey],
  ].filter(([, value]) => !value).map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`missing live Claude Code hook matrix env: ${missing.join(', ')}`);
  }
  return {
    OPENBOX_CORE_URL: coreUrl!,
    OPENBOX_API_KEY: runtimeKey!,
    OPENBOX_AGENT_DID: agentDid!,
    OPENBOX_AGENT_PRIVATE_KEY: agentPrivateKey!,
    GOVERNANCE_POLICY: 'fail_closed',
    GOVERNANCE_TIMEOUT: '20',
    HITL_ENABLED: 'false',
    HITL_MAX_WAIT: '1',
    APPROVAL_MODE: 'inline',
    VERBOSE: 'false',
  };
}

function requirePlatformConfig(): { apiUrl: string; apiKey: string; agentId: string } {
  const apiUrl = firstEnv('OPENBOX_PLATFORM_API_URL', 'OPENBOX_STAGING_CLAUDE_CODE_E2E_API_URL');
  const apiKey = firstEnv('OPENBOX_PLATFORM_API_KEY', 'OPENBOX_STAGING_PLATFORM_API_KEY');
  const agentId = firstEnv('OPENBOX_AGENT_ID', 'OPENBOX_STAGING_CLAUDE_CODE_E2E_AGENT_ID');
  const missing = [
    ['OPENBOX_PLATFORM_API_URL', apiUrl],
    ['OPENBOX_PLATFORM_API_KEY', apiKey],
    ['OPENBOX_AGENT_ID', agentId],
  ].filter(([, value]) => !value).map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`missing live Claude Code platform assertion env: ${missing.join(', ')}`);
  }
  return { apiUrl: apiUrl!, apiKey: apiKey!, agentId: agentId! };
}

function createProject(config: Record<string, string>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'obx-cc-live-hooks-'));
  const configDir = path.join(root, '.claude-hooks');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(path.join(configDir, 'config.json'), JSON.stringify(config, null, 2));
  return root;
}

function envelopeFor(event: string, sessionId: string, index: number, projectRoot: string): Record<string, unknown> {
  const common = {
    hook_event_name: event,
    session_id: sessionId,
    cwd: projectRoot,
    model: 'claude-opus-4-8',
    transcript_path: `/tmp/openbox-live-hook-${sessionId}.jsonl`,
    tool_name: 'TodoWrite',
    tool_input: { todos: [{ content: `matrix-${event}`, status: 'pending', activeForm: 'testing' }] },
    tool_response: { ok: true },
    tool_calls: [
      {
        tool_name: 'TodoWrite',
        tool_input: { todos: [{ content: `batch-${event}`, status: 'completed' }] },
        tool_response: { ok: true },
      },
    ],
    prompt: `live hook matrix prompt ${event}`,
    expanded_prompt: `live hook matrix expanded prompt ${event}`,
    command_name: 'openbox-status',
    command_args: '',
    trigger: 'manual',
    source: 'project',
    instructions: 'live matrix instructions',
    custom_instructions: 'preserve governance evidence',
    compact_summary: 'live matrix compact summary',
    agent_id: `subagent-${index}`,
    agent_type: 'general-purpose',
    task_id: `task-${index}`,
    task_subject: `live matrix task ${index}`,
    task_description: 'exercise Claude Code hook surface',
    teammate_name: 'openbox-e2e',
    team_name: 'sdk-compliance',
    last_assistant_message: `live matrix assistant output ${event}`,
    background_tasks: [],
    session_crons: [],
    message: `live matrix message ${event}`,
    display_content: `live matrix display ${event}`,
    file_path: `/tmp/openbox-live-hook-${index}.txt`,
    old_cwd: '/tmp',
    new_cwd: projectRoot,
    name: `worktree-${index}`,
    event: 'modified',
    reason: 'live matrix synthetic reason',
    error: 'live matrix synthetic failure',
    mcp_server_name: 'openbox',
    mode: 'request',
    url: 'https://example.com/',
    requested_schema: { type: 'object', properties: { approved: { type: 'boolean' } } },
    action: 'accept',
    content: { approved: true },
  };

  if (event === 'MessageDisplay' || event === 'Stop') {
    return {
      ...common,
      final: true,
      transcript: [
        {
          type: 'assistant',
          message: {
            model: 'claude-opus-4-8',
            usage: {
              input_tokens: 1234,
              output_tokens: 56,
              total_tokens: 1290,
            },
            content: [{ type: 'text', text: `live matrix final ${event}` }],
          },
        },
      ],
    };
  }

  return common;
}

function callHook(projectRoot: string, envelope: Record<string, unknown>) {
  const projectConfig = JSON.parse(
    readFileSync(path.join(projectRoot, '.claude-hooks', 'config.json'), 'utf-8'),
  ) as Record<string, string>;
  const env = {
    ...process.env,
    OPENBOX_CLI: OPENBOX,
    OPENBOX_HOME: path.join(projectRoot, '.openbox'),
    OPENBOX_CORE_URL: projectConfig.OPENBOX_CORE_URL,
    OPENBOX_API_KEY: projectConfig.OPENBOX_API_KEY,
    OPENBOX_AGENT_DID: projectConfig.OPENBOX_AGENT_DID,
    OPENBOX_AGENT_PRIVATE_KEY: projectConfig.OPENBOX_AGENT_PRIVATE_KEY,
  };
  const result = spawnSync(OPENBOX, ['claude-code', 'hook'], {
    cwd: projectRoot,
    encoding: 'utf-8',
    input: JSON.stringify(envelope),
    env,
    timeout: 30_000,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function parseStdout(stdout: string): Record<string, unknown> {
  const text = stdout.trim();
  if (!text) return {};
  return JSON.parse(text) as Record<string, unknown>;
}

function sessionFilePath(projectRoot: string, sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(projectRoot, '.claude-hooks', 'sessions', `${safe}.json`);
}

function readSessionRecord(projectRoot: string, sessionId: string): { workflowId: string; runId: string } {
  return JSON.parse(readFileSync(sessionFilePath(projectRoot, sessionId), 'utf-8')) as {
    workflowId: string;
    runId: string;
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollPlatformSession(
  platform: { apiUrl: string; apiKey: string; agentId: string },
  workflowId: string,
): Promise<Record<string, unknown>> {
  const url = new URL(`/agent/${platform.agentId}/sessions`, platform.apiUrl);
  url.searchParams.set('search', workflowId);
  url.searchParams.set('perPage', '5');
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await fetch(url, { headers: { 'X-API-Key': platform.apiKey } });
    const body = await response.json() as { data?: { data?: Array<Record<string, unknown>> } };
    if (!response.ok) {
      throw new Error(`platform session lookup failed for ${workflowId}: ${response.status}`);
    }
    const row = body.data?.data?.find((candidate) => candidate.workflow_id === workflowId);
    if (row) return row;
    await sleep(500);
  }
  throw new Error(`platform session not found for workflow ${workflowId}`);
}

function isBlockingOutput(stdout: string): boolean {
  const parsed = parseStdout(stdout);
  if (parsed.decision === 'block') return true;
  if (parsed.continue === false) return true;
  const hookSpecificOutput = parsed.hookSpecificOutput;
  if (!hookSpecificOutput || typeof hookSpecificOutput !== 'object') return false;
  const output = hookSpecificOutput as Record<string, unknown>;
  if (output.permissionDecision === 'deny' || output.permissionDecision === 'ask' || output.permissionDecision === 'defer') return true;
  const decision = output.decision;
  return !!decision && typeof decision === 'object' && (decision as Record<string, unknown>).behavior === 'deny';
}

function readHookLog(projectRoot: string): Array<Record<string, unknown>> {
  const candidates = [
    path.join(projectRoot, '.openbox', 'log', 'claude-code-hook.jsonl'),
    path.join(projectRoot, '.claude-hooks', 'log', 'claude-code-hook.jsonl'),
  ];
  const logPath = candidates.find((candidate) => existsSync(candidate));
  if (!logPath) return [];
  return readFileSync(logPath, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe.runIf(SHOULD_RUN)('claude-code live direct hook matrix', () => {
  it('runs every generated hook event against real Core and platform sessions', async () => {
    const config = requireLiveConfig();
    const platform = requirePlatformConfig();
    const events = HOOK_SPEC.events.map((event) => event.name);
    const baseSessionId = `live-hook-${Date.now()}`;
    const sequences = events.map((event, eventIndex) => {
      const sessionId = `${baseSessionId}-${eventIndex}-${event}`;
      if (event === 'SessionStart' || event === 'SessionEnd') {
        return { sessionId, events: ['SessionStart', 'SessionEnd'] };
      }
      if (event === 'Stop') return { sessionId, events: ['SessionStart', 'Stop'] };
      if (event === 'StopFailure') return { sessionId, events: ['SessionStart', 'StopFailure'] };
      return { sessionId, events: ['SessionStart', event, 'SessionEnd'] };
    });

    let index = 0;
    const projectResults: Array<{
      projectRoot: string;
      sessionId: string;
      workflowId: string;
      runId: string;
      sequence: string[];
      results: Array<{ event: string; stdout: string }>;
    }> = [];
    for (const sequence of sequences) {
      const projectRoot = createProject(config);
      const results: Array<{ event: string; stdout: string }> = [];
      let sessionRecord: { workflowId: string; runId: string } | undefined;
      for (const event of sequence.events) {
        const result = callHook(projectRoot, envelopeFor(event, sequence.sessionId, index++, projectRoot));
        expect(result.status, `${event} exited non-zero\nstdout=${result.stdout}\nstderr=${result.stderr}`).toBe(0);
        expect(result.stderr, `${event} wrote stderr`).not.toContain('OpenBox governance failed');
        expect(() => parseStdout(result.stdout), `${event} produced invalid stdout: ${result.stdout}`).not.toThrow();
        results.push({ event, stdout: result.stdout });
        if (event === 'SessionStart') {
          sessionRecord = readSessionRecord(projectRoot, sequence.sessionId);
        }
      }
      expect(sessionRecord, `${projectRoot} did not persist a session record after SessionStart`).toBeDefined();
      projectResults.push({
        projectRoot,
        sessionId: sequence.sessionId,
        workflowId: sessionRecord!.workflowId,
        runId: sessionRecord!.runId,
        sequence: sequence.events,
        results,
      });
    }

    const platformRows = await Promise.all(
      projectResults.map((result) => pollPlatformSession(platform, result.workflowId)),
    );
    expect(platformRows.map((row) => row.workflow_id).sort()).toEqual(
      projectResults.map((result) => result.workflowId).sort(),
    );
    for (const { row, result } of platformRows.map((row, idx) => ({ row, result: projectResults[idx] }))) {
      expect(row.run_id, `platform row run_id mismatch for ${result.workflowId}`).toBe(result.runId);
      expect(row.agent_id, `platform row agent_id mismatch for ${result.workflowId}`).toBe(platform.agentId);
      expect(row.event_count, `platform row has no event_count for ${result.workflowId}`).toBeTruthy();
    }

    const logLines = projectResults.flatMap(({ projectRoot }) => readHookLog(projectRoot));
    expect(logLines.filter((line) => line.error)).toEqual([]);
    const logEvents = new Set(logLines.map((line) => line.event));
    for (const event of events) {
      const loggedEvent = event.charAt(0).toLowerCase() + event.slice(1);
      expect(logEvents.has(loggedEvent), `hook log missing ${loggedEvent}`).toBe(true);
    }
    for (const { projectRoot, sequence, results } of projectResults) {
      const sessionDir = path.join(projectRoot, '.claude-hooks', 'sessions');
      const sessionFiles = existsSync(sessionDir)
        ? readdirSync(sessionDir, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map((entry) => entry.name)
        : [];
      const stopResult = results.find((result) => result.event === 'Stop');
      if (stopResult && isBlockingOutput(stopResult.stdout)) {
        expect(sessionFiles.length, `${projectRoot} should keep Stop retry state`).toBeGreaterThan(0);
        expect(parseStdout(stopResult.stdout).decision, `${projectRoot} Stop did not block`).toBe('block');
        continue;
      }
      expect(sessionFiles, `${projectRoot} left nonblocking session files for ${sequence.join(' -> ')}`).toEqual([]);
    }
  }, 180_000);
});
