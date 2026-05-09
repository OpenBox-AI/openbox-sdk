#!/usr/bin/env node
import { Command } from 'commander';
import type { CommanderError } from 'commander';
import { loadFeatures, loadPermissions } from './config.js';
import { resolveEnv } from '../env/index.js';
import { applyEnvSource } from './env-source.js';
import {
  COMMAND_FEATURES,
  COMMAND_PERMISSIONS,
  missingFeatures,
  missingPermissions,
} from './permissions.js';
import { registerAuthCommands } from './commands/auth.js';
import { registerConfigCommands } from './commands/config.js';
import { registerAgentCommands } from './commands/agent.js';
import { registerApiKeyCommands } from './commands/api-key.js';
import { registerGuardrailCommands } from './commands/guardrail.js';
import { registerPolicyCommands } from './commands/policy.js';
import { registerBehaviorCommands } from './commands/behavior.js';
import { registerSessionCommands } from './commands/session.js';
import { registerTrustCommands } from './commands/trust.js';
import { registerAivssCommands } from './commands/aivss.js';
import { registerGoalCommands } from './commands/goal.js';
import { registerApprovalCommands } from './commands/approval.js';
import { registerObservabilityCommands } from './commands/observability.js';
import { registerViolationCommands } from './commands/violation.js';
import { registerOrgCommands } from './commands/org.js';
import { registerTeamCommands } from './commands/team.js';
import { registerMemberCommands } from './commands/member.js';
import { registerAuditCommands } from './commands/audit.js';
import { registerHealthCommands } from './commands/health.js';
import { registerCoreCommands } from './commands/core.js';
import { registerMcpCommands } from './commands/mcp.js';
import { registerSkillCommands } from './commands/skill.js';
import { registerClaudeCodeCommands } from './commands/claude-code.js';
import { registerCursorCommands } from './commands/cursor.js';
import { registerInstallCommands } from './commands/install.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerVerifyCommand } from './commands/verify.js';
import { registerVersionsCommand } from './commands/versions.js';
import { registerWebhookCommands } from './commands/webhook.js';
import { registerSsoCommands } from './commands/sso.js';
import { gateCommands, setMaturityOverride } from './maturity.js';
import { maturityOf } from '../maturity/index.js';
import { COMMAND_MATURITY } from './generated/cli-maturity.js';
import { setExplicitFeatures } from './features.js';
import { EXIT, bailWith } from './exit-codes.js';
import { error } from './output.js';
import { reportAndExit } from '../validators/index.js';

const program = new Command();

// ---------------------------------------------------------------------------
// Commander error handling
//
// Each kind of Commander parse failure (`unknown option`, `missing
// required argument`, `too many arguments`, …) carries a stable
// `err.code` string. We dispatch on the code and emit a tailored
// (msg, help) pair via the `error()` helper, instead of regex-scrubbing
// Commander's free-form English. `configureOutput.outputError` is
// silenced so Commander doesn't print its own version first.
//
// `exitOverride` is per-command and not inherited by subcommands, so we
// recurse over the whole tree once registration is complete.
// ---------------------------------------------------------------------------

/** Walk the program tree against argv to find the deepest registered
 *  subcommand the user actually reached. Used by helpRef so that
 *  `openbox api-key rotate` (missing arg) points at
 *  `openbox api-key rotate --help`, not just `openbox api-key --help`.
 *  Stops at the first token that doesn't match a registered subcommand
 *  so an unknown verb doesn't poison the path. */
function deepestRegisteredPath(): string | null {
  const VALUE_FLAGS = new Set(['--env', '--feature']);
  const argv = process.argv.slice(2);
  // Strip global value-flags + value, and bail at the first flag.
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE_FLAGS.has(a)) {
      i++;
      continue;
    }
    if (a.startsWith('-')) break;
    positionals.push(a);
  }
  let cmd: Command = program;
  const path: string[] = [];
  for (const tok of positionals) {
    const sub = cmd.commands.find((c) => c.name() === tok);
    if (!sub) break;
    path.push(tok);
    cmd = sub;
  }
  return path.length > 0 ? path.join(' ') : null;
}

