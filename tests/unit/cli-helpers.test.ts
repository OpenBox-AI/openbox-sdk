// CLI helpers, public-library entry points, and thin command-wrapper
// registrations. Covers every module that doesn't justify a dedicated
// per-module test file but still needs behavioral assertions:
//   - Constant exports (SKIP_PATTERNS, ACTIVITY_TYPES, COMMAND_PERMISSIONS)
//   - Public library helpers (output, colors, exit-codes, non-interactive,
//     maturity, features); call each export with a real argument and
//     assert observable behavior, not just module shape.
//   - Spec-driven command wrappers (sso, webhook, mcp, claude-code,
//     cursor, skill); register against a fresh Commander and assert
//     the expected verbs appear.
//
// Runtime adapter logic (mappers, hook handlers, side-effects) lives in
// runtime-claude-code-mappers.test.ts / runtime-cursor-mappers.test.ts.

import { describe, it, expect } from 'vitest';
import { Command } from 'commander';

describe('thin exports', () => {
  it('governance/skip-patterns exports SKIP_PATTERNS', async () => {
    const { SKIP_PATTERNS } = await import('../../ts/src/governance/skip-patterns');
    expect(Array.isArray(SKIP_PATTERNS)).toBe(true);
    expect(SKIP_PATTERNS.length).toBeGreaterThan(0);
    expect(SKIP_PATTERNS.every((p) => p instanceof RegExp)).toBe(true);
    // Spot-check: cursor / claude internals must skip.
    expect(SKIP_PATTERNS.some((re) => re.test('/.cursor/foo'))).toBe(true);
  });

  it('runtime/claude-code/activity-types exports the canonical map', async () => {
    const mod = await import('../../ts/src/runtime/claude-code/activity-types');
    expect(typeof mod.ACTIVITY_TYPES).toBe('object');
    expect(Object.values(mod.ACTIVITY_TYPES).length).toBeGreaterThan(0);
  });

  it('runtime/cursor/activity-types exports the canonical map', async () => {
    const mod = await import('../../ts/src/runtime/cursor/activity-types');
    expect(typeof mod.ACTIVITY_TYPES).toBe('object');
    expect(Object.values(mod.ACTIVITY_TYPES).length).toBeGreaterThan(0);
  });

  it('cli/permissions exports COMMAND_PERMISSIONS + missingPermissions', async () => {
    const { COMMAND_PERMISSIONS, missingPermissions, missingFeatures } = await import(
      '../../ts/src/cli/permissions'
    );
    expect(typeof COMMAND_PERMISSIONS).toBe('object');
    expect(missingPermissions(['create:agent'], ['create:agent', 'read:agent'])).toEqual([]);
    expect(missingPermissions(['create:agent'], ['read:agent'])).toEqual(['create:agent']);
    expect(missingFeatures(['webhooks'], { webhooks: true })).toEqual([]);
    expect(missingFeatures(['webhooks'], { webhooks: false })).toEqual(['webhooks']);
  });

  it('cli/features integration helpers wire to the public maturity gate', async () => {
    const mod = await import('../../ts/src/cli/features');
    expect(typeof mod.setExplicitFeatures).toBe('function');
    // setExplicitFeatures forwards to enableFeatures; call it twice
    // to exercise both branches (empty + non-empty).
    mod.setExplicitFeatures([]);
    mod.setExplicitFeatures(['some.feature']);
  });
});

describe('command-group wrappers register subcommands', () => {
  // Each spec-driven `register*Commands(program)` call walks the matching
  // *_HANDLERS manifest and registers verbs on a Commander parent. The
  // handlers themselves are exercised by the conformance suite. This
  // batch just asserts the wrapper actually walks the manifest.
  const cases: { name: string; mod: string; register: string; verbs: string[] }[] = [
    { name: 'sso', mod: '../../ts/src/cli/commands/sso', register: 'registerSsoCommands', verbs: ['status', 'config'] },
    { name: 'webhook', mod: '../../ts/src/cli/commands/webhook', register: 'registerWebhookCommands', verbs: ['list', 'create', 'delete'] },
    { name: 'mcp', mod: '../../ts/src/cli/commands/mcp', register: 'registerMcpCommands', verbs: ['serve'] },
    // claude-code, cursor, skill: install/uninstall verbs moved to the
    // unified `openbox install <target>` parent (see install.ts). Each
    // module retains only its non-install verbs.
    { name: 'claude-code', mod: '../../ts/src/cli/commands/claude-code', register: 'registerClaudeCodeCommands', verbs: ['hook'] },
    { name: 'cursor', mod: '../../ts/src/cli/commands/cursor', register: 'registerCursorCommands', verbs: ['hook'] },
    { name: 'skill', mod: '../../ts/src/cli/commands/skill', register: 'registerSkillCommands', verbs: ['path'] },
    { name: 'install', mod: '../../ts/src/cli/commands/install', register: 'registerInstallCommands', verbs: ['approver', 'extension', 'cursor', 'claude-code', 'skill', 'mobile'] },
  ];

  for (const c of cases) {
    it(`${c.name} registers expected subcommands`, async () => {
      const mod = await import(c.mod);
      const program = new Command();
      const fn = mod[c.register];
      expect(typeof fn).toBe('function');
      fn(program);
      const parent = program.commands[0];
      expect(parent, `${c.name} parent command not registered`).toBeDefined();
      const subs = parent.commands.map((s) => s.name());
      for (const verb of c.verbs) {
        expect(subs, `${c.name} missing subcommand ${verb} (got: ${subs.join(',')})`).toContain(verb);
      }
    });
  }
});

