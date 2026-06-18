// Direct test of `openbox claude-code hook` as a subprocess.
//
// Skips claude entirely: pipes a synthetic ClaudeCodeEnvelope to
// the hook on stdin and asserts the stdout JSON matches the
// shape claude-code expects per @verdictShape. Faster than the
// end-to-end matrix (no model latency) and covers paths claude
// cannot easily drive: permissionRequest, subagent events, stale
// config knobs, and exact stdout shape.
//
// The hook honors a config-dir override through the walk-up
// resolver: we plant a `.claude-hooks/config.json` in a temp
// directory and spawn the subprocess with cwd inside that dir,
// so each case has its own isolated project config without touching
// user-level hook config.

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HOOK_SPEC } from '../../ts/src/core-client/generated/runtime/claude-code.js';
import { requireOpenBoxCli } from '../helpers/openbox-cli.js';

const OPENBOX = requireOpenBoxCli();
const TEST_KEY = 'obx_test_0000000000000000000000000000000000000000000000';
const DEAD_CORE = 'http://127.0.0.1:1';

interface ConfigOverrides {
  /** Stale SKIP_TOOLS list retained by old project configs. */
  skipTools?: string[];
  /** Stale SKIP_ACTIVITY_TYPES list retained by old project configs. */
  skipActivityTypes?: string[];
  /** Stale fail-open value; runtime normalizes to fail_closed. */
  governancePolicy?: 'fail_open' | 'fail_closed';
  /** Runtime key. Defaults to a syntactically valid test key. */
  apiKey?: string;
  /** Override the core URL; the dead-port pattern exercises
   *  fail-closed. */
  coreUrl?: string;
  /** Verbose log toggle. */
  verbose?: boolean;
  /** Omit OPENBOX_API_KEY to exercise runtime readiness paths. */
  omitApiKey?: boolean;
}

interface HookResult {
  status: number | null;
  stdout: string;
  stderr: string;
  parsed: unknown;
}

function planConfigDir(opts: ConfigOverrides): string {
  const root = mkdtempSync(path.join(tmpdir(), 'obx-cc-stdin-'));
  const configDir = path.join(root, '.claude-hooks');
  mkdirSync(configDir, { recursive: true });
  const cfg: Record<string, unknown> = {
    OPENBOX_CORE_URL: opts.coreUrl ?? DEAD_CORE,
    governancePolicy: opts.governancePolicy ?? 'fail_closed',
    governanceTimeout: 1,
    hitlEnabled: false,
    verbose: opts.verbose ?? false,
  };
  if (!opts.omitApiKey) {
    cfg.OPENBOX_API_KEY = opts.apiKey ?? TEST_KEY;
  }
  if (opts.skipTools) cfg.SKIP_TOOLS = opts.skipTools.join(',');
  if (opts.skipActivityTypes) cfg.SKIP_ACTIVITY_TYPES = opts.skipActivityTypes.join(',');
  writeFileSync(path.join(configDir, 'config.json'), JSON.stringify(cfg, null, 2));
  return root;
}

function callHook(
  envelope: Record<string, unknown>,
  configRoot: string,
  envOverrides: Record<string, string | undefined> = {},
): HookResult {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  const r = spawnSync(OPENBOX, ['claude-code', 'hook'], {
    cwd: configRoot,
    encoding: 'utf-8',
    timeout: 15_000,
    input: JSON.stringify(envelope),
    env,
  });
  let parsed: unknown = undefined;
  const text = (r.stdout ?? '').trim();
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      /* leave parsed undefined; caller asserts on raw stdout */
    }
  }
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', parsed };
}

