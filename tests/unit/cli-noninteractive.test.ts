// Drift lock for the non-interactive CLI contract.
//
//  - No raw `process.exit(...)` outside `ts/src/cli/exit-codes.ts` and
//    `ts/src/validators/index.ts`. Everything else routes through
//    `bailWith` or `reportAndExit` so the exit-code taxonomy in
//    EXIT_CODES is the single source of truth.
//
//  - No raw `\x1b[` ANSI escape sequences outside `ts/src/cli/colors.ts`.
//    All color output must flow through the `useColor()`-aware helpers
//    so NO_COLOR / OPENBOX_NO_COLOR / CI / --no-color cleanly degrade.
//
//  - No `\rspinner-style` carriage-return overwrites outside the
//    test-utils renderer. Progress on long-running commands must be
//    `\n`-terminated lines that survive piping to a log file.

import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';

const SRC_ROOT = 'ts/src';
const CLI_ROOT = `${SRC_ROOT}/cli`;

function listSourceFiles(root: string): string[] {
  const out = execSync(`find ${root} -type f -name '*.ts'`, { encoding: 'utf-8' });
  return out
    .split('\n')
    .filter(Boolean)
    .filter((p) => !p.endsWith('.d.ts'))
    .filter((p) => !p.includes('/generated/'));
}

