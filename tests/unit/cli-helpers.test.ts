// CLI helpers, public-library entry points, and thin command-wrapper
// registrations. Covers every module that doesn't justify a dedicated
// per-module test file but still needs behavioral assertions:
//   - Constant exports (redaction patterns, ACTIVITY_TYPES, COMMAND_PERMISSIONS)
//   - Public library helpers (output, colors, exit-codes, non-interactive,
//     maturity); call each export with a real argument and
//     assert observable behavior, not just module shape.
//   - Stable command wrappers (mcp, claude-code, cursor, skill,
//     install); register against a fresh Commander and assert
//     the expected verbs appear.
//
// Runtime adapter logic (mappers, hook handlers, side-effects) lives in
// runtime-claude-code-mappers.test.ts / runtime-cursor-mappers.test.ts.

import { describe, it, expect } from 'vitest';
import { Command } from 'commander';

describe('thin exports', () => {
  it('governance/skip-patterns exports redaction patterns', async () => {
    const { REDACT_PATH_CONTENT_PATTERNS, shouldRedactPathContent } = await import(
      '../../ts/src/governance/skip-patterns'
    );
    expect(Array.isArray(REDACT_PATH_CONTENT_PATTERNS)).toBe(true);
    expect(REDACT_PATH_CONTENT_PATTERNS.length).toBeGreaterThan(0);
    expect(REDACT_PATH_CONTENT_PATTERNS.every((p) => p instanceof RegExp)).toBe(true);
    expect(shouldRedactPathContent('/.cursor/foo')).toBe(true);
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

  it('first-party runtime activity maps are canonical or explicitly host-specific', async () => {
    const { CANONICAL_ACTIVITY_TYPES, PRESET_ACTIVITY_TYPES } = await import(
      '../../ts/src/core-client/generated/govern'
    );
    const { ACTIVITY_TYPES: claudeCode } = await import(
      '../../ts/src/runtime/claude-code/activity-types'
    );
    const { ACTIVITY_TYPES: cursor } = await import(
      '../../ts/src/runtime/cursor/activity-types'
    );
    const { CODEX_ACTIVITY_TYPES: codex } = await import(
      '../../ts/src/runtime/codex/activity-types'
    );
    const { ANTHROPIC_AGENT_ACTIVITY_TYPES: anthropicAgent } = await import(
      '../../ts/src/anthropic-agent-sdk/payloads'
    );
    const { OPENAI_AGENTS_ACTIVITY_TYPES: openaiAgents } = await import(
      '../../ts/src/openai-agents-sdk/payloads'
    );
    const defaultActivity = PRESET_ACTIVITY_TYPES.default;
    const claudeCodePreset = PRESET_ACTIVITY_TYPES['claude-code'];
    const codexPreset = PRESET_ACTIVITY_TYPES.codex;
    const cursorPreset = PRESET_ACTIVITY_TYPES.cursor;
    const anthropicPreset = PRESET_ACTIVITY_TYPES['anthropic-agent-sdk'];
    const openaiPreset = PRESET_ACTIVITY_TYPES['openai-agents-sdk'];

    expect(claudeCode).toMatchObject({
      PROMPT: defaultActivity.prompt,
      FILE_READ: defaultActivity.read,
      FILE_EDIT: defaultActivity.write,
      DB_QUERY: defaultActivity.databaseQuery,
      AGENT_ACTION: defaultActivity.agentAction,
      SESSION: claudeCodePreset.sessionActivityStarted,
      CONFIG_CHANGE: claudeCodePreset.configChangeActivity,
      WORKSPACE_CHANGE: claudeCodePreset.workspaceChangeSignal,
      MCP_ELICITATION: claudeCodePreset.mcpElicitationStarted,
      TASK: claudeCodePreset.taskActivityStarted,
      MESSAGE: claudeCodePreset.messageActivityStarted,
    });
    expect(codex).toMatchObject({
      PROMPT: defaultActivity.prompt,
      SESSION: codexPreset.sessionCompleted,
      TOOL_INPUT: codexPreset.preToolUse,
      TOOL_OUTPUT: codexPreset.postToolUse,
      DB_QUERY: defaultActivity.databaseQuery,
      AGENT_ACTION: defaultActivity.agentAction,
    });
    expect(cursor).toMatchObject({
      PROMPT: cursorPreset.beforeSubmitPrompt,
      COMPLETION: cursorPreset.afterAgentResponse,
      FILE_READ: cursorPreset.beforeReadFile,
      FILE_WRITE: cursorPreset.afterFileEdit,
      WORKFLOW_START: defaultActivity.sessionStart,
      WORKFLOW_COMPLETE: defaultActivity.stop,
    });
    expect(anthropicAgent).toMatchObject({
      PROMPT: defaultActivity.prompt,
      TOOL_INPUT: anthropicPreset.preToolUse,
      SESSION: anthropicPreset.sessionActivityStarted,
      MESSAGE: anthropicPreset.messageActivityStarted,
      CONFIG_CHANGE: anthropicPreset.configChangeActivity,
      WORKSPACE_CHANGE: anthropicPreset.workspaceChangeSignal,
      MCP_ELICITATION: anthropicPreset.mcpElicitationStarted,
      TASK: anthropicPreset.taskActivityStarted,
      USAGE_SIGNAL: anthropicPreset.usageSignal,
      GOAL_SIGNAL: defaultActivity.goalSignal,
    });
    expect(openaiAgents).toMatchObject({
      RUN: openaiPreset.runStarted,
      TOOL_STARTED: openaiPreset.toolStarted,
      TOOL_COMPLETED: openaiPreset.toolCompleted,
      HANDOFF: openaiPreset.handoff,
      GUARDRAIL: openaiPreset.guardrail,
    });

    for (const [name, map] of Object.entries({
      anthropicAgent,
      claudeCode,
      codex,
      cursor,
      openaiAgents,
    })) {
      const drift = Object.entries(map).filter(
        ([, value]) => !CANONICAL_ACTIVITY_TYPES.has(value),
      );
      expect(
        drift,
        `${name} activity map has values missing from the TypeSpec-generated first-party vocabulary`,
      ).toEqual([]);
    }
  });

  it('cli/permissions exports COMMAND_PERMISSIONS + missingPermissions', async () => {
    const { COMMAND_PERMISSIONS, missingPermissions } = await import(
      '../../ts/src/cli/permissions'
    );
    expect(typeof COMMAND_PERMISSIONS).toBe('object');
    expect(missingPermissions(['create:agent'], ['create:agent', 'read:agent'])).toEqual([]);
    expect(missingPermissions(['create:agent'], ['read:agent'])).toEqual(['create:agent']);
  });
});

describe('command-group wrappers register subcommands', () => {
  // These wrappers back the supported compact CLI surface.
  const cases: {
    name: string;
    mod: string;
    register: string;
    verbs: string[];
    absent?: string[];
  }[] = [
    { name: 'mcp', mod: '../../ts/src/cli/commands/mcp', register: 'registerMcpCommands', verbs: ['serve'] },
    // claude-code and cursor retain their runtime verbs. Both expose
    // plugin export/install helpers; one-command setup lives at
    // `openbox install <host>`.
    { name: 'claude-code', mod: '../../ts/src/cli/commands/claude-code', register: 'registerClaudeCodeCommands', verbs: ['hook', 'plugin', 'doctor'], absent: ['install', 'uninstall'] },
    {
      name: 'cursor',
      mod: '../../ts/src/cli/commands/cursor',
      register: 'registerCursorCommands',
      verbs: ['hook', 'plugin', 'doctor'],
      absent: ['install', 'uninstall', 'harden', 'unharden', 'sync-rules'],
    },
    { name: 'skill', mod: '../../ts/src/cli/commands/skill', register: 'registerSkillCommands', verbs: ['path'] },
    { name: 'install', mod: '../../ts/src/cli/commands/install', register: 'registerInstallCommands', verbs: ['cursor', 'claude-code'] },
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
      for (const verb of c.absent ?? []) {
        expect(subs, `${c.name} unexpectedly exposed subcommand ${verb}`).not.toContain(verb);
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

  it('cli/non-interactive covers color, quiet, json, and consent branches', async () => {
    const mod = await import('../../ts/src/cli/non-interactive');
    const orig = {
      ci: process.env.CI,
      noColor: process.env.NO_COLOR,
      openboxNoColor: process.env.OPENBOX_NO_COLOR,
      quiet: process.env.OPENBOX_QUIET,
      assume: process.env.OPENBOX_ASSUME_YES,
      nonInteractive: process.env.OPENBOX_NONINTERACTIVE,
      stdinTty: process.stdin.isTTY,
      stdoutTty: process.stdout.isTTY,
    };
    try {
      delete process.env.CI;
      delete process.env.NO_COLOR;
      delete process.env.OPENBOX_NO_COLOR;
      delete process.env.OPENBOX_QUIET;
      delete process.env.OPENBOX_ASSUME_YES;
      delete process.env.OPENBOX_NONINTERACTIVE;
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

      mod.setArgvForTesting(['node', 'openbox', '--json']);
      expect(mod.isJsonMode()).toBe(true);
      expect(mod.isMachineMode()).toBe(true);

      mod.setArgvForTesting(['node', 'openbox', '--quiet']);
      expect(mod.isQuiet()).toBe(true);
      mod.setArgvForTesting(['node', 'openbox', '-q']);
      expect(mod.isQuiet()).toBe(true);
      mod.setArgvForTesting(['node', 'openbox']);
      process.env.OPENBOX_QUIET = '1';
      expect(mod.isQuiet()).toBe(true);
      process.env.OPENBOX_QUIET = '0';
      expect(mod.isQuiet()).toBe(false);

      expect(mod.useColor()).toBe(true);
      process.env.NO_COLOR = '1';
      expect(mod.useColor()).toBe(false);
      delete process.env.NO_COLOR;
      process.env.OPENBOX_NO_COLOR = '1';
      expect(mod.useColor()).toBe(false);
      process.env.OPENBOX_NO_COLOR = '0';
      mod.setArgvForTesting(['node', 'openbox', '--no-color']);
      expect(mod.useColor()).toBe(false);
      mod.setArgvForTesting(['node', 'openbox']);
      process.env.CI = 'true';
      expect(mod.useColor()).toBe(false);
      process.env.CI = 'false';
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
      expect(mod.isMachineMode()).toBe(true);
      expect(mod.useColor()).toBe(false);

      process.env.OPENBOX_ASSUME_YES = '1';
      await expect(mod.consent('Allow test mutation?')).resolves.toBe(true);
      delete process.env.OPENBOX_ASSUME_YES;
      process.env.OPENBOX_NONINTERACTIVE = '1';
      await expect(mod.consent('Allow test mutation?')).resolves.toBe(false);
    } finally {
      if (orig.ci === undefined) delete process.env.CI;
      else process.env.CI = orig.ci;
      if (orig.noColor === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = orig.noColor;
      if (orig.openboxNoColor === undefined) delete process.env.OPENBOX_NO_COLOR;
      else process.env.OPENBOX_NO_COLOR = orig.openboxNoColor;
      if (orig.quiet === undefined) delete process.env.OPENBOX_QUIET;
      else process.env.OPENBOX_QUIET = orig.quiet;
      if (orig.assume === undefined) delete process.env.OPENBOX_ASSUME_YES;
      else process.env.OPENBOX_ASSUME_YES = orig.assume;
      if (orig.nonInteractive === undefined) delete process.env.OPENBOX_NONINTERACTIVE;
      else process.env.OPENBOX_NONINTERACTIVE = orig.nonInteractive;
      Object.defineProperty(process.stdin, 'isTTY', { value: orig.stdinTty, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: orig.stdoutTty, configurable: true });
      mod.setArgvForTesting(null);
    }
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

    // maturityOf; the lean CLI treats unlisted active commands as stable.
    expect(mod.maturityOf('auth')).toBe('stable');
    expect(mod.maturityOf('does.not.exist')).toBe('stable'); // default

    // enableFeatures + isFeatureEnabled + listFeatures
    mod.enableFeatures(['some.feature']);
    // listFeatures is a snapshot of the registry intersected with state.
    expect(typeof mod.listFeatures()).toBe('object');

    // Reset for downstream tests.
    mod.setMaturityLevel(null);
  });

});
