// Editor-agnostic rules projection. Fetches an agent's live guardrails,
// policies, and behavior rules and normalizes them into the `ProjectedRule` shape
// declared in specs/typespec/govern/rules-projection.tsp.
//
// The projection output shape is generated from TypeSpec. Backend
// behavior-rule inputs also use generated types so v2 state predicates stay
// aligned with the API contract.
import { createApi } from '../runtime/mcp/config.js';
import type { components } from '../types/generated/backend.js';
import type {
  ProjectedRule,
  RulesProjection,
  RuleSeverity,
} from './generated/rules-projection.js';

export type {
  ProjectedRule,
  RulesProjection,
  RuleSeverity,
  RuleTrigger,
} from './generated/rules-projection.js';

export interface CodexInstructionRenderOptions {
  skillName?: string;
  title?: string;
}

export interface CodexCommandRulesRenderOptions {
  header?: string;
}

export interface ClaudeInstructionsRenderOptions {
  commandPrefix?: string;
  title?: string;
}

const PROJECTION_VERSION = 1;

interface BackendGuardrail {
  id: string;
  name: string;
  guardrail_type: string;
  description?: string;
  processing_stage: string;
  is_active: boolean;
  params?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  trust_impact?: string;
}

interface BackendPolicy {
  id: string;
  name: string;
  description?: string;
  rego_code: string;
  is_active: boolean;
  trust_impact?: string;
}

type BackendBehaviorRule = components['schemas']['BehaviorRule'];
type BehaviorRuleState =
  NonNullable<BackendBehaviorRule['states']>[number];

/**
 * Trust impact ∈ {none, low, medium, high, critical}; map to the rule
 * severity vocabulary. "high" / "critical" carry hard-block semantics
 * at hook time, so surface them as `block` to the agent. "medium" is
 * an approval gate (`warn`). Everything else is `info`.
 */
function severityFromTrustImpact(impact: string | undefined): RuleSeverity {
  switch (impact) {
    case 'high':
    case 'critical':
      return 'block';
    case 'medium':
      return 'warn';
    default:
      return 'info';
  }
}

function severityFromBehaviorRule(rule: BackendBehaviorRule): RuleSeverity {
  switch (rule.verdict) {
    case 3:
    case 4:
      return 'block';
    case 1:
    case 2:
      return 'warn';
    case 0:
      return 'info';
    default:
      return severityFromTrustImpact(rule.trust_impact);
  }
}

/**
 * Best-effort glob extraction. Guardrails of types like `pii_filter` or
 * `dlp_scan` typically apply to file_read/file_write spans, but the
 * stable per-guardrail glob comes from `params.path_globs` when the
 * operator has set one. Fall back to undefined (= alwaysApply) when
 * absent rather than guessing.
 */
function globsFromParams(params: Record<string, unknown> | undefined): string[] | undefined {
  if (!params) return undefined;
  const raw = params.path_globs ?? params.globs ?? params.file_globs;
  if (Array.isArray(raw) && raw.every((x) => typeof x === 'string')) {
    return raw as string[];
  }
  return undefined;
}

function projectGuardrail(g: BackendGuardrail): ProjectedRule | null {
  if (!g.is_active) return null;
  const globs = globsFromParams(g.params);
  return {
    id: `guardrail/${g.id}`,
    source: 'guardrail',
    description: g.description ?? g.name,
    body: renderGuardrailBody(g),
    trigger: globs ? 'globMatch' : 'always',
    severity: severityFromTrustImpact(g.trust_impact),
    ...(globs ? { globs } : {}),
    rendererHints: {
      guardrailType: g.guardrail_type,
      processingStage: g.processing_stage,
    },
  };
}

function projectPolicy(p: BackendPolicy): ProjectedRule | null {
  if (!p.is_active) return null;
  return {
    id: `policy/${p.id}`,
    source: 'policy',
    description: p.description ?? p.name,
    body: renderPolicyBody(p),
    // Policies fire across every span; agent-requested keeps them out
    // of the always-on context unless the model decides they're
    // relevant. Operators can override with rendererHints.alwaysApply.
    trigger: 'agentRequested',
    severity: severityFromTrustImpact(p.trust_impact),
  };
}

function projectBehaviorRule(rule: BackendBehaviorRule): ProjectedRule | null {
  if (rule.is_active === false) return null;
  return {
    id: `behavior-rule/${rule.id}`,
    source: 'behavior-rule',
    description: rule.description ?? rule.rule_name,
    body: renderBehaviorRuleBody(rule),
    trigger: 'always',
      severity: severityFromBehaviorRule(rule),
    rendererHints: {
      trigger: rule.trigger,
      states: rule.states,
      priority: rule.priority,
      verdict: rule.verdict,
      timeWindow: rule.time_window,
      groupId: rule.group_id,
      version: rule.version,
    },
  };
}

