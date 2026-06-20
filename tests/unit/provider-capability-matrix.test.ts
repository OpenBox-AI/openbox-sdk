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
  HOOK_CAPABILITY_GUARDS,
  INSTALL_DOCTOR_CAPABILITY_GUARDS,
  MCP_CAPABILITY_GUARDS,
  OPENBOX_CAPABILITY_IDS,
  POLICY_EVALUATION_GUARDS,
  MCP_PROMPT_SURFACES,
  MCP_RESOURCE_TEMPLATE_SURFACES,
  MCP_SKILL_REFERENCE_SURFACES,
  MCP_TOOL_SURFACES,
  N8N_INTEGRATION_SURFACE,
  PLUGIN_CAPABILITY_GUARDS,
  PROVIDER_CAPABILITY_MATRIX,
  PROVIDER_EVENT_CATALOG,
  OPENBOX_PROVIDER_IDS,
  OPENBOX_SUPPORT_TIERS,
  PROVIDER_PLUGIN_COMPONENTS,
  PUBLIC_INTEGRATION_SUPPORT,
  RULES_INSTRUCTION_CAPABILITY_GUARDS,
  SKILL_CAPABILITY_GUARDS,
  SUBAGENTS_AGENTS_CAPABILITY_GUARDS,
  TRACING_CAPABILITY_GUARDS,
  USAGE_COST_CAPABILITY_GUARDS,
  USAGE_NORMALIZATION_SURFACE,
  type OpenBoxProviderId,
} from '../../ts/src/governance/capability-matrix.js';

const PROVIDERS: readonly OpenBoxProviderId[] = OPENBOX_PROVIDER_IDS;

function readProviderCapabilityFixture(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'codegen/fixtures/provider-capabilities.json'), 'utf8'),
  ) as Record<string, unknown>;
}

const GUARD_COVERAGE_GROUPS = [
  { name: 'approvals-hitl', guards: HITL_CAPABILITY_GUARDS },
  { name: 'opa-rules', guards: POLICY_EVALUATION_GUARDS },
  { name: 'guardrails', guards: GUARDRAIL_CAPABILITY_GUARDS },
  { name: 'usage-cost', guards: USAGE_COST_CAPABILITY_GUARDS },
  { name: 'tracing', guards: TRACING_CAPABILITY_GUARDS },
  { name: 'install-doctor', guards: INSTALL_DOCTOR_CAPABILITY_GUARDS },
  { name: 'rules-instructions', guards: RULES_INSTRUCTION_CAPABILITY_GUARDS },
  { name: 'mcp', guards: MCP_CAPABILITY_GUARDS },
  { name: 'plugins', guards: PLUGIN_CAPABILITY_GUARDS },
  { name: 'skills', guards: SKILL_CAPABILITY_GUARDS },
  { name: 'hooks', guards: HOOK_CAPABILITY_GUARDS },
  { name: 'subagents-agents', guards: SUBAGENTS_AGENTS_CAPABILITY_GUARDS },
  { name: 'goal-signals', guards: GOAL_SIGNAL_GUARDS },
] as const;

function normalizeGuardProofText(value: string): string {
  return value
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[→⇒]/g, '->')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

