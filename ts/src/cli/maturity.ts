// Fine-grained CLI maturity gate. Each command - top-level OR
// sub-command - has a maturity label. The user opts in to higher
// maturity bands via `OPENBOX_EXPERIMENTAL_LEVEL=experimental` (env)
// or `--experimental` (flag).
//
// Path syntax: space-separated command path from the program root.
//   'auth login'         → `openbox auth login`
//   'agent list'         → `openbox agent list`
//   'mcp serve'          → `openbox mcp serve`
//   'audit forensics'    → `openbox audit forensics` (sub-of-stable)
//
// CONSERVATIVE DEFAULT: any path NOT in the registry is treated as
// `experimental`. To make a command visible without the user passing
// `--experimental`, add it here as `stable` (or `beta`).
//
// To make a parent visible, mark BOTH the parent and at least one
// child as `stable`. (Marking a parent without children leaves nothing
// to drill into; marking a child without the parent makes the child
// unreachable from `--help`.)

import type { Command } from 'commander';
import { ENV_VAR_BINDINGS } from '../env/generated/env-bindings.js';

export type Maturity = 'stable' | 'beta' | 'experimental';

const LEVEL: Record<Maturity, number> = {
  stable: 0,
  beta: 1,
  experimental: 2,
};

/**
 * Path → maturity. Unlisted paths default to `experimental`.
 *
 * Initial stable list: only commands the user has personally exercised
 * + the bedrock auth flow needed to reach anything else. Promote
 * commands here as you verify them - the goal is gradual confidence,
 * not blanket trust.
 */
export const COMMAND_MATURITY: Record<string, Maturity> = {
  // ─── Auth (bedrock - needed to reach anything else) ─────────────
  'auth':         'stable',
  'auth login':   'stable',
  'auth logout':  'stable',
  'auth profile': 'stable',
  'auth refresh': 'stable',

  // ─── Health / introspection (low-risk, used daily) ──────────────
  'health':       'stable',
  'versions':     'stable',
  'doctor':       'stable',

  // The promotions below cover only sub-commands exercised by
  // tests/e2e/cli-commands/* - stable means "we have an end-to-end
  // test that drives this path against a real backend."  Anything
  // unverified stays experimental.

  // ─── Agent (agent-lifecycle.test.ts) ────────────────────────────
  'agent':         'stable',
  'agent list':    'stable',
  'agent create':  'stable',
  'agent get':     'stable',
  'agent delete':  'stable',

  // ─── Team (team-lifecycle.test.ts) ──────────────────────────────
  'team':          'stable',
  'team list':     'stable',
  'team create':   'stable',
  'team get':      'stable',
  'team delete':   'stable',

  // ─── API key (api-key-lifecycle.test.ts) ────────────────────────
  'api-key':         'stable',
  'api-key rotate':  'stable',
  'api-key revoke':  'stable',

  // ─── Audit (audit-lifecycle.test.ts) ────────────────────────────
  'audit':                'stable',
  'audit list':           'stable',
  'audit preview':        'stable',
  'audit exports':        'stable',
  'audit delete-export':  'stable',

  // ─── Behavior (behavior-lifecycle.test.ts) ──────────────────────
  'behavior':         'stable',
  'behavior types':   'stable',
  'behavior list':    'stable',
  'behavior current': 'stable',
  'behavior get':     'stable',
  'behavior toggle':  'stable',
  'behavior delete':  'stable',

  // ─── Goal (goal-lifecycle.test.ts) ──────────────────────────────
  'goal':         'stable',
  'goal trend':   'stable',
  'goal drifts':  'stable',

  // ─── Guardrail (guardrail-lifecycle.test.ts) ────────────────────
  'guardrail':         'stable',
  'guardrail list':    'stable',
  'guardrail get':     'stable',
  'guardrail delete':  'stable',

  // ─── Approval (live-approval.test.ts + read-paths) ──────────────
  'approval':          'stable',
  'approval pending':  'stable',
  'approval decide':   'stable',
  'approval history':  'stable',
  'approval metrics':  'stable',

  // ─── Violation (live-violation.test.ts + read-paths) ────────────
  'violation':       'stable',
  'violation list':  'stable',
  'violation agent': 'stable',

  // ─── Org (org-lifecycle.test.ts) ────────────────────────────────
  'org':            'stable',
  'org get':        'stable',
  'org settings':   'stable',
  'org dashboard':  'stable',
  'org sessions':   'stable',
  'org approvals':  'stable',

  // ─── Policy (policy-lifecycle.test.ts + live-* tests) ───────────
  'policy':         'stable',
  'policy list':    'stable',
  'policy create':  'stable',
  'policy get':     'stable',
  'policy current': 'stable',

  // ─── Session (live-ingest, read-paths, demo-agent-analytics) ────
  'session':            'stable',
  'session list':       'stable',
  'session active':     'stable',
  'session get':        'stable',
  'session logs':       'stable',
  'session goal-stats': 'stable',
  'session terminate':  'stable',

  // ─── Trust (read-paths.test.ts + demo-agent-analytics) ──────────
  'trust':              'stable',
  'trust histories':    'stable',
  'trust events':       'stable',
  'trust tier-changes': 'stable',

  // ─── Observe (read-paths.test.ts + demo-agent-analytics) ────────
  'observe':         'stable',
  'observe data':    'stable',
  'observe issues':  'stable',
  'observe metrics': 'stable',
  'observe logs':    'stable',
  'observe insights':'stable',

  // Everything not listed (member, aivss, verify, webhook, sso, core,
  // setup, mcp, skill, claude-code, cursor, plus untested sub-commands
  // of the stable parents above) defaults to `experimental` until an
  // e2e test or manual verification justifies promotion.
};