function renderGuardrailBody(g: BackendGuardrail): string {
  const lines = [
    `**${g.name}** (${g.guardrail_type}, ${g.processing_stage})`,
    '',
    g.description ?? '_No description provided._',
  ];
  if (g.params && Object.keys(g.params).length > 0) {
    lines.push('', 'Parameters:', '```json', JSON.stringify(g.params, null, 2), '```');
  }
  return lines.join('\n');
}

function renderPolicyBody(p: BackendPolicy): string {
  // Don't dump rego_code into the rule body; it's noisy and won't help
  // the agent. Surface the description and let the agent ask if needed.
  return [
    `**${p.name}** (OPA policy)`,
    '',
    p.description ?? '_No description provided._',
    '',
    `Policy id: \`${p.id}\``,
  ].join('\n');
}

function renderBehaviorRuleBody(rule: BackendBehaviorRule): string {
  const lines = [
    `**${rule.rule_name}** (behavior rule)`,
    '',
    rule.description ?? '_No description provided._',
  ];
  if (rule.trigger) lines.push('', `Trigger: \`${rule.trigger}\``);
  if (rule.states && rule.states.length > 0) {
    lines.push(`States: ${rule.states.map(renderBehaviorState).join(', ')}`);
  }
  if (typeof rule.verdict === 'number') lines.push(`Verdict: ${rule.verdict}`);
  if (rule.reject_message) lines.push('', `Reject message: ${rule.reject_message}`);
  return lines.join('\n');
}

function renderBehaviorState(state: BehaviorRuleState): string {
  return `\`${state}\``;
}

export interface FetchProjectionOpts {
  agentId: string;
  tokensPath?: string;
}

export async function fetchRulesProjection(opts: FetchProjectionOpts): Promise<RulesProjection> {
  const api = createApi({ tokensPath: opts.tokensPath });
  const [guardrails, policies, behaviorRules] = await Promise.all([
    api(`/agent/${opts.agentId}/guardrails?page=0&perPage=200`),
    api(`/agent/${opts.agentId}/policies?page=0&perPage=200`),
    api(`/agent/${opts.agentId}/behavior-rule?page=0&perPage=200`),
  ]) as [unknown, unknown, unknown];

  const grList = listFromEnvelope<BackendGuardrail>(guardrails);
  const polList = listFromEnvelope<BackendPolicy>(policies);
  const behaviorRuleList = listFromEnvelope<BackendBehaviorRule>(behaviorRules);

  const rules: ProjectedRule[] = [];
  for (const g of grList) {
    const r = projectGuardrail(g);
    if (r) rules.push(r);
  }
  for (const p of polList) {
    const r = projectPolicy(p);
    if (r) rules.push(r);
  }
  for (const rule of behaviorRuleList) {
    const r = projectBehaviorRule(rule);
    if (r) rules.push(r);
  }

  rules.sort((a, b) => a.id.localeCompare(b.id));

  return {
    agentId: opts.agentId,
    fetchedAt: new Date().toISOString(),
    version: PROJECTION_VERSION,
    rules,
  };
}

export function renderCodexAgentsMarkdown(
  projection: RulesProjection,
  options: CodexInstructionRenderOptions = {},
): string {
  const skillName = options.skillName ?? 'openbox';
  const title = options.title ?? 'OpenBox Governance';
  const counts = projectionCounts(projection);
  return [
    `# ${title}`,
    '',
    'OpenBox Core is the source of truth for guardrails, OPA/Rego policies, behavior rules, trust, approvals, cost, usage, and goal alignment.',
    '',
    `Use the \`$${skillName}\` skill when reviewing or explaining OpenBox governance in this repository.`,
    '',
    'Do not locally reimplement policy decisions. Send complete spans and source-attributed inputs to OpenBox Core and enforce returned verdicts fail-closed.',
    '',
    'Projection summary:',
    '',
    `- Agent: \`${projection.agentId}\``,
    `- Fetched: \`${projection.fetchedAt}\``,
    `- Guardrails: ${counts.guardrail}`,
    `- Policies: ${counts.policy}`,
    `- Behavior rules: ${counts['behavior-rule']}`,
    '',
  ].join('\n');
}