describe('provider capability matrix', () => {
  it('matches the TypeSpec-emitted provider capability conformance fixture', () => {
    const fixture = readProviderCapabilityFixture();

    expect(fixture.generatedBy).toBe('codegen/emitters/typespec-emitter');
    expect(fixture.source).toBe('specs/typespec/govern/capabilities.tsp');
    expect(OPENBOX_CAPABILITY_IDS).toEqual(fixture.capabilityIds);
    expect(OPENBOX_PROVIDER_IDS).toEqual(fixture.providerIds);
    expect(OPENBOX_SUPPORT_TIERS).toEqual(fixture.supportTiers);
    expect(PROVIDER_CAPABILITY_MATRIX).toEqual(fixture.providerCapabilityMatrix);
    expect(PROVIDER_EVENT_CATALOG).toEqual(fixture.providerEventCatalog);
    expect(PROVIDER_PLUGIN_COMPONENTS).toEqual(fixture.providerPluginComponents);
    expect(PUBLIC_INTEGRATION_SUPPORT).toEqual(fixture.publicIntegrationSupport);
    expect(GOAL_SIGNAL_GUARDS).toEqual(fixture.goalSignalGuards);
    expect(USAGE_COST_CAPABILITY_GUARDS).toEqual(fixture.usageCostCapabilityGuards);
    expect(USAGE_NORMALIZATION_SURFACE).toEqual(fixture.usageNormalizationSurface);
    expect(TRACING_CAPABILITY_GUARDS).toEqual(fixture.tracingCapabilityGuards);
    expect(HITL_CAPABILITY_GUARDS).toEqual(fixture.hitlCapabilityGuards);
    expect(GUARDRAIL_CAPABILITY_GUARDS).toEqual(fixture.guardrailCapabilityGuards);
    expect(POLICY_EVALUATION_GUARDS).toEqual(fixture.policyEvaluationGuards);
    expect(RULES_INSTRUCTION_CAPABILITY_GUARDS).toEqual(
      fixture.rulesInstructionCapabilityGuards,
    );
    expect(HOOK_CAPABILITY_GUARDS).toEqual(fixture.hookCapabilityGuards);
    expect(SUBAGENTS_AGENTS_CAPABILITY_GUARDS).toEqual(
      fixture.subagentsAgentsCapabilityGuards,
    );
    expect(PLUGIN_CAPABILITY_GUARDS).toEqual(fixture.pluginCapabilityGuards);
    expect(SKILL_CAPABILITY_GUARDS).toEqual(fixture.skillCapabilityGuards);
    expect(MCP_CAPABILITY_GUARDS).toEqual(fixture.mcpCapabilityGuards);
    expect(INSTALL_DOCTOR_CAPABILITY_GUARDS).toEqual(fixture.installDoctorCapabilityGuards);
    expect(MCP_TOOL_SURFACES).toEqual(fixture.mcpToolSurfaces);
    expect(MCP_PROMPT_SURFACES).toEqual(fixture.mcpPromptSurfaces);
    expect(MCP_RESOURCE_TEMPLATE_SURFACES).toEqual(fixture.mcpResourceTemplateSurfaces);
    expect(MCP_SKILL_REFERENCE_SURFACES).toEqual(fixture.mcpSkillReferenceSurfaces);
    expect(N8N_INTEGRATION_SURFACE).toEqual(fixture.n8nIntegrationSurface);
  });

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

  it('resolves every capability guardTest to a checked-in test phrase', () => {
    for (const group of GUARD_COVERAGE_GROUPS) {
      for (const guard of group.guards) {
        const [file, anchor] = guard.guardTest.split('#');
        expect(file, `${group.name}/${guard.provider} guardTest file`).toMatch(/^tests\/.+\.test\.ts$/);
        expect(anchor, `${group.name}/${guard.provider} guardTest anchor`).toBeTruthy();

        const source = readFileSync(resolve(process.cwd(), file), 'utf8');
        expect(
          normalizeGuardProofText(source),
          `${group.name}/${guard.provider} guardTest anchor ${guard.guardTest}`,
        ).toContain(normalizeGuardProofText(anchor));
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
    expect(USAGE_NORMALIZATION_SURFACE.canonicalFields).toEqual(
      expect.arrayContaining(['input_tokens', 'output_tokens', 'total_tokens', 'cost_usd']),
    );
    expect(USAGE_NORMALIZATION_SURFACE.inputTokenAliases).toEqual(
      expect.arrayContaining(['inputTokens', 'input_tokens', 'promptTokenCount']),
    );
    expect(USAGE_NORMALIZATION_SURFACE.costUsdAliases).toEqual(
      expect.arrayContaining(['costUSD', 'cost_usd', 'total_cost_usd']),
    );
    expect(USAGE_NORMALIZATION_SURFACE.policyBoundary).toContain('OpenBox Core');
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

  it('pins mcp support claims to explicit server, config, and surface coverage', () => {
    const mcpCapabilityProviders = PROVIDER_CAPABILITY_MATRIX
      .filter((entry) => entry.capability === 'mcp')
      .map((entry) => entry.provider)
      .sort();
    const guardProviders = MCP_CAPABILITY_GUARDS
      .map((entry) => entry.provider)
      .sort();

    expect(guardProviders).toEqual(mcpCapabilityProviders);
    expect(new Set(guardProviders).size).toBe(guardProviders.length);

    const tierByProvider = new Map(
      PROVIDER_CAPABILITY_MATRIX
        .filter((entry) => entry.capability === 'mcp')
        .map((entry) => [entry.provider, entry.tier]),
    );
    for (const guard of MCP_CAPABILITY_GUARDS) {
      expect(guard.tier, `${guard.provider} tier`).toBe(tierByProvider.get(guard.provider));
      expect(guard.serverSurface, `${guard.provider} serverSurface`).toMatch(/MCP|mcp/);
      expect(guard.configSurface.length, `${guard.provider} configSurface`).toBeGreaterThan(30);
      expect(guard.toolResourcePromptCoverage, `${guard.provider} toolResourcePromptCoverage`).toMatch(/MCP|mcp/);
      expect(guard.hostBoundary, `${guard.provider} hostBoundary`).toContain('Core');
      expect(guard.guardTest, `${guard.provider} guardTest`).toMatch(/^tests\/.+#/);
    }
  });

  it('pins plugin support claims to explicit packaged component coverage', () => {
    const pluginCapabilityProviders = PROVIDER_CAPABILITY_MATRIX
      .filter((entry) => entry.capability === 'plugins')
      .map((entry) => entry.provider)
      .sort();
    const guardProviders = PLUGIN_CAPABILITY_GUARDS
      .map((entry) => entry.provider)
      .sort();

    expect(guardProviders).toEqual(pluginCapabilityProviders);
    expect(new Set(guardProviders).size).toBe(guardProviders.length);

    const tierByProvider = new Map(
      PROVIDER_CAPABILITY_MATRIX
        .filter((entry) => entry.capability === 'plugins')
        .map((entry) => [entry.provider, entry.tier]),
    );
    const pluginComponentsByProvider = new Map(
      PROVIDER_PLUGIN_COMPONENTS.map((entry) => [entry.provider, entry.components]),
    );
    for (const guard of PLUGIN_CAPABILITY_GUARDS) {
      expect(guard.tier, `${guard.provider} tier`).toBe(tierByProvider.get(guard.provider));
      expect(guard.packageSurface.length, `${guard.provider} packageSurface`).toBeGreaterThan(30);
      expect(guard.componentCoverage.length, `${guard.provider} componentCoverage`).toBeGreaterThan(30);
      expect(guard.installSurface.length, `${guard.provider} installSurface`).toBeGreaterThan(20);
      expect(guard.scopeBoundary.length, `${guard.provider} scopeBoundary`).toBeGreaterThan(20);
      expect(guard.guardTest, `${guard.provider} guardTest`).toMatch(/^tests\/.+#/);

      if (guard.provider === 'codex' || guard.provider === 'cursor' || guard.provider === 'claude-code') {
        const componentNames = pluginComponentsByProvider.get(guard.provider)?.map((entry) => entry.name);
        expect(componentNames, `${guard.provider} componentNames`).toEqual(
          expect.arrayContaining(['hooks', 'mcp', 'skills']),
        );
        expect(componentNames?.some((name) => name.includes('manifest'))).toBe(true);
        expect(guard.packageSurface, `${guard.provider} packageSurface`).toMatch(/plugin/i);
        expect(guard.scopeBoundary, `${guard.provider} scopeBoundary`).toMatch(/project-local|Project-local/);
      } else if (guard.provider === 'n8n') {
        expect(guard.tier).toBe('wrapped');
        expect(N8N_INTEGRATION_SURFACE.credentials.length).toBeGreaterThan(0);
        expect(N8N_INTEGRATION_SURFACE.nodes.length).toBeGreaterThan(0);
        expect(N8N_INTEGRATION_SURFACE.workflowTemplates.length).toBeGreaterThan(0);
        expect(guard.componentCoverage).toMatch(/credentials|nodes|template/i);
      } else {
        expect(guard.tier, `${guard.provider} tier`).toBe('out-of-scope');
        expect(guard.installSurface, `${guard.provider} installSurface`).toMatch(/No plugin install surface/);
        expect(guard.scopeBoundary, `${guard.provider} scopeBoundary`).toContain('Out-of-scope');
      }
    }
  });

  it('pins skill support claims to explicit skill surface coverage', () => {
    const skillCapabilityProviders = PROVIDER_CAPABILITY_MATRIX
      .filter((entry) => entry.capability === 'skills')
      .map((entry) => entry.provider)
      .sort();
    const guardProviders = SKILL_CAPABILITY_GUARDS
      .map((entry) => entry.provider)
      .sort();

    expect(guardProviders).toEqual(skillCapabilityProviders);
    expect(new Set(guardProviders).size).toBe(guardProviders.length);

    const tierByProvider = new Map(
      PROVIDER_CAPABILITY_MATRIX
        .filter((entry) => entry.capability === 'skills')
        .map((entry) => [entry.provider, entry.tier]),
    );
    const pluginComponentsByProvider = new Map(
      PROVIDER_PLUGIN_COMPONENTS.map((entry) => [entry.provider, entry.components]),
    );
    const mcpSkillResource = MCP_RESOURCE_TEMPLATE_SURFACES.find((entry) => entry.name === 'skill-reference');

    for (const guard of SKILL_CAPABILITY_GUARDS) {
      expect(guard.tier, `${guard.provider} tier`).toBe(tierByProvider.get(guard.provider));
      expect(guard.skillSurface.length, `${guard.provider} skillSurface`).toBeGreaterThan(30);
      expect(guard.installSurface.length, `${guard.provider} installSurface`).toBeGreaterThan(20);
      expect(guard.discoverySurface.length, `${guard.provider} discoverySurface`).toBeGreaterThan(20);
      expect(guard.hostBoundary, `${guard.provider} hostBoundary`).toMatch(/Core\/backend|Out-of-scope/);
      expect(guard.guardTest, `${guard.provider} guardTest`).toMatch(/^tests\/.+#/);

      if (guard.tier === 'native' && guard.provider !== 'mcp') {
        expect(guard.skillSurface, `${guard.provider} skillSurface`).toContain('SKILL.md');
        expect(pluginComponentsByProvider.get(guard.provider)?.map((entry) => entry.name)).toContain('skills');
      } else if (guard.provider === 'mcp') {
        expect(mcpSkillResource).toMatchObject({
          name: 'skill-reference',
          uriTemplate: 'openbox://skill/{name}',
        });
      } else {
        expect(guard.installSurface, `${guard.provider} installSurface`).toMatch(/No skill installation/);
        expect(guard.hostBoundary, `${guard.provider} hostBoundary`).toContain('Out-of-scope');
      }
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

  it('pins hook support claims to explicit hook surface coverage', () => {
    const hookCapabilityProviders = PROVIDER_CAPABILITY_MATRIX
      .filter((entry) => entry.capability === 'hooks')
      .map((entry) => entry.provider)
      .sort();
    const guardProviders = HOOK_CAPABILITY_GUARDS
      .map((entry) => entry.provider)
      .sort();

    expect(guardProviders).toEqual(hookCapabilityProviders);
    expect(new Set(guardProviders).size).toBe(guardProviders.length);

    const tierByProvider = new Map(
      PROVIDER_CAPABILITY_MATRIX
        .filter((entry) => entry.capability === 'hooks')
        .map((entry) => [entry.provider, entry.tier]),
    );
    const eventCatalogByProvider = new Map<OpenBoxProviderId, (typeof PROVIDER_EVENT_CATALOG)[number]>(
      PROVIDER_EVENT_CATALOG.map((entry) => [entry.provider, entry]),
    );
    const publicIntegrationByProvider = new Map<OpenBoxProviderId, (typeof PUBLIC_INTEGRATION_SUPPORT)[number]>(
      PUBLIC_INTEGRATION_SUPPORT.map((entry) => [entry.integration, entry]),
    );

    for (const guard of HOOK_CAPABILITY_GUARDS) {
      expect(guard.tier, `${guard.provider} tier`).toBe(tierByProvider.get(guard.provider));
      expect(guard.hookSurface.length, `${guard.provider} hookSurface`).toBeGreaterThan(30);
      expect(guard.eventCoverage.length, `${guard.provider} eventCoverage`).toBeGreaterThan(30);
      expect(guard.enforcementBoundary.length, `${guard.provider} enforcementBoundary`).toBeGreaterThan(30);
      expect(guard.fallbackOrOutOfScope.length, `${guard.provider} fallbackOrOutOfScope`).toBeGreaterThan(20);
      expect(guard.guardTest, `${guard.provider} guardTest`).toMatch(/^tests\/.+#/);

      const eventCatalog = eventCatalogByProvider.get(guard.provider);
      if (eventCatalog) {
        expect(eventCatalog.generatedAdapterEvents.length, `${guard.provider} generatedAdapterEvents`).toBeGreaterThan(0);
        expect(guard.eventCoverage, `${guard.provider} eventCoverage`).toMatch(/PROVIDER_EVENT_CATALOG|HOOK_SPEC|HOOK_EVENTS/);
      } else if (guard.provider === 'openai-agents-sdk') {
        expect(publicIntegrationByProvider.get(guard.provider)?.exports).toContain('createOpenBoxAgentHooks');
        expect(guard.hookSurface).toContain('createOpenBoxAgentHooks');
      } else if (guard.provider === 'copilotkit') {
        expect(publicIntegrationByProvider.get(guard.provider)?.exports).toContain('createOpenBoxCopilotKitAdapter');
        expect(guard.hookSurface).toContain('createOpenBoxCopilotKitAdapter');
      } else if (guard.provider === 'n8n') {
        expect(publicIntegrationByProvider.get(guard.provider)?.exports).toEqual(
          expect.arrayContaining(['emitN8nNodePreExecute', 'emitN8nNodePostExecute']),
        );
        expect(guard.hookSurface).toContain('emitN8nNodePreExecute');
      } else {
        expect(guard.tier, `${guard.provider} tier`).toBe('out-of-scope');
        expect(guard.fallbackOrOutOfScope, `${guard.provider} fallbackOrOutOfScope`).toContain('Out-of-scope');
      }

      if (guard.tier !== 'out-of-scope') {
        expect(guard.enforcementBoundary, `${guard.provider} enforcementBoundary`).toContain('Core');
      }
    }
  });

  it('pins subagents-agents support claims to explicit agent ownership coverage', () => {
    const capabilityProviders = PROVIDER_CAPABILITY_MATRIX
      .filter((entry) => entry.capability === 'subagents-agents')
      .map((entry) => entry.provider)
      .sort();
    const guardProviders = SUBAGENTS_AGENTS_CAPABILITY_GUARDS
      .map((entry) => entry.provider)
      .sort();

    expect(guardProviders).toEqual(capabilityProviders);
    expect(new Set(guardProviders).size).toBe(guardProviders.length);

    const tierByProvider = new Map(
      PROVIDER_CAPABILITY_MATRIX
        .filter((entry) => entry.capability === 'subagents-agents')
        .map((entry) => [entry.provider, entry.tier]),
    );
    const eventCatalogByProvider = new Map<OpenBoxProviderId, (typeof PROVIDER_EVENT_CATALOG)[number]>(
      PROVIDER_EVENT_CATALOG.map((entry) => [entry.provider, entry]),
    );
    const pluginComponentsByProvider = new Map<OpenBoxProviderId, (typeof PROVIDER_PLUGIN_COMPONENTS)[number]['components']>(
      PROVIDER_PLUGIN_COMPONENTS.map((entry) => [entry.provider, entry.components]),
    );

    for (const guard of SUBAGENTS_AGENTS_CAPABILITY_GUARDS) {
      expect(guard.tier, `${guard.provider} tier`).toBe(tierByProvider.get(guard.provider));
      expect(guard.agentSurface.length, `${guard.provider} agentSurface`).toBeGreaterThan(30);
      expect(guard.lifecycleCoverage.length, `${guard.provider} lifecycleCoverage`).toBeGreaterThan(30);
      expect(guard.ownershipBoundary.length, `${guard.provider} ownershipBoundary`).toBeGreaterThan(30);
      expect(guard.guardTest, `${guard.provider} guardTest`).toMatch(/^tests\/.+#/);

      if (guard.provider === 'cursor' || guard.provider === 'claude-code') {
        expect(guard.tier).toBe('native');
        expect(pluginComponentsByProvider.get(guard.provider)?.map((entry) => entry.name)).toContain('agents');
        expect(eventCatalogByProvider.get(guard.provider)?.generatedAdapterEvents.some((event) =>
          event.toLowerCase().includes('subagent'))).toBe(true);
        expect(guard.ownershipBoundary).toContain('Native');
      } else {
        expect(guard.tier, `${guard.provider} tier`).toBe('observe-only');
        expect(guard.ownershipBoundary, `${guard.provider} ownershipBoundary`).toMatch(/Observe-only|owns/);
      }

      if (guard.provider === 'mcp') {
        expect(MCP_RESOURCE_TEMPLATE_SURFACES.map((entry) => entry.name)).toContain('agent');
      } else if (guard.provider === 'n8n') {
        expect(N8N_INTEGRATION_SURFACE.workflowTemplates.some((template) =>
          Array.isArray(template.nodes) && template.nodes.includes('n8nAiAgent'))).toBe(true);
      } else if (guard.provider === 'openai-agents-sdk') {
        expect(guard.lifecycleCoverage).toMatch(/handoff/i);
      } else if (guard.provider === 'anthropic-agent-sdk') {
        expect(guard.lifecycleCoverage).toMatch(/TaskCreated|SubagentStart|a2a/);
      }
    }
  });

  it('records install/plugin components and intentional exclusions per host', () => {
    const byProvider = new Map(
      PROVIDER_PLUGIN_COMPONENTS.map((entry) => [entry.provider, entry.components]),
    );

    expect(byProvider.get('codex')?.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(['manifest', 'marketplace', 'skills', 'repo-skill', 'hooks', 'mcp', 'agents-md', 'rules']),
    );
    expect(byProvider.get('cursor')?.map((entry) => entry.name)).toEqual(
      expect.arrayContaining([
        'plugin-manifest',
        'hooks',
        'mcp',
        'rules',
        'commands',
        'agents',
        'skills',
        'workspaceOpen',
        'repo-hooks',
        'repo-mcp',
        'repo-rules',
        'repo-skill',
      ]),
    );
    const cursorRepoComponents = (byProvider.get('cursor') ?? []).filter(
      (entry) => (entry as { surface?: string }).surface === 'repo',
    );
    expect(cursorRepoComponents.map((entry) => (entry as { path?: string }).path)).toEqual([
      '.cursor/hooks.json',
      '.cursor/mcp.json',
      '.cursor/rules/openbox-governance.mdc',
      '.agents/skills/openbox/SKILL.md',
    ]);
    expect(byProvider.get('claude-code')?.find((entry) => entry.name === 'lsp')?.tier).toBe('out-of-scope');
    expect(byProvider.get('claude-code')?.find((entry) => entry.name === 'monitors')?.tier).toBe('diagnose-only');
  });

  it('pins public SDK integrations to intended support tiers and exports', () => {
    const byIntegration = new Map(
      PUBLIC_INTEGRATION_SUPPORT.map((entry) => [entry.integration, entry]),
    );

    expect(byIntegration.get('openai-agents-sdk')?.tier).toBe('native');
    expect(byIntegration.get('openai-agents-sdk')?.packageSubpath).toBe('./openai-agents-sdk');
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
    expect(byIntegration.get('anthropic-agent-sdk')?.packageSubpath).toBe('./anthropic-agent-sdk');
    expect(byIntegration.get('copilotkit')?.packageSubpath).toBe('./copilotkit');
    expect(byIntegration.get('copilotkit')?.exports).toContain('createOpenBoxAGUIAdapter');
    expect(byIntegration.get('n8n')?.packageSubpath).toBe('./runtime/n8n');
    expect(byIntegration.get('n8n')?.exports).toContain('OPENBOX_N8N_INTEGRATION');
    expect(byIntegration.get('n8n')?.exports).toEqual(
      expect.arrayContaining([
        'listOpenBoxN8nCredentials',
        'listOpenBoxN8nNodes',
        'listOpenBoxN8nWorkflowTemplates',
        'listOpenBoxN8nExamples',
        'getOpenBoxN8nCredential',
        'getOpenBoxN8nNode',
        'getOpenBoxN8nWorkflowTemplate',
        'getOpenBoxN8nExample',
      ]),
    );
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
        'openboxLlm',
        'openboxGovernance',
        'openboxGuardrails',
        'openboxApproval',
        'openboxGovernedAiAgent',
      ]),
    );
    expect(N8N_INTEGRATION_SURFACE.workflowTemplates[0].id).toBe('openbox-governed-ai-agent');
    expect((N8N_INTEGRATION_SURFACE.workflowTemplates[0].workflow as { nodes?: readonly unknown[] }).nodes?.length).toBeGreaterThan(0);
    expect((N8N_INTEGRATION_SURFACE.workflowTemplates[0].workflow as { nodes: ReadonlyArray<{ type: string }> }).nodes.map((node) => node.type)).toEqual(
      expect.arrayContaining([
        'n8n-nodes-openbox-hook.openboxGovernance',
        '@n8n/n8n-nodes-langchain.agent',
        'n8n-nodes-openbox-hook.openboxGuardrails',
        'n8n-nodes-openbox-hook.openboxApproval',
      ]),
    );
    expect(N8N_INTEGRATION_SURFACE.examples.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([
        'ai-agent-tool-review',
        'guardrails-node-interop',
        'mcp-client-tool',
        'mcp-server-trigger',
      ]),
    );
    expect(N8N_INTEGRATION_SURFACE.examples.every((entry) =>
      Array.isArray((entry.workflow as { nodes?: readonly unknown[] }).nodes))).toBe(true);
    expect(N8N_INTEGRATION_SURFACE.examples.find((entry) => entry.id === 'mcp-client-tool')?.workflow).toMatchObject({
      nodes: expect.arrayContaining([
        expect.objectContaining({ type: '@n8n/n8n-nodes-langchain.toolmcp' }),
      ]),
    });
    expect(N8N_INTEGRATION_SURFACE.examples.find((entry) => entry.id === 'mcp-server-trigger')?.workflow).toMatchObject({
      nodes: expect.arrayContaining([
        expect.objectContaining({ type: '@n8n/n8n-nodes-langchain.mcptrigger' }),
      ]),
    });
    const showcase = N8N_INTEGRATION_SURFACE.showcaseWorkflows.find(
      (entry) => entry.id === 'sdk-showcase',
    ) as Record<string, any> | undefined;
    expect(showcase).toBeDefined();
    const showcaseWorkflow = JSON.parse(
      readFileSync(resolve(process.cwd(), showcase!.path), 'utf8'),
    ) as {
      name: string;
      nodes: Array<{
        id?: string;
        name: string;
        type: string;
        parameters?: Record<string, unknown>;
        credentials?: Record<string, { id?: unknown }>;
        [key: string]: unknown;
      }>;
      connections: Record<string, Record<string, Array<Array<{ node: string }>>>>;
    };
    const showcaseNodeNames = new Set(showcaseWorkflow.nodes.map((node) => node.name));
    const showcaseNodeTypes = new Set(showcaseWorkflow.nodes.map((node) => node.type));
    const showcaseNodeByName = new Map(showcaseWorkflow.nodes.map((node) => [node.name, node]));
    const connectedNodes = (source: string): string[] =>
      Object.values(showcaseWorkflow.connections[source] ?? {}).flatMap(
        (branches) => branches.flatMap((branch) => branch.map((edge) => edge.node)),
      );
    const hasEdge = (from: string, to: string): boolean =>
      connectedNodes(from).includes(to);
    expect(showcaseWorkflow.name).toBe(showcase!.name);
    for (const openboxNodeId of showcase!.requiredOpenBoxNodeIds) {
      expect(N8N_INTEGRATION_SURFACE.packageManifest.openboxSpecNodeIds).toContain(openboxNodeId);
    }
    for (const type of showcase!.requiredOpenBoxNodeTypes) {
      expect(showcaseNodeTypes.has(type)).toBe(true);
    }
    for (const type of showcase!.requiredTriggerTypes) {
      expect(showcaseNodeTypes.has(type)).toBe(true);
    }
    for (const checkpoint of showcase!.requiredCheckpoints) {
      expect(showcaseNodeNames.has(checkpoint)).toBe(true);
      const node = showcaseWorkflow.nodes.find((entry) => entry.name === checkpoint);
      expect(showcase!.requiredOpenBoxNodeTypes).toContain(node?.type);
    }
    for (const terminalNode of showcase!.requiredTerminalNodes) {
      expect(showcaseNodeNames.has(terminalNode)).toBe(true);
    }
    for (const edge of showcase!.requiredEntryEdges) {
      expect(hasEdge(edge.from, edge.to)).toBe(true);
    }
    for (const gate of showcase!.checkpointGates) {
      expect(hasEdge(gate.checkpoint, gate.gate)).toBe(true);
      expect(hasEdge(gate.gate, gate.pass)).toBe(true);
      expect(hasEdge(gate.gate, gate.fail)).toBe(true);
    }
    for (const flag of showcase!.requiredNodeBooleanFlags ?? []) {
      const node = showcaseNodeByName.get(flag.node);
      expect(node, flag.node).toBeDefined();
      expect(node?.[flag.flag], `${flag.node}.${flag.flag}`).toBe(flag.expected);
    }
    for (const check of showcase!.expressionSourceChecks ?? []) {
      const nodeText = JSON.stringify(showcaseNodeByName.get(check.node) ?? {});
      for (const required of check.requiredContains) {
        expect(nodeText, `${check.node} must contain ${required}`).toContain(required);
      }
      for (const forbidden of check.forbiddenContains) {
        expect(nodeText, `${check.node} must not contain ${forbidden}`).not.toContain(forbidden);
      }
    }
    const missingConnectionRefs: string[] = [];
    for (const [source, outputs] of Object.entries(showcaseWorkflow.connections)) {
      if (!showcaseNodeNames.has(source)) missingConnectionRefs.push(source);
      for (const branches of Object.values(outputs)) {
        for (const branch of branches) {
          for (const edge of branch) {
            if (!showcaseNodeNames.has(edge.node)) missingConnectionRefs.push(edge.node);
          }
        }
      }
    }
    expect(missingConnectionRefs).toEqual([]);
    const showcaseJson = JSON.stringify(showcaseWorkflow);
    expect(showcaseJson).toContain(showcase!.terminalLogTable);
    for (const stage of showcase!.approvalStages) {
      expect(showcaseJson).toContain(`'${stage}'`);
    }
    for (const actionId of showcase!.requiredApprovalActionIds) {
      expect(showcaseJson).toContain(`'${actionId}'`);
    }
    for (const step of showcase!.requiredPathLogSteps) {
      expect(showcaseJson).toContain(`step: '${step}'`);
    }
    for (const eventType of showcase!.requiredTerminalEventTypes) {
      expect(showcaseJson).toContain(`eventType: '${eventType}'`);
    }
    const credentialIds = new Set<string>();
    for (const node of showcaseWorkflow.nodes) {
      for (const credential of Object.values(node.credentials ?? {})) {
        if (typeof credential.id === 'string') credentialIds.add(credential.id);
      }
    }
    expect([...credentialIds].sort()).toEqual([...showcase!.allowedCredentialPlaceholders].sort());
  });
});
