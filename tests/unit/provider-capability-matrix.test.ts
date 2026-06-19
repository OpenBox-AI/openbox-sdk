import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
  GOAL_SIGNAL_GUARDS,
  GUARDRAIL_CAPABILITY_GUARDS,
  HITL_CAPABILITY_GUARDS,
  INSTALL_DOCTOR_CAPABILITY_GUARDS,
  OPENBOX_CAPABILITY_IDS,
  POLICY_EVALUATION_GUARDS,
  MCP_PROMPT_SURFACES,
  MCP_RESOURCE_TEMPLATE_SURFACES,
  MCP_TOOL_SURFACES,
  N8N_INTEGRATION_SURFACE,
  PROVIDER_CAPABILITY_MATRIX,
  PROVIDER_EVENT_CATALOG,
  PROVIDER_PLUGIN_COMPONENTS,
  PUBLIC_INTEGRATION_SUPPORT,
  RULES_INSTRUCTION_CAPABILITY_GUARDS,
  TRACING_CAPABILITY_GUARDS,
  USAGE_COST_CAPABILITY_GUARDS,
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

  it('pins approvals-hitl support claims to explicit HITL guard coverage', () => {
    const supportedCapabilityProviders = PROVIDER_CAPABILITY_MATRIX
      .filter((entry) =>
        entry.capability === 'approvals-hitl' &&
        (entry.tier === 'native' || entry.tier === 'wrapped'))
      .map((entry) => entry.provider)
      .sort();
    const guardProviders = HITL_CAPABILITY_GUARDS
      .map((entry) => entry.provider)
      .sort();

    expect(guardProviders).toEqual(supportedCapabilityProviders);
    expect(new Set(guardProviders).size).toBe(guardProviders.length);

    const tierByProvider = new Map(
      PROVIDER_CAPABILITY_MATRIX
        .filter((entry) => entry.capability === 'approvals-hitl')
        .map((entry) => [entry.provider, entry.tier]),
    );
    for (const guard of HITL_CAPABILITY_GUARDS) {
      expect(guard.tier, `${guard.provider} tier`).toBe(tierByProvider.get(guard.provider));
      expect(guard.requireApprovalSurface.length, `${guard.provider} requireApprovalSurface`).toBeGreaterThan(0);
      expect(guard.sourceAttribution, `${guard.provider} sourceAttribution`).toContain('metadata.source');
      expect(guard.sourceAttribution, `${guard.provider} sourceAttribution`).toContain('_openbox_source');
      expect(guard.nativeSurface.length, `${guard.provider} nativeSurface`).toBeGreaterThan(0);
      expect(guard.fallbackSurface.length, `${guard.provider} fallbackSurface`).toBeGreaterThan(0);
      expect(guard.guardTest, `${guard.provider} guardTest`).toMatch(/^tests\/.+#/);
      expect(guard.failClosedBehavior.length, `${guard.provider} failClosedBehavior`).toBeGreaterThan(20);
    }
  });

  it('pins opa-rules support claims to backend-owned policy evaluation guards', () => {
    const policyProviders = PROVIDER_CAPABILITY_MATRIX
      .filter((entry) => entry.capability === 'opa-rules' && entry.tier === 'native')
      .map((entry) => entry.provider)
      .sort();
    const guardProviders = POLICY_EVALUATION_GUARDS
      .filter((entry) => entry.tier === 'native')
      .map((entry) => entry.provider)
      .sort();

    expect(guardProviders).toEqual(policyProviders);
    expect(new Set(guardProviders).size).toBe(guardProviders.length);

    for (const guard of POLICY_EVALUATION_GUARDS) {
      expect(guard.authority, `${guard.provider} authority`).toContain('Core/backend');
      expect(guard.sdkResponsibility, `${guard.provider} sdkResponsibility`).toContain('send');
      expect(guard.forbiddenLocalWork, `${guard.provider} forbiddenLocalWork`).toContain('OPA/Rego evaluation');
      expect(guard.guardTest, `${guard.provider} guardTest`).toMatch(/^tests\/.+#/);
    }
  });

  it('pins native guardrail support claims to explicit guardrail guard coverage', () => {
    const nativeCapabilityProviders = PROVIDER_CAPABILITY_MATRIX
      .filter((entry) => entry.capability === 'guardrails' && entry.tier === 'native')
      .map((entry) => entry.provider)
      .sort();
    const nativeGuardProviders = GUARDRAIL_CAPABILITY_GUARDS
      .filter((entry) => entry.tier === 'native')
      .map((entry) => entry.provider)
      .sort();

    expect(nativeGuardProviders).toEqual(nativeCapabilityProviders);
    expect(new Set(nativeGuardProviders).size).toBe(nativeGuardProviders.length);

    for (const guard of GUARDRAIL_CAPABILITY_GUARDS) {
      expect(guard.coreContract, `${guard.provider} coreContract`).toContain('Core');
      expect(guard.governedSurfaces.length, `${guard.provider} governedSurfaces`).toBeGreaterThan(10);
      expect(guard.redactionBehavior.length, `${guard.provider} redactionBehavior`).toBeGreaterThan(30);
      expect(guard.failClosedBehavior, `${guard.provider} failClosedBehavior`).toMatch(/fail|block|deny|halt|throw/i);
      expect(guard.guardTest, `${guard.provider} guardTest`).toMatch(/^tests\/.+#/);
    }
  });

  it('pins usage-cost support claims to explicit usage guard coverage', () => {
    const supportedCapabilityProviders = PROVIDER_CAPABILITY_MATRIX
      .filter((entry) => entry.capability === 'usage-cost')
      .map((entry) => entry.provider)
      .sort();
    const guardProviders = USAGE_COST_CAPABILITY_GUARDS
      .map((entry) => entry.provider)
      .sort();

    expect(guardProviders).toEqual(supportedCapabilityProviders);
    expect(new Set(guardProviders).size).toBe(guardProviders.length);

    const tierByProvider = new Map(
      PROVIDER_CAPABILITY_MATRIX
        .filter((entry) => entry.capability === 'usage-cost')
        .map((entry) => [entry.provider, entry.tier]),
    );
    for (const guard of USAGE_COST_CAPABILITY_GUARDS) {
      expect(guard.tier, `${guard.provider} tier`).toBe(tierByProvider.get(guard.provider));
      expect(guard.usageSurface.length, `${guard.provider} usageSurface`).toBeGreaterThan(20);
      expect(guard.normalizedFields, `${guard.provider} normalizedFields`).toContain('input_tokens');
      expect(guard.normalizedFields, `${guard.provider} normalizedFields`).toContain('output_tokens');
      expect(guard.normalizedFields, `${guard.provider} normalizedFields`).toContain('total_tokens');
      expect(guard.sharedNormalizer, `${guard.provider} sharedNormalizer`).toMatch(/normalizeOpenBoxUsage|openBoxUsageTelemetryFields|buildSpan|buildAssistantOutputSpan|assistantOutputTelemetryFields/);
      expect(guard.costPolicyBoundary, `${guard.provider} costPolicyBoundary`).toContain('OpenBox Core');
      expect(guard.guardTest, `${guard.provider} guardTest`).toMatch(/^tests\/.+#/);
    }
  });

  it('pins tracing support claims to explicit tracing guard coverage', () => {
    const tracingCapabilityProviders = PROVIDER_CAPABILITY_MATRIX
      .filter((entry) => entry.capability === 'tracing')
      .map((entry) => entry.provider)
      .sort();
    const guardProviders = TRACING_CAPABILITY_GUARDS
      .map((entry) => entry.provider)
      .sort();

    expect(guardProviders).toEqual(tracingCapabilityProviders);
    expect(new Set(guardProviders).size).toBe(guardProviders.length);

    const tierByProvider = new Map(
      PROVIDER_CAPABILITY_MATRIX
        .filter((entry) => entry.capability === 'tracing')
        .map((entry) => [entry.provider, entry.tier]),
    );
    for (const guard of TRACING_CAPABILITY_GUARDS) {
      expect(guard.tier, `${guard.provider} tier`).toBe(tierByProvider.get(guard.provider));
      expect(guard.traceSurface.length, `${guard.provider} traceSurface`).toBeGreaterThan(20);
      expect(guard.spanCoverage, `${guard.provider} spanCoverage`).toMatch(/span/i);
      expect(guard.spanEmission, `${guard.provider} spanEmission`).toMatch(/hook_trigger|observed spans|pre-gated|span-free/i);
      expect(guard.sourceAttribution, `${guard.provider} sourceAttribution`).toContain('_openbox_source');
      expect(guard.guardTest, `${guard.provider} guardTest`).toMatch(/^tests\/.+#/);
    }
  });

  it('pins install-doctor support claims to explicit install and doctor guard coverage', () => {
    const installDoctorCapabilityProviders = PROVIDER_CAPABILITY_MATRIX
      .filter((entry) => entry.capability === 'install-doctor')
      .map((entry) => entry.provider)
      .sort();
    const guardProviders = INSTALL_DOCTOR_CAPABILITY_GUARDS
      .map((entry) => entry.provider)
      .sort();

    expect(guardProviders).toEqual(installDoctorCapabilityProviders);
    expect(new Set(guardProviders).size).toBe(guardProviders.length);

    const tierByProvider = new Map(
      PROVIDER_CAPABILITY_MATRIX
        .filter((entry) => entry.capability === 'install-doctor')
        .map((entry) => [entry.provider, entry.tier]),
    );
    for (const guard of INSTALL_DOCTOR_CAPABILITY_GUARDS) {
      expect(guard.tier, `${guard.provider} tier`).toBe(tierByProvider.get(guard.provider));
      expect(guard.installSurface.length, `${guard.provider} installSurface`).toBeGreaterThan(20);
      expect(guard.doctorSurface.length, `${guard.provider} doctorSurface`).toBeGreaterThan(20);
      expect(guard.scopeBoundary, `${guard.provider} scopeBoundary`).toMatch(
        /project-local|diagnose-only|operator-owned|no files|global host config/i,
      );
      expect(guard.generatedOrPackagedSurface.length, `${guard.provider} generatedOrPackagedSurface`).toBeGreaterThan(20);
      expect(guard.guardTest, `${guard.provider} guardTest`).toMatch(/^tests\/.+#/);
    }
  });

  it('pins rules-instructions support claims to explicit projection boundary coverage', () => {
    const rulesInstructionCapabilityProviders = PROVIDER_CAPABILITY_MATRIX
      .filter((entry) => entry.capability === 'rules-instructions')
      .map((entry) => entry.provider)
      .sort();
    const guardProviders = RULES_INSTRUCTION_CAPABILITY_GUARDS
      .map((entry) => entry.provider)
      .sort();

    expect(guardProviders).toEqual(rulesInstructionCapabilityProviders);
    expect(new Set(guardProviders).size).toBe(guardProviders.length);

    const tierByProvider = new Map(
      PROVIDER_CAPABILITY_MATRIX
        .filter((entry) => entry.capability === 'rules-instructions')
        .map((entry) => [entry.provider, entry.tier]),
    );
    for (const guard of RULES_INSTRUCTION_CAPABILITY_GUARDS) {
      expect(guard.tier, `${guard.provider} tier`).toBe(tierByProvider.get(guard.provider));
      expect(guard.projectionSurface.length, `${guard.provider} projectionSurface`).toBeGreaterThan(30);
      expect(guard.sourceOfTruth, `${guard.provider} sourceOfTruth`).toContain('Core/backend');
      expect(guard.allowedProjectionWork, `${guard.provider} allowedProjectionWork`).toMatch(
        /render|project|wrap|expose|ship|build/i,
      );
      expect(guard.forbiddenLocalWork, `${guard.provider} forbiddenLocalWork`).toContain('OPA/Rego evaluation');
      expect(guard.forbiddenLocalWork, `${guard.provider} forbiddenLocalWork`).toMatch(/behavior-rule matching|local policy/i);
      expect(guard.hostBoundary, `${guard.provider} hostBoundary`).toContain('Core');
      expect(guard.guardTest, `${guard.provider} guardTest`).toMatch(/^tests\/.+#/);
    }
  });

  it('preserves lowercase literal words in generated Python strings', () => {
    const capabilityMatrix = readFileSync(
      resolve(process.cwd(), 'python/openbox_sdk/generated/capability_matrix.py'),
      'utf8',
    );
    const backendClient = readFileSync(
      resolve(process.cwd(), 'python/openbox_sdk/generated/backend_client.py'),
      'utf8',
    );

    expect(capabilityMatrix).toContain('continue:false');
    expect(capabilityMatrix).not.toContain('continue:False');
    expect(backendClient).toContain('/false-positive');
    expect(backendClient).not.toContain('/False-positive');
  });

  it('pins native goal-signal capability claims to explicit guard coverage', () => {
    const nativeCapabilityProviders = PROVIDER_CAPABILITY_MATRIX
      .filter((entry) => entry.capability === 'goal-signals' && entry.tier === 'native')
      .map((entry) => entry.provider)
      .sort();
    const nativeGuardProviders = GOAL_SIGNAL_GUARDS
      .filter((entry) => entry.tier === 'native')
      .map((entry) => entry.provider)
      .sort();

    expect(nativeGuardProviders).toEqual(nativeCapabilityProviders);
    expect(new Set(nativeGuardProviders).size).toBe(nativeGuardProviders.length);
    expect(nativeGuardProviders).not.toContain('mcp');

    for (const guard of GOAL_SIGNAL_GUARDS) {
      expect(guard.signalActivity).toBe('user_prompt');
      expect(guard.entrySurface.length, `${guard.provider} entrySurface`).toBeGreaterThan(0);
      expect(guard.firstGovernedSurface.length, `${guard.provider} firstGovernedSurface`).toBeGreaterThan(0);
      expect(guard.guardTest, `${guard.provider} guardTest`).toMatch(/^tests\/.+#/);
      expect(guard.orderGuarantee, `${guard.provider} orderGuarantee`).toContain('precedes');
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
      const intentionalExclusions = catalog.intentionalExclusions as readonly {
        event: string;
      }[];
      const generatedPlusIntentionalExclusions = [
        ...catalog.generatedAdapterEvents,
        ...intentionalExclusions.map((entry) => entry.event),
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
      expect.arrayContaining(['check_governance', 'decide_approval', 'openbox_status', 'codex_doctor']),
    );
    expect(MCP_TOOL_SURFACES.find((entry) => entry.name === 'codex_doctor')).toMatchObject({
      title: 'Codex Doctor',
      risk: 'low',
      readOnlyHint: true,
    });
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
