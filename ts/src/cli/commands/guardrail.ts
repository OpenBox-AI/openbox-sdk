import { Command } from 'commander';
import { getClient } from '../config.js';
import { output, outputList } from '../output.js';
import { parseJsonInput } from '../input.js';
import {
  reportAndExit,
  validateGuardrailType,
  validateStage,
  validateGuardrailParams,
  validateActivitiesConfig,
  validateEnum,
  parsePagination,
  validateIsoDate,
} from '../validators/index.js';

export function registerGuardrailCommands(program: Command) {
  const guardrail = program.command('guardrail').description('Guardrail management');

  guardrail
    .command('list <agentId>')
    .description('List guardrails for an agent')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .option('--stage <stage>', 'Filter by processing stage')
    .action(async (agentId: string, opts) => {
      try {
        const data = await getClient().listGuardrails(agentId, {
          ...parsePagination(opts),
          processing_stage: opts.stage,
        });
        outputList(data, 'guardrails');
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  guardrail
    .command('create <agentId>')
    .description('Create a guardrail')
    .option('-n, --name <name>', 'Guardrail name (required unless --json provides it)')
    .option('--type <type>', 'Guardrail type (1=PII, 2=NSFW, 3=Toxicity, 4=BanList, 5=Regex, or name)')
    .option('--stage <stage>', 'Processing stage (0=input, 1=output). Must be 0 or 1.')
    .option('-d, --desc <text>', 'Description')
    .option('--trust-impact <impact>', 'Trust impact (none|low|medium|high)')
    .option('--trust-threshold <n>', 'Trust threshold')
    .option('--json <json>', 'Full JSON body. Merged with flags (flags fill missing fields).')
    .action(async (agentId: string, opts) => {
      try {
        // Start with --json body if provided, then fill from flags
        let dto: any = opts.json ? parseJsonInput(opts.json) : {};

        // Flags fill missing fields (don't override what --json provides)
        if (opts.name && !dto.name) dto.name = opts.name;
        if (opts.type && !dto.guardrail_type) dto.guardrail_type = opts.type;
        if (opts.stage != null && !dto.processing_stage) dto.processing_stage = opts.stage;
        if (opts.desc && !dto.description) dto.description = opts.desc;
        if (opts.trustImpact && !dto.trust_impact) dto.trust_impact = opts.trustImpact;
        if (opts.trustThreshold && !dto.trust_threshold) dto.trust_threshold = parseInt(opts.trustThreshold);

        // Required fields
        if (!dto.name) { console.error('Error: --name or name in --json is required'); process.exit(2); }
        if (!dto.guardrail_type) { console.error('Error: --type or guardrail_type in --json is required'); process.exit(2); }
        if (opts.trustImpact) validateEnum(opts.trustImpact, ['none', 'low', 'medium', 'high'] as const, '--trust-impact');

        // Full validation pipeline - each step exits 2 with an actionable message if it fails.
        dto.guardrail_type = validateGuardrailType(dto.guardrail_type);
        const stage = validateStage(dto.processing_stage ?? '0');
        dto.processing_stage = stage;
        validateGuardrailParams(dto.guardrail_type, dto.params);

        // Settings: if user provided activities, validate the full shape + prefix match.
        // If not, default to a stage-appropriate baseline covering the common canonical types.
        if (dto.settings?.activities) {
          validateActivitiesConfig(dto.settings.activities, stage);
        } else {
          const prefix = stage === '0' ? 'input' : 'output';
          dto.settings = {
            on_fail: 1,
            log_violation: true,
            activities: [
              { activity_type: 'PromptSubmission', fields_to_check: [`${prefix}.*.prompt`] },
              { activity_type: 'LLMCompleted',     fields_to_check: [`${prefix}.*.response`] },
              { activity_type: 'ToolCompleted',    fields_to_check: [`${prefix}.*.result`] },
            ],
            timeout: 5000,
            retry_attempts: 3,
            ...(dto.settings || {}),
          };
        }

        const data = await getClient().createGuardrail(agentId, dto);
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  guardrail
    .command('get <agentId> <guardrailId>')
    .description('Get guardrail details')
    .action(async (agentId: string, guardrailId: string) => {
      try {
        const data = await getClient().getGuardrail(agentId, guardrailId);
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  guardrail
    .command('update <agentId> <guardrailId>')
    .description('Update a guardrail')
    .option('-n, --name <name>', 'Guardrail name')
    .option('--active <bool>', 'Active status (true|false)')
    .option('--type <type>', 'Guardrail type')
    .option('--stage <stage>', 'Processing stage (0=input, 1=output)')
    .option('-d, --desc <text>', 'Description')
    .option('--trust-impact <impact>', 'Trust impact (none|low|medium|high)')
    .option('--trust-threshold <n>', 'Trust threshold')
    .option('--json <json>', 'Full JSON body (merged with flags)')
    .action(async (agentId: string, guardrailId: string, opts) => {
      try {
        let dto: any = opts.json ? parseJsonInput(opts.json) : {};
        if (opts.name && !dto.name) dto.name = opts.name;
        if (opts.active !== undefined && dto.is_active === undefined) dto.is_active = opts.active === 'true';
        if (opts.type && !dto.guardrail_type) dto.guardrail_type = opts.type;
        if (opts.stage != null && !dto.processing_stage) dto.processing_stage = opts.stage;
        if (opts.desc && !dto.description) dto.description = opts.desc;
        if (opts.trustImpact && !dto.trust_impact) dto.trust_impact = opts.trustImpact;
        if (opts.trustThreshold && !dto.trust_threshold) dto.trust_threshold = parseInt(opts.trustThreshold);
        // Validate processing_stage
        if (dto.processing_stage && dto.processing_stage !== '0' && dto.processing_stage !== '1') {
          console.error(`Error: --stage must be 0 (input) or 1 (output). Got: "${dto.processing_stage}"`);
          process.exit(1);
        }
        const data = await getClient().updateGuardrail(agentId, guardrailId, dto);
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  guardrail
    .command('delete <agentId> <guardrailId>')
    .description('Delete a guardrail')
    .action(async (agentId: string, guardrailId: string) => {
      try {
        const data = await getClient().deleteGuardrail(agentId, guardrailId);
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  guardrail
    .command('reorder <agentId> <guardrailId> <order>')
    .description('Reorder a guardrail')
    .action(async (agentId: string, guardrailId: string, order: string) => {
      try {
        const data = await getClient().reorderGuardrail(agentId, guardrailId, {
          order: parseInt(order),
        });
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  guardrail
    .command('metrics <agentId>')
    .description('Get guardrail metrics')
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .action(async (agentId: string, opts) => {
      try {
        if (opts.from) validateIsoDate(opts.from, '--from');
        if (opts.to) validateIsoDate(opts.to, '--to');
        const data = await getClient().getGuardrailMetrics(agentId, {
          fromTime: opts.from,
          toTime: opts.to,
        });
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  guardrail
    .command('violations <agentId>')
    .description('Get guardrail violation logs')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .option('--type <type>', 'Guardrail type filter')
    .action(async (agentId: string, opts) => {
      try {
        if (opts.from) validateIsoDate(opts.from, '--from');
        if (opts.to) validateIsoDate(opts.to, '--to');
        const data = await getClient().getGuardrailViolationLogs(agentId, {
          ...parsePagination(opts),
          fromTime: opts.from,
          toTime: opts.to,
          guardrail_type: opts.type,
        });
        outputList(data, 'violations');
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  guardrail
    .command('test')
    .description('Run a guardrail test')
    .option('--type <type>', 'Guardrail type (1=PII, 2=NSFW, 3=Toxicity, 4=BanList, 5=Regex)')
    .option('--text <text>', 'Text to test against the guardrail')
    .option('--json <json>', 'Full JSON body (overrides other options)')
    .action(async (opts) => {
      try {
        let dto: any;
        if (opts.json) {
          dto = parseJsonInput(opts.json);
        } else {
          const GUARDRAIL_TYPE_MAP: Record<string, string> = {
            pii_detection: '1', pii: '1',
            nsfw: '2', nsfw_detection: '2', content_safety: '2',
            toxicity: '3', toxicity_detection: '3',
            ban_list: '4', ban_words: '4',
            regex: '5', regex_match: '5',
          };
          const resolvedType = GUARDRAIL_TYPE_MAP[opts.type] || opts.type;
          const testText = opts.text || 'test input';
          dto = {
            guardrail_type: resolvedType,
            params: {},
            settings: {
              on_fail: 1,
              activities: [{ activity_type: 'PromptSubmission', fields_to_check: ['input.*.prompt'] }],
            },
            logs: {
              event_type: 'ActivityStarted',
              activity_type: 'PromptSubmission',
              input: [{ prompt: testText }],
              output: null,
              signal_name: null,
            },
          };
        }
        const data = await getClient().runGuardrailTest(dto);
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });
}
