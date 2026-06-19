// Editor-agnostic rules projection. Fetches an agent's live guardrails,
// policies, and behavior rules and normalizes them into the `ProjectedRule` shape
// declared in specs/typespec/govern/rules-projection.tsp.
//
// The projection output shape is hand-mirrored from the TypeSpec model.
// Backend behavior-rule inputs use generated types so v2 state predicates
// stay aligned with the API contract.
import { createApi } from '../runtime/mcp/config.js';
import type { components } from '../types/generated/backend.js';

export type RuleTrigger = 'always' | 'globMatch' | 'agentRequested' | 'manual';
export type RuleSeverity = 'block' | 'warn' | 'info';

export interface ProjectedRule {
  id: string;
  source: 'guardrail' | 'policy' | 'behavior-rule';
  description: string;
  body: string;
  trigger: RuleTrigger;
  severity: RuleSeverity;
  globs?: string[];
  rendererHints?: Record<string, unknown>;
}

export interface RulesProjection {
  agentId: string;
  fetchedAt: string;
  version: number;
  rules: ProjectedRule[];
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
      triggerMatch: rule.trigger_match,
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
  if (rule.trigger_match && rule.trigger_match.length > 0) {
    lines.push(`Trigger match: ${renderMatchConditions(rule.trigger_match)}`);
  }
  if (rule.states && rule.states.length > 0) {
    lines.push(`States: ${rule.states.map(renderBehaviorState).join(', ')}`);
  }
  if (typeof rule.verdict === 'number') lines.push(`Verdict: ${rule.verdict}`);
  if (rule.reject_message) lines.push('', `Reject message: ${rule.reject_message}`);
  return lines.join('\n');
}

function renderBehaviorState(state: BehaviorRuleState): string {
  if (typeof state === 'string') return `\`${state}\``;
  const semanticType = state.semantic_type;
  const match =
    state.match && state.match.length > 0
      ? ` where ${renderMatchConditions(state.match)}`
      : '';
  return `\`${semanticType}\`${match}`;
}

function renderMatchConditions(
  conditions: components['schemas']['BehaviorRuleMatchCondition'][],
): string {
  return conditions
    .map((condition) => {
      const value =
        condition.value === undefined ? '' : ` ${JSON.stringify(condition.value)}`;
      return `\`${condition.field} ${condition.op}${value}\``;
    })
    .join(', ');
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
