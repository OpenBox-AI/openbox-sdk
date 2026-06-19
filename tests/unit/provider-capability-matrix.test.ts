import { describe, expect, it } from 'vitest';
import { HOOK_EVENTS as ANTHROPIC_AGENT_HOOK_EVENTS } from '@anthropic-ai/claude-agent-sdk';
import {
  OPENBOX_ANTHROPIC_AGENT_DEFAULT_HOOK_EVENTS,
  OPENBOX_ANTHROPIC_AGENT_OPT_IN_HOOK_EVENTS,
} from '../../ts/src/anthropic-agent-sdk/hooks.js';
import { HOOK_SPEC as CLAUDE_HOOK_SPEC } from '../../ts/src/core-client/generated/runtime/claude-code.js';
import { HOOK_SPEC as CODEX_HOOK_SPEC } from '../../ts/src/core-client/generated/runtime/codex.js';
import { HOOK_SPEC as CURSOR_HOOK_SPEC } from '../../ts/src/core-client/generated/runtime/cursor.js';
import {
  OPENBOX_CAPABILITY_IDS,
  MCP_PROMPT_SURFACES,
  MCP_RESOURCE_TEMPLATE_SURFACES,
  MCP_TOOL_SURFACES,
  N8N_INTEGRATION_SURFACE,
  PROVIDER_CAPABILITY_MATRIX,
  PROVIDER_EVENT_CATALOG,
  PROVIDER_PLUGIN_COMPONENTS,
  PUBLIC_INTEGRATION_SUPPORT,
  type OpenBoxProviderId,
} from '../../ts/src/governance/capability-matrix.js';

const PROVIDERS: readonly OpenBoxProviderId[] = [
  'codex',
  'cursor',
  'claude-code',
  'mcp',
  'openai-agents-sdk',
  'anthropic-agent-sdk',
  'copilotkit',
  'n8n',
];

describe('provider capability matrix', () => {
  it('declares every required capability for every provider', () => {
    for (const provider of PROVIDERS) {
      const entries = PROVIDER_CAPABILITY_MATRIX.filter((entry) => entry.provider === provider);
      expect(entries.map((entry) => entry.capability).sort()).toEqual(
        [...OPENBOX_CAPABILITY_IDS].sort(),
      );
      for (const entry of entries) {
        expect(entry.rationale.length, `${provider}/${entry.capability} rationale`).toBeGreaterThan(20);
      }
    }
  });

  it('pins generated hook events to the event catalog', () => {
    const generated: Partial<Record<OpenBoxProviderId, readonly string[]>> = {
      codex: CODEX_HOOK_SPEC.events.map((event) => event.name),
      cursor: CURSOR_HOOK_SPEC.events.map((event) => event.name),
      'claude-code': CLAUDE_HOOK_SPEC.events.map((event) => event.name),
      'anthropic-agent-sdk': [
        ...OPENBOX_ANTHROPIC_AGENT_DEFAULT_HOOK_EVENTS,
        ...OPENBOX_ANTHROPIC_AGENT_OPT_IN_HOOK_EVENTS,
      ],
    };

    for (const catalog of PROVIDER_EVENT_CATALOG) {
      expect(generated[catalog.provider]).toEqual(catalog.generatedAdapterEvents);
      const generatedPlusIntentionalExclusions = [
        ...catalog.generatedAdapterEvents,
        ...catalog.intentionalExclusions.map((entry) => entry.event),
      ].sort();
      expect(generatedPlusIntentionalExclusions).toEqual([...catalog.upstreamKnownEvents].sort());
    }
    expect(
      PROVIDER_EVENT_CATALOG.find((entry) => entry.provider === 'anthropic-agent-sdk')?.upstreamKnownEvents.slice().sort(),
    ).toEqual([...ANTHROPIC_AGENT_HOOK_EVENTS].sort());
  });

  it('records install/plugin components and intentional exclusions per host', () => {
    const byProvider = new Map(
      PROVIDER_PLUGIN_COMPONENTS.map((entry) => [entry.provider, entry.components]),
    );

    expect(byProvider.get('codex')?.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(['manifest', 'marketplace', 'skills', 'repo-skill', 'hooks', 'mcp', 'agents-md', 'rules']),
    );
    expect(byProvider.get('cursor')?.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(['plugin-manifest', 'hooks', 'mcp', 'rules', 'commands', 'agents', 'skills', 'workspaceOpen']),
    );
    expect(byProvider.get('claude-code')?.find((entry) => entry.name === 'lsp')?.tier).toBe('out-of-scope');
    expect(byProvider.get('claude-code')?.find((entry) => entry.name === 'monitors')?.tier).toBe('diagnose-only');
  });

  it('pins public SDK integrations to intended support tiers and exports', () => {
    const byIntegration = new Map(
      PUBLIC_INTEGRATION_SUPPORT.map((entry) => [entry.integration, entry]),
    );

    expect(byIntegration.get('openai-agents-sdk')?.tier).toBe('native');
    expect(byIntegration.get('openai-agents-sdk')?.exports).toEqual(
      expect.arrayContaining([
        'createOpenBoxAgentHooks',
        'createOpenBoxTracingProcessor',
        'openBoxInputGuardrail',
        'openBoxOutputGuardrail',
        'openBoxToolInputGuardrail',
        'openBoxToolOutputGuardrail',
      ]),
    );
    expect(byIntegration.get('copilotkit')?.exports).toContain('createOpenBoxAGUIAdapter');
    expect(byIntegration.get('n8n')?.exports).toContain('OPENBOX_N8N_INTEGRATION');
  });

  it('declares MCP protocol surfaces from the canonical spec', () => {
    expect(MCP_TOOL_SURFACES.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(['check_governance', 'decide_approval', 'openbox_status']),
    );
    expect(MCP_TOOL_SURFACES.find((entry) => entry.name === 'check_governance')).toMatchObject({
      risk: 'medium',
      readOnlyHint: false,
      idempotentHint: false,
    });
    expect(MCP_PROMPT_SURFACES.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(['pending_approvals', 'policy_review', 'governance_check', 'guardrail_review']),
    );
    expect(MCP_RESOURCE_TEMPLATE_SURFACES.map((entry) => entry.uriTemplate)).toEqual(
      expect.arrayContaining([
        'openbox://agent/{agent_id}',
        'openbox://agent/{agent_id}/behavior-rule/{behavior_rule_id}',
        'openbox://skill/{name}',
      ]),
    );
  });

  it('declares the packaged n8n integration descriptor from the canonical spec', () => {
    expect(N8N_INTEGRATION_SURFACE.credentials[0].id).toBe('openboxCredentials');
    expect(N8N_INTEGRATION_SURFACE.nodes.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([
        'openboxGovernance',
        'openboxGuardrails',
        'openboxApproval',
        'openboxGovernedAiAgent',
      ]),
    );
    expect(N8N_INTEGRATION_SURFACE.workflowTemplates[0].id).toBe('openbox-governed-ai-agent');
    expect(N8N_INTEGRATION_SURFACE.examples.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([
        'ai-agent-tool-review',
        'guardrails-node-interop',
        'mcp-client-tool',
        'mcp-server-trigger',
      ]),
    );
  });
});
