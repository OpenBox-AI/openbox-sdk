#!/usr/bin/env node
import { Command } from 'commander';
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
