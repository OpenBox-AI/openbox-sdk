#!/usr/bin/env node
import { Command } from 'commander';
import { registerAuthCommands } from './commands/auth';
import { registerAgentCommands } from './commands/agent';
import { registerApiKeyCommands } from './commands/api-key';
import { registerGuardrailCommands } from './commands/guardrail';
import { registerPolicyCommands } from './commands/policy';
import { registerBehaviorCommands } from './commands/behavior';
import { registerSessionCommands } from './commands/session';
import { registerTrustCommands } from './commands/trust';
import { registerAivssCommands } from './commands/aivss';
import { registerGoalCommands } from './commands/goal';
import { registerApprovalCommands } from './commands/approval';
import { registerObservabilityCommands } from './commands/observability';
import { registerViolationCommands } from './commands/violation';
import { registerOrgCommands } from './commands/org';
import { registerTeamCommands } from './commands/team';
import { registerMemberCommands } from './commands/member';
import { registerAuditCommands } from './commands/audit';
import { registerHealthCommands } from './commands/health';
import { registerCoreCommands } from './commands/core';
import { registerSetupCommands } from './commands/setup';

const program = new Command();

program.name('openbox').description('OpenBox AI Platform CLI').version('1.0.0');

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
