// Maps CLI command paths to the backend permissions required to execute them.
// Derived from the granular permission set defined in the-backend-service
// src/modules/**/decorators (`@Permissions(...)`). Any command listed here
// will be pre-flight-checked against the cached per-env permission list -
// if the current env's role lacks a required permission, the CLI errors
// locally with a clear message instead of firing a request and getting 403.

export type CommandKey = string;

export const COMMAND_PERMISSIONS: Record<CommandKey, string[]> = {
  // agent sub-resources - granular permission set added in backend PR #237.
  'guardrail list':         ['read:agent_guardrail'],
  'guardrail get':          ['read:agent_guardrail'],
  'guardrail create':       ['create:agent_guardrail'],
  'guardrail update':       ['update:agent_guardrail'],
  'guardrail delete':       ['delete:agent_guardrail'],
  'guardrail reorder':      ['update:agent_guardrail'],
  'guardrail metrics':      ['read:agent_guardrail'],
  'guardrail violations':   ['read:agent_guardrail'],
  'guardrail test':         ['read:agent_guardrail'],

  'policy list':            ['read:agent_policy'],
  'policy get':             ['read:agent_policy'],
  'policy current':         ['read:agent_policy'],
  'policy create':          ['create:agent_policy'],
  'policy update':          ['update:agent_policy'],
  'policy evaluate':        ['read:agent_policy'],
  'policy evaluations':     ['read:agent_policy'],
  'policy metrics':         ['read:agent_policy'],

  'behavior list':          ['read:agent_behavior_rule'],
  'behavior get':           ['read:agent_behavior_rule'],
  'behavior current':       ['read:agent_behavior_rule'],
  'behavior create':        ['create:agent_behavior_rule'],
  'behavior update':        ['update:agent_behavior_rule'],
  'behavior delete':        ['delete:agent_behavior_rule'],
  'behavior toggle':        ['update:agent_behavior_rule'],
  'behavior semantic-types':['read:agent_behavior_rule'],
  'behavior metrics':       ['read:agent_behavior_rule'],
  'behavior violations':    ['read:agent_behavior_rule'],

  'session list':           ['read:agent_session'],
  'session active':         ['read:agent_session'],
  'session get':            ['read:agent_session'],
  'session logs':           ['read:agent_session'],
  'session goal-alignment': ['read:agent_session'],
  'session reasoning':      ['read:agent_session'],
  'session terminate':      ['manage:agent_session'],
  'session inspect':        ['read:agent_session'],
  'session prune':          ['read:agent_session', 'manage:agent_session'],

  'agent audit':            ['read:agent', 'read:agent_session', 'read:agent_guardrail', 'read:agent_policy'],

  'observe logs':           ['read:agent_log'],
  'observe drift':          ['read:agent_log'],
  'observe issues':         ['read:agent_log'],
  'observe metrics':        ['read:agent_log'],
  'observe insights':       ['read:agent_log'],
  'observe agent-metrics':  ['read:agent_log'],
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