let cliOverride: Maturity | null = null;

/** Set by the CLI's top-level `--experimental` flag handler. */
export function setMaturityOverride(level: Maturity | null): void {
  cliOverride = level;
}

/** What level the user is currently asking for. CLI flag > env var > default 'stable'. */
export function currentMaturityLevel(): Maturity {
  if (cliOverride) return cliOverride;
  const envName = ENV_VAR_BINDINGS.experimentalLevel.name;
  const env = (process.env[envName] ?? '').toLowerCase();
  if (env === 'experimental' || env === 'beta' || env === 'stable') return env;
  return 'stable';
}

/** True if a command at the target maturity is visible at the current level. */
export function isMaturityVisible(target: Maturity, current = currentMaturityLevel()): boolean {
  return LEVEL[target] <= LEVEL[current];
}

/**
 * Walk the program's full command tree. For each command:
 *  - look up its full path's maturity (default: experimental)
 *  - if invisible at the current level, REMOVE it from the parent
 *  - if visible but non-stable, prefix its description with [experimental]/[beta]
 *
 * Call this AFTER all `register<X>Commands(program)` calls and BEFORE
 * `program.parseAsync(argv)`.
 */
export function gateCommands(program: Command): void {
  const current = currentMaturityLevel();

  function walk(parent: Command, path: string[]): void {
    const snapshot = [...parent.commands];
    for (const sub of snapshot) {
      const subPath = [...path, sub.name()];
      const key = subPath.join(' ');
      const target: Maturity = COMMAND_MATURITY[key] ?? 'experimental';

      if (!isMaturityVisible(target, current)) {
        const idx = parent.commands.indexOf(sub);
        if (idx >= 0) parent.commands.splice(idx, 1);
        continue;
      }

      if (target !== 'stable') {
        const tag = target === 'experimental' ? '[experimental] ' : '[beta] ';
        const desc = sub.description() ?? '';
        if (!desc.startsWith('[experimental]') && !desc.startsWith('[beta]')) {
          sub.description(tag + desc);
        }
      }
      walk(sub, subPath);
    }
  }

  walk(program, []);
}
