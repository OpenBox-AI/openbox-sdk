import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RulesProjection } from '../../ts/src/governance/rules-projection.js';

const apiState = vi.hoisted(() => ({
  responses: new Map<string, unknown>(),
  calls: [] as string[],
}));

vi.mock('../../ts/src/runtime/mcp/config.js', () => ({
  createApi: vi.fn(() => async (path: string) => {
    apiState.calls.push(path);
    return apiState.responses.get(path);
  }),
}));

describe('governance rules projection coverage', () => {
  beforeEach(() => {
    apiState.responses.clear();
    apiState.calls.length = 0;
  });

  it('projects active guardrails and policies from backend envelopes', async () => {
    const { fetchRulesProjection } = await import(
      '../../ts/src/governance/rules-projection.ts'
    );
    apiState.responses.set('/agent/agent-1/guardrails?page=0&perPage=200', {
      data: [
        {
          id: 'gr-b',
          name: 'PII filter',
          guardrail_type: 'pii',
          processing_stage: '0',
          is_active: true,
          params: { path_globs: ['**/*.md'], mode: 'strict' },
          trust_impact: 'critical',
        },
        {
          id: 'gr-off',
          name: 'Inactive',
          guardrail_type: 'secret',
          processing_stage: '1',
          is_active: false,
        },
        {
          id: 'gr-a',
          name: 'Prompt guard',
          description: 'Review prompts',
          guardrail_type: 'prompt',
          processing_stage: '1',
          is_active: true,
          settings: { ignored: true },
          trust_impact: 'medium',
        },
      ],
    });
    apiState.responses.set('/agent/agent-1/policies?page=0&perPage=200', {
      data: [
        {
          id: 'pol-a',
          name: 'Transfer policy',
          rego_code: 'package x',
          is_active: true,
          trust_impact: 'low',
        },
        {
          id: 'pol-off',
          name: 'Off',
          rego_code: 'package x',
          is_active: false,
        },
      ],
    });
    apiState.responses.set('/agent/agent-1/behavior-rule?page=0&perPage=200', { data: [] });

    const projection = await fetchRulesProjection({
      agentId: 'agent-1',
      tokensPath: '/tmp/tokens',
    });

    expect(apiState.calls).toEqual([
      '/agent/agent-1/guardrails?page=0&perPage=200',
      '/agent/agent-1/policies?page=0&perPage=200',
      '/agent/agent-1/behavior-rule?page=0&perPage=200',
    ]);
    expect(projection).toMatchObject({
      agentId: 'agent-1',
      version: 1,
    });
    expect(projection.rules.map((rule) => rule.id)).toEqual([
      'guardrail/gr-a',
      'guardrail/gr-b',
      'policy/pol-a',
    ]);
    expect(projection.rules[0]).toMatchObject({
      trigger: 'always',
      severity: 'warn',
      description: 'Review prompts',
    });
    expect(projection.rules[1]).toMatchObject({
      trigger: 'globMatch',
      severity: 'block',
      globs: ['**/*.md'],
      rendererHints: {
        guardrailType: 'pii',
        processingStage: '0',
      },
    });
    expect(projection.rules[1].body).toContain('Parameters:');
    expect(projection.rules[2]).toMatchObject({
      source: 'policy',
      trigger: 'agentRequested',
      severity: 'info',
      description: 'Transfer policy',
    });
    expect(projection.rules[2].body).toContain('Policy id: `pol-a`');
  });

  it('projects array responses and ignores invalid glob shapes', async () => {
    const { fetchRulesProjection } = await import(
      '../../ts/src/governance/rules-projection.ts'
    );
    apiState.responses.set('/agent/agent-2/guardrails?page=0&perPage=200', [
      {
        id: 'gr-c',
        name: 'Secret scan',
        guardrail_type: 'secret',
        description: undefined,
        processing_stage: '1',
        is_active: true,
        params: { globs: ['ok', 42] },
        trust_impact: 'high',
      },
      {
        id: 'gr-d',
        name: 'DLP',
        guardrail_type: 'dlp',
        processing_stage: '1',
        is_active: true,
        params: { file_globs: ['**/*.txt'] },
        trust_impact: 'none',
      },
    ]);
    apiState.responses.set('/agent/agent-2/policies?page=0&perPage=200', [
      {
        id: 'pol-c',
        name: 'No description policy',
        description: undefined,
        rego_code: 'package x',
        is_active: true,
        trust_impact: 'critical',
      },
    ]);

    const projection = await fetchRulesProjection({ agentId: 'agent-2' });

    expect(projection.rules.find((rule) => rule.id === 'guardrail/gr-c')).toMatchObject({
      trigger: 'always',
      severity: 'block',
      description: 'Secret scan',
    });
    expect(projection.rules.find((rule) => rule.id === 'guardrail/gr-c')?.body).toContain(
      '_No description provided._',
    );
    expect(projection.rules.find((rule) => rule.id === 'guardrail/gr-d')).toMatchObject({
      trigger: 'globMatch',
      severity: 'info',
      globs: ['**/*.txt'],
    });
    expect(projection.rules.find((rule) => rule.id === 'policy/pol-c')).toMatchObject({
      severity: 'block',
      description: 'No description policy',
    });
  });

  it('renders instruction projections and exact Codex command rules without local policy evaluation', async () => {
    const {
      renderClaudeInstructionsMarkdown,
      renderCodexAgentsMarkdown,
      renderCodexCommandRules,
    } = await import(
      '../../ts/src/governance/rules-projection.ts'
    );
    const projection: RulesProjection = {
      agentId: 'agent-1',
      fetchedAt: '2026-05-04T00:00:00Z',
      version: 1,
      rules: [
        {
          id: 'guardrail/gr-a',
          source: 'guardrail',
          description: 'Prompt guard',
          body: 'guardrail body',
          trigger: 'always',
          severity: 'warn',
        },
        {
          id: 'policy/pol-a',
          source: 'policy',
          description: 'Transfer policy',
          body: 'policy body',
          trigger: 'agentRequested',
          severity: 'block',
        },
        {
          id: 'behavior-rule/br-publish',
          source: 'behavior-rule',
          description: 'Block package publish',
          body: 'behavior rule body',
          trigger: 'always',
          severity: 'block',
          rendererHints: {
            exactShellPrefix: ['npm', 'publish'],
          },
        },
        {
          id: 'behavior-rule/br-no-prefix',
          source: 'behavior-rule',
          description: 'No local command prefix',
          body: 'behavior rule body',
          trigger: 'always',
          severity: 'warn',
        },
      ],
    };

    const agents = renderCodexAgentsMarkdown(projection);
    expect(agents).toContain('OpenBox Core is the source of truth');
    expect(agents).toContain('Do not locally reimplement policy decisions');
    expect(agents).toContain('- Guardrails: 1');
    expect(agents).toContain('- Policies: 1');
    expect(agents).toContain('- Behavior rules: 2');

    const claude = renderClaudeInstructionsMarkdown(projection);
    expect(claude).toContain('OpenBox Governance for Claude Code');
    expect(claude).toContain('Use the OpenBox Claude Code plugin, MCP tools, or slash commands');
    expect(claude).toContain('Do not evaluate OPA/Rego, behavior-rule predicates');
    expect(claude).toContain('## Guardrails');
    expect(claude).toContain('- [warn] Prompt guard (guardrail/gr-a)');
    expect(claude).toContain('## Behavior Rules');
    expect(claude).toContain('- [block] Block package publish (behavior-rule/br-publish)');
    expect(claude).toContain('`/openbox-check`');
    expect(claude).not.toContain('prefix_rule(');
    expect(claude).not.toContain('pattern = ["npm", "publish"]');

    const commandRules = renderCodexCommandRules(projection);
    expect(commandRules).toContain('Only exact shell command-prefix execution policy is projected here');
    expect(commandRules).toContain('prefix_rule(');
    expect(commandRules).toContain('pattern = ["npm", "publish"]');
    expect(commandRules).toContain('decision = "forbidden"');
    expect(commandRules).not.toContain('guardrail/gr-a');
    expect(commandRules).not.toContain('policy/pol-a');
    expect(commandRules).not.toContain('br-no-prefix');
  });
});