export function renderClaudeInstructionsMarkdown(
  projection: RulesProjection,
  options: ClaudeInstructionsRenderOptions = {},
): string {
  const title = options.title ?? 'OpenBox Governance for Claude Code';
  const commandPrefix = options.commandPrefix ?? '/openbox';
  const counts = projectionCounts(projection);
  return [
    `# ${title}`,
    '',
    'OpenBox Core/backend is the source of truth for guardrails, OPA/Rego policies, behavior rules, trust, approvals, cost, usage, and goal alignment.',
    '',
    'Use the OpenBox Claude Code plugin, MCP tools, or slash commands before advising or executing governed work:',
    '',
    `- \`${commandPrefix}-status\`: inspect backend, MCP, and plugin readiness.`,
    `- \`${commandPrefix}-check\`: send a proposed action to Core before execution.`,
    `- \`${commandPrefix}-pending\`: inspect HITL approvals and preserve source attribution.`,
    '',
    'Do not evaluate OPA/Rego, behavior-rule predicates, guardrail logic, or approval policy locally. Send complete spans and source-attributed inputs to OpenBox Core and enforce the returned verdict fail-closed.',
    '',
    'Projection summary:',
    '',
    `- Agent: \`${projection.agentId}\``,
    `- Fetched: \`${projection.fetchedAt}\``,
    `- Guardrails: ${counts.guardrail}`,
    `- Policies: ${counts.policy}`,
    `- Behavior rules: ${counts['behavior-rule']}`,
    '',
    ...renderClaudeRuleSection('Guardrails', rulesBySource(projection, 'guardrail')),
    ...renderClaudeRuleSection('Policies', rulesBySource(projection, 'policy')),
    ...renderClaudeRuleSection('Behavior Rules', rulesBySource(projection, 'behavior-rule')),
    '',
  ].join('\n');
}

export function renderCodexCommandRules(
  projection: RulesProjection,
  options: CodexCommandRulesRenderOptions = {},
): string {
  const entries = projection.rules
    .map(commandRuleFromProjection)
    .filter((entry): entry is { pattern: string[]; decision: string; justification: string } => Boolean(entry));
  const header =
    options.header ??
    'Generated by OpenBox. Only exact shell command-prefix execution policy is projected here; Core remains canonical for governance.';
  const lines = [`# ${header}`, ''];
  for (const entry of entries) {
    lines.push('prefix_rule(');
    lines.push(`    pattern = ${starlarkStringList(entry.pattern)},`);
    lines.push(`    decision = ${JSON.stringify(entry.decision)},`);
    lines.push(`    justification = ${JSON.stringify(entry.justification)},`);
    lines.push(')');
    lines.push('');
  }
  return lines.join('\n');
}

function projectionCounts(projection: RulesProjection): Record<ProjectedRule['source'], number> {
  return projection.rules.reduce<Record<ProjectedRule['source'], number>>(
    (acc, rule) => {
      acc[rule.source] += 1;
      return acc;
    },
    { guardrail: 0, policy: 0, 'behavior-rule': 0 },
  );
}

function rulesBySource(
  projection: RulesProjection,
  source: ProjectedRule['source'],
): ProjectedRule[] {
  return projection.rules.filter((rule) => rule.source === source);
}

function renderClaudeRuleSection(title: string, rules: ProjectedRule[]): string[] {
  const lines = [`## ${title}`, ''];
  if (rules.length === 0) {
    lines.push('- None projected.');
    return lines;
  }
  for (const rule of rules) {
    lines.push(`- [${rule.severity}] ${rule.description} (${rule.id})`);
    if (rule.trigger === 'globMatch' && rule.globs?.length) {
      lines.push(`  - Files: ${rule.globs.map((glob) => `\`${glob}\``).join(', ')}`);
    }
    lines.push(`  - Trigger: \`${rule.trigger}\``);
  }
  return lines;
}

function commandRuleFromProjection(
  rule: ProjectedRule,
): { pattern: string[]; decision: string; justification: string } | null {
  if (rule.source !== 'behavior-rule') return null;
  const hints = rule.rendererHints ?? {};
  const rawPrefix =
    hints.codexCommandPrefix ??
    hints.commandPrefix ??
    hints.exactShellPrefix;
  const pattern =
    Array.isArray(rawPrefix) && rawPrefix.every((part) => typeof part === 'string')
      ? rawPrefix as string[]
      : undefined;
  if (!pattern || pattern.length === 0) return null;
  return {
    pattern,
    decision: codexDecisionFor(rule.severity),
    justification: rule.description || rule.id,
  };
}

function codexDecisionFor(severity: RuleSeverity): 'allow' | 'prompt' | 'forbidden' {
  if (severity === 'block') return 'forbidden';
  if (severity === 'warn') return 'prompt';
  return 'allow';
}

function starlarkStringList(values: string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(', ')}]`;
}

function listFromEnvelope<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (!value || typeof value !== 'object') return [];
  const data = (value as { data?: unknown }).data;
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') {
    const nested = (data as { data?: unknown }).data;
    if (Array.isArray(nested)) return nested as T[];
  }
  return [];
}
