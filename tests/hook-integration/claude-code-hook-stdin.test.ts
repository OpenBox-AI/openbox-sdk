// Direct test of `openbox claude-code hook` as a subprocess.
//
// Skips claude entirely: pipes a synthetic ClaudeCodeEnvelope to
// the hook on stdin and asserts the stdout JSON matches the
// shape claude-code expects per @verdictShape. Faster than the
// end-to-end matrix (no model latency) and covers paths claude
// cannot easily drive: dryRun, skipTools, skipActivityTypes,
// permissionRequest, subagent events, exact stdout shape.
//
// The hook honors a config-dir override through the walk-up
// resolver: we plant a `.claude-hooks/config.json` in a temp
// directory and spawn the subprocess with cwd inside that dir,
// so each case has its own isolated config without touching the
// user's global ~/.claude-hooks/.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';

const OPENBOX = process.env.OPENBOX_CLI ?? 'openbox';

interface ConfigOverrides {
  /** When set, the synthetic config writes DRY_RUN=true so the
   *  hook returns undefined (default allow) without calling the
   *  backend. */
  dryRun?: boolean;
  /** SKIP_TOOLS list; tool_name values in this list cause the hook
   *  to return early. */
  skipTools?: string[];
  /** SKIP_ACTIVITY_TYPES list; activity types in this list cause
   *  the hook to skip. */
  skipActivityTypes?: string[];
  /** Pin GOVERNANCE_POLICY; defaults to fail_open. */
  governancePolicy?: 'fail_open' | 'fail_closed';
  /** Override the core URL; the dead-port pattern exercises
   *  fail-open. */
  coreUrl?: string;
  /** Verbose log toggle. */
  verbose?: boolean;
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
    // No real key: with the dryRun path we never hit the backend.
    // For the fail-open path the API key still has to validate
    // shape, so we use a syntactically-correct test key.
    OPENBOX_API_KEY: 'obx_test_0000000000000000000000000000000000000000000000',
    OPENBOX_CORE_URL: opts.coreUrl ?? 'http://127.0.0.1:1',
    OPENBOX_ENDPOINT: opts.coreUrl ?? 'http://127.0.0.1:1',
    GOVERNANCE_POLICY: opts.governancePolicy ?? 'fail_open',
    HITL_ENABLED: false,
    DRY_RUN: opts.dryRun ?? false,
    VERBOSE: opts.verbose ?? false,
  };
  if (opts.skipTools) cfg.SKIP_TOOLS = opts.skipTools.join(',');
  if (opts.skipActivityTypes) cfg.SKIP_ACTIVITY_TYPES = opts.skipActivityTypes.join(',');
  writeFileSync(path.join(configDir, 'config.json'), JSON.stringify(cfg, null, 2));
  return root;
}

