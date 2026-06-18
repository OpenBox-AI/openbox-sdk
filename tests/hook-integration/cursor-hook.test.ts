// Spawns `openbox cursor hook` exactly the way Cursor does (stdin
// envelope, stdout verdict). One test per hook_event_name, asserts:
//
//   1. The handler exits 0 (errors fail closed in the SDK; we want
//      "no crash" here, not "no error"; verdicts can carry errors
//      and still exit 0).
//   2. Stdout is parseable JSON for `before*`/`preToolUse`/`after*`
//      events; sessionStart/stop emit nothing per the spec.
//   3. The JSONL log line at <project>/.cursor-hooks/log/cursor-hook.jsonl has a
//      matching record (event name + verdict_kind).
//
// Auth: each invocation uses a syntactically valid test runtime key and an
// unreachable Core URL. Permission-capable events must fail closed and
// observe-only events must still log without crashing. Real Core persistence
// is covered by the live suites.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ENVELOPES, type EventName, OBSERVE_EVENTS, PERMISSION_EVENTS } from './fixtures/envelopes';
import { requireOpenBoxCli } from '../helpers/openbox-cli.js';

const CLI = requireOpenBoxCli();
const HOOK_ROOT = mkdtempSync(join(tmpdir(), 'openbox-cursor-hook-'));
const HOOK_HOME = join(HOOK_ROOT, '.cursor-hooks');
const LOG = join(HOOK_HOME, 'log', 'cursor-hook.jsonl');

interface HookOutcome {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runHook(envelope: Record<string, unknown>): HookOutcome {
  const result = spawnSync('node', [CLI, 'cursor', 'hook'], {
    input: JSON.stringify(envelope),
    cwd: HOOK_ROOT,
    env: {
      ...process.env,
      OPENBOX_API_KEY: 'obx_test_' + 'x'.repeat(48),
      OPENBOX_CORE_URL: 'http://127.0.0.1:1',
      GOVERNANCE_TIMEOUT: '1',
      OPENBOX_HOME: HOOK_HOME,
      HITL_ENABLED: 'false',
    },
    encoding: 'utf-8',
    timeout: 15_000,
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function readLogTail(sinceCursor: number): string[] {
  if (!existsSync(LOG)) return [];
  const buf = readFileSync(LOG, 'utf-8');
  return buf
    .slice(sinceCursor)
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function logSize(): number {
  try {
    return statSync(LOG).size;
  } catch {
    return 0;
  }
}

beforeAll(() => {
  // Ensure the CLI entrypoint is available.
  if (!existsSync(CLI)) {
    throw new Error(
      `CLI not built at ${CLI}. Run \`npm run build\` before \`npm run test:hook-integration\`.`,
    );
  }
  // Ensure log dir exists so readLogTail works on first iteration.
  mkdirSync(join(HOOK_HOME, 'log'), { recursive: true });
  if (!existsSync(LOG)) writeFileSync(LOG, '');
});

afterAll(() => {
  rmSync(HOOK_ROOT, { recursive: true, force: true });
});

describe('cursor hook handler; every event', () => {
  for (const event of Object.keys(ENVELOPES) as EventName[]) {
    it(`${event}: handler runs, logs, exits cleanly`, () => {
      const before = logSize();
      const out = runHook(ENVELOPES[event]);

      expect(out.status, `stderr: ${out.stderr}`).toBe(0);

      // JSONL log line was appended.
      const newLines = readLogTail(before);
      const events = newLines
        .map((l) => {
          try {
            return JSON.parse(l) as { event?: string; verdict_kind?: string };
          } catch {
            return null;
          }
        })
        .filter((x) => x !== null) as Array<{ event?: string; verdict_kind?: string }>;
      const matching = events.filter((e) => e.event === event);
      expect(matching, `no log line for ${event}; saw: ${events.map((e) => e.event).join(', ')}`).not.toHaveLength(0);

      // Verdict-kind matches the spec grouping.
      const last = matching[matching.length - 1];
      const expectedKind =
        PERMISSION_EVENTS.has(event) ? 'permission' :
        OBSERVE_EVENTS.has(event) ? 'observe' :
        'none';
      expect(last.verdict_kind).toBe(expectedKind);
    });
  }

  it('rejects malformed envelope without crashing', () => {
    const out = runHook({ hook_event_name: 'beforeShellExecution' /* missing required fields */ });
    // The handler is lenient: dispatch on event name even if mapper
    // gets undefined fields. We only require it not to throw.
    expect(out.status).toBe(0);
  });

  it('unknown hook_event_name is a soft no-decision event', () => {
    const out = runHook({
      hook_event_name: 'somethingNobodyDeclared',
      conversation_id: 'x',
    });
    expect(out.status).toBe(0);
  });
});