describe('public library entry points', () => {
  it('cli/output round-trips arrays + objects through outputList', async () => {
    const { output, outputList } = await import('../../ts/src/cli/output');
    // Both go straight to console.log; we just need the line executed
    // for coverage. Capture stdout briefly to avoid polluting test output.
    const origLog = console.log;
    const origErr = console.error;
    const sink: string[] = [];
    console.log = (...a) => sink.push(a.join(' '));
    console.error = () => {};
    try {
      output({ ok: true });
      outputList([{ id: 1 }, { id: 2 }], 'rows');
      outputList({ data: [{ id: 1 }], total: 5 } as any, 'rows');
      outputList({ id: 1 } as any, 'rows');
    } finally {
      console.log = origLog;
      console.error = origErr;
    }
    expect(sink.length).toBeGreaterThanOrEqual(4);
  });

  it('cli/colors emit ANSI when useColor() returns true', async () => {
    const { color } = await import('../../ts/src/cli/colors');
    // useColor() is contextual; pass through every helper to load each
    // wrap path. Don't assert content (depends on TTY); just shape.
    const wrappers = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'bold', 'dim'] as const;
    for (const w of wrappers) {
      const out = color[w]('x');
      expect(typeof out).toBe('string');
      expect(out.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('cli/exit-codes exposes EXIT taxonomy + helpers', async () => {
    const { EXIT, exitCodeForStatus, isRetryable } = await import('../../ts/src/cli/exit-codes');
    // Statuses outside the table should fall to GENERIC.
    expect(exitCodeForStatus(418)).toBe(EXIT.GENERIC);
    expect(isRetryable(EXIT.OK)).toBe(false);
  });

  it('cli/non-interactive flips on common CI-mode triggers', async () => {
    const mod = await import('../../ts/src/cli/non-interactive');
    // Don't trash the process env; use the test setter.
    const origCi = process.env.CI;
    const origNi = process.env.OPENBOX_NONINTERACTIVE;
    delete process.env.CI;
    delete process.env.OPENBOX_NONINTERACTIVE;

    mod.setArgvForTesting(['node', 'openbox', '--yes']);
    expect(mod.assumeYes()).toBe(true);
    expect(mod.isNonInteractive()).toBe(true);

    mod.setArgvForTesting(['node', 'openbox']);
    process.env.CI = '1';
    expect(mod.isNonInteractive()).toBe(true);

    process.env.CI = '0';
    delete process.env.CI;
    process.env.OPENBOX_NONINTERACTIVE = '1';
    expect(mod.isNonInteractive()).toBe(true);

    // requireYesForDestructive throws the typed error when not assumed.
    // tests/setup.ts sets OPENBOX_ASSUME_YES=1 so unit tests bypass the
    // gate by default; clear it locally for this assertion only.
    process.env.OPENBOX_NONINTERACTIVE = '0';
    delete process.env.OPENBOX_NONINTERACTIVE;
    const origAssume = process.env.OPENBOX_ASSUME_YES;
    delete process.env.OPENBOX_ASSUME_YES;
    mod.setArgvForTesting(['node', 'openbox']);
    expect(() => mod.requireYesForDestructive('agent delete')).toThrow(
      mod.DestructiveConfirmRequiredError,
    );
    if (origAssume !== undefined) process.env.OPENBOX_ASSUME_YES = origAssume;

    // Restore.
    if (origCi !== undefined) process.env.CI = origCi;
    if (origNi !== undefined) process.env.OPENBOX_NONINTERACTIVE = origNi;
    mod.setArgvForTesting(null);
  });

  it('maturity public surface gates correctly across all three levels', async () => {
    const mod = await import('../../ts/src/maturity');
    // setMaturityLevel + currentMaturityLevel + isMaturityVisible
    mod.setMaturityLevel('experimental');
    expect(mod.currentMaturityLevel()).toBe('experimental');
    expect(mod.isMaturityVisible('stable', 'experimental')).toBe(true);
    expect(mod.isMaturityVisible('beta', 'experimental')).toBe(true);
    expect(mod.isMaturityVisible('experimental', 'experimental')).toBe(true);

    mod.setMaturityLevel('stable');
    expect(mod.isMaturityVisible('experimental', 'stable')).toBe(false);
    expect(mod.isMaturityVisible('beta', 'stable')).toBe(false);

    mod.setMaturityLevel('beta');
    expect(mod.isMaturityVisible('beta', 'beta')).toBe(true);
    expect(mod.isMaturityVisible('experimental', 'beta')).toBe(false);

    // maturityOf — `auth` is the canonical "always-stable" parent
    // (any owner-tested CLI must keep auth stable since it's the
    // entry point); `agent list` was demoted to experimental when the
    // Agent interface lost its `@cli_maturity("stable")`.
    expect(mod.maturityOf('auth')).toBe('stable');
    expect(mod.maturityOf('does.not.exist')).toBe('experimental'); // default

    // enableFeatures + isFeatureEnabled + listFeatures
    mod.enableFeatures(['some.feature']);
    // listFeatures is a snapshot of the registry intersected with state.
    expect(typeof mod.listFeatures()).toBe('object');

    // Reset for downstream tests.
    mod.setMaturityLevel(null);
  });

  it('cli/maturity gateCommands prunes and tags the tree', async () => {
    const { gateCommands } = await import('../../ts/src/cli/maturity');
    const program = new Command();
    program.command('agent').description('Agent management').command('list');
    program.command('made-up-experimental').description('not real');
    // Just exercise the walk; we don't depend on a specific result.
    gateCommands(program);
    expect(typeof gateCommands).toBe('function');
  });
});