function helpRef(cmd?: string | null): string {
  const c = cmd ?? deepestRegisteredPath();
  return c ? `see \`openbox ${c} --help\`` : 'see `openbox --help`';
}

function emitCommanderError(err: CommanderError): void {
  const m = err.message;
  switch (err.code) {
    case 'commander.excessArguments': {
      // "too many arguments for 'install'. Expected 0 arguments but got 1."
      // Most often the user thought a positional was a subcommand.
      const cmd = m.match(/for '([^']+)'/)?.[1];
      const positionals = process.argv
        .slice(2)
        .filter((a) => !a.startsWith('-'));
      const extra = positionals[positionals.length - 1];
      if (cmd && extra && extra !== cmd) {
        error(`'${extra}' is not a subcommand of '${cmd}'`, {
          help: `${helpRef(cmd)} for valid subcommands and options`,
        });
      } else if (cmd) {
        error(`'${cmd}' got unexpected positional argument(s)`, {
          help: helpRef(cmd),
        });
      } else {
        error('unexpected positional argument(s)', { help: helpRef() });
      }
      return;
    }
    case 'commander.unknownOption': {
      // "unknown option '--bogus'"
      const opt = m.match(/'([^']+)'/)?.[1] ?? '<flag>';
      error(`unknown option \`${opt}\``, { help: helpRef() });
      return;
    }
    case 'commander.unknownCommand': {
      const cmd = m.match(/'([^']+)'/)?.[1];
      error(cmd ? `unknown command \`${cmd}\`` : 'unknown command', {
        help: 'see `openbox --help` for the full command list',
      });
      return;
    }
    case 'commander.missingArgument': {
      // "missing required argument 'agentId'"
      const arg = m.match(/'([^']+)'/)?.[1] ?? '<arg>';
      error(`missing required argument <${arg}>`, { help: helpRef() });
      return;
    }
    case 'commander.optionMissingArgument': {
      // "option '--foo <value>' argument missing"
      const opt = m.match(/'([^']+)'/)?.[1] ?? '<flag>';
      error(`option \`${opt}\` is missing its value`, { help: helpRef() });
      return;
    }
    case 'commander.missingMandatoryOptionValue': {
      // "required option '-y, --yes' not specified"
      const opt = m.match(/'([^']+)'/)?.[1] ?? '<flag>';
      error(`missing required option \`${opt}\``, { help: helpRef() });
      return;
    }
    case 'commander.invalidArgument':
    case 'commander.invalidOptionArgument':
    case 'commander.conflictingOption': {
      // Custom-validator messages already include the relevant detail.
      error(m.replace(/^error:\s*/, '').replace(/\.\s*$/, ''));
      return;
    }
    default:
      // Unknown code: pass through the message body, stripped of
      // commander's own `error:` prefix and trailing period.
      error(m.replace(/^error:\s*/, '').replace(/\.\s*$/, ''));
  }
}

function exitForCommanderError(err: CommanderError): never {
  // Help / version are intentional successes, not errors; let them
  // through with their own exit code (0). bailWith is the single
  // sanctioned `process.exit` wrapper; the drift test bans direct
  // `process.exit` calls outside `exit-codes.ts`.
  if (
    err.code === 'commander.help' ||
    err.code === 'commander.helpDisplayed' ||
    err.code === 'commander.version'
  ) {
    // Commander uses exit code 0 for these; we always exit OK so the
    // ExitCode union stays honest.
    bailWith(EXIT.OK);
  }
  emitCommanderError(err);
  bailWith(EXIT.USAGE);
}

/** exitOverride and configureOutput are NOT inherited by subcommands;
 *  every command keeps its own handler. Walk the tree once after
 *  registration so the format applies uniformly. */
function applyUniformErrorHandling(cmd: Command): void {
  cmd.configureOutput({ outputError: () => {} });
  cmd.exitOverride(exitForCommanderError);
  for (const sub of cmd.commands) applyUniformErrorHandling(sub);
}