function callHook(envelope: Record<string, unknown>, configRoot: string): HookResult {
  const r = spawnSync(OPENBOX, ['claude-code', 'hook'], {
    cwd: configRoot,
    encoding: 'utf-8',
    timeout: 15_000,
    input: JSON.stringify(envelope),
    env: { ...process.env },
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
  it('PreToolUse default-allow returns the permission-decision allow shape', () => {
    const root = planConfigDir({ dryRun: true });
    const r = callHook(
      {
        hook_event_name: 'PreToolUse',
        session_id: 's-1',
        tool_name: 'Read',
        tool_input: { file_path: '/etc/hostname' },
      },
      root,
    );
    expect(r.status, `exit=${r.status} stderr=${r.stderr}`).toBe(0);
    const out = r.parsed as { hookSpecificOutput?: { permissionDecision?: string; hookEventName?: string } };
    expect(out?.hookSpecificOutput?.hookEventName).toBe('PreToolUse');
    expect(out?.hookSpecificOutput?.permissionDecision).toBe('allow');
  });

  it('UserPromptSubmit on dryRun emits the decision-block allow shape (empty)', () => {
    const root = planConfigDir({ dryRun: true });
    const r = callHook(
      {
        hook_event_name: 'UserPromptSubmit',
        session_id: 's-2',
        prompt: 'test',
      },
      root,
    );
    expect(r.status).toBe(0);
    // UserPromptSubmit dispatches through `decision-block`; on
    // allow / constrain / require_approval that shape is `{}`.
    // claude treats `{}` and empty stdout interchangeably; both
    // pass-through.
    const out = (r.parsed ?? {}) as Record<string, unknown>;
    expect(out.decision).toBeUndefined();
  });

  it('PostToolUse on dryRun emits no decision payload (observe-only event)', () => {
    const root = planConfigDir({ dryRun: true });
    const r = callHook(
      {
        hook_event_name: 'PostToolUse',
        session_id: 's-3',
        tool_name: 'Read',
        tool_input: { file_path: '/etc/hostname' },
        tool_output: 'hostname-contents',
      },
      root,
    );
    expect(r.status).toBe(0);
    // PostToolUse emits decision-block shape; on allow this is `{}`.
    // The spec says claude treats empty stdout the same way; either
    // is correct.
    const out = r.parsed as Record<string, unknown> | undefined;
    if (out && Object.keys(out).length > 0) {
      // decision-block allow shape carries no `decision` field.
      expect(out.decision).toBeUndefined();
    }
  });

  it('PermissionRequest returns the permission-request allow shape on dryRun', () => {
    const root = planConfigDir({ dryRun: true });
    const r = callHook(
      {
        hook_event_name: 'PermissionRequest',
        session_id: 's-4',
        tool_name: 'Read',
        tool_input: { file_path: '/etc/hostname' },
      },
      root,
    );
    expect(r.status).toBe(0);
    const out = r.parsed as {
      hookSpecificOutput?: { decision?: { behavior?: string }; hookEventName?: string };
    };
    // PermissionRequest is mapped to permission-request shape with
    // `decision: { behavior: 'allow' }` on allow / constrain.
    expect(out?.hookSpecificOutput?.hookEventName).toBe('PermissionRequest');
    expect(out?.hookSpecificOutput?.decision?.behavior).toBe('allow');
  });

  it('every spec-defined hook event dispatches cleanly under dryRun', () => {
    // Covers the long tail beyond preToolUse / postToolUse:
    // PreCompact and Notification have handlers in the adapter
    // but no other test fires them. SessionStart / SessionEnd /
    // Stop / SubagentStart / SubagentStop are observe-only events
    // that should never surface a verdict; the hook must still
    // dispatch them and write a log record.
    const root = planConfigDir({ dryRun: true });
    for (const event of [
      'SessionStart',
      'SessionEnd',
      'Stop',
      'SubagentStart',
      'SubagentStop',
      'Notification',
      'PreCompact',
    ]) {
      const r = callHook(
        {
          hook_event_name: event,
          session_id: `s-${event}`,
          agent_id: 'test-agent',
          agent_type: 'task',
        },
        root,
      );
      expect(r.status, `${event} failed: ${r.stderr}`).toBe(0);
    }
  });

  it('permission_mode rides through the envelope without breaking the verdict shape', () => {
    // Claude carries `permission_mode` (plan, default, etc.) on
    // every envelope. The adapter passes it through to the activity
    // payload; the hook must keep returning a sane verdict shape
    // regardless of the mode value.
    const root = planConfigDir({ dryRun: true });
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
      expect(out?.hookSpecificOutput?.permissionDecision).toBe('allow');
    }
  });

  it('VERBOSE=true does not break the verdict shape on dispatch', () => {
    // Note: the per-event verbose log (`<configDir>/hook.log`) is
    // not currently wired; the adapter calls `createLogger().initLogger`
    // but never calls `log()`. The only on-disk log today is the
    // JSONL hook log at `~/.openbox/log/claude-code-hook.jsonl`,
    // which is covered separately. If a future PR wires the
    // human-readable log, this test should grow assertions on
    // <configDir>/hook.log; for now we only assert that VERBOSE
    // does not regress the verdict path.
    const root = planConfigDir({ dryRun: true, verbose: true });
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
    expect(out?.hookSpecificOutput?.permissionDecision).toBe('allow');
  });

  it('skipTools causes the hook to bypass governance for the named tool', () => {
    const root = planConfigDir({ skipTools: ['TodoWrite'] });
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
    // The hook returns the default-allow shape; we accept either
    // an explicit allow or an empty stdout (both equivalent to claude).
    if (r.parsed) {
      const out = r.parsed as { hookSpecificOutput?: { permissionDecision?: string } };
      const decision = out?.hookSpecificOutput?.permissionDecision;
      expect(decision === undefined || decision === 'allow').toBe(true);
    }
  });

  it('fail-open with unreachable core returns default-allow shape, not an error', () => {
    const root = planConfigDir({ coreUrl: 'http://127.0.0.1:1', governancePolicy: 'fail_open' });
    const r = callHook(
      {
        hook_event_name: 'PreToolUse',
        session_id: 's-6',
        tool_name: 'Read',
        tool_input: { file_path: '/etc/hostname' },
      },
      root,
    );
    expect(r.status, `exit=${r.status} stderr=${r.stderr}`).toBe(0);
    // The hook must not surface a deny on a transport error under
    // fail_open; the worst it should emit is empty stdout (default
    // allow on claude's side).
    if (r.parsed) {
      const out = r.parsed as { hookSpecificOutput?: { permissionDecision?: string } };
      expect(out?.hookSpecificOutput?.permissionDecision).not.toBe('deny');
    }
  });

  it('missing OPENBOX_API_KEY short-circuits with no stdout (pass-through)', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'obx-cc-stdin-nokey-'));
    const configDir = path.join(root, '.claude-hooks');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      path.join(configDir, 'config.json'),
      JSON.stringify({
        OPENBOX_ENDPOINT: 'http://127.0.0.1:1',
        GOVERNANCE_POLICY: 'fail_open',
        HITL_ENABLED: false,
      }),
    );
    const r = callHook(
      {
        hook_event_name: 'PreToolUse',
        session_id: 's-7',
        tool_name: 'Read',
        tool_input: { file_path: '/etc/hostname' },
      },
      root,
    );
    // The hook exits 0 (no key path) without writing a decision
    // to stdout; claude treats absent stdout as default allow.
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('');
  });

  it('JSONL hook log captures one record per event', () => {
    const root = planConfigDir({ dryRun: true });
    const logPath = path.join(homedir(), '.openbox', 'log', 'claude-code-hook.jsonl');
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
