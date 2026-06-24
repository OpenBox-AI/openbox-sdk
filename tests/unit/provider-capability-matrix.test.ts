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
  BEHAVIOR_RULE_CAPABILITY_GUARDS,
  GOAL_SIGNAL_GUARDS,
  GUARDRAIL_CAPABILITY_GUARDS,
  HITL_CAPABILITY_GUARDS,
  HOOK_CAPABILITY_GUARDS,
  INSTALL_DOCTOR_CAPABILITY_GUARDS,
  CLAUDE_CODE_GOVERNANCE_AUDIT_SURFACE,
  CLAUDE_CODE_GOVERNANCE_AUDIT,
  CLAUDE_CODE_SDK_CAPABILITY_MATRIX,
  CLAUDE_CODE_SURFACE_MATRIX,
  GUARDRAILS_HUB_RECORDING_SURFACE,
  LOCAL_STACK_OUTCOME_SOURCES,
  LOCAL_STACK_PROOF_LEVELS,
  LOCAL_STACK_SCENARIO_AXIS_IDS,
  LOCAL_STACK_SCENARIO_CATEGORY_IDS,
  LOCAL_STACK_SCENARIO_PATHS,
  LOCAL_STACK_SCENARIO_MATRIX,
  LOCAL_GOVERNANCE_VERDICT_MATRIX_CASES,
  MCP_CAPABILITY_GUARDS,
  OPENBOX_CAPABILITY_IDS,
  GOVERNANCE_CHECKLIST_LIMITATIONS,
  GOVERNANCE_CHECKLIST_SCORE,
  POLICY_EVALUATION_GUARDS,
  MCP_PROMPT_SURFACES,
  MCP_RESOURCE_TEMPLATE_SURFACES,
  MCP_SKILL_REFERENCE_SURFACES,
  MCP_TOOL_SURFACES,
  N8N_INTEGRATION_SURFACE,
  OPA_EVALUATION_MATRIX,
  PLUGIN_CAPABILITY_GUARDS,
  PROVIDER_CAPABILITY_MATRIX,
  REFERENCE_PROVIDER_PARITY_CLOSURES,
  REFERENCE_PROVIDER_RUNTIME_AUDIT,
  GOVERNANCE_CHECKLIST_ROWS,
  PROVIDER_EVENT_CATALOG,
  OPENBOX_PROVIDER_IDS,
  OPENBOX_SUPPORT_TIERS,
  PROVIDER_PLUGIN_COMPONENTS,
  PUBLIC_INTEGRATION_SUPPORT,
  RULES_INSTRUCTION_CAPABILITY_GUARDS,
  SDK_SEMANTIC_GAP_CLOSURE_TARGETS,
  SKILL_CAPABILITY_GUARDS,
  SUBAGENTS_AGENTS_CAPABILITY_GUARDS,
  TRACING_CAPABILITY_GUARDS,
  USAGE_COST_CAPABILITY_GUARDS,
  USAGE_NORMALIZATION_SURFACE,
  type OpenBoxProviderId,
  type GovernanceChecklistRowEntry,
  type ReferenceProviderParityClosureStatus,
  type ReferenceProviderRuntimePromotionDecision,
} from '../../ts/src/governance/capability-matrix.js';
import { GOVERNANCE_SPEC_DOMAINS } from '../helpers/governance-spec-domains';

const PROVIDERS: readonly OpenBoxProviderId[] = OPENBOX_PROVIDER_IDS;
const CHECKLIST_ROWS: readonly GovernanceChecklistRowEntry[] = GOVERNANCE_CHECKLIST_ROWS;

function readProviderCapabilityFixture(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'codegen/fixtures/provider-capabilities.json'), 'utf8'),
  ) as Record<string, unknown>;
}

function sortedUniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function csvCell(value: unknown): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const GUARD_COVERAGE_GROUPS = [
  { name: 'approvals-hitl', guards: HITL_CAPABILITY_GUARDS },
  { name: 'opa-rules', guards: POLICY_EVALUATION_GUARDS },
  { name: 'guardrails', guards: GUARDRAIL_CAPABILITY_GUARDS },
  { name: 'behavior-rules', guards: BEHAVIOR_RULE_CAPABILITY_GUARDS },
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

function stripCodeComments(source: string): string {
  let out = '';
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;
  for (let index = 0; index < source.length; index++) {
    const ch = source[index];
    const next = source[index + 1];
    if (quote) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index++;
      out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index++;
      }
      index++;
      out += ' ';
      continue;
    }
    out += ch;
  }
  return out;
}

function extractEnabledTestBlocks(source: string): Array<{ title: string; source: string }> {
  const out: Array<{ title: string; source: string }> = [];
  const skippedRanges = findSkippedDescribeRanges(source);
  const testRe = /\b(?:it|test)\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1\s*,/g;
  for (const match of source.matchAll(testRe)) {
    const start = match.index ?? 0;
    if (skippedRanges.some((range) => start >= range.start && start < range.end)) continue;
    const arrowIndex = source.indexOf('=>', start);
    if (arrowIndex === -1) continue;
    const bodyStart = source.indexOf('{', arrowIndex);
    if (bodyStart === -1) continue;
    const bodyEnd = findMatchingBrace(source, bodyStart);
    if (bodyEnd === -1) continue;
    out.push({ title: match[2], source: source.slice(start, bodyEnd + 1) });
  }
  return out;
}

