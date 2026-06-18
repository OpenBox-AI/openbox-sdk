#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import type { CommanderError } from 'commander';
import { loadPermissions } from './config.js';
import { applyEnvSource } from './env-source.js';
import {
  COMMAND_PERMISSIONS,
  missingPermissions,
} from './permissions.js';
import { registerAuthCommands } from './commands/auth.js';
import { registerConnectCommand } from './commands/connect.js';
import { registerConfigCommands } from './commands/config.js';
import { registerApiCommands } from './commands/api.js';
import { registerHealthCommands } from './commands/health.js';
import { registerMcpCommands } from './commands/mcp.js';
import { registerClaudeCodeCommands } from './commands/claude-code.js';
import { registerCursorCommands } from './commands/cursor.js';
import { registerInstallCommands } from './commands/install.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerVerifyCommand } from './commands/verify.js';
import { EXIT, bailWith } from './exit-codes.js';
import { error } from './output.js';
import { reportAndExit } from '../validators/index.js';

export const program = new Command();
let commandTreeConfigured = false;
let activeArgv = process.argv;

function packageVersion(): string {
  for (const rel of ['../../package.json', '../../../package.json']) {
    try {
      const pkg = JSON.parse(
        readFileSync(new URL(rel, import.meta.url), 'utf8'),
      ) as {
        version?: unknown;
      };
      if (typeof pkg.version === 'string' && pkg.version.length > 0)
        return pkg.version;
    } catch {
      // Try the next layout: bundled dist first, source tree second.
    }
  }
  return '0.0.0';
}

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
 *  `openbox api backend` (missing arg) points at
 *  `openbox api backend --help`, not just `openbox api --help`.
 *  Stops at the first token that doesn't match a registered subcommand
 *  so an unknown verb doesn't poison the path. */
function deepestRegisteredPath(): string | null {
  const argv = activeArgv.slice(2);
  // Strip global flags, and bail at the first flag.
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
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
      const positionals: string[] = [];
      for (const arg of activeArgv.slice(2)) {
        if (arg.startsWith('-')) break;
        positionals.push(arg);
      }
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
  .version(packageVersion())
  .option(
    '-y, --yes',
    'Assume yes on confirmation prompts. Implied by CI=1, OPENBOX_NONINTERACTIVE=1, or non-TTY stdin.',
  )
  .option(
    '--non-interactive',
    'Hard-fail instead of prompting on missing input. Implied by CI=1 or OPENBOX_NONINTERACTIVE=1.',
  )
  .option(
    '--no-color',
    'Disable ANSI color output. Implied by NO_COLOR=1, OPENBOX_NO_COLOR=1, or CI=1',
  )
  .option(
    '-q, --quiet',
    'Suppress non-essential progress lines on stderr (errors still print)',
  )
  .option(
    '--json',
    'Emit machine-readable JSON instead of human-rendered output',
  )
  .hook('preAction', (thisCommand, actionCommand) => {
    const commandPath = buildCommandKey(actionCommand);
    const projectScopedHook = commandPath === 'claude-code hook';
    if (!projectScopedHook) {
      applyEnvSource();
    }

    // Permission check (granular Keycloak role permissions).
    const required = COMMAND_PERMISSIONS[commandPath];
    if (!required || required.length === 0) return;
    const have = loadPermissions();
    if (have.length === 0) return;
    const missing = missingPermissions(required, have);
    if (missing.length === 0) return;

    error(
      `missing permission for \`openbox ${commandPath}\`: ${missing.join(', ')}`,
      {
        detail: `api-key has ${have.length} permission(s); server returns 403 if any required ones are missing`,
        help: `ask your admin to grant the missing permission(s) for the active OpenBox connection`,
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
registerConnectCommand(program);
registerConfigCommands(program);
registerApiCommands(program);
registerHealthCommands(program);
registerMcpCommands(program);
registerClaudeCodeCommands(program);
registerCursorCommands(program);
registerInstallCommands(program);
registerDoctorCommand(program);
registerVerifyCommand(program);

function isCliEntrypoint(): boolean {
  const entrypoint = process.argv[1];
  if (!entrypoint) return false;
  const modulePath = fileURLToPath(import.meta.url);
  try {
    return realpathSync(modulePath) === realpathSync(entrypoint);
  } catch {
    return modulePath === entrypoint;
  }
}

function configureCommandTree(argv: string[]): void {
  if (commandTreeConfigured) return;

  void argv;

  // Apply uniform error handling across the command tree. exitOverride
  // and configureOutput are per-command, not inherited; we walk once.
  applyUniformErrorHandling(program);
  commandTreeConfigured = true;
}

function rejectRemovedGlobalFlags(argv: string[]): void {
  const removed = argv
    .slice(2)
    .find((arg) =>
      arg === '--experimental' ||
      arg.startsWith('--experimental=') ||
      arg === '--feature' ||
      arg.startsWith('--feature='),
    );
  if (!removed) return;
  error(`unknown option \`${removed}\``, { help: 'see `openbox --help`' });
  bailWith(EXIT.USAGE);
}

export async function runOpenBoxCli(
  argv: string[] = process.argv,
): Promise<void> {
  activeArgv = argv;
  rejectRemovedGlobalFlags(argv);
  configureCommandTree(argv);

  // `openbox` (no args) defaults to printing help instead of silently
  // exiting. Mirrors `cargo` / `gh`; bare invocation is informational.
  if (argv.length === 2) {
    program.outputHelp();
    bailWith(EXIT.OK);
  }

  await program.parseAsync(argv).catch((err) => {
    reportAndExit(err);
  });
}

if (isCliEntrypoint()) {
  await runOpenBoxCli();
}