program
  .name('openbox')
  .description('openbox-sdk')
  .version('1.0.0')
  .option(
    '--env <env>',
    "Environment: production, staging, or local. Defaults to $OPENBOX_ENV, then production.",
  )
  .option(
    '--experimental',
    "Reveal experimental subcommands. Equivalent to OPENBOX_EXPERIMENTAL_LEVEL=experimental. Coarse gate; controls whole subcommands.",
  )
  .option(
    '--feature <name...>',
    'Enable specific experimental feature flags inside stable commands. Equivalent to OPENBOX_FEATURES=name1,name2. Fine gate; controls code paths.',
  )
  .option(
    '-y, --yes',
    'Assume yes on confirmation prompts. Implied by CI=1, OPENBOX_NONINTERACTIVE=1, or non-TTY stdin.',
  )
  .option(
    '--non-interactive',
    'Hard-fail instead of prompting on missing input. Implied by CI=1 or OPENBOX_NONINTERACTIVE=1.',
  )
  .option('--no-color', 'Disable ANSI color output. Implied by NO_COLOR=1, OPENBOX_NO_COLOR=1, or CI=1')
  .option('-q, --quiet', 'Suppress non-essential progress lines on stderr (errors still print)')
  .option('--json', 'Emit machine-readable JSON instead of human-rendered output')
  .hook('preAction', (thisCommand, actionCommand) => {
    const flag = thisCommand.opts().env as string | undefined;
    if (flag) process.env.OPENBOX_ENV = flag;

    // Single-source env resolution. Same call every other surface
    // makes (MCP, cursor hook, claude-code hook) so all OpenBox
    // processes on this machine agree on the active env.
    const commandPath = buildCommandKey(actionCommand);
    const env = applyEnvSource();

    // 1. Feature-flag check, mirroring `@RequireFeature` on the backend.
    const requiredFeatures = COMMAND_FEATURES[commandPath];
    if (requiredFeatures && requiredFeatures.length > 0) {
      const features = loadFeatures(env);
      if (Object.keys(features).length > 0) {
        const missingF = missingFeatures(requiredFeatures, features);
        if (missingF.length > 0) {
          error(
            `feature disabled for \`openbox ${commandPath}\` in env ${env}: ${missingF.join(', ')}`,
            { help: `ask your admin to enable the feature on the ${env} org` },
          );
          bailWith(EXIT.FEATURE_DISABLED);
        }
      }
    }

    // 2. Permission check (granular Keycloak role permissions).
    const required = COMMAND_PERMISSIONS[commandPath];
    if (!required || required.length === 0) return;
    const have = loadPermissions(env);
    if (have.length === 0) return;
    const missing = missingPermissions(required, have);
    if (missing.length === 0) return;

    error(
      `missing permission for \`openbox ${commandPath}\` in env ${env}: ${missing.join(', ')}`,
      {
        detail: `api-key has ${have.length} permission(s); server returns 403 if any required ones are missing`,
        help: `ask your admin to grant the missing permission(s) on the ${env} Keycloak role`,
      },
    );
    bailWith(EXIT.AUTH);
  });

function buildCommandKey(cmd: Command): string {
  const parts: string[] = [];
  let c: Command | null = cmd;
  while (c && c.parent) {
    parts.unshift(c.name());
    c = c.parent;
  }
  return parts.join(' ');
}

registerAuthCommands(program);
registerConfigCommands(program);
registerAgentCommands(program);
registerApiKeyCommands(program);
registerGuardrailCommands(program);
registerPolicyCommands(program);
registerBehaviorCommands(program);
registerSessionCommands(program);
registerTrustCommands(program);
registerAivssCommands(program);
registerGoalCommands(program);
registerApprovalCommands(program);
registerObservabilityCommands(program);
registerViolationCommands(program);
registerOrgCommands(program);
registerTeamCommands(program);
registerMemberCommands(program);
registerAuditCommands(program);
registerHealthCommands(program);
registerCoreCommands(program);
registerMcpCommands(program);
registerSkillCommands(program);
registerClaudeCodeCommands(program);
registerCursorCommands(program);
registerInstallCommands(program);
registerDoctorCommand(program);
registerVerifyCommand(program);
registerVersionsCommand(program);
registerWebhookCommands(program);
registerSsoCommands(program);