describe('claude-code hook stdin/stdout', () => {
  it('every spec-defined hook event dispatches cleanly under fail-closed Core outage', () => {
    // Covers the full generated HOOK_SPEC inventory. WorktreeCreate
    // is intentionally absent from HOOK_SPEC because it is opt-in and
    // replaces Claude Code's default worktree creation behavior.
    const root = planConfigDir({ coreUrl: DEAD_CORE });
    for (const { name: event } of HOOK_SPEC.events) {
      const r = callHook(
        {
          hook_event_name: event,
          session_id: `s-${event}`,
          agent_id: 'test-agent',
          agent_type: 'task',
          tool_name: 'Read',
          tool_input: { file_path: '/etc/hostname' },
          prompt: 'test prompt',
          expanded_prompt: 'expanded prompt',
          message: 'message',
          task_id: 'task-1',
          task_subject: 'subject',
          teammate_name: 'teammate',
          mcp_server_name: 'openbox',
        },
        root,
      );
      expect(r.status, `${event} failed: ${r.stderr}`).toBe(0);
    }
  });

  it('permission_mode rides through the envelope and still fails closed', () => {
    // Claude carries `permission_mode` (plan, default, etc.) on
    // every envelope. The adapter passes it through to the activity
    // payload; the hook must keep returning a sane verdict shape
    // regardless of the mode value.
    const root = planConfigDir({ coreUrl: DEAD_CORE });
    for (const mode of ['default', 'plan', 'acceptEdits', 'bypassPermissions']) {
      const r = callHook(
        {
          hook_event_name: 'PreToolUse',
          session_id: `s-pm-${mode}`,
          tool_name: 'Read',
          tool_input: { file_path: '/etc/hostname' },
          permission_mode: mode,
        },
        root,
      );
      expect(r.status, `permission_mode=${mode} failed: ${r.stderr}`).toBe(0);
      const out = r.parsed as { hookSpecificOutput?: { permissionDecision?: string } };
      expect(out?.hookSpecificOutput?.permissionDecision).toBe('deny');
    }
  });

  it('verbose=true does not break the verdict shape on dispatch', () => {
    // Note: the per-event verbose log (`<configDir>/hook.log`) is
    // not currently wired; the adapter calls `createLogger().initLogger`
    // but never calls `log()`. The only on-disk log today is the
    // JSONL hook log at `<project>/.claude-hooks/log/claude-code-hook.jsonl`,
    // which is covered separately. If a future PR wires the
    // human-readable log, this test should grow assertions on
    // <configDir>/hook.log; for now we only assert that verbose
    // does not regress the verdict path.
    const root = planConfigDir({ verbose: true, coreUrl: DEAD_CORE });
    const r = callHook(
      {
        hook_event_name: 'PreToolUse',
        session_id: 's-verbose',
        tool_name: 'Read',
        tool_input: { file_path: '/etc/hostname' },
      },
      root,
    );
    expect(r.status).toBe(0);
    const out = r.parsed as { hookSpecificOutput?: { permissionDecision?: string } };
    expect(out?.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  it('stale skipTools config does not bypass governance for the named tool', () => {
    const root = planConfigDir({ skipTools: ['TodoWrite'], coreUrl: DEAD_CORE });
    const r = callHook(
      {
        hook_event_name: 'PreToolUse',
        session_id: 's-5',
        tool_name: 'TodoWrite',
        tool_input: { todos: [] },
      },
      root,
    );
    expect(r.status).toBe(0);
    const out = r.parsed as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } };
    expect(out.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput?.permissionDecisionReason).toContain('[OpenBox]');
  });

  it('stale fail_open with unreachable core still denies decision-capable PreToolUse', () => {
    const root = planConfigDir({ coreUrl: 'http://127.0.0.1:1', governancePolicy: 'fail_open' });
    const r = callHook(
      {
        hook_event_name: 'PreToolUse',
        session_id: 's-6',
        tool_name: 'Read',
        tool_input: { file_path: '/etc/hostname' },
      },
      root,
      { OPENBOX_CORE_URL: 'http://127.0.0.1:1' },
    );
    expect(r.status, `exit=${r.status} stderr=${r.stderr}`).toBe(0);
    const out = r.parsed as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } };
    expect(out.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput?.permissionDecisionReason).toContain('[OpenBox]');
  });

  it('fail-closed with unreachable core denies decision-capable PreToolUse', () => {
    const root = planConfigDir({ coreUrl: 'http://127.0.0.1:1', governancePolicy: 'fail_closed' });
    const r = callHook(
      {
        hook_event_name: 'PreToolUse',
        session_id: 's-fc-core',
        tool_name: 'Read',
        tool_input: { file_path: '/etc/hostname' },
      },
      root,
      { OPENBOX_CORE_URL: 'http://127.0.0.1:1' },
    );
    expect(r.status, `exit=${r.status} stderr=${r.stderr}`).toBe(0);
    const out = r.parsed as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } };
    expect(out.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput?.permissionDecisionReason).toContain('[OpenBox]');
  });

  it('missing OPENBOX_API_KEY denies decision-capable hooks even with stale fail_open', () => {
    const root = planConfigDir({ omitApiKey: true, governancePolicy: 'fail_open' });
    const r = callHook(
      {
        hook_event_name: 'PreToolUse',
        session_id: 's-7',
        tool_name: 'Read',
        tool_input: { file_path: '/etc/hostname' },
      },
      root,
      { OPENBOX_API_KEY: '' },
    );
    expect(r.status).toBe(0);
    const out = r.parsed as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } };
    expect(out.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput?.permissionDecisionReason).toContain('missing OPENBOX_API_KEY');
  });

  it('missing OPENBOX_API_KEY fail-closed writes each decision-capable deny/block shape', () => {
    const root = planConfigDir({ omitApiKey: true, governancePolicy: 'fail_closed' });
    const cases: Array<{
      event: string;
      envelope?: Record<string, unknown>;
      assert: (parsed: any) => void;
    }> = [
      {
        event: 'PreToolUse',
        assert: (out) => expect(out.hookSpecificOutput.permissionDecision).toBe('deny'),
      },
      {
        event: 'PermissionRequest',
        assert: (out) => expect(out.hookSpecificOutput.decision.behavior).toBe('deny'),
      },
      {
        event: 'PermissionDenied',
        assert: (out) => expect(out.hookSpecificOutput.retry).toBe(false),
      },
      {
        event: 'PostToolUse',
        assert: (out) => expect(out.decision).toBe('block'),
      },
      {
        event: 'PostToolUseFailure',
        assert: (out) => expect(out.hookSpecificOutput.additionalContext).toContain('[OpenBox]'),
      },
      {
        event: 'TaskCreated',
        assert: (out) => expect(out.continue).toBe(false),
      },
      {
        event: 'Elicitation',
        assert: (out) => expect(out.hookSpecificOutput.action).toBe('decline'),
      },
      {
        event: 'ConfigChange',
        assert: (out) => expect(out.decision).toBe('block'),
      },
    ];

    for (const c of cases) {
      const r = callHook(
        {
          hook_event_name: c.event,
          session_id: `s-fc-${c.event}`,
          tool_name: 'Read',
          tool_input: { file_path: '/etc/hostname' },
          ...c.envelope,
        },
        root,
        { OPENBOX_API_KEY: '' },
      );
      expect(r.status, `${c.event} failed: ${r.stderr}`).toBe(0);
      expect(r.parsed, `${c.event} produced no JSON`).toBeDefined();
      c.assert(r.parsed);
    }
  });

  it('missing OPENBOX_API_KEY fail-closed does not re-block an active Stop retry', () => {
    const root = planConfigDir({ omitApiKey: true, governancePolicy: 'fail_closed' });
    const r = callHook(
      {
        hook_event_name: 'Stop',
        session_id: 's-stop-active-retry',
        stop_hook_active: true,
      },
      root,
      { OPENBOX_API_KEY: '' },
    );
    expect(r.status, `Stop active retry failed: ${r.stderr}`).toBe(0);
    const out = (r.parsed ?? {}) as Record<string, unknown>;
    expect(out.decision).toBeUndefined();
  });

  it('unreachable core fail-closed does not re-block an active Stop retry', () => {
    const root = planConfigDir({ coreUrl: 'http://127.0.0.1:1', governancePolicy: 'fail_closed' });
    const r = callHook(
      {
        hook_event_name: 'Stop',
        session_id: 's-stop-active-core',
        stop_hook_active: true,
        background_tasks: [],
        session_crons: [],
      },
      root,
      { OPENBOX_CORE_URL: 'http://127.0.0.1:1' },
    );
    expect(r.status, `Stop active retry failed: ${r.stderr}`).toBe(0);
    const out = (r.parsed ?? {}) as Record<string, unknown>;
    expect(out.decision).toBeUndefined();
  });

  it('JSONL hook log captures one record per event', () => {
    const root = planConfigDir({ coreUrl: DEAD_CORE });
    const logPath = path.join(root, '.claude-hooks', 'log', 'claude-code-hook.jsonl');
    const before = existsSync(logPath) ? readFileSync(logPath, 'utf-8').length : 0;

    const events = ['PreToolUse', 'PostToolUse', 'SessionStart', 'SessionEnd', 'Stop'];
    for (const event of events) {
      callHook(
        {
          hook_event_name: event,
          session_id: 's-log',
          tool_name: 'Read',
          tool_input: { file_path: '/etc/hostname' },
        },
        root,
      );
    }

    const after = existsSync(logPath) ? readFileSync(logPath, 'utf-8') : '';
    const appended = after.slice(before);
    const lines = appended.split('\n').filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
    // One log line per dispatched event. Event names in the log
    // are camelCase per hook-handler.ts.
    const expected = ['preToolUse', 'postToolUse', 'sessionStart', 'sessionEnd', 'stop'];
    for (const event of expected) {
      expect(lines.some((l) => l.event === event), `log missing ${event}`).toBe(true);
    }
  });

});
