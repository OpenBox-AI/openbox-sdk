import { Command } from 'commander';
import { getClient } from '../config.js';
import { output, outputList } from '../output.js';
import { parseJsonInput } from '../input.js';

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
          page: parseInt(opts.page),
          perPage: parseInt(opts.limit),
          processing_stage: opts.stage,
        });
        outputList(data, 'guardrails');
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  guardrail
    .command('create <agentId>')
    .description('Create a guardrail')
    .requiredOption('-n, --name <name>', 'Guardrail name')
    .requiredOption('--type <type>', 'Guardrail type (1=PII, 2=NSFW, 3=Toxicity, 4=BanList, 5=Regex, or numeric ID)')
    .requiredOption('--stage <stage>', 'Processing stage (0=input, 1=output)')
    .option('-d, --desc <text>', 'Description')
    .option('--trust-impact <impact>', 'Trust impact (none|low|medium|high)')
    .option('--trust-threshold <n>', 'Trust threshold')
    .option('--json <json>', 'Full JSON body (overrides other options)')
    .action(async (agentId: string, opts) => {
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
          // BanList (4) requires banned_words, Regex (5) requires regex pattern
          if (resolvedType === '4') {
            console.error('Error: Ban list guardrail requires params.banned_words. Use --json to provide full payload:\n  --json \'{"params":{"banned_words":["word1","word2"]}}\'\nOr combine: -n "Ban Words" --type ban_list --stage 0 --json \'{"params":{"banned_words":["DROP TABLE","DELETE FROM"]}}\'');
            process.exit(1);
          }
          if (resolvedType === '5') {
            console.error('Error: Regex guardrail requires params.regex. Use --json to provide full payload:\n  --json \'{"params":{"regex":"pattern","match_type":"search"}}\'');
            process.exit(1);
          }
          dto = {
            name: opts.name,
            guardrail_type: resolvedType,
            processing_stage: opts.stage,
            description: opts.desc,
            trust_impact: opts.trustImpact,
            trust_threshold: opts.trustThreshold ? parseInt(opts.trustThreshold) : undefined,
            settings: {
              on_fail: 1,
              log_violation: true,
              activities: [
                { activity_type: 'PromptSubmission', fields_to_check: ['input.*.prompt'] },
                { activity_type: 'FileRead', fields_to_check: ['input.*.content'] },
                { activity_type: 'ShellExecution', fields_to_check: ['input.*.command'] },
                { activity_type: 'MCPToolCall', fields_to_check: ['input.*.tool_input'] },
              ],
              timeout: 5000,
              retry_attempts: 3,
            },
          };
        }
        const data = await getClient().createGuardrail(agentId, dto);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
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
        console.error(err.message || err);
        process.exit(1);
      }
    });

  guardrail
    .command('update <agentId> <guardrailId>')
    .description('Update a guardrail')
    .option('-n, --name <name>', 'Guardrail name')
    .option('--active <bool>', 'Active status (true|false)')
    .option('--type <type>', 'Guardrail type')
    .option('--stage <stage>', 'Processing stage')
    .option('-d, --desc <text>', 'Description')
    .option('--trust-impact <impact>', 'Trust impact (none|low|medium|high)')
    .option('--trust-threshold <n>', 'Trust threshold')
    .option('--json <json>', 'Full JSON body')
    .action(async (agentId: string, guardrailId: string, opts) => {
      try {
        let dto: any;
        if (opts.json) {
          dto = parseJsonInput(opts.json);
        } else {
          dto = {} as any;
          if (opts.name) dto.name = opts.name;
          if (opts.active !== undefined) dto.is_active = opts.active === 'true';
          if (opts.type) dto.guardrail_type = opts.type;
          if (opts.stage) dto.processing_stage = opts.stage;
          if (opts.desc) dto.description = opts.desc;
          if (opts.trustImpact) dto.trust_impact = opts.trustImpact;
          if (opts.trustThreshold) dto.trust_threshold = parseInt(opts.trustThreshold);
        }
        const data = await getClient().updateGuardrail(agentId, guardrailId, dto);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
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
        console.error(err.message || err);
        process.exit(1);
      }
    });

  guardrail
    .command('reorder <agentId> <guardrailId> <order>')
    .description('Reorder a guardrail')
    .action(async (agentId: string, guardrailId: string, order: string) => {
      try {
        const data = await getClient().reorderGuardrail(agentId, guardrailId, parseInt(order));
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  guardrail
    .command('metrics <agentId>')
    .description('Get guardrail metrics')
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .action(async (agentId: string, opts) => {
      try {
        const data = await getClient().getGuardrailMetrics(agentId, {
          fromTime: opts.from,
          toTime: opts.to,
        });
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
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
        const data = await getClient().getGuardrailViolationLogs(agentId, {
          page: parseInt(opts.page),
          perPage: parseInt(opts.limit),
          fromTime: opts.from,
          toTime: opts.to,
          guardrail_type: opts.type,
        });
        outputList(data, 'violations');
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
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
        console.error(err.message || err);
        process.exit(1);
      }
    });
}