// Pre-scan global flags BEFORE gating + parse; commander's --help is
// printed during parseAsync, by which time the command tree has to
// already reflect the user's --experimental / --feature opt-ins.
{
  const argv = process.argv;
  if (argv.includes('--experimental')) setMaturityOverride('experimental');
  const features: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--feature' && i + 1 < argv.length) features.push(argv[i + 1]);
  }
  if (features.length) setExplicitFeatures(features);
}

// Walk the registered command tree and remove anything not visible at
// the current maturity level. Mark visible-but-non-stable commands
// with [experimental] / [beta] in their description so users can see
// the maturity at a glance without further filtering.
gateCommands(program);

// Apply uniform error handling across the (now-final) command tree.
// Must run AFTER gateCommands so subcommands removed by maturity
// gating don't get touched. exitOverride and configureOutput are
// per-command, not inherited; we walk the tree once.
applyUniformErrorHandling(program);

// `openbox` (no args) defaults to printing help instead of silently
// exiting. Mirrors `cargo` / `gh` — bare invocation is informational.
if (process.argv.length === 2) {
  program.outputHelp();
  bailWith(EXIT.OK);
}

// Pre-flight check: if the user typed a command that's gated behind
// `--experimental` without passing the flag, commander would emit a
// bare `error: unknown command '<verb>'`. That message is misleading -
// the verb DOES exist, it's just hidden at the current maturity level.
// LLMs (and humans) who see "unknown command 'agent'" tend to invent
// explanations like "slim build" instead of trying --experimental.
// Print a tighter, accurate error when we detect this case.
{
  // Walk argv past the top-level flags (and their values) to find the
  // first real verb. Top-level flags that take a value: --env, --feature.
  // Top-level boolean flags: --experimental, --yes, -y, --non-interactive,
  // --no-color, -q, --quiet, --json, -V, --version, -h, --help. Any
  // unknown -... flag is treated as boolean conservatively (we'd rather
  // miss the hint than fire it at the wrong token).
  const VALUE_FLAGS = new Set(['--env', '--feature']);
  const argv = process.argv.slice(2);
  let firstVerb: string | undefined;
  let positionalStart = -1;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('-')) {
      if (VALUE_FLAGS.has(a)) i++; // skip the value too
      continue;
    }
    firstVerb = a;
    positionalStart = i;
    break;
  }
  if (firstVerb && !argv.includes('--experimental')) {
    // Only fire the experimental-hint when the verb is EXPLICITLY
    // listed in the spec's COMMAND_MATURITY table. Without this
    // check, `maturityOf(unlisted)` defaults to 'experimental' and
    // a genuine typo (`openbox bogus`) would get pointed at
    // --experimental instead of "unknown command". The conservative
    // gating-time default still applies elsewhere; this check is
    // about user-facing diagnostic accuracy.
    const fullPath = argv
      .slice(positionalStart)
      .filter((a) => !a.startsWith('-'))
      .join(' ');
    const explicitlyExperimental =
      (COMMAND_MATURITY[firstVerb] === 'experimental' ||
        COMMAND_MATURITY[fullPath] === 'experimental') &&
      // Plus the conservative gating-default still classifies it as
      // experimental so we don't fire on anything the spec hides.
      maturityOf(firstVerb) === 'experimental';
    // Fire only when the verb isn't currently registered (gated out)
    // AND it's known-experimental in the spec. Otherwise commander's
    // own `unknown command` is the right error.
    const knownToCommander = program.commands.some((c) => c.name() === firstVerb);
    if (explicitlyExperimental && !knownToCommander) {
      error(`\`${firstVerb}\` is an experimental command`, {
        help:
          `re-run with --experimental:\n` +
          `  openbox --experimental ${argv.join(' ')}\n` +
          'or set OPENBOX_EXPERIMENTAL_LEVEL=experimental in your shell',
      });
      bailWith(EXIT.USAGE);
    }
  }
}

program.parseAsync(process.argv).catch((err) => {
  reportAndExit(err);
});
