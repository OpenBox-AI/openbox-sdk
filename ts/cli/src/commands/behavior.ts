import { Command } from 'commander';
import { getClient } from '../config.js';
import { output, outputList } from '../output.js';
import { parseJsonInput } from '../input.js';
import {
  reportAndExit,
  validateBehaviorTrigger,
  validateBehaviorStates,
  validateVerdict,
  validateApprovalTimeout,
  validateInt,
  validateEnum,
  parsePagination,
  validateIsoDate,
} from '../validators/index.js';

export function registerBehaviorCommands(program: Command) {
  const behavior = program.command('behavior').description('Behavior rule management');

  behavior
    .command('types')
    .description('Get semantic types')
    .action(async () => {
      try {
        const data = await getClient().getSemanticTypes();
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  behavior
    .command('list <agentId>')
    .description('List behavior rules for an agent')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .option('--verdict <n>', 'Filter by verdict (0-4)')
    .option('--active <bool>', 'Filter by active status (true|false)')
    .option('--trigger <trigger>', 'Filter by trigger type')
    .action(async (agentId: string, opts) => {
      try {
        const data = await getClient().listBehaviorRules(agentId, {
          ...parsePagination(opts),
          verdict: opts.verdict !== undefined ? parseInt(opts.verdict) : undefined,
          is_active: opts.active !== undefined ? opts.active === 'true' : undefined,
          trigger: opts.trigger,
        });
        outputList(data, 'behavior rules');
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  behavior
    .command('current <agentId>')
    .description('Get current active behavior rules')
    .action(async (agentId: string) => {
      try {
        const data = await getClient().getCurrentBehaviorRules(agentId);
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  behavior
    .command('create <agentId>')
    .description('Create a behavior rule')
    .requiredOption('-n, --name <name>', 'Rule name')
    .requiredOption('--trigger <trigger>', 'Trigger type')
    .requiredOption('--states <states...>', 'State triggers')
    .requiredOption('--window <n>', 'Time window (seconds)')
    .requiredOption(
      '--verdict <n>',
      'Verdict (0=ALLOW, 1=CONSTRAIN, 2=REQUIRE_APPROVAL, 3=BLOCK, 4=HALT)',
    )
    .requiredOption('--message <text>', 'Reject message')
    .option('--priority <n>', 'Priority', '1')
    .option('-d, --desc <text>', 'Description')
    .option('--trust-impact <impact>', 'Trust impact (none|low|medium|high)')
    .option('--trust-threshold <n>', 'Trust threshold')
    .option('--approval-timeout <n>', 'Approval timeout (seconds)')
    .option('--json <json>', 'Full JSON body (overrides other options)')
    .action(async (agentId: string, opts) => {
      try {
        let dto: any;
        if (opts.json) {
          dto = parseJsonInput(opts.json);
          // Validate --json body too - can't trust user JSON any more than flags.
          if (dto.trigger) validateBehaviorTrigger(dto.trigger);
          if (dto.states) validateBehaviorStates(dto.states);
          if (dto.verdict != null) validateVerdict(dto.verdict);
          if (dto.priority != null) validateInt(dto.priority, 'priority', { min: 1, max: 100 });
          if (dto.time_window != null) validateInt(dto.time_window, 'time_window', { min: 1 });
          if (dto.verdict != null) validateApprovalTimeout(Number(dto.verdict), dto.approval_timeout);
          if (dto.trust_impact) validateEnum(dto.trust_impact, ['none', 'low', 'medium', 'high'] as const, 'trust_impact');
        } else {
          // Flag path - validate each piece before assembling the dto.
          const trigger = validateBehaviorTrigger(opts.trigger);
          const states = validateBehaviorStates(opts.states);
          const window = validateInt(opts.window, '--window', { min: 1 });
          const verdict = validateVerdict(opts.verdict);
          const priority = validateInt(opts.priority, '--priority', { min: 1, max: 100 });
          validateApprovalTimeout(verdict, opts.approvalTimeout);
          if (opts.trustImpact) validateEnum(opts.trustImpact, ['none', 'low', 'medium', 'high'] as const, '--trust-impact');
          if (opts.trustThreshold) validateInt(opts.trustThreshold, '--trust-threshold');

          dto = {
            rule_name: opts.name,
            description: opts.desc,
            priority,
            trigger,
            states,
            time_window: window,
            verdict,
            reject_message: opts.message,
            trust_impact: opts.trustImpact,
            trust_threshold: opts.trustThreshold ? parseInt(opts.trustThreshold) : undefined,
            approval_timeout: opts.approvalTimeout ? parseInt(opts.approvalTimeout) : undefined,
          };
        }
        const data = await getClient().createBehaviorRule(agentId, dto);
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  behavior
    .command('get <agentId> <ruleId>')
    .description('Get behavior rule details')
    .action(async (agentId: string, ruleId: string) => {
      try {
        const data = await getClient().getBehaviorRule(agentId, ruleId);
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  behavior
    .command('update <agentId> <ruleId>')
    .description('Update a behavior rule')
    .requiredOption('--json <json>', 'Full JSON body (required due to many fields). If it omits change_log, the --change-log flag fills it in.')
    .option('--change-log <text>', 'Human-readable change reason. Required by the backend (UpdateBehavioralRuleDto.change_log is non-empty). The value is read from --json first; this flag is the fallback when your --json doesn\'t include it.')
    .action(async (agentId: string, ruleId: string, opts) => {
      try {
        const dto = parseJsonInput<any>(opts.json);
        if (!dto.change_log && opts.changeLog) dto.change_log = opts.changeLog;
        if (!dto.change_log) {
          console.error('Error: change_log is required (include in --json or pass --change-log <text>).');
          process.exit(2);
        }
        const data = await getClient().updateBehaviorRule(agentId, ruleId, dto);
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  behavior
    .command('delete <agentId> <ruleId>')
    .description('Delete a behavior rule')
    .action(async (agentId: string, ruleId: string) => {
      try {
        const data = await getClient().deleteBehaviorRule(agentId, ruleId);
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  behavior
    .command('restore <agentId> <ruleId>')
    .description('Restore (rollback) a deleted behavior rule')
    .action(async (agentId: string, ruleId: string) => {
      try {
        const data = await getClient().restoreBehaviorRule(agentId, ruleId);
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  behavior
    .command('toggle <agentId> <ruleId>')
    .description('Toggle behavior rule active status')
    .requiredOption('--active <bool>', 'Active status (true|false)')
    .action(async (agentId: string, ruleId: string, opts) => {
      try {
        const data = await getClient().toggleBehaviorRuleStatus(agentId, ruleId, {
          is_active: opts.active === 'true',
        });
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  behavior
    .command('versions <agentId> <groupId>')
    .description('Get behavior rule versions')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .action(async (agentId: string, groupId: string, opts) => {
      try {
        const data = await getClient().getBehaviorRuleVersions(agentId, groupId, {
          ...parsePagination(opts),
        });
        outputList(data, 'versions');
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  behavior
    .command('metrics <agentId>')
    .description('Get behavior metrics')
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .action(async (agentId: string, opts) => {
      try {
        if (opts.from) validateIsoDate(opts.from, '--from');
        if (opts.to) validateIsoDate(opts.to, '--to');
        const data = await getClient().getBehaviorMetrics(agentId, {
          fromTime: opts.from,
          toTime: opts.to,
        });
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  behavior
    .command('violations <agentId>')
    .description('Get behavior violations')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .action(async (agentId: string, opts) => {
      try {
        const data = await getClient().getBehaviorViolations(agentId, {
          ...parsePagination(opts),
        });
        outputList(data, 'violations');
      } catch (err: any) {
        reportAndExit(err);
      }
    });
}
