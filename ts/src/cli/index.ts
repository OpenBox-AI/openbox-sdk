#!/usr/bin/env node
import { Command } from 'commander';
import { loadFeatures, loadPermissions } from './config.js';
import { resolveEnv } from '../env/index.js';
import {
  COMMAND_FEATURES,
  COMMAND_PERMISSIONS,
  missingFeatures,
  missingPermissions,
} from './permissions.js';
import { registerAuthCommands } from './commands/auth.js';
import { registerConfigCommands } from './commands/config.js';
import { applyConfigToProcessEnv, applyGlobalConfigToProcessEnv } from './config-store.js';
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
import { setExplicitFeatures } from './features.js';
import { EXIT, bailWith } from './exit-codes.js';
import { reportAndExit } from '../validators/index.js';

const program = new Command();

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
  .option('--no-color', 'Disable ANSI color output. Implied by NO_COLOR=1, OPENBOX_NO_COLOR=1, or CI=1.')
  .option('-q, --quiet', 'Suppress non-essential progress lines on stderr. Errors still print.')
  .option('--json', 'Emit machine-readable JSON instead of human-rendered output.')
  .hook('preAction', (thisCommand, actionCommand) => {
    const flag = thisCommand.opts().env as string | undefined;
    if (flag) process.env.OPENBOX_ENV = flag;

    // Apply GLOBAL config BEFORE env resolution so a persisted
    // `OPENBOX_ENV=staging` (or OPENBOX_HOME, OPENBOX_CLIENT_VARIANT)
    // can actually default the env. Only fills unset vars; explicit
    // shell exports and --env always win.
    applyGlobalConfigToProcessEnv();

    // Pre-flight gates: each env's live role AND feature flags may differ.
    // Catch problems locally instead of firing a request and getting 403.
    const commandPath = buildCommandKey(actionCommand);
    const env = resolveEnv();

    // Layer per-env CLI config AFTER env is known. Used to pin
    // OPENBOX_API_URL, OPENBOX_CORE_URL, or OPENBOX_PLATFORM_URL for
    // a specific env, such as staging, without re-exporting every shell.
    applyConfigToProcessEnv(env);

    // 1. Feature-flag check, mirroring `@RequireFeature` on the backend.
    const requiredFeatures = COMMAND_FEATURES[commandPath];
    if (requiredFeatures && requiredFeatures.length > 0) {
      const features = loadFeatures(env);
      if (Object.keys(features).length > 0) {
        const missingF = missingFeatures(requiredFeatures, features);
        if (missingF.length > 0) {
          console.error(
            `This env (${env}) has feature(s) disabled for \`openbox ${commandPath}\`: ${missingF.join(', ')}`,
          );
          console.error(
            `To fix: ask your admin to enable the feature on the ${env} org.`,
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

    console.error(
      `This env (${env}) lacks required permission(s) for \`openbox ${commandPath}\`: ${missing.join(', ')}`,
    );
    console.error(
      `Your api-key has ${have.length} permission(s); the server will return 403 if any are required.`,
    );
    console.error(
      `To fix: ask your admin to grant the missing permission(s) on the ${env} Keycloak role.`,
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

// Pre-flight check: if the user typed a command that's gated behind
// `--experimental` without passing the flag, commander would emit a
// bare `error: unknown command '<verb>'`. That message is misleading -
// the verb DOES exist, it's just hidden at the current maturity level.
// LLMs (and humans) who see "unknown command 'agent'" tend to invent
// explanations like "slim build" instead of trying --experimental.
// Print a tighter, accurate error when we detect this case.
{
  const argv = process.argv.slice(2);
  // First non-flag token is the candidate top-level verb.
  const firstVerb = argv.find((a) => !a.startsWith('-'));
  if (firstVerb && !argv.includes('--experimental')) {
    // Use maturityOf() which defaults unlisted paths to
    // 'experimental' (the same conservative default the gating
    // walker uses). COMMAND_MATURITY only lists paths the spec
    // explicitly tags; commands like `core` that aren't tagged
    // still get gated as experimental at runtime, so the hint
    // needs the same fallback or we'd miss them.
    const fullPath = argv.filter((a) => !a.startsWith('-')).join(' ');
    const topMaturity = maturityOf(firstVerb);
    const fullMaturity = maturityOf(fullPath);
    const gated = topMaturity === 'experimental' || fullMaturity === 'experimental';
    // Only fire when the verb isn't currently registered (gated out)
    // AND it's known-experimental in the spec. Otherwise commander's
    // own error is the right one.
    const knownToCommander = program.commands.some((c) => c.name() === firstVerb);
    if (gated && !knownToCommander) {
      console.error(
        `error: '${firstVerb}' is an experimental command. Re-run with --experimental:\n` +
          `  openbox --experimental ${argv.join(' ')}\n` +
          `Or set OPENBOX_EXPERIMENTAL_LEVEL=experimental in your shell.`,
      );
      bailWith(EXIT.USAGE);
    }
  }
}

program.parseAsync(process.argv).catch((err) => {
  reportAndExit(err);
});
