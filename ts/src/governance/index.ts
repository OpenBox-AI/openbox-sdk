// Public sub-path: `@openbox-ai/openbox-sdk/governance`.
//
// Cross-cutting governance primitives that any SDK consumer can
// reuse:
//
//   * `checkGovernance` runs an in-process evaluation against the
//     core endpoint. Suitable for gates, ad-hoc audits, and tests.
//   * `buildSpan` constructs a classifier-ready span with the
//     `semantic_type` and gate attributes the policy engine needs
//     to match behavior rules.
//   * `EVENT` enumerates the canonical workflow event names
//     (`ActivityStarted`, `ActivityCompleted`, `SignalReceived`).
//   * `REDACT_PATH_CONTENT_PATTERNS`, `shouldRedactPathContent`, and
//     `isInsideAnyRoot` identify IDE metadata / secret paths whose raw
//     content should stay out of governance payloads.
//   * `fetchRulesProjection` returns a Cursor-compatible projection
//     of an agent's behavior rules.
//   * `hookEventLabel` / `HOOK_EVENT_LABELS` map hook event names to
//     human-readable display strings.
//   * `PROVIDER_CAPABILITY_MATRIX` records provider parity tiers and
//     intentional exclusions so unsupported surfaces are explicit.

export {
  checkGovernance,
  type CheckGovernanceOptions,
  type SpanType,
} from './check.js';
export {
  buildLLMCompletionResponseBody,
  buildLLMCompletionSpan,
  buildSpan,
  llmTokenUsageFromRecord,
  openBoxActivityMetadata,
  withOpenBoxActivityMetadata,
  withOpenBoxSubagentActivityMetadata,
  type LLMCompletionSpanInput,
  type OpenBoxActivityMetadataInput,
  type SpanInput,
} from './spans.js';
export {
  assistantOutputTelemetryFields,
  buildAssistantOutputSpan,
  type AssistantOutputTelemetryInput,
} from './assistant-output.js';
export {
  combineOpenBoxUsage,
  normalizeOpenBoxUsage,
  openBoxUsageTelemetryFields,
  type NormalizedOpenBoxUsage,
} from './usage.js';
export { EVENT } from './events.js';
export {
  REDACT_PATH_CONTENT_PATTERNS,
  shouldRedactPathContent,
  isSensitivePath,
  isInsideAnyRoot,
} from './skip-patterns.js';
export {
  fetchRulesProjection,
  renderClaudeInstructionsMarkdown,
  renderCodexAgentsMarkdown,
  renderCodexCommandRules,
  type ProjectedRule,
  type RulesProjection,
  type RuleTrigger,
  type RuleSeverity,
  type FetchProjectionOpts,
  type ClaudeInstructionsRenderOptions,
  type CodexInstructionRenderOptions,
  type CodexCommandRulesRenderOptions,
} from './rules-projection.js';
export {
  OPENBOX_CAPABILITY_IDS,
  PROVIDER_CAPABILITY_MATRIX,
  PROVIDER_EVENT_CATALOG,
  PROVIDER_PLUGIN_COMPONENTS,
  PUBLIC_INTEGRATION_SUPPORT,
  MCP_PROMPT_SURFACES,
  MCP_RESOURCE_TEMPLATE_SURFACES,
  MCP_SKILL_REFERENCE_SURFACES,
  MCP_TOOL_SURFACES,
  N8N_INTEGRATION_SURFACE,
  USAGE_NORMALIZATION_SURFACE,
  type OpenBoxCapabilityId,
  type OpenBoxProviderId,
  type OpenBoxSupportTier,
  type McpPromptSurfaceEntry,
  type McpResourceTemplateSurfaceEntry,
  type McpSkillReferenceSurfaceEntry,
  type McpToolSurfaceEntry,
  type N8nIntegrationSurface,
  type ProviderCapabilityEntry,
  type ProviderEventCatalogEntry,
  type ProviderPluginComponentCatalogEntry,
  type PublicIntegrationSupportEntry,
  type UsageNormalizationSurface,
} from './capability-matrix.js';
export { hookEventLabel, HOOK_EVENT_LABELS } from './hook-event-labels.js';
