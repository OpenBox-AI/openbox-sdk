#!/usr/bin/env node
import { Command } from 'commander';
import { loadPermissions } from './config.js';
import { resolveEnv } from './environments.js';
import { COMMAND_PERMISSIONS, missingPermissions } from './permissions.js';
import { registerAuthCommands } from './commands/auth.js';
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
import { registerSetupCommands } from './commands/setup.js';

const program = new Command();

program
  .name('openbox')
  .description('OpenBox AI Platform CLI')
  .version('1.0.0')
  .option(
    '--env <env>',
    "Environment: 'production' or 'staging' (default: $OPENBOX_ENV or 'production')",
  )
  .hook('preAction', (thisCommand, actionCommand) => {
    const flag = thisCommand.opts().env as string | undefined;
    if (flag) process.env.OPENBOX_ENV = flag;

    // Pre-flight permission check: each env's live role may differ. Catch
    // missing permissions locally instead of firing a request and getting 403.
    const commandPath = buildCommandKey(actionCommand);
    const required = COMMAND_PERMISSIONS[commandPath];
    if (!required || required.length === 0) return;

    const env = resolveEnv();
    const have = loadPermissions(env);
    if (have.length === 0) return;

    const missing = missingPermissions(required, have);
    if (missing.length === 0) return;

    console.error(
      `This env (${env}) lacks required permission(s) for \`openbox ${commandPath}\`: ${missing.join(', ')}`,
    );
    console.error(
      `Your role has ${have.length} permission(s) - run \`openbox auth permissions\` to inspect.`,
    );
    console.error(
      `To fix: ask your admin to grant the missing permission(s) on the ${env} Keycloak role.`,
    );
    process.exit(3);
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
registerSetupCommands(program);

program.parseAsync(process.argv).catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
