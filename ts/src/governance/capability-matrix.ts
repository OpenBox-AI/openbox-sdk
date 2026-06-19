// Public wrapper for the spec-generated provider capability matrix.
// Canonical data lives in specs/typespec/govern/capabilities.tsp and
// is emitted by `npm run specs:compile`.

export {
  OPENBOX_CAPABILITY_IDS,
  OPENBOX_PROVIDER_IDS,
  OPENBOX_SUPPORT_TIERS,
  PROVIDER_CAPABILITY_MATRIX,
  PROVIDER_EVENT_CATALOG,
  PROVIDER_PLUGIN_COMPONENTS,
  PUBLIC_INTEGRATION_SUPPORT,
  GOAL_SIGNAL_GUARDS,
  USAGE_COST_CAPABILITY_GUARDS,
  HITL_CAPABILITY_GUARDS,
  GUARDRAIL_CAPABILITY_GUARDS,
  POLICY_EVALUATION_GUARDS,
  MCP_TOOL_SURFACES,
  MCP_PROMPT_SURFACES,
  MCP_RESOURCE_TEMPLATE_SURFACES,
  N8N_INTEGRATION_SURFACE,
} from './generated/capability-matrix.js';
export type {
  OpenBoxCapabilityId,
  OpenBoxProviderId,
  OpenBoxSupportTier,
  GoalSignalGuardEntry,
  UsageCostCapabilityGuardEntry,
  HitlCapabilityGuardEntry,
  GuardrailCapabilityGuardEntry,
  PolicyEvaluationGuardEntry,
  McpPromptSurfaceEntry,
  McpResourceTemplateSurfaceEntry,
  McpToolSurfaceEntry,
  N8nIntegrationSurface,
  ProviderCapabilityEntry,
  ProviderEventCatalogEntry,
  ProviderPluginComponentCatalogEntry,
  PublicIntegrationSupportEntry,
} from './generated/capability-matrix.js';
