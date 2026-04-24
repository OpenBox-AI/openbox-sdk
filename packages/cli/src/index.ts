#!/usr/bin/env node
import { Command } from 'commander';
import { loadFeatures, loadPermissions } from './config.js';
import { resolveEnv } from './environments.js';
import {
  COMMAND_FEATURES,
  COMMAND_PERMISSIONS,
  missingFeatures,
  missingPermissions,
} from './permissions.js';
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
import { registerDoctorCommand } from './commands/doctor.js';
import { registerVerifyCommand } from './commands/verify.js';
import { registerVersionsCommand } from './commands/versions.js';

const program = new Command();

program
  .name('openbox')
  .description('OpenBox AI Platform CLI')
  .version('1.0.0')
  .option(
    '--env <env>',
    "Environment: 'production' | 'staging' | 'local' (default: $OPENBOX_ENV or 'production')",
  )
  .hook('preAction', (thisCommand, actionCommand) => {
    const flag = thisCommand.opts().env as string | undefined;
    if (flag) process.env.OPENBOX_ENV = flag;

    // Pre-flight gates: each env's live role AND feature flags may differ.
    // Catch problems locally instead of firing a request and getting 403.
    const commandPath = buildCommandKey(actionCommand);
    const env = resolveEnv();

    // 1. Feature-flag check (`@RequireFeature` on openbox-backend controllers).
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
            `Check feature state: run \`openbox auth features --all\`.`,
          );
          console.error(
            `To fix: ask your admin to enable the feature on the ${env} org.`,
          );
          process.exit(4);
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
registerDoctorCommand(program);
registerVerifyCommand(program);
registerVersionsCommand(program);

program.parseAsync(process.argv).catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