function findSkippedDescribeRanges(source: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const describeSkipRe = /\bdescribe\.skip\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1\s*,/g;
  for (const match of source.matchAll(describeSkipRe)) {
    const start = match.index ?? 0;
    const arrowIndex = source.indexOf('=>', start);
    if (arrowIndex === -1) continue;
    const bodyStart = source.indexOf('{', arrowIndex);
    if (bodyStart === -1) continue;
    const bodyEnd = findMatchingBrace(source, bodyStart);
    if (bodyEnd !== -1) ranges.push({ start, end: bodyEnd + 1 });
  }
  return ranges;
}

function findMatchingBrace(source: string, start: number): number {
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;
  for (let index = start; index < source.length; index++) {
    const ch = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function expectGuardTestResolves(label: string, guardTest: string): void {
  const [file, anchor] = guardTest.split('#');
  expect(file, `${label} guardTest file`).toMatch(/^tests\/.+\.test\.ts$/);
  expect(anchor, `${label} guardTest anchor`).toBeTruthy();

  const source = readFileSync(resolve(process.cwd(), file), 'utf8');
  const normalizedAnchor = normalizeGuardProofText(anchor);
  const matchingBlock = extractEnabledTestBlocks(source).find((block) => {
    const normalizedTitle = normalizeGuardProofText(block.title);
    return normalizedTitle.includes(normalizedAnchor) || normalizedAnchor.includes(normalizedTitle);
  });
  expect(matchingBlock, `${label} guardTest enabled test block ${guardTest}`).toBeDefined();
  expect(
    stripCodeComments(matchingBlock?.source ?? ''),
    `${label} guardTest executable assertions ${guardTest}`,
  ).toMatch(/\bexpect(?:\.|\()/);
}

describe('provider capability matrix', () => {
  it('matches the TypeSpec-emitted provider capability conformance fixture', () => {
    const fixture = readProviderCapabilityFixture();

    expect(fixture.generatedBy).toBe('codegen/emitters/typespec-emitter');
    expect(fixture.source).toBe('specs/typespec/govern/capabilities.tsp');
    expect(OPENBOX_CAPABILITY_IDS).toEqual(fixture.capabilityIds);
    expect(OPENBOX_PROVIDER_IDS).toEqual(fixture.providerIds);
    expect(OPENBOX_SUPPORT_TIERS).toEqual(fixture.supportTiers);
    expect(LOCAL_STACK_SCENARIO_CATEGORY_IDS).toEqual(
      GOVERNANCE_SPEC_DOMAINS.localStackScenarioCategories,
    );
    expect(LOCAL_STACK_SCENARIO_AXIS_IDS).toEqual(GOVERNANCE_SPEC_DOMAINS.localStackScenarioAxes);
    expect(LOCAL_STACK_PROOF_LEVELS).toEqual(GOVERNANCE_SPEC_DOMAINS.localStackProofLevels);
    expect(LOCAL_STACK_OUTCOME_SOURCES).toEqual(GOVERNANCE_SPEC_DOMAINS.localStackOutcomeSources);
    expect(SDK_SEMANTIC_GAP_CLOSURE_TARGETS).toEqual(
      GOVERNANCE_SPEC_DOMAINS.sdkSemanticGapClosureTargets,
    );
    expect(PROVIDER_CAPABILITY_MATRIX).toEqual(fixture.providerCapabilityMatrix);
    expect(GOVERNANCE_CHECKLIST_LIMITATIONS).toEqual(
      fixture.governanceChecklistLimitations,
    );
    expect(GOVERNANCE_CHECKLIST_ROWS).toEqual(fixture.governanceChecklistRows);
    expect(GOVERNANCE_CHECKLIST_SCORE).toEqual(fixture.governanceChecklistScore);
    expect(REFERENCE_PROVIDER_PARITY_CLOSURES).toEqual(
      fixture.referenceProviderParityClosures,
    );
    expect(REFERENCE_PROVIDER_RUNTIME_AUDIT).toEqual(fixture.referenceProviderRuntimeAudit);
    expect(PROVIDER_EVENT_CATALOG).toEqual(fixture.providerEventCatalog);
    expect(PROVIDER_PLUGIN_COMPONENTS).toEqual(fixture.providerPluginComponents);
    const claudeCodeGovernanceAuditSurface = fixture.claudeCodeGovernanceAuditSurface as {
      audit: unknown;
      surfaces: unknown;
      sdkCapabilities: unknown;
    };
    expect(CLAUDE_CODE_GOVERNANCE_AUDIT_SURFACE).toEqual(
      claudeCodeGovernanceAuditSurface,
    );
    expect(CLAUDE_CODE_GOVERNANCE_AUDIT).toEqual(
      claudeCodeGovernanceAuditSurface.audit,
    );
    expect(CLAUDE_CODE_SURFACE_MATRIX).toEqual(
      claudeCodeGovernanceAuditSurface.surfaces,
    );
    expect(CLAUDE_CODE_SDK_CAPABILITY_MATRIX).toEqual(
      claudeCodeGovernanceAuditSurface.sdkCapabilities,
    );
    expect(PUBLIC_INTEGRATION_SUPPORT).toEqual(fixture.publicIntegrationSupport);
    expect(GOAL_SIGNAL_GUARDS).toEqual(fixture.goalSignalGuards);
    expect(USAGE_COST_CAPABILITY_GUARDS).toEqual(fixture.usageCostCapabilityGuards);
    expect(USAGE_NORMALIZATION_SURFACE).toEqual(fixture.usageNormalizationSurface);
    expect(TRACING_CAPABILITY_GUARDS).toEqual(fixture.tracingCapabilityGuards);
    expect(HITL_CAPABILITY_GUARDS).toEqual(fixture.hitlCapabilityGuards);
    expect(GUARDRAIL_CAPABILITY_GUARDS).toEqual(fixture.guardrailCapabilityGuards);
    expect(BEHAVIOR_RULE_CAPABILITY_GUARDS).toEqual(fixture.behaviorRuleCapabilityGuards);
    expect(GUARDRAILS_HUB_RECORDING_SURFACE).toEqual(
      fixture.guardrailsHubRecordingSurface,
    );
    expect(OPA_EVALUATION_MATRIX).toEqual(fixture.opaEvaluationMatrix);
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
    expect(LOCAL_STACK_SCENARIO_PATHS).toEqual(fixture.localStackScenarioPaths);
    expect(LOCAL_STACK_SCENARIO_MATRIX).toEqual(fixture.localStackScenarioMatrix);
    expect(MCP_TOOL_SURFACES).toEqual(fixture.mcpToolSurfaces);
    expect(MCP_PROMPT_SURFACES).toEqual(fixture.mcpPromptSurfaces);
    expect(MCP_RESOURCE_TEMPLATE_SURFACES).toEqual(fixture.mcpResourceTemplateSurfaces);
    expect(MCP_SKILL_REFERENCE_SURFACES).toEqual(fixture.mcpSkillReferenceSurfaces);
    expect(N8N_INTEGRATION_SURFACE).toEqual(fixture.n8nIntegrationSurface);
  });

  it('keeps governance checklist scoring honest by excluding explicit limitations', () => {
    const expectedLimitationIds = [
      'CLAUDE-062',
      'CODEX-015',
      'CODEX-019',
      'CURSOR-074',
      'CURSOR-077',
      'OAI-010',
      'MCP-018',
      'MCP-050',
      'COPILOT-017',
      'N8N-012',
      'N8N-016',
    ];
    const scoredRows = GOVERNANCE_CHECKLIST_SCORE.filter((entry) => entry.scope === 'scored');
    const implementationTotal = GOVERNANCE_CHECKLIST_SCORE.find(
      (entry) => entry.area === 'Implementation Total',
    );
    const implementationRows = CHECKLIST_ROWS.filter(
      (entry) => entry.area !== 'Universal contract requirements',
    );

    expect(GOVERNANCE_CHECKLIST_LIMITATIONS).toHaveLength(expectedLimitationIds.length);
    expect(
      GOVERNANCE_CHECKLIST_LIMITATIONS.map((entry) => entry.checklistId).sort(),
    ).toEqual([...expectedLimitationIds].sort());
    expect(
      new Set(GOVERNANCE_CHECKLIST_LIMITATIONS.map((entry) => entry.checklistId)).size,
    ).toBe(GOVERNANCE_CHECKLIST_LIMITATIONS.length);
    for (const limitation of GOVERNANCE_CHECKLIST_LIMITATIONS) {
      const row = CHECKLIST_ROWS.find(
        (entry) => entry.id === limitation.checklistId,
      );
      expect(row, `${limitation.checklistId} detailed row`).toBeDefined();
      expect(row?.status, `${limitation.checklistId} row status`).toBe('limitation');
      expect(row?.scored, `${limitation.checklistId} row scored`).toBe(false);
      expect(row?.provider, `${limitation.checklistId} row provider`).toBe(
        limitation.provider,
      );
      expect(row?.boundaryOwner, `${limitation.checklistId} row boundary`).toBe(
        limitation.boundaryOwner,
      );
      expect(OPENBOX_PROVIDER_IDS, `${limitation.checklistId} provider`).toContain(
        limitation.provider,
      );
      expect(['host', 'caller'], `${limitation.checklistId} boundaryOwner`).toContain(
        limitation.boundaryOwner,
      );
      expect(limitation.scored, `${limitation.checklistId} scored`).toBe(false);
      expect(limitation.limitation.length, `${limitation.checklistId} limitation`).toBeGreaterThan(
        40,
      );
      expect(
        limitation.openboxContract.length,
        `${limitation.checklistId} openboxContract`,
      ).toBeGreaterThan(60);
    }

    expect(scoredRows.length).toBeGreaterThan(0);
    for (const row of scoredRows) {
      expect(row.total, `${row.area} total math`).toBe(
        row.done + row.limitations + row.missing,
      );
      expect(row.scoredTotal, `${row.area} scoredTotal`).toBe(row.done);
      expect(row.scoredDone, `${row.area} scoredDone`).toBe(row.scoredTotal);
      expect(row.scoredDonePercent, `${row.area} scoredDonePercent`).toBe('100.0%');
      expect(row.missing, `${row.area} missing`).toBe(0);
    }

    expect(CHECKLIST_ROWS).toHaveLength(639);
    expect(new Set(CHECKLIST_ROWS.map((entry) => entry.id)).size).toBe(
      CHECKLIST_ROWS.length,
    );
    for (const score of GOVERNANCE_CHECKLIST_SCORE) {
      if (score.area === 'Implementation Total') continue;
      const areaRows = CHECKLIST_ROWS.filter(
        (entry) => entry.area === score.area,
      );
      expect(areaRows, `${score.area} detailed rows`).toHaveLength(score.total);
      if (score.scope === 'universal') {
        expect(areaRows.every((entry) => entry.status === 'universal')).toBe(true);
        expect(areaRows.every((entry) => entry.scored === false)).toBe(true);
        continue;
      }
      const done = areaRows.filter((entry) => entry.status === 'done').length;
      const limitations = areaRows.filter((entry) => entry.status === 'limitation').length;
      const missing = areaRows.filter((entry) => entry.status === 'missing').length;
      const scored = areaRows.filter((entry) => entry.scored).length;
      expect(done, `${score.area} done detailed rows`).toBe(score.done);
      expect(limitations, `${score.area} limitation detailed rows`).toBe(score.limitations);
      expect(missing, `${score.area} missing detailed rows`).toBe(score.missing);
      expect(scored, `${score.area} scored detailed rows`).toBe(score.scoredTotal);
    }

    expect(implementationTotal).toBeDefined();
    const implementationScore = implementationTotal!;
    expect(implementationScore.limitations).toBe(GOVERNANCE_CHECKLIST_LIMITATIONS.length);
    expect(implementationRows).toHaveLength(implementationScore.total);
    expect(implementationRows.filter((entry) => entry.status === 'done')).toHaveLength(
      implementationScore.done,
    );
    expect(
      implementationRows.filter((entry) => entry.status === 'limitation'),
    ).toHaveLength(implementationScore.limitations);
    expect(implementationRows.filter((entry) => entry.status === 'missing')).toHaveLength(
      implementationScore.missing,
    );
    expect(implementationScore.total).toBe(583);
    expect(implementationScore.done).toBe(572);
    expect(implementationScore.scoredTotal).toBe(572);
    expect(implementationScore.scoredDone).toBe(572);
  });

  it('keeps repo-local governance checklist artifacts synced to generated constants', () => {
    const markdown = readFileSync(
      resolve(process.cwd(), 'docs/governance-artifacts/capability-checklist.md'),
      'utf8',
    );
    const csv = readFileSync(
      resolve(process.cwd(), 'docs/governance-artifacts/summary.csv'),
      'utf8',
    );
    const detailedCsv = readFileSync(
      resolve(process.cwd(), 'docs/governance-artifacts/capability-checklist.csv'),
      'utf8',
    );
    const expectedCsvRows = [
      [
        'Area',
        'Total',
        'Done',
        'Limitations',
        'Missing',
        'Scored Total',
        'Scored Done',
        'Scored Done %',
      ],
      ...GOVERNANCE_CHECKLIST_SCORE.map((row) => [
        row.area,
        String(row.total),
        row.scope === 'universal' ? 'n/a' : String(row.done),
        row.scope === 'universal' ? 'n/a' : String(row.limitations),
        row.scope === 'universal' ? 'n/a' : String(row.missing),
        row.scope === 'universal' ? 'n/a' : String(row.scoredTotal),
        row.scope === 'universal' ? 'n/a' : String(row.scoredDone),
        row.scoredDonePercent,
      ]),
    ];
    const expectedCsv = expectedCsvRows.map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
    const expectedDetailedCsvRows = [
      [
        'Area',
        'Group',
        'ID',
        'Status',
        'Scored',
        'Provider',
        'Boundary Owner',
        'Requirement',
      ],
      ...CHECKLIST_ROWS.map((row) => [
        row.area,
        row.group,
        row.id,
        row.status,
        row.scored,
        row.provider ?? '',
        row.boundaryOwner ?? '',
        row.requirement,
      ]),
    ];
    const expectedDetailedCsv =
      expectedDetailedCsvRows.map((row) => row.map(csvCell).join(',')).join('\n') + '\n';

    expect(csv).toBe(expectedCsv);
    expect(detailedCsv).toBe(expectedDetailedCsv);
    expect(markdown).toContain('AUTO-GENERATED by scripts/write-governance-checklist.mjs');
    expect(markdown).toContain('Detailed rows are emitted from `governanceChecklistRows`.');
    for (const row of GOVERNANCE_CHECKLIST_SCORE) {
      expect(markdown, row.area).toContain(`### ${row.area}`);
      expect(markdown, row.area).toContain(`- Total: ${row.total}`);
    }
    for (const row of CHECKLIST_ROWS) {
      expect(markdown, row.id).toContain(`${row.id} - `);
    }
    for (const limitation of GOVERNANCE_CHECKLIST_LIMITATIONS) {
      const limitationLine = `- Limitation: ${limitation.limitation}`;
      expect(markdown, limitation.checklistId).toContain(
        `### ${limitation.checklistId}`,
      );
      expect(markdown, limitation.checklistId).toContain(
        `- Boundary owner: ${limitation.boundaryOwner}`,
      );
      expect(markdown.replace(/\n  /g, ' '), limitation.checklistId).toContain(
        limitationLine,
      );
    }
  });

  it('does not use stale conditional provider-exposure wording in generated capability text', () => {
    const serialized = JSON.stringify({
      providerCapabilityMatrix: PROVIDER_CAPABILITY_MATRIX,
      governanceChecklistLimitations: GOVERNANCE_CHECKLIST_LIMITATIONS,
      governanceChecklistRows: GOVERNANCE_CHECKLIST_ROWS,
      governanceChecklistScore: GOVERNANCE_CHECKLIST_SCORE,
      referenceProviderParityClosures: REFERENCE_PROVIDER_PARITY_CLOSURES,
      referenceProviderRuntimeAudit: REFERENCE_PROVIDER_RUNTIME_AUDIT,
      usageCostCapabilityGuards: USAGE_COST_CAPABILITY_GUARDS,
      subagentsAgentsCapabilityGuards: SUBAGENTS_AGENTS_CAPABILITY_GUARDS,
      mcpCapabilityGuards: MCP_CAPABILITY_GUARDS,
      localStackScenarioPaths: LOCAL_STACK_SCENARIO_PATHS,
    });

    expect(serialized).not.toMatch(
      /when [^"]*(?:expos|surfaced|supplied|represented|available|present)/i,
    );
    expect(serialized).not.toMatch(
      /(?:exposes? (?:it|them)|surfaced by|where available|where present|when supplied)/i,
    );
    expect(serialized).not.toMatch(
      /(?:reference provider does not expose|does not expose an OpenBox-owned surface|reference surface exposes|not exposed by hooks|exposes enough)/i,
    );
  });

  it('pins OPA evaluation matrix to spec-owned canonical surfaces', () => {
    const localStackScenarioIds = new Set<string>(
      LOCAL_STACK_SCENARIO_PATHS.map((entry) => entry.id),
    );
    const expectedVerdicts = GOVERNANCE_SPEC_DOMAINS.coreVerdicts
      .filter((verdict) => verdict !== 'constrain')
      .sort();

    expect(OPA_EVALUATION_MATRIX.source).toBe('specs/typespec/govern/capabilities.tsp');
    expect(sortedUniqueStrings(OPA_EVALUATION_MATRIX.decisionScenarios.map((entry) => entry.expectedVerdict))).toEqual(
      expectedVerdicts,
    );
    expect(sortedUniqueStrings(OPA_EVALUATION_MATRIX.decisionScenarios.map((entry) => entry.expectedAction))).toEqual(
      expectedVerdicts,
    );
    expect(OPA_EVALUATION_MATRIX.decisionScenarios.map((entry) => entry.scenarioId).sort()).toEqual([
      'opa-allow',
      'opa-block',
      'opa-halt',
      'opa-require-approval',
    ]);
    expect(OPA_EVALUATION_MATRIX.governedSurfaces.length).toBeGreaterThan(20);
    expect(
      new Set(
        OPA_EVALUATION_MATRIX.governedSurfaces.map(
          (entry) => `${entry.scenarioId}:${entry.activityType}:${entry.semanticType}`,
        ),
      ).size,
    ).toBe(OPA_EVALUATION_MATRIX.governedSurfaces.length);

    const matrixScenarioIds = sortedUniqueStrings([
      ...OPA_EVALUATION_MATRIX.decisionScenarios.map((entry) => entry.scenarioId),
      ...OPA_EVALUATION_MATRIX.governedSurfaces.map((entry) => entry.scenarioId),
      ...OPA_EVALUATION_MATRIX.aliasCases.map((entry) => entry.scenarioId),
      OPA_EVALUATION_MATRIX.unsupportedConstrain.scenarioId,
      OPA_EVALUATION_MATRIX.unavailableFailClosed.scenarioId,
      'opa-decision-aliases',
    ]);
    expect(matrixScenarioIds.filter((id) => !localStackScenarioIds.has(id))).toEqual([]);

    const serialized = JSON.stringify(OPA_EVALUATION_MATRIX);
    expect(serialized).not.toMatch(/\/tmp\/openbox-sdk/);
    expect(serialized).toContain('fixtures/openbox-sdk-readme.md');
    expect(OPA_EVALUATION_MATRIX.unsupportedConstrain.expectedVerdict).toBe('allow');
    expect(OPA_EVALUATION_MATRIX.unavailableFailClosed.unavailableVerdict).toBe('halt');
  });

  it('routes non-native embedding governance through MCP-required drivers', () => {
    const embeddingCase = LOCAL_GOVERNANCE_VERDICT_MATRIX_CASES.find(
      (entry) => entry.id === 'llm-embedding-approval',
    );
    expect(embeddingCase).toMatchObject({
      spanType: 'llm_embedding',
      expectedTrigger: 'llm_embedding',
      expectedVerdict: 'require_approval',
    });

    for (const provider of ['openai-agents-sdk', 'anthropic-agent-sdk', 'copilotkit'] as const) {
      const drivers = embeddingCase?.providerDrivers?.filter(
        (entry) => entry.provider === provider,
      );
      expect(drivers, provider).toEqual([
        expect.objectContaining({
          provider,
          surface: 'mcp-required',
          event: 'tools/call',
          tool: 'check_governance',
        }),
      ]);
      expect(drivers?.map((entry) => String(entry.surface)), provider).not.toContain(
        'sdk-wrapper',
      );
      expect(drivers?.map((entry) => String(entry.surface)), provider).not.toContain(
        'runtime-adapter',
      );
    }
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

  it('keeps provider capability rows rectangular, unique, and domain-valid', () => {
    const expectedKeys = PROVIDERS.flatMap((provider) =>
      OPENBOX_CAPABILITY_IDS.map((capability) => `${provider}/${capability}`),
    ).sort();
    const actualKeys = PROVIDER_CAPABILITY_MATRIX
      .map((entry) => `${entry.provider}/${entry.capability}`)
      .sort();

    expect(PROVIDER_CAPABILITY_MATRIX.length).toBe(
      OPENBOX_PROVIDER_IDS.length * OPENBOX_CAPABILITY_IDS.length,
    );
    expect(actualKeys).toEqual(expectedKeys);
    expect([...new Set(actualKeys)]).toEqual(actualKeys);

    for (const entry of PROVIDER_CAPABILITY_MATRIX) {
      expect(OPENBOX_PROVIDER_IDS, `${entry.provider}/${entry.capability} provider`).toContain(
        entry.provider,
      );
      expect(OPENBOX_CAPABILITY_IDS, `${entry.provider}/${entry.capability} capability`).toContain(
        entry.capability,
      );
      expect(OPENBOX_SUPPORT_TIERS, `${entry.provider}/${entry.capability} tier`).toContain(
        entry.tier,
      );
    }
  });

  it('resolves every capability guardTest to a checked-in test phrase', () => {
    for (const group of GUARD_COVERAGE_GROUPS) {
      for (const guard of group.guards) {
        expectGuardTestResolves(`${group.name}/${guard.provider}`, guard.guardTest);
      }
    }
  });

  it('pins reference provider parity closures to every non-native capability claim', () => {
    const statusByTier = new Map([
      ['wrapped', 'implemented-through-wrapper'],
      ['observe-only', 'host-owned-observe-only'],
      ['diagnose-only', 'runtime-diagnostic-only'],
      ['out-of-scope', 'host-unsupported'],
    ]);
    const nonNativeCapabilityClaims = PROVIDER_CAPABILITY_MATRIX
      .filter((entry) => entry.tier !== 'native')
      .map((entry) => `${entry.provider}/${entry.capability}`)
      .sort();
    const closureClaims = REFERENCE_PROVIDER_PARITY_CLOSURES
      .map((entry) => `${entry.provider}/${entry.capability}`)
      .sort();

    expect(closureClaims).toEqual(nonNativeCapabilityClaims);
    expect(new Set(closureClaims).size).toBe(closureClaims.length);

    const matrixByClaim = new Map(
      PROVIDER_CAPABILITY_MATRIX.map((entry) => [
        `${entry.provider}/${entry.capability}`,
        entry,
      ]),
    );
    for (const closure of REFERENCE_PROVIDER_PARITY_CLOSURES) {
      const claim = `${closure.provider}/${closure.capability}`;
      const matrixEntry = matrixByClaim.get(claim);
      expect(matrixEntry, `${claim} matrix entry`).toBeDefined();
      expect(closure.tier, `${claim} tier`).toBe(matrixEntry?.tier);
      expect(closure.status, `${claim} status`).toBe(statusByTier.get(closure.tier));
      expect(closure.referenceSurface.length, `${claim} referenceSurface`).toBeGreaterThan(20);
      expect(closure.openboxSurface.length, `${claim} openboxSurface`).toBeGreaterThan(20);
      expect(closure.closureDecision, `${claim} closureDecision`).toMatch(/^Closed as /);
      expect(closure.closureDecision, `${claim} closureDecision`).not.toMatch(
        /\b(todo|planned|future|unclosed)\b/i,
      );
      expectGuardTestResolves(`reference-closure/${claim}`, closure.guardTest);
    }
  });

  it('pins runtime promotion audits to every reference provider parity closure', () => {
    const expectedDecisionsByStatus: Record<
      ReferenceProviderParityClosureStatus,
      readonly ReferenceProviderRuntimePromotionDecision[]
    > = {
      'implemented-through-wrapper': ['max-through-wrapper'],
      'host-owned-observe-only': ['retain-host-owned-boundary'],
      'runtime-diagnostic-only': ['implemented-runtime-diagnostic'],
      'host-unsupported': ['retain-package-boundary', 'retain-protocol-boundary'],
    };
    const closureClaims = REFERENCE_PROVIDER_PARITY_CLOSURES
      .map((entry) => `${entry.provider}/${entry.capability}`)
      .sort();
    const auditClaims = REFERENCE_PROVIDER_RUNTIME_AUDIT
      .map((entry) => `${entry.provider}/${entry.capability}`)
      .sort();
    const closureByClaim = new Map(
      REFERENCE_PROVIDER_PARITY_CLOSURES.map((entry) => [
        `${entry.provider}/${entry.capability}`,
        entry,
      ]),
    );

    expect(auditClaims).toEqual(closureClaims);
    expect(new Set(auditClaims).size).toBe(auditClaims.length);

    for (const audit of REFERENCE_PROVIDER_RUNTIME_AUDIT) {
      const claim = `${audit.provider}/${audit.capability}`;
      const closure = closureByClaim.get(claim);
      expect(closure, `${claim} closure`).toBeDefined();
      expect(audit.tier, `${claim} tier`).toBe(closure?.tier);
      expect(audit.status, `${claim} status`).toBe(closure?.status);
      expect(audit.guardTest, `${claim} guardTest`).toBe(closure?.guardTest);
      expect(
        expectedDecisionsByStatus[audit.status].includes(audit.promotionDecision),
        `${claim} promotionDecision`,
      ).toBe(true);
      expect(audit.runtimeEvidence.length, `${claim} runtimeEvidence`).toBeGreaterThan(60);
      expect(audit.technicalBoundary.length, `${claim} technicalBoundary`).toBeGreaterThan(60);
      expect(`${audit.runtimeEvidence} ${audit.technicalBoundary}`, `${claim} audit text`).not.toMatch(
        /\b(todo|planned|future|unclosed|maybe)\b/i,
      );
      expectGuardTestResolves(`runtime-audit/${claim}`, audit.guardTest);

      if (audit.status === 'implemented-through-wrapper') {
        expect(audit.runtimeEvidence, `${claim} wrapper evidence`).toMatch(
          /\b(wraps?|wrappers?|project|projects|emits?|maps?|renders?|ships?|generates?|helper|helpers|spans?)\b/i,
        );
      }
      if (audit.status === 'host-owned-observe-only') {
        expect(audit.technicalBoundary, `${claim} observe boundary`).toMatch(
          /\b(host|provider|Codex|Cursor|MCP|OpenAI|Anthropic|CopilotKit|n8n).*\b(own|owns|orchestration|configuration|metering|scheduling|observe|observes)\b/i,
        );
      }
      if (audit.status === 'runtime-diagnostic-only') {
        expect(audit.runtimeEvidence, `${claim} diagnostic evidence`).toMatch(
          /verifyOpenBox|createOpenBoxReadinessCheck/,
        );
        expect(audit.technicalBoundary, `${claim} diagnostic boundary`).toMatch(
          /\b(no host install surface|never mutate|operator-owned|no files installed|without host file mutation)\b/i,
        );
      }
      if (audit.status === 'host-unsupported') {
        expect(audit.technicalBoundary, `${claim} unsupported boundary`).toMatch(
          /\b(protocol|package|plugin|skill|surface|contract)\b/i,
        );
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

  it('pins behavior-rules support claims to explicit Core-owned trigger guards', () => {
    const behaviorCapabilityProviders = PROVIDER_CAPABILITY_MATRIX
      .filter((entry) => entry.capability === 'behavior-rules' && entry.tier === 'native')
      .map((entry) => entry.provider)
      .sort();
    const nativeGuardProviders = BEHAVIOR_RULE_CAPABILITY_GUARDS
      .filter((entry) => entry.tier === 'native')
      .map((entry) => entry.provider)
      .sort();

    expect(nativeGuardProviders).toEqual(behaviorCapabilityProviders);
    expect(new Set(nativeGuardProviders).size).toBe(nativeGuardProviders.length);

    const targetHosts: readonly OpenBoxProviderId[] = ['claude-code', 'cursor', 'codex'];
    for (const provider of targetHosts) {
      expect(nativeGuardProviders, `${provider} behavior-rule guard`).toContain(provider);
      const guard = BEHAVIOR_RULE_CAPABILITY_GUARDS.find((entry) => entry.provider === provider);
      expect(guard?.localStackProof, `${provider} localStackProof`).toContain('local Core');
    }

    for (const guard of BEHAVIOR_RULE_CAPABILITY_GUARDS) {
      expect(guard.triggerSurfaces.length, `${guard.provider} triggerSurfaces`).toBeGreaterThan(30);
      expect(guard.spanCoverage, `${guard.provider} spanCoverage`).toMatch(/span/i);
      expect(guard.coreContract, `${guard.provider} coreContract`).toContain('Core/backend');
      expect(guard.coreContract, `${guard.provider} coreContract`).toMatch(/owns behavior-rule trigger matching/i);
      expect(guard.verdictEnforcement, `${guard.provider} verdictEnforcement`).toMatch(
        /verdict|allow|block|halt|deny|approval/i,
      );
      expect(guard.verdictEnforcement, `${guard.provider} verdictEnforcement`).toMatch(
        /without local predicate evaluation|never computes behavior decisions/i,
      );
      expect(guard.localStackProof, `${guard.provider} localStackProof`).toMatch(/^tests\/.+\.test\.ts /);
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

  it('pins Guardrails Hub recording to spec-owned corpus and deterministic samples', () => {
    expect(GUARDRAILS_HUB_RECORDING_SURFACE.source).toBe(
      'specs/typespec/govern/capabilities.tsp',
    );
    expect(GUARDRAILS_HUB_RECORDING_SURFACE.recorderScript).toBe(
      'scripts/record-guardrails-hub.mjs',
    );
    expect(GUARDRAILS_HUB_RECORDING_SURFACE.provenanceCommand).toBe(
      'node scripts/record-guardrails-hub.mjs --provenance',
    );
    expect(GUARDRAILS_HUB_RECORDING_SURFACE.defaultSampleCount).toBe(5);
    expect(GUARDRAILS_HUB_RECORDING_SURFACE.requiredValidatorModulePrefix).toBe(
      'guardrails_grhub_',
    );
    expect(GUARDRAILS_HUB_RECORDING_SURFACE.forbiddenValidatorModulePrefixes).toContain(
      'src.guardrails.local',
    );
    expect(GUARDRAILS_HUB_RECORDING_SURFACE.cases.every((entry) => entry.sampleCount === 5)).toBe(
      true,
    );
    expect(GUARDRAILS_HUB_RECORDING_SURFACE.cases.every((entry) => entry.variants.length >= 2)).toBe(
      true,
    );
    const hubVariants = GUARDRAILS_HUB_RECORDING_SURFACE.cases.flatMap((entry) =>
      entry.variants.map((variant) => ({ entry, variant })),
    );
    expect(new Set(hubVariants.map(({ entry, variant }) => `${entry.id}/${variant.id}`)).size).toBe(
      hubVariants.length,
    );
    for (const entry of GUARDRAILS_HUB_RECORDING_SURFACE.cases) {
      expect(sortedUniqueStrings(entry.variants.map((variant) => variant.expectedSemanticStatus))).toEqual([
        'allowed',
        'violation',
      ]);
    }
    expect(
      sortedUniqueStrings(GUARDRAILS_HUB_RECORDING_SURFACE.cases.map((entry) => entry.guardrailType)),
    ).toEqual([...GOVERNANCE_SPEC_DOMAINS.guardrailTypes].sort());
    expect(
      sortedUniqueStrings(hubVariants.map(({ variant }) => variant.expectedSemanticStatus)),
    ).toEqual(['allowed', 'violation']);

    const recordedPath = resolve(
      process.cwd(),
      GUARDRAILS_HUB_RECORDING_SURFACE.fixturePath,
    );
    const recordedText = readFileSync(recordedPath, 'utf8');
    expect(recordedText).not.toMatch(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);

    const recorded = JSON.parse(recordedText) as {
      schemaVersion: number;
      status: 'not-recorded' | 'recorded';
      generatedBy: string;
      policyId: string;
      recordingRequired?: boolean;
      provenance?: { source?: string; validators?: Array<{ module?: string }> };
      records: Array<{
        caseId: string;
        variantId: string;
        sampleCount: number;
        stable: boolean;
        samples: Array<{ semanticStatus: string }>;
      }>;
    };
    expect(recorded.schemaVersion).toBe(1);
    expect(recorded.generatedBy).toBe(GUARDRAILS_HUB_RECORDING_SURFACE.recorderScript);
    expect(recorded.policyId).toBe(GUARDRAILS_HUB_RECORDING_SURFACE.id);

    if (recorded.status === 'not-recorded') {
      expect(recorded.recordingRequired).toBe(true);
      expect(recorded.records).toEqual([]);
      return;
    }

    expect(recorded.provenance?.source).toBe('guardrails-hub');
    expect(
      recorded.provenance?.validators?.every((validator) =>
        String(validator.module).startsWith(
          GUARDRAILS_HUB_RECORDING_SURFACE.requiredValidatorModulePrefix,
        ),
      ),
    ).toBe(true);
    const variantByRef = new Map<
      string,
      {
        entry: (typeof GUARDRAILS_HUB_RECORDING_SURFACE.cases)[number];
        variant: (typeof GUARDRAILS_HUB_RECORDING_SURFACE.cases)[number]['variants'][number];
      }
    >(
      GUARDRAILS_HUB_RECORDING_SURFACE.cases.flatMap((entry) =>
        entry.variants.map((variant) => [`${entry.id}/${variant.id}`, { entry, variant }] as const),
      ),
    );
    expect(recorded.records.map((entry) => `${entry.caseId}/${entry.variantId}`).sort()).toEqual(
      [...variantByRef.keys()].sort(),
    );
    for (const record of recorded.records) {
      const recordRef = `${record.caseId}/${record.variantId}`;
      const expected = variantByRef.get(recordRef);
      expect(expected, recordRef).toBeDefined();
      expect(record.sampleCount, recordRef).toBe(expected?.entry.sampleCount);
      expect(record.stable, recordRef).toBe(true);
      expect(record.samples, recordRef).toHaveLength(expected?.entry.sampleCount ?? 0);
      expect(
        record.samples.every((sample) => sample.semanticStatus === expected?.variant.expectedSemanticStatus),
        recordRef,
      ).toBe(true);
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
      expect(guard.normalizedFields, `${guard.provider} normalizedFields`).toContain(
        'cost_usd is forwarded from explicit',
      );
      expect(guard.sharedNormalizer, `${guard.provider} sharedNormalizer`).toMatch(/normalizeOpenBoxUsage|openBoxUsageTelemetryFields|buildSpan|buildAssistantOutputSpan|assistantOutputTelemetryFields/);
      expect(guard.costPolicyBoundary, `${guard.provider} costPolicyBoundary`).toContain('OpenBox Core');
      expect(guard.costPolicyBoundary, `${guard.provider} costPolicyBoundary`).toMatch(/reports token usage|Core remains/);
      expect(guard.costPolicyBoundary, `${guard.provider} costPolicyBoundary`).toMatch(/never computes|never locally enforce/);
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
      PROVIDER_EVENT_CATALOG.find((entry) => entry.provider === 'anthropic-agent-sdk')?.upstreamKnownEvents,
    ).toEqual([...ANTHROPIC_AGENT_HOOK_EVENTS]);
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
    for (const identity of showcase!.requiredNodeIdentities ?? []) {
      const node = showcaseNodeByName.get(identity.name);
      expect(node, identity.name).toBeDefined();
      expect(node?.id, `${identity.name}.id`).toBe(identity.id);
      expect(node?.type, `${identity.name}.type`).toBe(identity.type);
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
    for (const check of showcase!.requiredOpenBoxNodeParameterChecks ?? []) {
      const nodes = showcaseWorkflow.nodes.filter((node) => node.type === check.nodeType);
      expect(nodes.length, `${check.nodeType} nodes`).toBeGreaterThan(0);
      for (const node of nodes) {
        const value = String(node.parameters?.[check.parameter] ?? '');
        expect(value, `${node.name}.${check.parameter}`).not.toBe('');
        for (const required of check.requiredContains) {
          expect(value, `${node.name}.${check.parameter} must contain ${required}`).toContain(required);
        }
        for (const forbidden of check.forbiddenContains) {
          expect(value, `${node.name}.${check.parameter} must not contain ${forbidden}`).not.toContain(
            forbidden,
          );
        }
        expect(check.forbiddenValues, `${node.name}.${check.parameter} exact value`).not.toContain(
          value,
        );
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
    for (const forbidden of showcase!.forbiddenWorkflowText ?? []) {
      expect(showcaseJson, `showcase must not contain ${forbidden}`).not.toContain(forbidden);
    }
    for (const forbiddenPattern of showcase!.forbiddenWorkflowRegexes ?? []) {
      expect(showcaseJson, `showcase must not match ${forbiddenPattern}`).not.toMatch(
        new RegExp(forbiddenPattern),
      );
    }
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