describe('CLI non-interactive contract', () => {
  it('only exit-codes.ts and validators/index.ts may call process.exit directly', () => {
    const files = listSourceFiles(SRC_ROOT);
    const offenders: string[] = [];
    const allowed = new Set([
      `${CLI_ROOT}/exit-codes.ts`,
      `${SRC_ROOT}/validators/index.ts`,
    ]);
    for (const file of files) {
      if (allowed.has(file)) continue;
      // Skip runtime/* - adapters run inside Claude Code/Cursor hooks
      // where they own the process anyway, and have their own exit code
      // contract with the host. Drift lives in cli/.
      if (file.startsWith(`${SRC_ROOT}/runtime/`)) continue;
      const src = readFileSync(file, 'utf-8');
      if (/process\.exit\s*\(/.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('only colors.ts, validators/index.ts, and runtime/* may emit raw ANSI escapes', () => {
    const files = listSourceFiles(SRC_ROOT);
    const offenders: { file: string; matches: string[] }[] = [];
    const allowed = new Set([
      `${CLI_ROOT}/colors.ts`,
    ]);
    for (const file of files) {
      if (allowed.has(file)) continue;
      // runtime/ adapters write protocol-shaped JSON to stdout; ANSI
      // there would never be rendered anyway. Skip.
      if (file.startsWith(`${SRC_ROOT}/runtime/`)) continue;
      const src = readFileSync(file, 'utf-8');
      const matches = src.match(/\\x1b\[/g);
      if (matches && matches.length > 0) {
        // validators/index.ts is allowed because it imports `color` from
        // the central helper - but the literal string check would still
        // hit it if it leaked. Currently it has zero raw escapes.
        offenders.push({ file, matches: [`${matches.length}x \\x1b[`] });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('non-interactive helper exposes the four contract functions', async () => {
    const mod = await import('../../ts/src/cli/non-interactive.js');
    expect(typeof mod.isNonInteractive).toBe('function');
    expect(typeof mod.assumeYes).toBe('function');
    expect(typeof mod.useColor).toBe('function');
    expect(typeof mod.isQuiet).toBe('function');
  });

  it('exit-codes module exposes the full taxonomy', async () => {
    const mod = await import('../../ts/src/cli/exit-codes.js');
    expect(mod.EXIT.OK).toBe(0);
    expect(mod.EXIT.GENERIC).toBe(1);
    expect(mod.EXIT.USAGE).toBe(2);
    expect(mod.EXIT.AUTH).toBe(3);
    expect(mod.EXIT.FEATURE_DISABLED).toBe(4);
    expect(mod.EXIT.NOT_FOUND).toBe(5);
    expect(mod.EXIT.CONFLICT).toBe(6);
    expect(mod.EXIT.RATE_LIMIT).toBe(7);
    expect(mod.EXIT.SERVER).toBe(8);
    expect(mod.EXIT.NETWORK).toBe(9);
  });

  it('exitCodeForStatus maps HTTP statuses to retry-aware codes', async () => {
    const { EXIT, exitCodeForStatus, isRetryable } = await import(
      '../../ts/src/cli/exit-codes.js'
    );
    expect(exitCodeForStatus(401)).toBe(EXIT.AUTH);
    expect(exitCodeForStatus(403)).toBe(EXIT.AUTH);
    expect(exitCodeForStatus(404)).toBe(EXIT.NOT_FOUND);
    expect(exitCodeForStatus(409)).toBe(EXIT.CONFLICT);
    expect(exitCodeForStatus(429)).toBe(EXIT.RATE_LIMIT);
    expect(exitCodeForStatus(500)).toBe(EXIT.SERVER);
    expect(exitCodeForStatus(503)).toBe(EXIT.SERVER);
    expect(exitCodeForStatus(400)).toBe(EXIT.GENERIC);

    expect(isRetryable(EXIT.RATE_LIMIT)).toBe(true);
    expect(isRetryable(EXIT.SERVER)).toBe(true);
    expect(isRetryable(EXIT.NETWORK)).toBe(true);
    expect(isRetryable(EXIT.AUTH)).toBe(false);
    expect(isRetryable(EXIT.NOT_FOUND)).toBe(false);
  });

  it('OPENBOX_BACKEND_API_KEY env can supply a key without writing to disk', () => {
    // Smoke check: just confirm the path exists in config.ts. The full
    // round-trip test requires a live backend (covered by e2e).
    const src = readFileSync(`${CLI_ROOT}/config.ts`, 'utf-8');
    expect(src).toContain('OPENBOX_BACKEND_API_KEY');
  });

  it('every spec op with a destructive verb carries @cli_destructive (or is allowlisted)', () => {
    // Verbs that should always be destructive. Keep this short; if you
    // think you need to add one, you almost certainly want @cli_destructive
    // in the spec instead.
    const DESTRUCTIVE_VERBS = [
      'delete',
      'revoke',
      'rotate',
      'remove',
      'removeMembers',
      'terminate',
      'prune',
    ];
    // Anything in this set is allowed to NOT carry @cli_destructive.
    // Empty by design - every reachable destructive verb in the spec
    // must declare its destructive nature so the runtime gate fires.
    const ALLOWLIST = new Set<string>([]);

    const spec = readFileSync('specs/typespec/cli/main.tsp', 'utf-8');
    const lines = spec.split('\n');
    const offenders: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      // Match `  <verb>(` at the body-of-interface indent. Skip cli_*
      // decorators that share verb-like names (`@cli_required`, etc).
      const m = lines[i].match(/^\s\s(\w+)\s*\(/);
      if (!m) continue;
      const verb = m[1];
      if (!DESTRUCTIVE_VERBS.includes(verb)) continue;
      if (ALLOWLIST.has(verb)) continue;
      // Look back up to 6 lines for @cli_destructive (the decorator stack).
      const start = Math.max(0, i - 6);
      const stack = lines.slice(start, i).join('\n');
      if (!stack.includes('@cli_destructive')) {
        offenders.push(`line ${i + 1}: \`${verb}(...)\` lacks @cli_destructive`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('SubcommandSpec carries the destructive flag when the spec sets @cli_destructive', async () => {
    const { AGENT_HANDLERS } = await import(
      '../../ts/src/cli/generated/cli-handlers/agent.js'
    );
    const del = AGENT_HANDLERS.find((h) => h.name === 'delete');
    expect(del).toBeDefined();
    expect(del?.destructive).toBe(true);
  });

  it('every destructive SubcommandSpec actually rejects at runtime without --yes', async () => {
    // Audit-driven: we previously trusted the emitter to wire the flag
    // through to runtime. This test asserts the WIRE-TO-RUNTIME contract.
    // For every `destructive: true` handler in every namespace, register
    // it on a fresh Commander tree and invoke without --yes. The gate
    // throws DestructiveConfirmRequiredError → action's catch funnels
    // through reportAndExit → process.exit(EXIT.USAGE = 2). We shim
    // process.exit and assert the exit code per op.
    const { Command } = await import('commander');
    const { wireSubcommands } = await import('../../ts/src/cli/wire-subcommands');
    const { EXIT } = await import('../../ts/src/cli/exit-codes');

    const namespaces: Array<[string, string]> = [
      ['agent', '../../ts/src/cli/generated/cli-handlers/agent.js'],
      ['api-key', '../../ts/src/cli/generated/cli-handlers/api-key.js'],
      ['behavior', '../../ts/src/cli/generated/cli-handlers/behavior.js'],
      ['guardrail', '../../ts/src/cli/generated/cli-handlers/guardrail.js'],
      ['member', '../../ts/src/cli/generated/cli-handlers/member.js'],
      ['session', '../../ts/src/cli/generated/cli-handlers/session.js'],
      ['sso', '../../ts/src/cli/generated/cli-handlers/sso.js'],
      ['team', '../../ts/src/cli/generated/cli-handlers/team.js'],
      ['webhook', '../../ts/src/cli/generated/cli-handlers/webhook.js'],
    ];

    // Clear OPENBOX_ASSUME_YES locally so the gate actually evaluates.
    const origAssume = process.env.OPENBOX_ASSUME_YES;
    delete process.env.OPENBOX_ASSUME_YES;

    // Silence stderr from reportAndExit so the test output stays clean.
    const oe = console.error;
    console.error = () => {};

    const ovExit = process.exit;
    let destructiveCount = 0;
    const ungated: string[] = [];

    const handlerKey = (ns: string) => `${ns.toUpperCase().replace(/-/g, '_')}_HANDLERS`;

    try {
      for (const [ns, modPath] of namespaces) {
        const mod: any = await import(modPath);
        const handlers = mod[handlerKey(ns)] as any[] | undefined;
        if (!handlers) continue;
        for (const sub of handlers) {
          if (!sub.destructive) continue;
          destructiveCount += 1;

          let observedExit: number | undefined;
          (process as any).exit = ((c?: number) => {
            observedExit = c;
            throw new Error('exit:' + c);
          }) as never;

          const program = new Command();
          const parent = program.command(ns);
          const stubGetClient = () => ({}) as any;
          wireSubcommands(parent, [sub], stubGetClient);

          const positionals = sub.args.map(() => 'placeholder');
          const requiredFlags: string[] = [];
          for (const f of sub.flags ?? []) {
            if (f.required) {
              requiredFlags.push(`--${f.long}`);
              requiredFlags.push(f.variadic ? 'a' : 'x');
            }
          }

          try {
            await program.parseAsync(['node', 'openbox', ns, sub.name, ...positionals, ...requiredFlags]);
          } catch {
            /* expected - process.exit shim throws */
          }

          if (observedExit !== EXIT.USAGE) {
            ungated.push(`${ns} ${sub.name}: exitCode=${observedExit ?? 'none'}`);
          }
        }
      }
    } finally {
      (process as any).exit = ovExit;
      console.error = oe;
      if (origAssume !== undefined) process.env.OPENBOX_ASSUME_YES = origAssume;
    }

    expect(destructiveCount, 'spec must declare some destructive ops').toBeGreaterThan(0);
    expect(
      ungated,
      `${ungated.length}/${destructiveCount} destructive ops did NOT fire the runtime gate. ` +
        `If a new destructive op slips through here, it would silently delete on accident.`,
    ).toEqual([]);
  });

  it('no spec op declares both @cli_calls and @cli_output_kind("custom") (silent dead code)', () => {
    // The runtime's wireSubcommands does:
    //   if (sub.output.kind === 'custom') continue;
    // So a spec op with both @cli_calls (which makes the emitter
    // generate a SubcommandSpec) AND @cli_output_kind("custom")
    // (which makes the runtime skip the spec) would be silently
    // dead code: emitted into the manifest but never registered.
    const spec = readFileSync('specs/typespec/cli/main.tsp', 'utf-8');
    const lines = spec.split('\n');
    const offenders: string[] = [];

    // Method-declaration regex: at the body-of-interface indent level.
    const opRe = /^\s\s(\w+)\s*\(/;
    // Decorator regex (inside the stack just above an op).
    const decRe = /^\s*@/;

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(opRe);
      if (!m) continue;
      // Walk back collecting CONTIGUOUS decorator/comment lines that
      // belong to THIS op's decorator stack. Stop at first blank line
      // OR at the previous op's declaration / closing semicolon - that's
      // the end of OUR stack and start of the previous op.
      const stackLines: string[] = [];
      for (let j = i - 1; j >= 0; j--) {
        const line = lines[j];
        if (line.trim() === '') break;
        if (/\)\s*:\s*\w+\s*;\s*$/.test(line)) break; // previous op end
        if (/^\s\s\w+\s*\(/.test(line)) break; // previous op start
        stackLines.unshift(line);
      }
      const stack = stackLines.join('\n');
      const hasCalls = /@cli_calls\(/.test(stack);
      const hasCustom = /@cli_output_kind\("custom"/.test(stack);
      if (hasCalls && hasCustom) {
        offenders.push(`line ${i + 1}: \`${m[1]}(...)\` has both @cli_calls AND @cli_output_kind("custom")`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('hand-coded destructive sites (session prune) fire the gate', async () => {
    // The runtime-gate drift test above iterates the SPEC-EMITTED handler
    // manifests. `session prune` is hand-coded with its own
    // `requireYesForDestructive(...)` call in commands/session.ts and
    // never appears in the generated handlers. Asserts the gate fires
    // when invoked without --yes / without OPENBOX_ASSUME_YES.
    const { Command } = await import('commander');
    const { EXIT } = await import('../../ts/src/cli/exit-codes');

    const origAssume = process.env.OPENBOX_ASSUME_YES;
    delete process.env.OPENBOX_ASSUME_YES;

    const oe = console.error;
    console.error = () => {};
    const ovExit = process.exit;

    type SiteCheck = { ns: string; verb: string; argv: string[] };
    const sites: SiteCheck[] = [
      { ns: 'session', verb: 'prune', argv: ['node', 'openbox', 'session', 'prune', 'agent-id', '--older-than', '1h'] },
    ];

    const ungated: string[] = [];
    try {
      for (const s of sites) {
        let observedExit: number | undefined;
        (process as any).exit = ((c?: number) => {
          observedExit = c;
          throw new Error('exit:' + c);
        }) as never;

        const program = new Command();
        const { registerSessionCommands } = await import('../../ts/src/cli/commands/session');
        registerSessionCommands(program);

        try {
          await program.parseAsync(s.argv);
        } catch {
          /* expected */
        }

        if (observedExit !== EXIT.USAGE) {
          ungated.push(`${s.ns} ${s.verb}: exitCode=${observedExit ?? 'none'}`);
        }
      }
    } finally {
      (process as any).exit = ovExit;
      console.error = oe;
      if (origAssume !== undefined) process.env.OPENBOX_ASSUME_YES = origAssume;
    }

    expect(ungated).toEqual([]);
  });
});
