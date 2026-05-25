// Maps CLI command paths to the backend permissions required to execute them.
// Mirrors the granular permission set the backend declares via
// `@Permissions(...)` decorators on its controllers. Any command listed
// here is pre-flight-checked against the cached permission list:
// if the current role lacks a required permission, the CLI errors
// locally with a clear message instead of firing a request and getting 403.

export type CommandKey = string;

export const COMMAND_PERMISSIONS: Record<CommandKey, string[]> = {
  // Guardrails
  'guardrail list':         ['read:agent_guardrail'],
  'guardrail get':          ['read:agent_guardrail'],
  'guardrail create':       ['create:agent_guardrail'],
  'guardrail update':       ['update:agent_guardrail'],
  'guardrail delete':       ['delete:agent_guardrail'],
  'guardrail reorder':      ['update:agent_guardrail'],
  'guardrail metrics':      ['read:agent_guardrail'],
  'guardrail violations':   ['read:agent_guardrail'],
  // 'guardrail test' endpoint has no @Permissions() on the backend; not gated here.

  // Policies
  'policy list':            ['read:agent_policy'],
  'policy get':             ['read:agent_policy'],
  'policy current':         ['read:agent_policy'],
  'policy create':          ['create:agent_policy'],
  'policy update':          ['update:agent_policy'],
  'policy evaluations':     ['read:agent_policy'],
  'policy metrics':         ['read:agent_policy'],
  // 'policy evaluate' endpoint has no @Permissions() on the backend; not gated here.

  // Behavior rules
  'behavior list':          ['read:agent_behavior_rule'],
  'behavior get':           ['read:agent_behavior_rule'],
  'behavior current':       ['read:agent_behavior_rule'],
  'behavior create':        ['create:agent_behavior_rule'],
  'behavior update':        ['update:agent_behavior_rule'],
  'behavior delete':        ['delete:agent_behavior_rule'],
  'behavior toggle':        ['update:agent_behavior_rule'],
  'behavior restore':       ['update:agent_behavior_rule'],
  'behavior versions':      ['read:agent_behavior_rule'],
  'behavior types':         ['read:agent_behavior_rule'],
  'behavior metrics':       ['read:agent_behavior_rule'],
  'behavior violations':    ['read:agent_behavior_rule'],

  // Sessions; note `session logs` hits a DIFFERENT endpoint requiring read:agent_log.
  'session list':           ['read:agent_session'],
  'session active':         ['read:agent_session'],
  'session get':            ['read:agent_session'],
  'session logs':           ['read:agent_log'],
  'session goal-stats':     ['read:agent_session'],
  'session trace':          ['read:agent_session'],
  'session terminate':      ['manage:agent_session'],
  'session inspect':        ['read:agent_session', 'read:agent_log'],
  'session prune':          ['read:agent_session', 'manage:agent_session'],

  // Agent cross-session scan uses session + logs + guardrails + behavior rules + policies.
  'agent audit':            ['read:agent', 'read:agent_session', 'read:agent_log', 'read:agent_guardrail', 'read:agent_policy', 'read:agent_behavior_rule'],

  // API keys (rotate/revoke hit agent-controller endpoints, gated by update:agent).
  'api-key rotate':         ['update:agent'],
  'api-key revoke':         ['update:agent'],

  // Observability; most endpoints gate on read:agent, not read:agent_log.
  'observe data':           ['read:agent'],
  'observe issues':         ['read:agent'],
  'observe metrics':        ['read:agent'],
  'observe insights':       ['read:agent'],
  'observe logs':           ['read:agent_log'],
  'observe drift':          ['read:agent_log'],

  // ─── Entries below mirror the live `@Permissions(...)` decorators
  // on the backend controllers. The backend uses a coarse-grained
  // scheme: most agent sub-resources such as aivss, trust, goal,
  // approvals, and violations gate on the generic `read:agent` or
  // `update:agent` rather than fine-grained scopes. Members use the
  // `user` resource, not `member`.
  //
  // Two endpoints that look like they should be gated but are not.
  // The backend declares no permission, so no entry here:
  //   - POST /agent/aivss                                      aivss calculate; pure calculator.
  //   - PATCH /agent/:id/violations/:vid/false-positive

  // AIVSS; agent risk assessment
  'aivss assessments':      ['read:agent'],
  'aivss recalculate':      ['update:agent'],
  'aivss update':           ['update:agent'],

  // Approvals; per-agent HITL queue. All four read with `read:agent`,
  // including `decide` (backend gates the decide endpoint on ReadAgent too).
  'approval decide':        ['read:agent'],
  'approval history':       ['read:agent'],
  'approval metrics':       ['read:agent'],
  'approval pending':       ['read:agent'],

  // Goal alignment
  'goal drifts':            ['read:agent'],
  'goal trend':             ['read:agent'],
  'goal update':            ['update:agent'],

  // Trust tier / history (per-agent, read-mostly)
  'trust events':           ['read:agent'],
  'trust histories':        ['read:agent'],
  'trust recovery':         ['read:agent'],
  'trust tier-changes':     ['read:agent'],

  // Violations
  'violation agent':        ['read:agent'],
  'violation list':         ['read:agent'],

  // Teams (org-scoped). Backend uses UpdateTeam for member add/remove, not a
  // separate manage:team permission.
  'team get':               ['read:team'],
  'team list':              ['read:team'],
  'team stats':             ['read:team'],
  'team members':           ['read:team'],
  'team update':            ['update:team'],
  'team create':            ['create:team'],
  'team delete':            ['delete:team'],
  'team add-members':       ['update:team'],
  'team remove-members':    ['update:team'],

  // Members; backend uses the `user` resource (read:user / create:user /
  // update:user / delete:user). There is no `member` permission scope.
  'member list':            ['read:user'],
  'member create':          ['create:user'],
  'member invite':          ['create:user'],
  'member update':          ['update:user'],
  'member remove':          ['delete:user'],
  'member assign-roles':    ['update:user'],
  'member remove-roles':    ['update:user'],
};

/**
 * Returns the missing permissions (from the required list) given the
 * user's cached permission set on a given env. Empty array means "allowed".
 */
export function missingPermissions(required: string[], have: string[]): string[] {
  if (required.length === 0) return [];
  const haveSet = new Set(have);
  return required.filter((p) => !haveSet.has(p));
}

/**
 * Maps CLI command paths to the backend feature flags they need.
 * Matches the live `@RequireFeature(Feature.*)` decorators:
 *   - Feature.ApiKeys  → api_keys
 *   - Feature.Webhooks → webhooks
 *   - Feature.Sso      → sso
 *
 * Each env's `FEATURES` cache, populated at login from
 * `GET /organization/{orgId}/features`, decides which commands the
 * CLI will even attempt to fire. Feature-disabled commands fail
 * locally with a clear "feature disabled on this env" message.
 */
export const COMMAND_FEATURES: Record<CommandKey, string[]> = {
  // Placeholders: add entries here once CLI commands for api-key / webhook /
  // sso groups exist. Populating the map is a no-op until then since
  // feature-gated endpoints aren't in the current CLI surface.
};

export function missingFeatures(
  required: string[],
  have: Record<string, boolean>,
): string[] {
  if (required.length === 0) return [];
  return required.filter((f) => have[f] !== true);
}
