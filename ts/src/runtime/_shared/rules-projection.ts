// Editor-agnostic rules projection. Fetches an agent's live guardrails
// and policies and normalizes them into the `ProjectedRule` shape
// declared in specs/typespec/govern/rules-projection.tsp.
//
// The shape is hand-mirrored from the TypeSpec model rather than
// generated; once codegen lights it up, switch the imports to
// generated types and delete the duplication. Until then, treat this
// file as the source of truth for what the spec says.
import { createApi } from '../mcp/config.js';

export type RuleTrigger = 'always' | 'globMatch' | 'agentRequested' | 'manual';
export type RuleSeverity = 'block' | 'warn' | 'info';

export interface ProjectedRule {
  id: string;
  source: 'guardrail' | 'policy';
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

export interface FetchProjectionOpts {
  agentId: string;
  envName?: string;
  tokensPath?: string;
}

export async function fetchRulesProjection(opts: FetchProjectionOpts): Promise<RulesProjection> {
  const api = createApi({ envName: opts.envName, tokensPath: opts.tokensPath });
  const [guardrails, policies] = await Promise.all([
    api(`/agent/${opts.agentId}/guardrails?page=0&perPage=200`),
    api(`/agent/${opts.agentId}/policies?page=0&perPage=200`),
  ]);

  const grList: BackendGuardrail[] = Array.isArray(guardrails)
    ? guardrails
    : guardrails?.data ?? [];
  const polList: BackendPolicy[] = Array.isArray(policies)
    ? policies
    : policies?.data ?? [];

  const rules: ProjectedRule[] = [];
  for (const g of grList) {
    const r = projectGuardrail(g);
    if (r) rules.push(r);
  }
  for (const p of polList) {
    const r = projectPolicy(p);
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
