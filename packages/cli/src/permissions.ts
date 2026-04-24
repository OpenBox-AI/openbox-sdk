// Maps CLI command paths to the backend permissions required to execute them.
// Derived from the granular permission set defined in the-backend-service
// src/modules/**/decorators (`@Permissions(...)`). Any command listed here
// will be pre-flight-checked against the cached per-env permission list -
// if the current env's role lacks a required permission, the CLI errors
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
  // 'guardrail test' endpoint has no @Permissions() on the backend - not gated here.

  // Policies
  'policy list':            ['read:agent_policy'],
  'policy get':             ['read:agent_policy'],
  'policy current':         ['read:agent_policy'],
  'policy create':          ['create:agent_policy'],
  'policy update':          ['update:agent_policy'],
  'policy evaluations':     ['read:agent_policy'],
  'policy metrics':         ['read:agent_policy'],
  // 'policy evaluate' endpoint has no @Permissions() on the backend - not gated here.

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

  // Sessions - note `session logs` hits a DIFFERENT endpoint requiring read:agent_log.
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

  // Observability - most endpoints gate on read:agent, not read:agent_log.
  'observe data':           ['read:agent'],
  'observe issues':         ['read:agent'],
  'observe metrics':        ['read:agent'],
  'observe insights':       ['read:agent'],
  'observe logs':           ['read:agent_log'],
  'observe drift':          ['read:agent_log'],

  // ─── Entries below are pattern-matched to the existing namespace convention
  // (read:agent_* / manage:agent_* / update:agent_* / read:team / manage:member).
  // Cross-check against the backend `@Permissions(...)` decorators on first
  // release - if any string is off, the pre-flight will produce a spurious
  // "you lack X" error against a correctly-granted role. Worst-case it's
  // self-correcting: remove the wrong entry when a user reports the false
  // positive, and the backend's real 403 will list the actual needed perm.

  // AIVSS - agent risk assessment
  'aivss assessments':      ['read:agent_assessment'],
  'aivss calculate':        ['read:agent_assessment'],
  'aivss recalculate':      ['manage:agent_assessment'],
  'aivss update':           ['update:agent_assessment'],

  // Approvals - per-agent HITL queue
  'approval decide':        ['manage:agent_approval'],
  'approval history':       ['read:agent_approval'],
  'approval metrics':       ['read:agent_approval'],
  'approval pending':       ['read:agent_approval'],

  // Goal alignment
  'goal drifts':            ['read:agent_goal_alignment'],
  'goal trend':             ['read:agent_goal_alignment'],
  'goal update':            ['update:agent_goal_alignment'],

  // Trust tier / history (per-agent, read-mostly)
  'trust events':           ['read:agent_trust'],
  'trust histories':        ['read:agent_trust'],
  'trust recovery':         ['read:agent_trust'],
  'trust tier-changes':     ['read:agent_trust'],

  // Violations (per-agent read + mark-false-positive admin op)
  'violation agent':        ['read:agent_violation'],
  'violation false-positive': ['manage:agent_violation'],
  'violation list':         ['read:agent_violation'],

  // Teams (org-scoped - `team` resource, not `agent_team`)
  'team get':               ['read:team'],
  'team list':              ['read:team'],
  'team stats':             ['read:team'],
  'team members':           ['read:team'],
  'team update':            ['update:team'],
  'team create':            ['create:team'],
  'team delete':            ['delete:team'],
  'team add-members':       ['manage:team'],
  'team remove-members':    ['manage:team'],

  // Members (org users)
  'member list':            ['read:member'],
  'member create':          ['create:member'],
  'member invite':          ['create:member'],
  'member update':          ['update:member'],
  'member remove':          ['delete:member'],
  'member assign-roles':    ['manage:member'],
  'member remove-roles':    ['manage:member'],
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
 * Maps CLI command paths to the backend feature flags they need. Matches
 * `@RequireFeature(Feature.*)` decorators in the-backend-service:
 *   - Feature.ApiKeys -> api_keys
 *   - Feature.Webhooks -> webhooks
 *   - Feature.Sso -> sso
 *
 * Each env's `FEATURES` cache (populated at login from
 * `GET /organization/{orgId}/features`) decides which commands the CLI
 * will even attempt to fire. Feature-disabled commands fail locally with
 * a clear "feature disabled on this env" message.
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
