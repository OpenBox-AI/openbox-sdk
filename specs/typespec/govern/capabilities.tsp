// specs/typespec/govern/capabilities.tsp; canonical provider/workflow
// parity declarations.
//
// This file is deliberately data-heavy: it is the cross-language source
// of truth for support tiers, event drift guards, plugin/install
// components, and public SDK integration surfaces. Runtime adapters
// render or enforce this data; they do not re-author it per language.

import "typespec-workflow";

using OpenBox.Workflow;

namespace OpenboxGovern.Capabilities {
  enum OpenBoxSupportTier {
    native,
    wrapped,
    `observe-only`,
    `diagnose-only`,
    `out-of-scope`,
  }

  enum OpenBoxProviderId {
    codex,
    cursor,
    `claude-code`,
    mcp,
    `openai-agents-sdk`,
    `anthropic-agent-sdk`,
    copilotkit,
    n8n,
  }

  enum OpenBoxCapabilityId {
    hooks,
    plugins,
    skills,
    mcp,
    `rules-instructions`,
    `subagents-agents`,
    `approvals-hitl`,
    `usage-cost`,
    guardrails,
    `behavior-rules`,
    `opa-rules`,
    `goal-signals`,
    tracing,
    `install-doctor`,
  }

  enum LocalStackScenarioCategoryId {
    `approvals-hitl`,
    behavioral,
    `goal-drift`,
    guardrails,
    opa,
    tracing,
    `usage-cost`,
    workflow,
  }

  enum LocalStackScenarioAxisId {
    cost,
    dbquery,
    failure,
    goal,
    guardrails,
    happy,
    matrix,
    opa,
    order,
    tool,
    usage,
  }

  enum LocalStackProofLevel {
    none,
    smoke,
    `negative-path`,
    behavioral,
    conformance,
  }

  enum LocalStackOutcomeSource {
    `local-stack-e2e`,
    `provider-guard-fixture`,
  }

  enum SdkSemanticGapClosureTarget {
    typescript,
    python,
  }

  model ProviderCapabilityEntry {
    provider: OpenBoxProviderId;
    capability: OpenBoxCapabilityId;
    tier: OpenBoxSupportTier;
    rationale: string;
  }

  enum ReferenceProviderParityClosureStatus {
    `implemented-through-wrapper`,
    `host-owned-observe-only`,
    `runtime-diagnostic-only`,
    `host-unsupported`,
  }

  model ReferenceProviderParityClosureEntry {
    provider: OpenBoxProviderId;
    capability: OpenBoxCapabilityId;
    tier: OpenBoxSupportTier;
    status: ReferenceProviderParityClosureStatus;
    referenceSurface: string;
    openboxSurface: string;
    closureDecision: string;
    guardTest: string;
  }

  enum ReferenceProviderRuntimePromotionDecision {
    `implemented-runtime-diagnostic`,
    `max-through-wrapper`,
    `retain-host-owned-boundary`,
    `retain-protocol-boundary`,
    `retain-package-boundary`,
  }

  model ReferenceProviderRuntimeAuditEntry {
    provider: OpenBoxProviderId;
    capability: OpenBoxCapabilityId;
    tier: OpenBoxSupportTier;
    status: ReferenceProviderParityClosureStatus;
    promotionDecision: ReferenceProviderRuntimePromotionDecision;
    runtimeEvidence: string;
    technicalBoundary: string;
    guardTest: string;
  }

  model ProviderEventCatalogEntry {
    provider: OpenBoxProviderId;
    upstreamKnownEvents: string[];
    generatedAdapterEvents: string[];
    intentionalExclusions: Record<unknown>[];
  }

  model ProviderPluginComponentCatalogEntry {
    provider: OpenBoxProviderId;
    components: Record<unknown>[];
  }

  model PublicIntegrationSupportEntry {
    integration: OpenBoxProviderId;
    tier: OpenBoxSupportTier;
    packageSubpath: string;
    exports: string[];
    notes: string;
  }

  model GoalSignalGuardEntry {
    provider: OpenBoxProviderId;
    tier: OpenBoxSupportTier;
    entrySurface: string;
    signalActivity: string;
    firstGovernedSurface: string;
    guardTest: string;
    orderGuarantee: string;
  }

  model UsageCostCapabilityGuardEntry {
    provider: OpenBoxProviderId;
    tier: OpenBoxSupportTier;
    usageSurface: string;
    normalizedFields: string;
    sharedNormalizer: string;
    costPolicyBoundary: string;
    guardTest: string;
  }

  model UsageNormalizationSurface {
    minimumValue: float64;
    tokenValuesRequireIntegers: boolean;
    canonicalFields: string[];
    inputTokenAliases: string[];
    outputTokenAliases: string[];
    totalTokenAliases: string[];
    cacheReadInputTokenAliases: string[];
    cacheCreationInputTokenAliases: string[];
    webSearchRequestAliases: string[];
    costUsdAliases: string[];
    providerUsageContainers: string[];
    providerModelFields: string[];
    providerFinishReasonFields: string[];
    policyBoundary: string;
  }

  model TracingCapabilityGuardEntry {
    provider: OpenBoxProviderId;
    tier: OpenBoxSupportTier;
    traceSurface: string;
    spanCoverage: string;
    spanEmission: string;
    sourceAttribution: string;
    guardTest: string;
  }

  model HitlCapabilityGuardEntry {
    provider: OpenBoxProviderId;
    tier: OpenBoxSupportTier;
    requireApprovalSurface: string;
    sourceAttribution: string;
    nativeSurface: string;
    fallbackSurface: string;
    guardTest: string;
    failClosedBehavior: string;
  }

  model GuardrailCapabilityGuardEntry {
    provider: OpenBoxProviderId;
    tier: OpenBoxSupportTier;
    governedSurfaces: string;
    coreContract: string;
    redactionBehavior: string;
    failClosedBehavior: string;
    guardTest: string;
  }

  model PolicyEvaluationGuardEntry {
    provider: OpenBoxProviderId;
    tier: OpenBoxSupportTier;
    authority: string;
    sdkResponsibility: string;
    allowedLocalWork: string;
    forbiddenLocalWork: string;
    guardTest: string;
  }

  model RulesInstructionCapabilityGuardEntry {
    provider: OpenBoxProviderId;
    tier: OpenBoxSupportTier;
    projectionSurface: string;
    sourceOfTruth: string;
    allowedProjectionWork: string;
    forbiddenLocalWork: string;
    hostBoundary: string;
    guardTest: string;
  }

  model HookCapabilityGuardEntry {
    provider: OpenBoxProviderId;
    tier: OpenBoxSupportTier;
    hookSurface: string;
    eventCoverage: string;
    enforcementBoundary: string;
    fallbackOrOutOfScope: string;
    guardTest: string;
  }

  model SubagentsAgentsCapabilityGuardEntry {
    provider: OpenBoxProviderId;
    tier: OpenBoxSupportTier;
    agentSurface: string;
    lifecycleCoverage: string;
    ownershipBoundary: string;
    guardTest: string;
  }

  model PluginCapabilityGuardEntry {
    provider: OpenBoxProviderId;
    tier: OpenBoxSupportTier;
    packageSurface: string;
    componentCoverage: string;
    installSurface: string;
    scopeBoundary: string;
    guardTest: string;
  }

  model SkillCapabilityGuardEntry {
    provider: OpenBoxProviderId;
    tier: OpenBoxSupportTier;
    skillSurface: string;
    installSurface: string;
    discoverySurface: string;
    hostBoundary: string;
    guardTest: string;
  }

  model McpCapabilityGuardEntry {
    provider: OpenBoxProviderId;
    tier: OpenBoxSupportTier;
    serverSurface: string;
    configSurface: string;
    toolResourcePromptCoverage: string;
    hostBoundary: string;
    guardTest: string;
  }

  model InstallDoctorCapabilityGuardEntry {
    provider: OpenBoxProviderId;
    tier: OpenBoxSupportTier;
    installSurface: string;
    doctorSurface: string;
    scopeBoundary: string;
    generatedOrPackagedSurface: string;
    guardTest: string;
  }

  model LocalStackScenarioPathSpec {
    id: string;
    category: LocalStackScenarioCategoryId;
    capability: OpenBoxCapabilityId;
    label: string;
    axes: LocalStackScenarioAxisId[];
    requiredProofLevel: LocalStackProofLevel;
    localStackRequired: boolean;
    operationIds: string[];
    evidencePatterns: string[];
    operationEvidencePatterns?: LocalStackOperationEvidenceSpec[];
    requiredBehavior: string;
  }

  model LocalStackOperationEvidenceSpec {
    operationId: string;
    evidencePatterns: string[];
  }

  model LocalStackCategoryAxisSpec {
    category: LocalStackScenarioCategoryId;
    axes: LocalStackScenarioAxisId[];
  }

  model LocalStackOutcomeSpec {
    id: string;
    label: string;
    source: LocalStackOutcomeSource;
    minimumProofLevel: LocalStackProofLevel;
    operationIds: string[];
    providerGuardCapabilities: string[];
    exceptionCapabilities: string[];
  }

  model LocalStackScenarioMatrixContract {
    id: string;
    description: string;
    requiredCapabilities: OpenBoxCapabilityId[];
    requiredCategories: LocalStackScenarioCategoryId[];
    requiredAxes: LocalStackScenarioAxisId[];
    requiredLocalStackAxes: LocalStackScenarioAxisId[];
    requiredCategoryAxes: LocalStackCategoryAxisSpec[];
    localStackScenarioIds: string[];
    providerOwnedScenarioIds: string[];
    requiredOutcomeIds: string[];
    requiredOutcomeSpecs: LocalStackOutcomeSpec[];
    requiredSharedProviderGuardProofCapabilities: OpenBoxCapabilityId[];
    requiredSdkSemanticGapClosureTargets: SdkSemanticGapClosureTarget[];
    providerGuardSharedProofPolicy: string;
    localStackAxisPolicy: string;
    rawSemanticGapPolicy: string;
    backendCoreGapStatusPolicy: string;
    backendCoreGapRemediationPolicy: string;
  }

  model McpToolSurfaceEntry {
    name: string;
    title: string;
    risk: string;
    approval: string;
    sideEffects: string;
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  }

  model McpPromptArgEntry {
    name: string;
    description: string;
    required: boolean;
  }

  model McpPromptSurfaceEntry {
    name: string;
    title: string;
    description: string;
    args: McpPromptArgEntry[];
    instructions: string;
  }

  model McpResourceTemplateSurfaceEntry {
    name: string;
    title: string;
    uriTemplate: string;
    description: string;
    mimeType: string;
  }

  model McpSkillReferenceSurfaceEntry {
    name: string;
    path: string;
    description: string;
  }

  model N8nWorkflowEdgeSpec {
    from: string;
    to: string;
  }

  model N8nCheckpointGateSpec {
    checkpoint: string;
    gate: string;
    pass: string;
    fail: string;
  }

  model N8nWorkflowNodeIdentitySpec {
    name: string;
    id: string;
    type: string;
  }

  model N8nNodeBooleanFlagSpec {
    node: string;
    flag: string;
    expected: boolean;
  }

  model N8nExpressionSourceCheckSpec {
    node: string;
    requiredContains: string[];
    forbiddenContains: string[];
  }

  model N8nNodeParameterCheckSpec {
    nodeType: string;
    parameter: string;
    requiredContains: string[];
    forbiddenContains: string[];
    forbiddenValues: string[];
  }

  model N8nShowcaseWorkflowSpec {
    name: string;
    id: string;
    path: string;
    description: string;
    requiredOpenBoxNodeIds: string[];
    requiredOpenBoxNodeTypes: string[];
    requiredTriggerTypes: string[];
    requiredCheckpoints: string[];
    requiredTerminalNodes: string[];
    requiredEntryEdges: N8nWorkflowEdgeSpec[];
    checkpointGates: N8nCheckpointGateSpec[];
    requiredNodeIdentities: N8nWorkflowNodeIdentitySpec[];
    requiredNodeBooleanFlags: N8nNodeBooleanFlagSpec[];
    expressionSourceChecks: N8nExpressionSourceCheckSpec[];
    requiredOpenBoxNodeParameterChecks: N8nNodeParameterCheckSpec[];
    approvalStages: string[];
    requiredApprovalActionIds: string[];
    requiredPathLogSteps: string[];
    requiredTerminalEventTypes: string[];
    allowedCredentialPlaceholders: string[];
    forbiddenWorkflowText: string[];
    forbiddenWorkflowRegexes: string[];
    terminalLogTable: string;
  }

  model N8nIntegrationSurface {
    packageManifest: Record<unknown>;
    credentials: Record<unknown>[];
    nodes: Record<unknown>[];
    workflowTemplates: Record<unknown>[];
    examples: Record<unknown>[];
    showcaseWorkflows: N8nShowcaseWorkflowSpec[];
  }
}

@providerCapabilities(#{
  capabilityIds: #[
    "hooks",
    "plugins",
    "skills",
    "mcp",
    "rules-instructions",
    "subagents-agents",
    "approvals-hitl",
    "usage-cost",
    "guardrails",
    "behavior-rules",
    "opa-rules",
    "goal-signals",
    "tracing",
    "install-doctor",
  ],
  providers: #[
    "codex",
    "cursor",
    "claude-code",
    "mcp",
    "openai-agents-sdk",
    "anthropic-agent-sdk",
    "copilotkit",
    "n8n",
  ],
  capabilities: #[
    #{ provider: "codex", capability: "hooks", tier: "native", rationale: "Codex hook JSON invokes the OpenBox Codex hook handler." },
    #{ provider: "codex", capability: "plugins", tier: "native", rationale: "OpenBox exports a Codex plugin bundle with manifest, hooks, skill, MCP config, and marketplace metadata." },
    #{ provider: "codex", capability: "skills", tier: "native", rationale: "The OpenBox skill installs under both repo skills and plugin skills." },
    #{ provider: "codex", capability: "mcp", tier: "native", rationale: "Codex uses trusted project config.toml or plugin-bundled MCP configuration." },
    #{ provider: "codex", capability: "rules-instructions", tier: "wrapped", rationale: "Governance instructions render to AGENTS.md/skills; command-prefix execution policy renders to .codex/rules only when exact prefixes exist." },
    #{ provider: "codex", capability: "subagents-agents", tier: "observe-only", rationale: "Codex agent/task tool calls emit governance spans but OpenBox does not own Codex subagent orchestration." },
    #{ provider: "codex", capability: "approvals-hitl", tier: "native", rationale: "PermissionRequest and require_approval verdicts fail closed through Core-owned approval state." },
    #{ provider: "codex", capability: "usage-cost", tier: "observe-only", rationale: "Codex usage is recorded when hook envelopes expose it; Core remains canonical for cost policy." },
    #{ provider: "codex", capability: "guardrails", tier: "native", rationale: "Prompt/tool/output spans are sent to Core guardrails and returned transforms are enforced." },
    #{ provider: "codex", capability: "opa-rules", tier: "native", rationale: "OPA/Rego and behavior-rule evaluation remain backend-owned." },
    #{ provider: "codex", capability: "behavior-rules", tier: "native", rationale: "Behavior-rule triggers are evaluated by backend/Core from Codex hook spans; SDK code only sends spans and enforces verdicts." },
    #{ provider: "codex", capability: "goal-signals", tier: "native", rationale: "UserPromptSubmit emits the default goal signal before governed prompt/action work." },
    #{ provider: "codex", capability: "tracing", tier: "wrapped", rationale: "Hook spans normalize Codex tool, file, shell, HTTP, MCP, and assistant activity." },
    #{ provider: "codex", capability: "install-doctor", tier: "native", rationale: "Install, plugin export, and verify helpers cover project-local Codex surfaces." },

    #{ provider: "cursor", capability: "hooks", tier: "native", rationale: "Cursor hooks are generated from the adapter spec and installed in plugin or repo mode." },
    #{ provider: "cursor", capability: "plugins", tier: "native", rationale: "Cursor plugin mode exports hooks, MCP, commands, rules, agents, and skill assets." },
    #{ provider: "cursor", capability: "skills", tier: "native", rationale: "Repo and plugin installs include .agents/skills/openbox or plugin skills/openbox." },
    #{ provider: "cursor", capability: "mcp", tier: "native", rationale: "Cursor repo and plugin modes include MCP server configuration." },
    #{ provider: "cursor", capability: "rules-instructions", tier: "native", rationale: "Cursor .mdc governance projection remains the native instruction/rule surface." },
    #{ provider: "cursor", capability: "subagents-agents", tier: "native", rationale: "Cursor subagent hooks and bundled agent templates emit OpenBox activities." },
    #{ provider: "cursor", capability: "approvals-hitl", tier: "native", rationale: "Cursor hook decisions integrate with the extension/native approval path and Core polling fallback." },
    #{ provider: "cursor", capability: "usage-cost", tier: "observe-only", rationale: "Assistant response/thought telemetry records usage when Cursor exposes it." },
    #{ provider: "cursor", capability: "guardrails", tier: "native", rationale: "Prompt/tool/output gates enforce Core guardrail verdicts fail-closed." },
    #{ provider: "cursor", capability: "opa-rules", tier: "native", rationale: "Rules are evaluated by Core; Cursor receives projected instructions and verdicts only." },
    #{ provider: "cursor", capability: "behavior-rules", tier: "native", rationale: "Cursor hook spans feed backend-owned behavior-rule matching; projections are instructional only." },
    #{ provider: "cursor", capability: "goal-signals", tier: "native", rationale: "Prompt-start surfaces emit goal signals before first governed action." },
    #{ provider: "cursor", capability: "tracing", tier: "wrapped", rationale: "Cursor hook spans normalize file, shell, MCP, subagent, and LLM activity." },
    #{ provider: "cursor", capability: "install-doctor", tier: "native", rationale: "Plugin mode, repo mode, workspaceOpen metadata, and runtime doctor checks are declared." },

    #{ provider: "claude-code", capability: "hooks", tier: "native", rationale: "Claude Code hooks are generated and default/opt-in events are recorded explicitly." },
    #{ provider: "claude-code", capability: "plugins", tier: "native", rationale: "Claude Code plugin packaging is the primary install surface." },
    #{ provider: "claude-code", capability: "skills", tier: "native", rationale: "OpenBox skill is packaged in the Claude Code plugin." },
    #{ provider: "claude-code", capability: "mcp", tier: "native", rationale: "The plugin bundles .mcp.json pointing at the project-local OpenBox CLI runner." },
    #{ provider: "claude-code", capability: "rules-instructions", tier: "wrapped", rationale: "CLAUDE/AGENTS-style instruction projection ships in the plugin as documentation-only guidance; policy logic stays in Core." },
    #{ provider: "claude-code", capability: "subagents-agents", tier: "native", rationale: "Subagent hooks and the OpenBox reviewer agent template are packaged." },
    #{ provider: "claude-code", capability: "approvals-hitl", tier: "native", rationale: "Native permission hooks and remote polling both enforce require_approval fail-closed." },
    #{ provider: "claude-code", capability: "usage-cost", tier: "native", rationale: "Claude transcript usage extraction and hook telemetry normalize usage fields." },
    #{ provider: "claude-code", capability: "guardrails", tier: "native", rationale: "Prompt/tool/output guardrails enforce Core verdicts." },
    #{ provider: "claude-code", capability: "opa-rules", tier: "native", rationale: "Core evaluates OPA/Rego and behavior rules from emitted spans." },
    #{ provider: "claude-code", capability: "behavior-rules", tier: "native", rationale: "Claude Code hook spans feed backend-owned behavior-rule matching; plugin assets do not evaluate predicates locally." },
    #{ provider: "claude-code", capability: "goal-signals", tier: "native", rationale: "UserPromptSubmit emits goal signals ahead of prompt/tool gates." },
    #{ provider: "claude-code", capability: "tracing", tier: "native", rationale: "Claude Code spans cover prompts, tools, batches, subagents, compaction, and assistant output." },
    #{ provider: "claude-code", capability: "install-doctor", tier: "native", rationale: "Plugin export/install/doctor and component inventory cover Claude Code surfaces." },

    #{ provider: "mcp", capability: "hooks", tier: "out-of-scope", rationale: "MCP is a server protocol, not a host hook system." },
    #{ provider: "mcp", capability: "plugins", tier: "out-of-scope", rationale: "Plugin packaging belongs to host adapters." },
    #{ provider: "mcp", capability: "skills", tier: "native", rationale: "MCP exposes OpenBox skill references as resources." },
    #{ provider: "mcp", capability: "mcp", tier: "native", rationale: "OpenBox is itself an MCP server over stdio or Streamable HTTP." },
    #{ provider: "mcp", capability: "rules-instructions", tier: "native", rationale: "Prompts and resource templates expose policy review and governance workflows." },
    #{ provider: "mcp", capability: "subagents-agents", tier: "observe-only", rationale: "MCP can inspect agents and approvals but does not spawn subagents." },
    #{ provider: "mcp", capability: "approvals-hitl", tier: "native", rationale: "Approval list/decision tools and Core polling fallback are exposed." },
    #{ provider: "mcp", capability: "usage-cost", tier: "observe-only", rationale: "MCP check spans can include usage from caller payloads; it does not meter hosts directly." },
    #{ provider: "mcp", capability: "guardrails", tier: "native", rationale: "check_governance sends complete spans to Core guardrails." },
    #{ provider: "mcp", capability: "opa-rules", tier: "native", rationale: "MCP policy/rule reads and check_governance stay backend-owned." },
    #{ provider: "mcp", capability: "behavior-rules", tier: "native", rationale: "MCP check_governance sends caller spans to backend-owned behavior-rule matching and exposes rules as read-only resources." },
    #{ provider: "mcp", capability: "goal-signals", tier: "wrapped", rationale: "Prompt templates instruct clients to emit goal signals; server tools govern actions." },
    #{ provider: "mcp", capability: "tracing", tier: "wrapped", rationale: "MCP governance spans normalize ad-hoc tool/resource checks." },
    #{ provider: "mcp", capability: "install-doctor", tier: "native", rationale: "MCP exposes status and doctor tools for host installs." },

    #{ provider: "openai-agents-sdk", capability: "hooks", tier: "native", rationale: "AgentHooks helper maps run/tool lifecycle into OpenBox sessions." },
    #{ provider: "openai-agents-sdk", capability: "plugins", tier: "out-of-scope", rationale: "The OpenAI Agents SDK has no plugin package surface for OpenBox to install." },
    #{ provider: "openai-agents-sdk", capability: "skills", tier: "out-of-scope", rationale: "Skills are Codex/host assets, not OpenAI Agents SDK assets." },
    #{ provider: "openai-agents-sdk", capability: "mcp", tier: "observe-only", rationale: "Tracing observes MCP tool usage; MCP tool servers remain owned by the host app." },
    #{ provider: "openai-agents-sdk", capability: "rules-instructions", tier: "wrapped", rationale: "Guardrail helpers project Core verdicts into native SDK guardrail callbacks." },
    #{ provider: "openai-agents-sdk", capability: "subagents-agents", tier: "observe-only", rationale: "Handoffs and agents-as-tools are observed through hooks/tracing." },
    #{ provider: "openai-agents-sdk", capability: "approvals-hitl", tier: "wrapped", rationale: "require_approval is surfaced as OpenBox errors or caller-managed interruption." },
    #{ provider: "openai-agents-sdk", capability: "usage-cost", tier: "native", rationale: "Run/tracing processors normalize model usage and cost telemetry where available." },
    #{ provider: "openai-agents-sdk", capability: "guardrails", tier: "native", rationale: "Input/output/tool guardrail helpers enforce Core verdicts." },
    #{ provider: "openai-agents-sdk", capability: "opa-rules", tier: "native", rationale: "Core evaluates all policy/rule payloads." },
    #{ provider: "openai-agents-sdk", capability: "behavior-rules", tier: "native", rationale: "Agent/tool/run spans are sent to backend-owned behavior-rule matching; SDK helpers only project returned verdicts." },
    #{ provider: "openai-agents-sdk", capability: "goal-signals", tier: "native", rationale: "Run-start helpers emit the default goal signal before governed action." },
    #{ provider: "openai-agents-sdk", capability: "tracing", tier: "native", rationale: "Tracing processor observes hosted tools, built-in tools, MCP tools, handoffs, generations, and usage." },
    #{ provider: "openai-agents-sdk", capability: "install-doctor", tier: "diagnose-only", rationale: "No files are installed; diagnostics are SDK export and configuration checks." },

    #{ provider: "anthropic-agent-sdk", capability: "hooks", tier: "native", rationale: "Anthropic Agent SDK hook helpers wrap query/options and message observation." },
    #{ provider: "anthropic-agent-sdk", capability: "plugins", tier: "out-of-scope", rationale: "Claude Code plugin packaging is separate from Anthropic Agent SDK usage." },
    #{ provider: "anthropic-agent-sdk", capability: "skills", tier: "out-of-scope", rationale: "Skills are host assets, not Anthropic Agent SDK assets." },
    #{ provider: "anthropic-agent-sdk", capability: "mcp", tier: "observe-only", rationale: "MCP server status and elicitation events are observed when the SDK exposes them." },
    #{ provider: "anthropic-agent-sdk", capability: "rules-instructions", tier: "wrapped", rationale: "Options/workspace changes are governed through Core, not local policy evaluation." },
    #{ provider: "anthropic-agent-sdk", capability: "subagents-agents", tier: "observe-only", rationale: "Tasks and subagents are observed from SDK messages." },
    #{ provider: "anthropic-agent-sdk", capability: "approvals-hitl", tier: "wrapped", rationale: "Permission/MCP elicitation events use Core approval semantics." },
    #{ provider: "anthropic-agent-sdk", capability: "usage-cost", tier: "native", rationale: "Usage messages are normalized into OpenBox telemetry." },
    #{ provider: "anthropic-agent-sdk", capability: "guardrails", tier: "native", rationale: "Prompt/tool/message gates send payloads to Core guardrails." },
    #{ provider: "anthropic-agent-sdk", capability: "opa-rules", tier: "native", rationale: "Core evaluates all policies and behavior rules." },
    #{ provider: "anthropic-agent-sdk", capability: "behavior-rules", tier: "native", rationale: "Hook/message/tool spans feed backend-owned behavior-rule matching; SDK code does not evaluate predicates locally." },
    #{ provider: "anthropic-agent-sdk", capability: "goal-signals", tier: "native", rationale: "User-prompt events emit goal signals before governed actions." },
    #{ provider: "anthropic-agent-sdk", capability: "tracing", tier: "wrapped", rationale: "SDK message observation maps sessions, tools, usage, and results to spans." },
    #{ provider: "anthropic-agent-sdk", capability: "install-doctor", tier: "diagnose-only", rationale: "No install surface; configuration is runtime-only." },

    #{ provider: "copilotkit", capability: "hooks", tier: "wrapped", rationale: "Runtime hooks and middleware wrap CopilotKit agent/prompt/tool surfaces." },
    #{ provider: "copilotkit", capability: "plugins", tier: "out-of-scope", rationale: "CopilotKit does not install host plugins through OpenBox." },
    #{ provider: "copilotkit", capability: "skills", tier: "out-of-scope", rationale: "Skills are host assets, not CopilotKit assets." },
    #{ provider: "copilotkit", capability: "mcp", tier: "observe-only", rationale: "MCP client/server use is observed through tool events when surfaced." },
    #{ provider: "copilotkit", capability: "rules-instructions", tier: "wrapped", rationale: "Prompt/tool/output gates project Core verdicts into CopilotKit result shapes." },
    #{ provider: "copilotkit", capability: "subagents-agents", tier: "observe-only", rationale: "Agent runner lifecycle is observed; CopilotKit owns orchestration." },
    #{ provider: "copilotkit", capability: "approvals-hitl", tier: "native", rationale: "React renderers and headless interruption helpers resolve OpenBox HITL decisions." },
    #{ provider: "copilotkit", capability: "usage-cost", tier: "observe-only", rationale: "AG-UI/runtime events normalize usage when present." },
    #{ provider: "copilotkit", capability: "guardrails", tier: "native", rationale: "Prompt/tool/output gates enforce Core guardrails." },
    #{ provider: "copilotkit", capability: "opa-rules", tier: "native", rationale: "Core remains canonical for OPA/Rego and behavior rules." },
    #{ provider: "copilotkit", capability: "behavior-rules", tier: "native", rationale: "Prompt/tool/output spans feed backend-owned behavior-rule matching; adapters only project returned verdicts." },
    #{ provider: "copilotkit", capability: "goal-signals", tier: "native", rationale: "Run/prompt entrypoints emit goal signals before governed actions." },
    #{ provider: "copilotkit", capability: "tracing", tier: "wrapped", rationale: "AG-UI event streams map lifecycle, text, tool, state, error, and interrupt activity." },
    #{ provider: "copilotkit", capability: "install-doctor", tier: "diagnose-only", rationale: "No host install; readiness helpers validate runtime wiring." },

    #{ provider: "n8n", capability: "hooks", tier: "wrapped", rationale: "n8n node pre/post execution helpers provide hook-equivalent gates." },
    #{ provider: "n8n", capability: "plugins", tier: "wrapped", rationale: "Packaged n8n node descriptors and templates are generated from SDK helpers." },
    #{ provider: "n8n", capability: "skills", tier: "out-of-scope", rationale: "n8n does not consume OpenBox skills directly." },
    #{ provider: "n8n", capability: "mcp", tier: "native", rationale: "Examples cover MCP Client Tool and MCP Server Trigger interop." },
    #{ provider: "n8n", capability: "rules-instructions", tier: "wrapped", rationale: "Governance and approval nodes project Core verdicts into workflows." },
    #{ provider: "n8n", capability: "subagents-agents", tier: "observe-only", rationale: "AI Agent workflow nodes are observed; n8n owns orchestration." },
    #{ provider: "n8n", capability: "approvals-hitl", tier: "native", rationale: "Approval/HITL node and Core polling resolve decisions." },
    #{ provider: "n8n", capability: "usage-cost", tier: "native", rationale: "LLM completion helpers normalize usage telemetry." },
    #{ provider: "n8n", capability: "guardrails", tier: "native", rationale: "Guardrails node wrapper and pre/post helpers enforce Core verdicts." },
    #{ provider: "n8n", capability: "opa-rules", tier: "native", rationale: "Core evaluates OPA/Rego and behavior rules." },
    #{ provider: "n8n", capability: "behavior-rules", tier: "native", rationale: "n8n node/LLM spans feed backend-owned behavior-rule matching; node helpers project returned verdicts." },
    #{ provider: "n8n", capability: "goal-signals", tier: "native", rationale: "Prompt helper emits default goal signal before node execution." },
    #{ provider: "n8n", capability: "tracing", tier: "wrapped", rationale: "Node and LLM spans normalize n8n workflow telemetry." },
    #{ provider: "n8n", capability: "install-doctor", tier: "diagnose-only", rationale: "Packaged descriptors/templates can be inspected; n8n installation is operator-owned." },
  ],
  referenceProviderParityClosures: #[
    #{ provider: "codex", capability: "rules-instructions", tier: "wrapped", status: "implemented-through-wrapper", referenceSurface: "AGENTS.md/OpenBox skill governance instructions plus .codex/rules exact shell-prefix rules when behavior-rule renderer hints include codexCommandPrefix, commandPrefix, or exactShellPrefix", openboxSurface: "Render instruction summaries, skill references, source counts, and exact shell command-prefix execution policy only.", closureDecision: "Closed as wrapper parity: OpenBox projects Core-owned governance into the provider's native extension point without claiming ownership of provider internals.", guardTest: "tests/unit/rules-projection-coverage.test.ts#renders instruction projections and exact Codex command rules without local policy evaluation" },
    #{ provider: "codex", capability: "subagents-agents", tier: "observe-only", status: "host-owned-observe-only", referenceSurface: "Codex Agent/Task-style tool calls are observed as tool or a2a metadata when surfaced by Codex spans.", openboxSurface: "Codex hook events do not expose a dedicated subagent lifecycle; OpenBox records available agent/task spans where present.", closureDecision: "Closed as observe-only parity: OpenBox records provider events or telemetry that the reference surface exposes while the provider remains the orchestrator.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins subagents-agents support claims to explicit agent ownership coverage" },
    #{ provider: "codex", capability: "usage-cost", tier: "observe-only", status: "host-owned-observe-only", referenceSurface: "Codex hook envelopes when upstream exposes usage metadata; current hook contracts are not metering surfaces.", openboxSurface: "Codex remains observe-only because host hooks do not meter usage; any upstream usage metadata that appears routes through normalizeOpenBoxUsage and generated nested-provider aliases.", closureDecision: "Closed as observe-only parity: OpenBox records provider events or telemetry that the reference surface exposes while the provider remains the orchestrator.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins usage-cost support claims to explicit usage guard coverage" },
    #{ provider: "codex", capability: "tracing", tier: "wrapped", status: "implemented-through-wrapper", referenceSurface: "UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, Stop", openboxSurface: "Codex shell, file, HTTP, MCP, database, agent/action, and assistant-output spans", closureDecision: "Closed as wrapper parity: OpenBox projects Core-owned governance into the provider's native extension point without claiming ownership of provider internals.", guardTest: "tests/unit/codex-runtime.test.ts#stamps Codex source and shell spans in paired tool mappers" },
    #{ provider: "cursor", capability: "usage-cost", tier: "observe-only", status: "host-owned-observe-only", referenceSurface: "afterAgentResponse and afterAgentThought assistant telemetry when Cursor exposes usage metadata", openboxSurface: "Cursor assistant-output mappers route usage through normalizeOpenBoxUsage and buildAssistantOutputSpan.", closureDecision: "Closed as observe-only parity: OpenBox records provider events or telemetry that the reference surface exposes while the provider remains the orchestrator.", guardTest: "tests/unit/cursor-spans.test.ts#afterAgentResponse emits completed assistant-output span" },
    #{ provider: "cursor", capability: "tracing", tier: "wrapped", status: "implemented-through-wrapper", referenceSurface: "before/after prompt, shell, file, MCP, assistant response, thought, and subagent hooks", openboxSurface: "Cursor file_read, file_write, shell/internal, MCP, LLM, HTTP, and assistant-output spans", closureDecision: "Closed as wrapper parity: OpenBox projects Core-owned governance into the provider's native extension point without claiming ownership of provider internals.", guardTest: "tests/unit/cursor-spans.test.ts#before/after shell execution keeps one activity id across the tool lifecycle" },
    #{ provider: "claude-code", capability: "rules-instructions", tier: "wrapped", status: "implemented-through-wrapper", referenceSurface: "Claude Code plugin reviewer agent, slash command guidance, OpenBox skill, and instructions/CLAUDE.md rendered from the shared CLAUDE/AGENTS-style instruction projection", openboxSurface: "Ship reviewer, command, and instruction assets that ask MCP/Core for policies, guardrails, behavior rules, trust, and governance verdicts.", closureDecision: "Closed as wrapper parity: OpenBox projects Core-owned governance into the provider's native extension point without claiming ownership of provider internals.", guardTest: "tests/unit/claude-code-plugin.test.ts#exports a complete marketplace-ready plugin folder" },
    #{ provider: "mcp", capability: "hooks", tier: "out-of-scope", status: "host-unsupported", referenceSurface: "No host hook surface exists for MCP itself; MCP is a server protocol.", openboxSurface: "MCP check_governance sends spans to Core when called; there is no host hook lifecycle to pre-gate.", closureDecision: "Closed as out-of-scope: the reference provider does not expose an OpenBox-owned surface for this capability.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins hook support claims to explicit hook surface coverage" },
    #{ provider: "mcp", capability: "plugins", tier: "out-of-scope", status: "host-unsupported", referenceSurface: "No MCP plugin package is emitted; MCP is the server protocol surface used by host plugins.", openboxSurface: "Plugin component catalogs are owned by Codex, Cursor, and Claude Code adapters, not the MCP server.", closureDecision: "Closed as out-of-scope: the reference provider does not expose an OpenBox-owned surface for this capability.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins plugin support claims to explicit packaged component coverage" },
    #{ provider: "mcp", capability: "subagents-agents", tier: "observe-only", status: "host-owned-observe-only", referenceSurface: "MCP list_agents, get_agent, and openbox://agent/{agent_id} resources inspect OpenBox agents.", openboxSurface: "MCP can inspect agents and approvals but does not spawn subagents or own multi-agent lifecycle events.", closureDecision: "Closed as observe-only parity: OpenBox records provider events or telemetry that the reference surface exposes while the provider remains the orchestrator.", guardTest: "tests/unit/mcp-server-coverage.test.ts#registers spec-driven MCP tool annotations, prompts, and resource templates" },
    #{ provider: "mcp", capability: "usage-cost", tier: "observe-only", status: "host-owned-observe-only", referenceSurface: "check_governance caller-supplied llm activity_input usage", openboxSurface: "MCP check_governance builds spans with buildSpan, which normalizes llm usage through the shared usage facade.", closureDecision: "Closed as observe-only parity: OpenBox records provider events or telemetry that the reference surface exposes while the provider remains the orchestrator.", guardTest: "tests/unit/mcp-server-coverage.test.ts#check_governance normalizes caller LLM usage into the emitted hook span" },
    #{ provider: "mcp", capability: "goal-signals", tier: "wrapped", status: "implemented-through-wrapper", referenceSurface: "Prompt templates instruct clients to emit goal signals; server tools govern actions.", openboxSurface: "MCP prompt templates expose goal-signal guidance while server tools govern concrete actions.", closureDecision: "Closed as wrapper parity: OpenBox projects Core-owned governance into the provider's native extension point without claiming ownership of provider internals.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins reference provider parity closures to every non-native capability claim" },
    #{ provider: "mcp", capability: "tracing", tier: "wrapped", status: "implemented-through-wrapper", referenceSurface: "check_governance tool over stdio or Streamable HTTP", openboxSurface: "MCP check spans normalize caller-supplied llm, shell, file, HTTP, database, and MCP payloads", closureDecision: "Closed as wrapper parity: OpenBox projects Core-owned governance into the provider's native extension point without claiming ownership of provider internals.", guardTest: "tests/unit/mcp-server-coverage.test.ts#check_governance still emits the hook span when the parent verdict blocks" },
    #{ provider: "openai-agents-sdk", capability: "plugins", tier: "out-of-scope", status: "host-unsupported", referenceSurface: "No OpenAI Agents SDK plugin package is emitted; consumers import public SDK helpers.", openboxSurface: "Public integration exports cover helper functions; host plugin components are intentionally out of scope.", closureDecision: "Closed as out-of-scope: the reference provider does not expose an OpenBox-owned surface for this capability.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins plugin support claims to explicit packaged component coverage" },
    #{ provider: "openai-agents-sdk", capability: "skills", tier: "out-of-scope", status: "host-unsupported", referenceSurface: "No OpenBox skill file surface is installed for OpenAI Agents SDK; consumers import SDK helpers instead.", openboxSurface: "Public integration exports document helper support; Codex/host skill assets are intentionally out of scope.", closureDecision: "Closed as out-of-scope: the reference provider does not expose an OpenBox-owned surface for this capability.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins skill support claims to explicit skill surface coverage" },
    #{ provider: "openai-agents-sdk", capability: "mcp", tier: "observe-only", status: "host-owned-observe-only", referenceSurface: "No OpenBox-owned MCP server install; OpenAI Agents SDK MCP tool usage is observed through tracing when the host app exposes spans.", openboxSurface: "Host application owns MCP server/client configuration; OpenBox SDK helpers do not install MCP config.; MCP tool calls are observed as tool spans and usage telemetry when tracing exposes mcp_data; no MCP prompts/resources are registered by the SDK.", closureDecision: "Closed as observe-only parity: OpenBox records provider events or telemetry that the reference surface exposes while the provider remains the orchestrator.", guardTest: "tests/unit/openai-agents-sdk.test.ts#observes OpenAI trace spans for generations, handoffs, guardrails, and tools" },
    #{ provider: "openai-agents-sdk", capability: "rules-instructions", tier: "wrapped", status: "implemented-through-wrapper", referenceSurface: "OpenAI Agents SDK guardrail helpers and tracing observations that project Core verdicts into native callbacks", openboxSurface: "Wrap input/output/tool guardrails and run lifecycle to send payloads to Core and return native SDK outcomes.", closureDecision: "Closed as wrapper parity: OpenBox projects Core-owned governance into the provider's native extension point without claiming ownership of provider internals.", guardTest: "tests/unit/openai-agents-sdk.test.ts#maps OpenBox tool guardrail verdicts to fail-closed tool behavior" },
    #{ provider: "openai-agents-sdk", capability: "subagents-agents", tier: "observe-only", status: "host-owned-observe-only", referenceSurface: "OpenAI Agents SDK handoffs and agents-as-tools are observed through AgentHooks and tracing processor spans.", openboxSurface: "Tracing processor observes handoff spans, hosted tools, built-in tools, MCP tools, generations, and usage after the host SDK produces them.", closureDecision: "Closed as observe-only parity: OpenBox records provider events or telemetry that the reference surface exposes while the provider remains the orchestrator.", guardTest: "tests/unit/openai-agents-sdk.test.ts#observes OpenAI trace spans for generations, handoffs, guardrails, and tools" },
    #{ provider: "openai-agents-sdk", capability: "approvals-hitl", tier: "wrapped", status: "implemented-through-wrapper", referenceSurface: "input, output, tool input, and tool output guardrails", openboxSurface: "OpenBox guardrail outputInfo or throwException behavior", closureDecision: "Closed as wrapper parity: OpenBox projects Core-owned governance into the provider's native extension point without claiming ownership of provider internals.", guardTest: "tests/unit/openai-agents-sdk.test.ts#maps OpenBox tool guardrail verdicts to fail-closed tool behavior" },
    #{ provider: "openai-agents-sdk", capability: "install-doctor", tier: "diagnose-only", status: "runtime-diagnostic-only", referenceSurface: "No host install surface; consumers import SDK helpers", openboxSurface: "verifyOpenBoxAgentsSDKConfig validates runtime enablement, key class, Core URL, signed identity, and defaults without mutating host state.", closureDecision: "Closed as diagnostic parity: the reference provider has no OpenBox-owned install surface, so the SDK validates exports and configuration without mutating host state.", guardTest: "tests/unit/openai-agents-sdk.test.ts#diagnoses runtime-only OpenAI Agents SDK configuration without host file mutation" },
    #{ provider: "anthropic-agent-sdk", capability: "plugins", tier: "out-of-scope", status: "host-unsupported", referenceSurface: "No Anthropic Agent SDK plugin package is emitted; consumers import hook/options helpers.", openboxSurface: "Claude Code plugin packaging is covered under claude-code, not Anthropic Agent SDK.", closureDecision: "Closed as out-of-scope: the reference provider does not expose an OpenBox-owned surface for this capability.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins plugin support claims to explicit packaged component coverage" },
    #{ provider: "anthropic-agent-sdk", capability: "skills", tier: "out-of-scope", status: "host-unsupported", referenceSurface: "No OpenBox skill file surface is installed for Anthropic Agent SDK; consumers import hook/options helpers instead.", openboxSurface: "Public integration exports document helper support; host skill assets are intentionally out of scope.", closureDecision: "Closed as out-of-scope: the reference provider does not expose an OpenBox-owned surface for this capability.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins skill support claims to explicit skill surface coverage" },
    #{ provider: "anthropic-agent-sdk", capability: "mcp", tier: "observe-only", status: "host-owned-observe-only", referenceSurface: "No OpenBox-owned MCP server install; Anthropic Agent SDK MCP elicitation/status events are observed when hooks expose them.", openboxSurface: "Host application owns MCP server/client configuration; OpenBox SDK helpers do not install MCP config.; MCP elicitation and permission events are mapped into OpenBox activities when surfaced by the SDK; no MCP prompts/resources are registered by the SDK.", closureDecision: "Closed as observe-only parity: OpenBox records provider events or telemetry that the reference surface exposes while the provider remains the orchestrator.", guardTest: "tests/unit/anthropic-agent-sdk.test.ts#maps task, config, and elicitation verdicts to Agent SDK outputs" },
    #{ provider: "anthropic-agent-sdk", capability: "rules-instructions", tier: "wrapped", status: "implemented-through-wrapper", referenceSurface: "Anthropic Agent SDK options, hooks, message observations, permission events, and workspace-change payloads", openboxSurface: "Build hook/message payloads, observe SDK events, and project returned Core verdicts into Anthropic hook decisions.", closureDecision: "Closed as wrapper parity: OpenBox projects Core-owned governance into the provider's native extension point without claiming ownership of provider internals.", guardTest: "tests/unit/anthropic-agent-sdk.test.ts#maps approval-required PreToolUse verdicts to ask or defer" },
    #{ provider: "anthropic-agent-sdk", capability: "subagents-agents", tier: "observe-only", status: "host-owned-observe-only", referenceSurface: "Anthropic Agent SDK Task/Agent tool events and subagent metadata are observed through hook payloads.", openboxSurface: "Official TaskCreated/TaskCompleted/SubagentStart/SubagentStop hooks and Agent/Task tool payloads are normalized with a2a metadata.", closureDecision: "Closed as observe-only parity: OpenBox records provider events or telemetry that the reference surface exposes while the provider remains the orchestrator.", guardTest: "tests/unit/anthropic-agent-sdk.test.ts#marks Agent/Task and subagent hooks as a2a activity metadata" },
    #{ provider: "anthropic-agent-sdk", capability: "approvals-hitl", tier: "wrapped", status: "implemented-through-wrapper", referenceSurface: "Anthropic Agent SDK PreToolUse permission hook and MCP elicitation events", openboxSurface: "Anthropic hook permissionDecision ask/defer", closureDecision: "Closed as wrapper parity: OpenBox projects Core-owned governance into the provider's native extension point without claiming ownership of provider internals.", guardTest: "tests/unit/anthropic-agent-sdk.test.ts#maps approval-required PreToolUse verdicts to ask or defer" },
    #{ provider: "anthropic-agent-sdk", capability: "tracing", tier: "wrapped", status: "implemented-through-wrapper", referenceSurface: "Anthropic Agent SDK hook events, query messages, result messages, usage messages, and elicitation", openboxSurface: "Anthropic Agent SDK prompt, tool, assistant-output, session, synthetic model-usage, and failure spans", closureDecision: "Closed as wrapper parity: OpenBox projects Core-owned governance into the provider's native extension point without claiming ownership of provider internals.", guardTest: "tests/unit/anthropic-agent-sdk.test.ts#records StopFailure as observe-only failed workflow telemetry" },
    #{ provider: "anthropic-agent-sdk", capability: "install-doctor", tier: "diagnose-only", status: "runtime-diagnostic-only", referenceSurface: "No host install surface; consumers import SDK helpers", openboxSurface: "verifyOpenBoxAnthropicAgentSDKConfig validates runtime enablement, key class, Core URL, signed identity, opt-in hook mode, and defaults without mutating host state.", closureDecision: "Closed as diagnostic parity: the reference provider has no OpenBox-owned install surface, so the SDK validates exports and configuration without mutating host state.", guardTest: "tests/unit/anthropic-agent-sdk.test.ts#diagnoses runtime-only Anthropic Agent SDK configuration without host file mutation" },
    #{ provider: "copilotkit", capability: "hooks", tier: "wrapped", status: "implemented-through-wrapper", referenceSurface: "createOpenBoxCopilotKitAdapter wraps CopilotKit runtime, LangChain middleware, tool, prompt, output, and AG-UI surfaces.", openboxSurface: "Wrapped prompt/tool/output gates send spans to Core and project returned verdicts into CopilotKit continuation, interruption, or terminal results.", closureDecision: "Closed as wrapper parity: OpenBox projects Core-owned governance into the provider's native extension point without claiming ownership of provider internals.", guardTest: "tests/unit/copilotkit-adapter.test.ts#pauses on approval-required prompt verdict without calling the model" },
    #{ provider: "copilotkit", capability: "plugins", tier: "out-of-scope", status: "host-unsupported", referenceSurface: "No CopilotKit plugin package is emitted; consumers wire runtime adapters and UI helpers.", openboxSurface: "Public integration exports cover CopilotKit adapters and approval helpers; host plugin components are intentionally out of scope.", closureDecision: "Closed as out-of-scope: the reference provider does not expose an OpenBox-owned surface for this capability.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins plugin support claims to explicit packaged component coverage" },
    #{ provider: "copilotkit", capability: "skills", tier: "out-of-scope", status: "host-unsupported", referenceSurface: "No OpenBox skill file surface is installed for CopilotKit; consumers wire runtime adapters and approval UI helpers instead.", openboxSurface: "Public integration exports document helper support; host skill assets are intentionally out of scope.", closureDecision: "Closed as out-of-scope: the reference provider does not expose an OpenBox-owned surface for this capability.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins skill support claims to explicit skill surface coverage" },
    #{ provider: "copilotkit", capability: "mcp", tier: "observe-only", status: "host-owned-observe-only", referenceSurface: "No OpenBox-owned MCP server install; CopilotKit observes MCP-like client/server tool events through AG-UI/runtime streams when surfaced.", openboxSurface: "Host application owns MCP server/client configuration; CopilotKit adapters do not install MCP config.; AG-UI lifecycle, tool, state, error, and interrupt events are mapped to OpenBox activities; MCP prompts/resources are not registered by CopilotKit.", closureDecision: "Closed as observe-only parity: OpenBox records provider events or telemetry that the reference surface exposes while the provider remains the orchestrator.", guardTest: "tests/unit/copilotkit-adapter.test.ts#maps AG-UI run, tool, message, state, error, and interrupt events through OpenBox gates" },
    #{ provider: "copilotkit", capability: "rules-instructions", tier: "wrapped", status: "implemented-through-wrapper", referenceSurface: "CopilotKit prompt, tool, output, AG-UI, and approval helper result shapes", openboxSurface: "Project Core verdicts into CopilotKit runtime results, AG-UI events, interruptions, and approval routes.", closureDecision: "Closed as wrapper parity: OpenBox projects Core-owned governance into the provider's native extension point without claiming ownership of provider internals.", guardTest: "tests/unit/copilotkit-adapter.test.ts#emits workflow/tool lifecycle events around a governed tool" },
    #{ provider: "copilotkit", capability: "subagents-agents", tier: "observe-only", status: "host-owned-observe-only", referenceSurface: "CopilotKit agent runner lifecycle and a2a tool metadata are observed through runtime, middleware, and AG-UI adapters.", openboxSurface: "CopilotKit AG-UI/run lifecycle and governed tool calls map subagent_type/tool metadata to OpenBox activities when surfaced.", closureDecision: "Closed as observe-only parity: OpenBox records provider events or telemetry that the reference surface exposes while the provider remains the orchestrator.", guardTest: "tests/unit/copilotkit-adapter.test.ts#emits workflow/tool lifecycle events around a governed tool" },
    #{ provider: "copilotkit", capability: "usage-cost", tier: "observe-only", status: "host-owned-observe-only", referenceSurface: "LangChain/CopilotKit model end events and AG-UI runtime events when usage metadata is present", openboxSurface: "CopilotKit middleware and AG-UI events route usage metadata through openBoxUsageTelemetryFields and buildAssistantOutputSpan.", closureDecision: "Closed as observe-only parity: OpenBox records provider events or telemetry that the reference surface exposes while the provider remains the orchestrator.", guardTest: "tests/unit/copilotkit-adapter.test.ts#normalizes usage and cost from AG-UI run completion events" },
    #{ provider: "copilotkit", capability: "tracing", tier: "wrapped", status: "implemented-through-wrapper", referenceSurface: "CopilotKit middleware, governed tools, AG-UI lifecycle, tool, state, error, and interrupt events", openboxSurface: "CopilotKit LLM, tool, AG-UI lifecycle, interrupt, and assistant-output spans", closureDecision: "Closed as wrapper parity: OpenBox projects Core-owned governance into the provider's native extension point without claiming ownership of provider internals.", guardTest: "tests/unit/copilotkit-adapter.test.ts#emits Core-extractable assistant output spans for goal alignment" },
    #{ provider: "copilotkit", capability: "install-doctor", tier: "diagnose-only", status: "runtime-diagnostic-only", referenceSurface: "No host install surface; consumers wire runtime adapters and approval routes", openboxSurface: "createOpenBoxReadinessCheck validates runtime Core wiring, backend inventory reachability, approval route dependencies, and capability readiness without installing host files.", closureDecision: "Closed as diagnostic parity: the reference provider has no OpenBox-owned install surface, so the SDK validates exports and configuration without mutating host state.", guardTest: "tests/unit/copilotkit-adapter.test.ts#readiness treats backend inventory config as optional when Core runtime is configured" },
    #{ provider: "n8n", capability: "hooks", tier: "wrapped", status: "implemented-through-wrapper", referenceSurface: "emitN8nUserPromptSignal, emitN8nNodePreExecute, emitN8nNodePostExecute, and emitN8nLlmCompletion provide hook-equivalent gates.", openboxSurface: "n8n helper calls send spans to Core and project returned verdicts into node/template behavior.", closureDecision: "Closed as wrapper parity: OpenBox projects Core-owned governance into the provider's native extension point without claiming ownership of provider internals.", guardTest: "tests/unit/govern-invariants.test.ts#n8n runtime helpers send node lifecycle events and hook completion spans" },
    #{ provider: "n8n", capability: "plugins", tier: "wrapped", status: "implemented-through-wrapper", referenceSurface: "Packaged n8n integration descriptor surface, not a Codex/Cursor/Claude host plugin folder.", openboxSurface: "N8N_INTEGRATION_SURFACE covers OpenBox credentials, Governance node, Guardrails node, Approval/HITL node, governed AI Agent template, and examples.", closureDecision: "Closed as wrapper parity: OpenBox projects Core-owned governance into the provider's native extension point without claiming ownership of provider internals.", guardTest: "tests/unit/runtime-adapters-coverage.test.ts#exports the spec-generated packaged n8n integration surface" },
    #{ provider: "n8n", capability: "skills", tier: "out-of-scope", status: "host-unsupported", referenceSurface: "No OpenBox skill file surface is installed for n8n; OpenBox ships node descriptors and workflow templates instead.", openboxSurface: "N8N_INTEGRATION_SURFACE documents credentials, nodes, templates, and examples rather than host skill files.", closureDecision: "Closed as out-of-scope: the reference provider does not expose an OpenBox-owned surface for this capability.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins skill support claims to explicit skill surface coverage" },
    #{ provider: "n8n", capability: "rules-instructions", tier: "wrapped", status: "implemented-through-wrapper", referenceSurface: "n8n Governance, Guardrails, Approval/HITL, and governed AI Agent node/template descriptors", openboxSurface: "Project Core verdicts into n8n node helper outputs, workflow templates, and packaged node descriptors.", closureDecision: "Closed as wrapper parity: OpenBox projects Core-owned governance into the provider's native extension point without claiming ownership of provider internals.", guardTest: "tests/unit/runtime-adapters-coverage.test.ts#exports the spec-generated packaged n8n integration surface" },
    #{ provider: "n8n", capability: "subagents-agents", tier: "observe-only", status: "host-owned-observe-only", referenceSurface: "n8n governed AI Agent workflow template and node descriptors expose AI Agent workflow surfaces.", openboxSurface: "OpenBox Governance, Guardrails, Approval/HITL, and governed AI Agent descriptors observe node/tool/LLM lifecycle around n8n AI Agent workflows.", closureDecision: "Closed as observe-only parity: OpenBox records provider events or telemetry that the reference surface exposes while the provider remains the orchestrator.", guardTest: "tests/unit/runtime-adapters-coverage.test.ts#exports the spec-generated packaged n8n integration surface" },
    #{ provider: "n8n", capability: "tracing", tier: "wrapped", status: "implemented-through-wrapper", referenceSurface: "n8n node pre/post execution, LLM completion helpers, and governed AI Agent workflow template", openboxSurface: "n8n node, LLM, assistant-output, tool, error, and workflow telemetry spans", closureDecision: "Closed as wrapper parity: OpenBox projects Core-owned governance into the provider's native extension point without claiming ownership of provider internals.", guardTest: "tests/unit/govern-invariants.test.ts#n8n generic node completion emits paired parent plus tool hook span" },
    #{ provider: "n8n", capability: "install-doctor", tier: "diagnose-only", status: "runtime-diagnostic-only", referenceSurface: "Operator-owned n8n package installation; OpenBox ships descriptors and templates", openboxSurface: "verifyOpenBoxN8nIntegrationSurface validates packaged credentials, nodes, workflow templates, examples, package ids, and showcase specs without mutating n8n instances.", closureDecision: "Closed as diagnostic parity: the reference provider has no OpenBox-owned install surface, so the SDK validates exports and configuration without mutating host state.", guardTest: "tests/unit/runtime-adapters-coverage.test.ts#exports the spec-generated packaged n8n integration surface" },
  ],
  referenceProviderRuntimeAudit: #[
    #{ provider: "codex", capability: "rules-instructions", tier: "wrapped", status: "implemented-through-wrapper", promotionDecision: "max-through-wrapper", runtimeEvidence: "Rules projection renders AGENTS.md/OpenBox skill governance summaries and exact .codex/rules command-prefix policy backed by the rules projection coverage test.", technicalBoundary: "Core remains policy authority; Codex receives projected instructions and rules only, so SDK runtime cannot evaluate or mutate provider-internal policy state.", guardTest: "tests/unit/rules-projection-coverage.test.ts#renders instruction projections and exact Codex command rules without local policy evaluation" },
    #{ provider: "codex", capability: "subagents-agents", tier: "observe-only", status: "host-owned-observe-only", promotionDecision: "retain-host-owned-boundary", runtimeEvidence: "Codex runtime maps available Agent or Task-style tool spans into tool or a2a metadata when hook and span payloads expose them.", technicalBoundary: "Codex owns subagent orchestration and exposes no dedicated subagent lifecycle hook, so OpenBox can only observe surfaced telemetry.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins subagents-agents support claims to explicit agent ownership coverage" },
    #{ provider: "codex", capability: "usage-cost", tier: "observe-only", status: "host-owned-observe-only", promotionDecision: "retain-host-owned-boundary", runtimeEvidence: "Codex usage guards and normalizeOpenBoxUsage consume direct and nested provider usage aliases when upstream hook envelopes expose usage metadata.", technicalBoundary: "Codex hook contracts are not metering APIs; the host owns model execution and cost collection, so OpenBox cannot meter locally.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins usage-cost support claims to explicit usage guard coverage" },
    #{ provider: "codex", capability: "tracing", tier: "wrapped", status: "implemented-through-wrapper", promotionDecision: "max-through-wrapper", runtimeEvidence: "Codex runtime emits paired shell, file, HTTP, MCP, database, agent/action, and assistant-output spans with codex source attribution.", technicalBoundary: "OpenBox wraps Codex hook payloads and span mapping but does not control Codex internal trace collection or orchestration.", guardTest: "tests/unit/codex-runtime.test.ts#stamps Codex source and shell spans in paired tool mappers" },
    #{ provider: "cursor", capability: "usage-cost", tier: "observe-only", status: "host-owned-observe-only", promotionDecision: "retain-host-owned-boundary", runtimeEvidence: "Cursor assistant-output mappers route afterAgentResponse and afterAgentThought usage metadata through normalizeOpenBoxUsage and buildAssistantOutputSpan.", technicalBoundary: "Cursor owns model execution and cost telemetry; OpenBox observes exposed assistant metadata and leaves spend enforcement to Core.", guardTest: "tests/unit/cursor-spans.test.ts#afterAgentResponse emits completed assistant-output span" },
    #{ provider: "cursor", capability: "tracing", tier: "wrapped", status: "implemented-through-wrapper", promotionDecision: "max-through-wrapper", runtimeEvidence: "Cursor hook mappers emit file, shell, MCP, LLM, HTTP, and assistant-output spans while keeping one activity id across paired lifecycle events.", technicalBoundary: "OpenBox projects tracing through Cursor hook extensions but cannot claim ownership of Cursor's internal session or trace collector.", guardTest: "tests/unit/cursor-spans.test.ts#before/after shell execution keeps one activity id across the tool lifecycle" },
    #{ provider: "claude-code", capability: "rules-instructions", tier: "wrapped", status: "implemented-through-wrapper", promotionDecision: "max-through-wrapper", runtimeEvidence: "Claude Code plugin export ships reviewer, command, skill, and instruction assets rendered from the shared governance instruction projection.", technicalBoundary: "OpenBox packages provider-native assets but Core remains the evaluator; local plugin instructions do not replace Claude Code internals.", guardTest: "tests/unit/claude-code-plugin.test.ts#exports a complete marketplace-ready plugin folder" },
    #{ provider: "mcp", capability: "hooks", tier: "out-of-scope", status: "host-unsupported", promotionDecision: "retain-protocol-boundary", runtimeEvidence: "MCP check_governance emits Core spans when clients call the server, proving runtime behavior exists only at the protocol tool boundary.", technicalBoundary: "MCP is a server protocol without host hook lifecycle; there is no OpenBox-owned pre or post hook surface to implement.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins hook support claims to explicit hook surface coverage" },
    #{ provider: "mcp", capability: "plugins", tier: "out-of-scope", status: "host-unsupported", promotionDecision: "retain-protocol-boundary", runtimeEvidence: "Plugin component catalogs deliberately assign packaged plugin assets to Codex, Cursor, and Claude Code adapters rather than the MCP server.", technicalBoundary: "MCP exposes tools, resources, and prompts and is consumed by host plugins; the protocol has no plugin package surface to emit.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins plugin support claims to explicit packaged component coverage" },
    #{ provider: "mcp", capability: "subagents-agents", tier: "observe-only", status: "host-owned-observe-only", promotionDecision: "retain-host-owned-boundary", runtimeEvidence: "MCP list_agents, get_agent, and openbox://agent/{agent_id} resources inspect OpenBox agents and approvals through the server runtime.", technicalBoundary: "Host runtimes own subagent orchestration; MCP can inspect OpenBox-owned agent records but does not spawn or schedule host subagent lifecycles.", guardTest: "tests/unit/mcp-server-coverage.test.ts#registers spec-driven MCP tool annotations, prompts, and resource templates" },
    #{ provider: "mcp", capability: "usage-cost", tier: "observe-only", status: "host-owned-observe-only", promotionDecision: "retain-host-owned-boundary", runtimeEvidence: "MCP check_governance builds spans from caller-supplied LLM activity_input and normalizes usage through the shared usage facade.", technicalBoundary: "MCP callers own model execution and metering; the server observes submitted usage payloads and never meters hosts directly.", guardTest: "tests/unit/mcp-server-coverage.test.ts#check_governance normalizes caller LLM usage into the emitted hook span" },
    #{ provider: "mcp", capability: "goal-signals", tier: "wrapped", status: "implemented-through-wrapper", promotionDecision: "max-through-wrapper", runtimeEvidence: "MCP prompt templates project goal-signal guidance while server tools govern concrete actions and send Core activities.", technicalBoundary: "Goal signals are expressed through prompts and tool calls because MCP has no ambient host session lifecycle owned by OpenBox.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins reference provider parity closures to every non-native capability claim" },
    #{ provider: "mcp", capability: "tracing", tier: "wrapped", status: "implemented-through-wrapper", promotionDecision: "max-through-wrapper", runtimeEvidence: "MCP check_governance emits span-free parents plus hook_trigger span re-evaluations for LLM, shell, file, HTTP, database, and MCP payloads.", technicalBoundary: "The server can trace submitted payloads but cannot observe host work that clients do not send through the MCP protocol.", guardTest: "tests/unit/mcp-server-coverage.test.ts#check_governance still emits the hook span when the parent verdict blocks" },
    #{ provider: "openai-agents-sdk", capability: "plugins", tier: "out-of-scope", status: "host-unsupported", promotionDecision: "retain-package-boundary", runtimeEvidence: "Public integration support exports the OpenAI Agents SDK helper surface instead of plugin package assets.", technicalBoundary: "OpenAI Agents SDK is a runtime library import surface with no OpenBox-owned plugin package contract.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins plugin support claims to explicit packaged component coverage" },
    #{ provider: "openai-agents-sdk", capability: "skills", tier: "out-of-scope", status: "host-unsupported", promotionDecision: "retain-package-boundary", runtimeEvidence: "OpenAI Agents SDK consumers import generated public helpers; no host skill file is generated for this runtime library surface.", technicalBoundary: "The provider exposes code-level SDK helpers rather than a discoverable skill folder, so skill assets remain host-package out of scope.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins skill support claims to explicit skill surface coverage" },
    #{ provider: "openai-agents-sdk", capability: "mcp", tier: "observe-only", status: "host-owned-observe-only", promotionDecision: "retain-host-owned-boundary", runtimeEvidence: "OpenAI tracing processor observes MCP tool spans, hosted tools, generations, handoffs, guardrails, and usage when the host SDK exposes them.", technicalBoundary: "Host applications own MCP server and client configuration; OpenBox SDK helpers do not install or pre-gate that host-owned MCP setup.", guardTest: "tests/unit/openai-agents-sdk.test.ts#observes OpenAI trace spans for generations, handoffs, guardrails, and tools" },
    #{ provider: "openai-agents-sdk", capability: "rules-instructions", tier: "wrapped", status: "implemented-through-wrapper", promotionDecision: "max-through-wrapper", runtimeEvidence: "OpenAI Agents SDK wrappers send input, output, tool, and run lifecycle payloads to Core and map verdicts into native guardrail results.", technicalBoundary: "OpenBox can wrap native callbacks and helpers but cannot own the provider's internal agent planner or tool scheduler.", guardTest: "tests/unit/openai-agents-sdk.test.ts#maps OpenBox tool guardrail verdicts to fail-closed tool behavior" },
    #{ provider: "openai-agents-sdk", capability: "subagents-agents", tier: "observe-only", status: "host-owned-observe-only", promotionDecision: "retain-host-owned-boundary", runtimeEvidence: "OpenAI tracing observes handoff spans, agents-as-tools, hosted tools, generation spans, and usage after the SDK produces them.", technicalBoundary: "OpenAI Agents SDK owns handoff orchestration and hosted tool execution; OpenBox receives trace observations where exposed.", guardTest: "tests/unit/openai-agents-sdk.test.ts#observes OpenAI trace spans for generations, handoffs, guardrails, and tools" },
    #{ provider: "openai-agents-sdk", capability: "approvals-hitl", tier: "wrapped", status: "implemented-through-wrapper", promotionDecision: "max-through-wrapper", runtimeEvidence: "OpenAI Agents SDK guardrail wrappers surface require_approval in outputInfo and fail closed for governed tool execution.", technicalBoundary: "The SDK offers guardrail callbacks rather than a provider-owned approval UI, so OpenBox projects Core verdicts into wrapper outcomes.", guardTest: "tests/unit/openai-agents-sdk.test.ts#maps OpenBox tool guardrail verdicts to fail-closed tool behavior" },
    #{ provider: "openai-agents-sdk", capability: "install-doctor", tier: "diagnose-only", status: "runtime-diagnostic-only", promotionDecision: "implemented-runtime-diagnostic", runtimeEvidence: "verifyOpenBoxAgentsSDKConfig validates runtime enablement, key class, Core URL, signed identity, and defaults without host file mutation.", technicalBoundary: "There is no host install surface for the runtime library; diagnostics validate configuration and never mutate host state or files.", guardTest: "tests/unit/openai-agents-sdk.test.ts#diagnoses runtime-only OpenAI Agents SDK configuration without host file mutation" },
    #{ provider: "anthropic-agent-sdk", capability: "plugins", tier: "out-of-scope", status: "host-unsupported", promotionDecision: "retain-package-boundary", runtimeEvidence: "Public integration support exports Anthropic Agent SDK hook/options helpers instead of a plugin package.", technicalBoundary: "Anthropic Agent SDK is a runtime library surface; Claude Code plugin packaging is covered by the claude-code provider instead.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins plugin support claims to explicit packaged component coverage" },
    #{ provider: "anthropic-agent-sdk", capability: "skills", tier: "out-of-scope", status: "host-unsupported", promotionDecision: "retain-package-boundary", runtimeEvidence: "Anthropic Agent SDK consumers import hook/options helpers; no OpenBox skill folder is generated for the library integration.", technicalBoundary: "The library exposes hooks and options rather than host skill discovery, so file-based skills remain outside this provider surface.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins skill support claims to explicit skill surface coverage" },
    #{ provider: "anthropic-agent-sdk", capability: "mcp", tier: "observe-only", status: "host-owned-observe-only", promotionDecision: "retain-host-owned-boundary", runtimeEvidence: "Anthropic Agent SDK hooks map MCP elicitation and permission events into OpenBox activities when surfaced by the SDK.", technicalBoundary: "Host applications own MCP client and server configuration; OpenBox helpers observe exposed events but do not install MCP config.", guardTest: "tests/unit/anthropic-agent-sdk.test.ts#maps task, config, and elicitation verdicts to Agent SDK outputs" },
    #{ provider: "anthropic-agent-sdk", capability: "rules-instructions", tier: "wrapped", status: "implemented-through-wrapper", promotionDecision: "max-through-wrapper", runtimeEvidence: "Anthropic Agent SDK hook and message wrappers send payloads to Core and project verdicts into permission decisions and hook outputs.", technicalBoundary: "OpenBox controls wrapper projection at hook boundaries but not the provider's internal agent planning or message stream ownership.", guardTest: "tests/unit/anthropic-agent-sdk.test.ts#maps approval-required PreToolUse verdicts to ask or defer" },
    #{ provider: "anthropic-agent-sdk", capability: "subagents-agents", tier: "observe-only", status: "host-owned-observe-only", promotionDecision: "retain-host-owned-boundary", runtimeEvidence: "Anthropic Agent SDK maps Agent/Task tool payloads and official subagent hooks into a2a activity metadata.", technicalBoundary: "The provider owns task and subagent orchestration; OpenBox observes emitted lifecycle payloads and cannot spawn or schedule subagents.", guardTest: "tests/unit/anthropic-agent-sdk.test.ts#marks Agent/Task and subagent hooks as a2a activity metadata" },
    #{ provider: "anthropic-agent-sdk", capability: "approvals-hitl", tier: "wrapped", status: "implemented-through-wrapper", promotionDecision: "max-through-wrapper", runtimeEvidence: "Anthropic PreToolUse and MCP elicitation wrappers map approval-required Core verdicts to ask or defer permission outcomes.", technicalBoundary: "OpenBox can project approval decisions through hook outputs but cannot provide a native provider approval surface beyond those callbacks.", guardTest: "tests/unit/anthropic-agent-sdk.test.ts#maps approval-required PreToolUse verdicts to ask or defer" },
    #{ provider: "anthropic-agent-sdk", capability: "tracing", tier: "wrapped", status: "implemented-through-wrapper", promotionDecision: "max-through-wrapper", runtimeEvidence: "Anthropic Agent SDK emits prompt, tool, assistant-output, session, synthetic model-usage, and failure spans with provider source attribution.", technicalBoundary: "OpenBox normalizes hook and message telemetry it receives; provider-owned trace events not exposed by hooks remain outside SDK control.", guardTest: "tests/unit/anthropic-agent-sdk.test.ts#records StopFailure as observe-only failed workflow telemetry" },
    #{ provider: "anthropic-agent-sdk", capability: "install-doctor", tier: "diagnose-only", status: "runtime-diagnostic-only", promotionDecision: "implemented-runtime-diagnostic", runtimeEvidence: "verifyOpenBoxAnthropicAgentSDKConfig validates runtime enablement, key class, Core URL, signed identity, opt-in hook mode, and defaults.", technicalBoundary: "There is no host install surface for the runtime library; diagnostics validate configuration and never mutate host state or files.", guardTest: "tests/unit/anthropic-agent-sdk.test.ts#diagnoses runtime-only Anthropic Agent SDK configuration without host file mutation" },
    #{ provider: "copilotkit", capability: "hooks", tier: "wrapped", status: "implemented-through-wrapper", promotionDecision: "max-through-wrapper", runtimeEvidence: "createOpenBoxCopilotKitAdapter wraps runtime, LangChain middleware, tools, prompts, outputs, and AG-UI surfaces with Core gates.", technicalBoundary: "OpenBox wraps exposed CopilotKit extension points but does not own CopilotKit's internal runtime scheduler or model execution.", guardTest: "tests/unit/copilotkit-adapter.test.ts#pauses on approval-required prompt verdict without calling the model" },
    #{ provider: "copilotkit", capability: "plugins", tier: "out-of-scope", status: "host-unsupported", promotionDecision: "retain-package-boundary", runtimeEvidence: "Public integration support exports CopilotKit adapters, approval helpers, and readiness checks instead of plugin package assets.", technicalBoundary: "CopilotKit exposes runtime and UI integration APIs, not a provider plugin package contract owned by OpenBox.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins plugin support claims to explicit packaged component coverage" },
    #{ provider: "copilotkit", capability: "skills", tier: "out-of-scope", status: "host-unsupported", promotionDecision: "retain-package-boundary", runtimeEvidence: "CopilotKit consumers wire adapters and approval UI helpers; no OpenBox skill file surface is generated for this integration.", technicalBoundary: "The provider integrates through app code and UI routes rather than host skill discovery, so skills are outside this package surface.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins skill support claims to explicit skill surface coverage" },
    #{ provider: "copilotkit", capability: "mcp", tier: "observe-only", status: "host-owned-observe-only", promotionDecision: "retain-host-owned-boundary", runtimeEvidence: "CopilotKit AG-UI runtime events map run, tool, message, state, error, and interrupt events into OpenBox governed activities.", technicalBoundary: "Host applications own MCP-like client/server configuration; OpenBox observes surfaced AG-UI tool events and does not install MCP resources.", guardTest: "tests/unit/copilotkit-adapter.test.ts#maps AG-UI run, tool, message, state, error, and interrupt events through OpenBox gates" },
    #{ provider: "copilotkit", capability: "rules-instructions", tier: "wrapped", status: "implemented-through-wrapper", promotionDecision: "max-through-wrapper", runtimeEvidence: "CopilotKit prompt, tool, output, AG-UI, and approval helper wrappers project Core verdicts into native runtime results.", technicalBoundary: "OpenBox can wrap application-provided CopilotKit surfaces but cannot own the host application's route, UI, or runtime wiring.", guardTest: "tests/unit/copilotkit-adapter.test.ts#emits workflow/tool lifecycle events around a governed tool" },
    #{ provider: "copilotkit", capability: "subagents-agents", tier: "observe-only", status: "host-owned-observe-only", promotionDecision: "retain-host-owned-boundary", runtimeEvidence: "CopilotKit AG-UI and governed tool flows map subagent_type and tool metadata to OpenBox activities when the runtime surfaces them.", technicalBoundary: "CopilotKit and the host app own agent runner orchestration; OpenBox observes exposed lifecycle and tool metadata only.", guardTest: "tests/unit/copilotkit-adapter.test.ts#emits workflow/tool lifecycle events around a governed tool" },
    #{ provider: "copilotkit", capability: "usage-cost", tier: "observe-only", status: "host-owned-observe-only", promotionDecision: "retain-host-owned-boundary", runtimeEvidence: "CopilotKit middleware and AG-UI run completion events route model usage and cost fields through openBoxUsageTelemetryFields.", technicalBoundary: "LangChain and CopilotKit own model calls and billing metadata; OpenBox normalizes surfaced usage but does not meter spend locally.", guardTest: "tests/unit/copilotkit-adapter.test.ts#normalizes usage and cost from AG-UI run completion events" },
    #{ provider: "copilotkit", capability: "tracing", tier: "wrapped", status: "implemented-through-wrapper", promotionDecision: "max-through-wrapper", runtimeEvidence: "CopilotKit adapters emit LLM, tool, AG-UI lifecycle, interrupt, and assistant-output spans with Core-extractable telemetry.", technicalBoundary: "Tracing is complete for wrapped middleware and AG-UI events; host application work outside those adapters remains host-owned.", guardTest: "tests/unit/copilotkit-adapter.test.ts#emits Core-extractable assistant output spans for goal alignment" },
    #{ provider: "copilotkit", capability: "install-doctor", tier: "diagnose-only", status: "runtime-diagnostic-only", promotionDecision: "implemented-runtime-diagnostic", runtimeEvidence: "createOpenBoxReadinessCheck validates runtime Core wiring, backend inventory reachability, approval route dependencies, and capability readiness.", technicalBoundary: "CopilotKit has no OpenBox-owned install surface; diagnostics inspect app wiring and never mutate host routes or files.", guardTest: "tests/unit/copilotkit-adapter.test.ts#readiness treats backend inventory config as optional when Core runtime is configured" },
    #{ provider: "n8n", capability: "hooks", tier: "wrapped", status: "implemented-through-wrapper", promotionDecision: "max-through-wrapper", runtimeEvidence: "n8n helper calls emit user prompt, node pre-execute, node post-execute, and LLM completion events to Core.", technicalBoundary: "OpenBox wraps n8n node helper execution but cannot own the operator-managed n8n scheduler or workflow engine.", guardTest: "tests/unit/govern-invariants.test.ts#n8n runtime helpers send node lifecycle events and hook completion spans" },
    #{ provider: "n8n", capability: "plugins", tier: "wrapped", status: "implemented-through-wrapper", promotionDecision: "max-through-wrapper", runtimeEvidence: "N8N_INTEGRATION_SURFACE generates packaged credentials, Governance, Guardrails, Approval/HITL nodes, templates, examples, and showcase specs.", technicalBoundary: "OpenBox emits package descriptors and templates while n8n installation, activation, and runtime execution remain operator-owned.", guardTest: "tests/unit/runtime-adapters-coverage.test.ts#exports the spec-generated packaged n8n integration surface" },
    #{ provider: "n8n", capability: "skills", tier: "out-of-scope", status: "host-unsupported", promotionDecision: "retain-package-boundary", runtimeEvidence: "N8N_INTEGRATION_SURFACE documents credentials, nodes, templates, examples, and showcase workflows rather than host skill files.", technicalBoundary: "n8n consumes node descriptors and workflow packages, not OpenBox skill folders, so skill installation has no provider surface.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins skill support claims to explicit skill surface coverage" },
    #{ provider: "n8n", capability: "rules-instructions", tier: "wrapped", status: "implemented-through-wrapper", promotionDecision: "max-through-wrapper", runtimeEvidence: "n8n Governance, Guardrails, Approval/HITL, and governed AI Agent descriptors project Core verdicts into workflow behavior.", technicalBoundary: "OpenBox packages nodes and templates but does not own operator workflow design or n8n's internal execution model.", guardTest: "tests/unit/runtime-adapters-coverage.test.ts#exports the spec-generated packaged n8n integration surface" },
    #{ provider: "n8n", capability: "subagents-agents", tier: "observe-only", status: "host-owned-observe-only", promotionDecision: "retain-host-owned-boundary", runtimeEvidence: "n8n governed AI Agent workflow descriptors observe node, tool, and LLM lifecycle around AI Agent workflows.", technicalBoundary: "n8n owns AI Agent orchestration and scheduling; OpenBox observes package-described lifecycle events and helper spans only.", guardTest: "tests/unit/runtime-adapters-coverage.test.ts#exports the spec-generated packaged n8n integration surface" },
    #{ provider: "n8n", capability: "tracing", tier: "wrapped", status: "implemented-through-wrapper", promotionDecision: "max-through-wrapper", runtimeEvidence: "n8n node, LLM, assistant-output, tool, error, and workflow telemetry spans are emitted by pre/post and completion helpers.", technicalBoundary: "OpenBox normalizes helper-emitted telemetry but cannot capture n8n workflow work that bypasses OpenBox nodes or helpers.", guardTest: "tests/unit/govern-invariants.test.ts#n8n generic node completion emits paired parent plus tool hook span" },
    #{ provider: "n8n", capability: "install-doctor", tier: "diagnose-only", status: "runtime-diagnostic-only", promotionDecision: "implemented-runtime-diagnostic", runtimeEvidence: "verifyOpenBoxN8nIntegrationSurface validates packaged credentials, nodes, templates, examples, package ids, and showcase specs.", technicalBoundary: "n8n installation is operator-owned; diagnostics validate generated descriptors and never mutate n8n instances.", guardTest: "tests/unit/runtime-adapters-coverage.test.ts#exports the spec-generated packaged n8n integration surface" },
  ],
  goalSignalGuards: #[
    #{ provider: "codex", tier: "native", entrySurface: "UserPromptSubmit", signalActivity: "user_prompt", firstGovernedSurface: "PromptSubmission", guardTest: "tests/unit/codex-runtime.test.ts#opens the workflow once when Codex starts from a prompt hook", orderGuarantee: "SignalReceived user_prompt precedes PromptSubmission" },
    #{ provider: "cursor", tier: "native", entrySurface: "beforeSubmitPrompt", signalActivity: "user_prompt", firstGovernedSurface: "PromptSubmission", guardTest: "tests/contract/cursor-hook-contract.test.ts#real CursorSession sends spans as parent-plus-hook payloads", orderGuarantee: "SignalReceived user_prompt precedes PromptSubmission" },
    #{ provider: "claude-code", tier: "native", entrySurface: "UserPromptSubmit", signalActivity: "user_prompt", firstGovernedSurface: "PromptSubmission", guardTest: "tests/unit/runtime-claude-code-mappers.test.ts#user-prompt-submit fires PromptSubmission activity", orderGuarantee: "SignalReceived user_prompt precedes PromptSubmission" },
    #{ provider: "openai-agents-sdk", tier: "native", entrySurface: "runWithOpenBox", signalActivity: "user_prompt", firstGovernedSurface: "OpenAIAgentsSDKRun", guardTest: "tests/unit/openai-agents-sdk.test.ts#wraps run() with workflow lifecycle and usage events", orderGuarantee: "SignalReceived user_prompt precedes OpenAIAgentsSDKRun" },
    #{ provider: "anthropic-agent-sdk", tier: "native", entrySurface: "UserPromptSubmit", signalActivity: "user_prompt", firstGovernedSurface: "PromptSubmission", guardTest: "tests/unit/anthropic-agent-sdk.test.ts#emits prompt submit gate after the goal signal without prompt spans", orderGuarantee: "SignalReceived user_prompt precedes PromptSubmission" },
    #{ provider: "copilotkit", tier: "native", entrySurface: "governed tool execute", signalActivity: "user_prompt", firstGovernedSurface: "openbox_governed_action", guardTest: "tests/unit/copilotkit-adapter.test.ts#emits workflow/tool lifecycle events around a governed tool", orderGuarantee: "SignalReceived user_prompt precedes first governed tool activity" },
    #{ provider: "n8n", tier: "native", entrySurface: "emitN8nNodePreExecute", signalActivity: "user_prompt", firstGovernedSurface: "node-pre-execute", guardTest: "tests/unit/govern-invariants.test.ts#n8n runtime helpers send node lifecycle events and hook completion spans", orderGuarantee: "SignalReceived user_prompt precedes node-pre-execute" },
  ],
  usageCostCapabilityGuards: #[
    #{ provider: "codex", tier: "observe-only", usageSurface: "Codex hook envelopes when upstream exposes usage metadata; current hook contracts are not metering surfaces.", normalizedFields: "input_tokens, output_tokens, total_tokens, cache tokens, web_search_requests, cost_usd when present", sharedNormalizer: "Codex usage remains host-owned observe-only; when upstream usage metadata appears, shared normalizeOpenBoxUsage consumes direct and nested provider usage aliases.", costPolicyBoundary: "OpenBox Core remains the source of truth for usage/cost policy; Codex never computes spend locally.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins usage-cost support claims to explicit usage guard coverage" },
    #{ provider: "cursor", tier: "observe-only", usageSurface: "afterAgentResponse and afterAgentThought assistant telemetry when Cursor exposes usage metadata", normalizedFields: "input_tokens, output_tokens, total_tokens, cache tokens, web_search_requests, cost_usd when present", sharedNormalizer: "Cursor assistant-output mappers route usage through normalizeOpenBoxUsage and buildAssistantOutputSpan.", costPolicyBoundary: "OpenBox Core remains the source of truth for usage/cost policy; Cursor observation never enforces spend locally.", guardTest: "tests/unit/cursor-spans.test.ts#afterAgentResponse emits completed assistant-output span" },
    #{ provider: "claude-code", tier: "native", usageSurface: "Claude transcript assistant turns, Stop, MessageDisplay, and final batch usage signals", normalizedFields: "input_tokens, output_tokens, total_tokens, cache_read_input_tokens, cache_creation_input_tokens, web_search_requests, cost_usd", sharedNormalizer: "Claude transcript extraction combines records with combineOpenBoxUsage and emits spans through buildAssistantOutputSpan.", costPolicyBoundary: "OpenBox Core remains the source of truth for usage/cost policy; Claude Code only normalizes telemetry.", guardTest: "tests/unit/runtime-claude-code-mappers.test.ts#message-display aggregates unique Claude assistant message usage without double-counting duplicate transcript rows" },
    #{ provider: "mcp", tier: "observe-only", usageSurface: "check_governance caller-supplied llm activity_input usage", normalizedFields: "input_tokens, output_tokens, total_tokens, cache tokens, web_search_requests, cost_usd when present", sharedNormalizer: "MCP check_governance builds spans with buildSpan, which normalizes llm usage through the shared usage facade.", costPolicyBoundary: "OpenBox Core remains the source of truth for usage/cost policy; MCP does not meter hosts directly.", guardTest: "tests/unit/mcp-server-coverage.test.ts#check_governance normalizes caller LLM usage into the emitted hook span" },
    #{ provider: "openai-agents-sdk", tier: "native", usageSurface: "run results, rawResponses, tracing processor generations, hosted/built-in tool observation", normalizedFields: "input_tokens, output_tokens, total_tokens, cache tokens, web_search_requests, cost_usd", sharedNormalizer: "OpenAI Agents SDK payload helpers route rawResponses through normalizeOpenBoxUsage and buildAssistantOutputSpan.", costPolicyBoundary: "OpenBox Core remains the source of truth for usage/cost policy; SDK helpers only report telemetry.", guardTest: "tests/unit/openai-agents-sdk.test.ts#normalizes raw response usage through the shared usage facade" },
    #{ provider: "anthropic-agent-sdk", tier: "native", usageSurface: "query result messages, usage_EXPERIMENTAL messages, per-model result telemetry", normalizedFields: "input_tokens, output_tokens, total_tokens, cache_read_input_tokens, cache_creation_input_tokens, web_search_requests, cost_usd", sharedNormalizer: "Anthropic Agent SDK payload helpers route usage and modelUsage through normalizeOpenBoxUsage and combineOpenBoxUsage.", costPolicyBoundary: "OpenBox Core remains the source of truth for usage/cost policy; SDK helpers only normalize telemetry.", guardTest: "tests/unit/anthropic-agent-sdk.test.ts#emits per-model synthetic usage spans for multi-model result telemetry" },
    #{ provider: "copilotkit", tier: "observe-only", usageSurface: "LangChain/CopilotKit model end events and AG-UI runtime events when usage metadata is present", normalizedFields: "input_tokens, output_tokens, total_tokens, cache tokens, web_search_requests, cost_usd when present", sharedNormalizer: "CopilotKit middleware and AG-UI events route usage metadata through openBoxUsageTelemetryFields and buildAssistantOutputSpan.", costPolicyBoundary: "OpenBox Core remains the source of truth for usage/cost policy; CopilotKit only observes model usage.", guardTest: "tests/unit/copilotkit-adapter.test.ts#normalizes usage and cost from AG-UI run completion events" },
    #{ provider: "n8n", tier: "native", usageSurface: "emitN8nLlmCompletion and packaged OpenBox governed AI Agent workflow telemetry", normalizedFields: "input_tokens, output_tokens, total_tokens, cache tokens, web_search_requests, cost_usd when present", sharedNormalizer: "n8n helpers route LLM completion usage through assistantOutputTelemetryFields and buildAssistantOutputSpan.", costPolicyBoundary: "OpenBox Core remains the source of truth for usage/cost policy; n8n nodes only normalize telemetry.", guardTest: "tests/unit/govern-invariants.test.ts#n8n runtime helpers send node lifecycle events and hook completion spans" },
  ],
  usageNormalization: #{
    minimumValue: 0,
    tokenValuesRequireIntegers: true,
    canonicalFields: #["input_tokens", "output_tokens", "total_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "web_search_requests", "cost_usd"],
    inputTokenAliases: #["inputTokens", "promptTokens", "input_tokens", "prompt_tokens", "inputTokenCount", "promptTokenCount", "input_token_count", "prompt_token_count"],
    outputTokenAliases: #["outputTokens", "completionTokens", "output_tokens", "completion_tokens", "outputTokenCount", "candidatesTokenCount", "responseTokenCount", "output_token_count", "candidates_token_count", "response_token_count"],
    totalTokenAliases: #["totalTokens", "total_tokens", "totalTokenCount", "total_token_count"],
    cacheReadInputTokenAliases: #["cacheReadInputTokens", "cache_read_input_tokens", "input_tokens_details.cached_tokens", "prompt_tokens_details.cached_tokens", "inputTokensDetails.cachedTokens", "promptTokensDetails.cachedTokens"],
    cacheCreationInputTokenAliases: #["cacheCreationInputTokens", "cache_creation_input_tokens"],
    webSearchRequestAliases: #["webSearchRequests", "web_search_requests"],
    costUsdAliases: #["costUsd", "costUSD", "cost_usd", "total_cost_usd"],
    providerUsageContainers: #["usage_metadata", "usageMetadata", "usage", "token_usage", "response_metadata.usage", "response_metadata.token_usage", "llm_output.token_usage", "providerData.response.usage", "providerData.rawResponse.usage"],
    providerModelFields: #["model", "model_name", "modelName", "response_metadata.model", "response_metadata.model_name", "response_metadata.modelName", "llm_output.model", "providerData.model", "providerData.response.model", "providerData.rawResponse.model"],
    providerFinishReasonFields: #["finish_reason", "finishReason", "response_metadata.finish_reason", "response_metadata.finishReason", "providerData.finish_reason", "providerData.finishReason", "providerData.response.finish_reason", "providerData.response.finishReason"],
    policyBoundary: "OpenBox Core remains the source of truth for usage/cost policy. SDKs normalize telemetry fields only and never locally enforce spend.",
  },
  tracingCapabilityGuards: #[
    #{ provider: "codex", tier: "wrapped", traceSurface: "UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, Stop", spanCoverage: "Codex shell, file, HTTP, MCP, database, agent/action, and assistant-output spans", spanEmission: "Parent activities omit spans; hook_trigger re-evaluations carry span_count=1 and per-span payloads.", sourceAttribution: "metadata.source, activity input _openbox_source, and span module are stamped as codex.", guardTest: "tests/unit/codex-runtime.test.ts#stamps Codex source and shell spans in paired tool mappers" },
    #{ provider: "cursor", tier: "wrapped", traceSurface: "before/after prompt, shell, file, MCP, assistant response, thought, and subagent hooks", spanCoverage: "Cursor file_read, file_write, shell/internal, MCP, LLM, HTTP, and assistant-output spans", spanEmission: "Tool/assistant spans are emitted on hook_trigger payloads while parent lifecycle events remain span-free where required.", sourceAttribution: "metadata.source, activity input _openbox_source, and span module are stamped as cursor.", guardTest: "tests/unit/cursor-spans.test.ts#before/after shell execution keeps one activity id across the tool lifecycle" },
    #{ provider: "claude-code", tier: "native", traceSurface: "Claude Code prompts, tools, batches, subagents, compaction, session, and assistant output", spanCoverage: "Claude Code shell, MCP, HTTP, file, database, Python-style root-field, Mastra-style camelCase, and assistant-output spans", spanEmission: "Parent activities omit spans; each hook_trigger re-evaluation carries one normalized span with the parent activity_id.", sourceAttribution: "metadata.source, activity input _openbox_source, and span module are stamped as claude-code.", guardTest: "tests/unit/govern-invariants.test.ts#ActivityStarted spans are emitted as parent plus per-span hook re-evaluations" },
    #{ provider: "mcp", tier: "wrapped", traceSurface: "check_governance tool over stdio or Streamable HTTP", spanCoverage: "MCP check spans normalize caller-supplied llm, shell, file, HTTP, database, and MCP payloads", spanEmission: "check_governance emits a span-free parent plus hook_trigger span re-evaluation for Core behavior matching.", sourceAttribution: "metadata.source, activity input _openbox_source, and span module are stamped as mcp or cursor-mcp.", guardTest: "tests/unit/mcp-server-coverage.test.ts#check_governance still emits the hook span when the parent verdict blocks" },
    #{ provider: "openai-agents-sdk", tier: "native", traceSurface: "AgentHooks lifecycle and OpenAI tracing processor spans", spanCoverage: "OpenAI generation, handoff, guardrail, hosted tool, built-in tool, MCP tool, and usage spans", spanEmission: "Tracing processor emits Core activities for observed spans even when they cannot be pre-gated.", sourceAttribution: "metadata.source, activity input _openbox_source, and span module are stamped as openai-agents-sdk.", guardTest: "tests/unit/openai-agents-sdk.test.ts#observes OpenAI trace spans for generations, handoffs, guardrails, and tools" },
    #{ provider: "anthropic-agent-sdk", tier: "wrapped", traceSurface: "Anthropic Agent SDK hook events, query messages, result messages, usage messages, and elicitation", spanCoverage: "Anthropic Agent SDK prompt, tool, assistant-output, session, synthetic model-usage, and failure spans", spanEmission: "Assistant/tool outputs emit span-free parents plus hook_trigger span re-evaluations where Core needs spans.", sourceAttribution: "metadata.source, activity input _openbox_source, and span module are stamped as anthropic-agent-sdk.", guardTest: "tests/unit/anthropic-agent-sdk.test.ts#records StopFailure as observe-only failed workflow telemetry" },
    #{ provider: "copilotkit", tier: "wrapped", traceSurface: "CopilotKit middleware, governed tools, AG-UI lifecycle, tool, state, error, and interrupt events", spanCoverage: "CopilotKit LLM, tool, AG-UI lifecycle, interrupt, and assistant-output spans", spanEmission: "Middleware emits span-free parent completion events plus hook_trigger assistant-output span re-evaluations.", sourceAttribution: "metadata.source, activity input _openbox_source, and span module are stamped as copilotkit.", guardTest: "tests/unit/copilotkit-adapter.test.ts#emits Core-extractable assistant output spans for goal alignment" },
    #{ provider: "n8n", tier: "wrapped", traceSurface: "n8n node pre/post execution, LLM completion helpers, and governed AI Agent workflow template", spanCoverage: "n8n node, LLM, assistant-output, tool, error, and workflow telemetry spans", spanEmission: "n8n post/LLM helpers emit span-free parent completions plus hook_trigger span re-evaluations.", sourceAttribution: "metadata.source, activity input _openbox_source, and span module are stamped as n8n.", guardTest: "tests/unit/govern-invariants.test.ts#n8n generic node completion emits paired parent plus tool hook span" },
  ],
  hitlCapabilityGuards: #[
    #{ provider: "codex", tier: "native", requireApprovalSurface: "PreToolUse permission gate", sourceAttribution: "metadata.source | input[0]._openbox_source | spans[0].module", nativeSurface: "Codex permission ask/defer hook output", fallbackSurface: "Core polling plus MCP/CLI approval tools", guardTest: "tests/unit/codex-runtime.test.ts#maps approval-required PreToolUse verdicts to Codex permission ask", failClosedBehavior: "Permission gates ask/defer when available and otherwise deny or block unsafe continuation." },
    #{ provider: "cursor", tier: "native", requireApprovalSurface: "beforeShellExecution and beforeSubmitPrompt", sourceAttribution: "metadata.source | input[0]._openbox_source | spans[0].module", nativeSurface: "Cursor notification with deny/continue:false hook output", fallbackSurface: "Core polling plus MCP/CLI approval tools", guardTest: "tests/contract/cursor-hook-contract.test.ts#cursor-permission require_approval (poll timed out) -> deny (ask is silently no-op in Cursor; deny is the only working gate)", failClosedBehavior: "Cursor returns deny or continue:false when approval remains pending." },
    #{ provider: "claude-code", tier: "native", requireApprovalSurface: "PreToolUse and PermissionRequest", sourceAttribution: "metadata.source | input[0]._openbox_source | spans[0].module", nativeSurface: "Claude Code permissionDecision ask/defer", fallbackSurface: "Core polling plus MCP/CLI approval tools", guardTest: "tests/unit/runtime-adapters.test.ts#permission-decision require_approval -> permissionDecision:\"ask\"", failClosedBehavior: "Claude Code asks/defer on permission gates and blocks decision-block surfaces while approval is pending." },
    #{ provider: "mcp", tier: "native", requireApprovalSurface: "check_governance", sourceAttribution: "metadata.source | input[0]._openbox_source | spans[0].module", nativeSurface: "list_pending_approvals and decide_approval MCP tools", fallbackSurface: "Core approval rows", guardTest: "tests/unit/mcp-server-coverage.test.ts#stamps Cursor MCP governance approvals with cursor-mcp source", failClosedBehavior: "MCP callers halt on require_approval until decide_approval resolves the Core row." },
    #{ provider: "openai-agents-sdk", tier: "wrapped", requireApprovalSurface: "input, output, tool input, and tool output guardrails", sourceAttribution: "metadata.source | input[0]._openbox_source | spans[0].module", nativeSurface: "OpenBox guardrail outputInfo or throwException behavior", fallbackSurface: "Caller-managed interruption or Core polling", guardTest: "tests/unit/openai-agents-sdk.test.ts#maps OpenBox tool guardrail verdicts to fail-closed tool behavior", failClosedBehavior: "Guardrails surface require_approval in outputInfo and throw for tool execution." },
    #{ provider: "anthropic-agent-sdk", tier: "wrapped", requireApprovalSurface: "PreToolUse", sourceAttribution: "metadata.source | input[0]._openbox_source | spans[0].module", nativeSurface: "Anthropic hook permissionDecision ask/defer", fallbackSurface: "Core polling plus MCP/CLI approval tools", guardTest: "tests/unit/anthropic-agent-sdk.test.ts#maps approval-required PreToolUse verdicts to ask or defer", failClosedBehavior: "Anthropic Agent SDK asks/defer on permission gates and blocks unsupported continuation." },
    #{ provider: "copilotkit", tier: "native", requireApprovalSurface: "governed tool resume and pollApproval", sourceAttribution: "metadata.source | input[0]._openbox_source | spans[0].module", nativeSurface: "React renderers, headless approval client, and approval route", fallbackSurface: "Core polling plus MCP/CLI approval tools", guardTest: "tests/unit/copilotkit-adapter.test.ts#does not reopen approval after an approved resume completes the tool", failClosedBehavior: "CopilotKit interrupts/polls until approval resolves and does not reopen completed approvals." },
    #{ provider: "n8n", tier: "native", requireApprovalSurface: "emitN8nNodePreExecute", sourceAttribution: "metadata.source | input[0]._openbox_source | spans[0].module", nativeSurface: "OpenBox Approval/HITL node", fallbackSurface: "Core polling plus MCP/CLI approval tools", guardTest: "tests/unit/govern-invariants.test.ts#n8n pre-execute approvals keep source attribution through Core polling", failClosedBehavior: "n8n pre-execute gates poll Core and preserve n8n source attribution." },
  ],
  guardrailCapabilityGuards: #[
    #{ provider: "codex", tier: "native", governedSurfaces: "UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse", coreContract: "Codex hook payloads are sent to OpenBox Core guardrails before continuation and returned verdicts are projected into Codex hook decisions.", redactionBehavior: "Prompt redaction that Codex cannot safely replace blocks; supported tool/output redaction is returned through the host output shape.", failClosedBehavior: "Unsupported or failed redaction blocks or denies continuation instead of allowing the original payload through.", guardTest: "tests/unit/codex-runtime.test.ts#fails closed when submitted prompt redaction cannot be applied by Codex" },
    #{ provider: "cursor", tier: "native", governedSurfaces: "beforeSubmitPrompt, beforeShellExecution, beforeReadFile, beforeMCPExecution, assistant output hooks", coreContract: "Cursor hook payloads and spans are sent to OpenBox Core guardrails; hook decisions enforce the returned verdict.", redactionBehavior: "Prompt and tool input redaction must arrive as a host-compatible replacement, otherwise Cursor returns deny or continue:false.", failClosedBehavior: "Field-only or unsupported redaction fails closed with deny/continue:false instead of passing the unredacted action.", guardTest: "tests/unit/runtime-adapters.test.ts#cursor-continue prompt field-only redaction fails closed" },
    #{ provider: "claude-code", tier: "native", governedSurfaces: "UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse", coreContract: "Claude Code hook activities send prompt/tool/output payloads to OpenBox Core guardrails and enforce the returned verdict.", redactionBehavior: "Decision-block prompt redaction requires a host-compatible replacement; unsupported redaction becomes a block.", failClosedBehavior: "Unsupported guardrail transforms block the Claude Code decision surface before unsafe continuation.", guardTest: "tests/unit/runtime-adapters.test.ts#decision-block prompt constrain with redaction fails closed" },
    #{ provider: "mcp", tier: "native", governedSurfaces: "check_governance tool plus guardrail review resources/prompts", coreContract: "check_governance sends caller-provided spans and activity payloads to OpenBox Core guardrails and returns the Core verdict.", redactionBehavior: "MCP exposes Core redaction fields in the verdict and does not mutate or reinterpret guardrail results locally.", failClosedBehavior: "MCP callers halt on block, halt, failed guardrails, or require_approval until Core returns a safe terminal decision.", guardTest: "tests/unit/mcp-server-coverage.test.ts#check_governance still emits the hook span when the parent verdict blocks" },
    #{ provider: "openai-agents-sdk", tier: "native", governedSurfaces: "input, output, tool input, and tool output guardrail helpers", coreContract: "OpenAI Agents SDK guardrail helpers send native guardrail payloads to OpenBox Core and project Core verdicts into native guardrail outcomes.", redactionBehavior: "Tool input/output redaction must provide a replacement payload that the SDK helper can return; field-only replacements are rejected.", failClosedBehavior: "Unsupported redaction throws or trips the guardrail instead of executing the original tool payload.", guardTest: "tests/unit/openai-agents-sdk.test.ts#fails closed when constrained tool input has field-only redaction" },
    #{ provider: "anthropic-agent-sdk", tier: "native", governedSurfaces: "UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, Elicitation", coreContract: "Anthropic Agent SDK hook payloads and message observations are sent to OpenBox Core guardrails; Core verdicts drive hook outcomes.", redactionBehavior: "Prompt/tool redaction must be represented as updated prompt/tool output when supported; field-only prompt redaction blocks.", failClosedBehavior: "Unsupported redaction blocks or denies the Anthropic Agent SDK hook surface before unsafe continuation.", guardTest: "tests/unit/anthropic-agent-sdk.test.ts#fails closed on field-only prompt redaction without replacement input" },
    #{ provider: "copilotkit", tier: "native", governedSurfaces: "prompt gates, tool gates, output gates, AG-UI interrupt/HITL flow", coreContract: "CopilotKit adapters send prompt/tool/output activities to OpenBox Core guardrails and map Core verdicts into runtime and interruption results.", redactionBehavior: "Output transforms use Core-provided redacted content without legacy placeholders; failed guardrails interrupt or block execution.", failClosedBehavior: "Failed guardrails or unsupported transforms fail closed by skipping execution, interrupting, or returning blocked results.", guardTest: "tests/unit/copilotkit-adapter.test.ts#treats Core output guardrail transforms as constrained without legacy placeholders" },
    #{ provider: "n8n", tier: "native", governedSurfaces: "emitN8nNodePreExecute, emitN8nNodePostExecute, emitN8nLlmCompletion, OpenBox Guardrails node descriptor", coreContract: "n8n helper payloads and node/LLM spans are sent to OpenBox Core guardrails; n8n nodes/templates enforce the returned verdict.", redactionBehavior: "Core redacted input/output is preserved on the WorkflowVerdict while source-attributed n8n payloads remain available for audit.", failClosedBehavior: "n8n pre/post helpers block, halt, or require approval from Core instead of continuing after failed guardrails.", guardTest: "tests/unit/govern-invariants.test.ts#n8n pre-execute guardrail constraints keep redaction and source attribution" },
  ],
  policyEvaluationGuards: #[
    #{ provider: "codex", tier: "native", authority: "OpenBox Core/backend", sdkResponsibility: "send complete spans and source-attributed inputs; enforce returned verdicts fail-closed", allowedLocalWork: "Rego source shape validation, instruction/rule projection, backend client calls", forbiddenLocalWork: "OPA/Rego evaluation or behavior-rule matching in SDK/runtime code", guardTest: "tests/unit/policy-evaluation-guard.test.ts#keeps OPA/Rego and behavior-rule evaluation backend-owned in SDK sources" },
    #{ provider: "cursor", tier: "native", authority: "OpenBox Core/backend", sdkResponsibility: "send complete spans and source-attributed inputs; enforce returned verdicts fail-closed", allowedLocalWork: "Cursor .mdc projection and backend reads", forbiddenLocalWork: "OPA/Rego evaluation or behavior-rule matching in SDK/runtime code", guardTest: "tests/unit/policy-evaluation-guard.test.ts#keeps OPA/Rego and behavior-rule evaluation backend-owned in SDK sources" },
    #{ provider: "claude-code", tier: "native", authority: "OpenBox Core/backend", sdkResponsibility: "send complete spans and source-attributed inputs; enforce returned verdicts fail-closed", allowedLocalWork: "CLAUDE/AGENTS-style instruction projection and backend reads", forbiddenLocalWork: "OPA/Rego evaluation or behavior-rule matching in SDK/runtime code", guardTest: "tests/unit/policy-evaluation-guard.test.ts#keeps OPA/Rego and behavior-rule evaluation backend-owned in SDK sources" },
    #{ provider: "mcp", tier: "native", authority: "OpenBox Core/backend", sdkResponsibility: "send check_governance spans to Core and expose policy/rule resources without evaluating them", allowedLocalWork: "MCP prompts, resource templates, list/read tools, and backend check_governance calls", forbiddenLocalWork: "OPA/Rego evaluation or behavior-rule matching in SDK/runtime code", guardTest: "tests/unit/policy-evaluation-guard.test.ts#keeps OPA/Rego and behavior-rule evaluation backend-owned in SDK sources" },
    #{ provider: "openai-agents-sdk", tier: "native", authority: "OpenBox Core/backend", sdkResponsibility: "send guardrail/tool/run spans to Core; project returned verdicts into native SDK guardrails", allowedLocalWork: "guardrail helper wrapping and tracing observation", forbiddenLocalWork: "OPA/Rego evaluation or behavior-rule matching in SDK/runtime code", guardTest: "tests/unit/policy-evaluation-guard.test.ts#keeps OPA/Rego and behavior-rule evaluation backend-owned in SDK sources" },
    #{ provider: "anthropic-agent-sdk", tier: "native", authority: "OpenBox Core/backend", sdkResponsibility: "send hook/message/tool spans to Core; enforce returned verdicts", allowedLocalWork: "options/workspace governance payload construction and backend reads", forbiddenLocalWork: "OPA/Rego evaluation or behavior-rule matching in SDK/runtime code", guardTest: "tests/unit/policy-evaluation-guard.test.ts#keeps OPA/Rego and behavior-rule evaluation backend-owned in SDK sources" },
    #{ provider: "copilotkit", tier: "native", authority: "OpenBox Core/backend", sdkResponsibility: "send prompt/tool/output spans to Core; project returned verdicts into CopilotKit flows", allowedLocalWork: "runtime middleware wrapping, AG-UI observation, and approval helpers", forbiddenLocalWork: "OPA/Rego evaluation or behavior-rule matching in SDK/runtime code", guardTest: "tests/unit/policy-evaluation-guard.test.ts#keeps OPA/Rego and behavior-rule evaluation backend-owned in SDK sources" },
    #{ provider: "n8n", tier: "native", authority: "OpenBox Core/backend", sdkResponsibility: "send node/LLM spans to Core; project returned verdicts into n8n nodes/templates", allowedLocalWork: "node/template descriptor generation and helper payload construction", forbiddenLocalWork: "OPA/Rego evaluation or behavior-rule matching in SDK/runtime code", guardTest: "tests/unit/policy-evaluation-guard.test.ts#keeps OPA/Rego and behavior-rule evaluation backend-owned in SDK sources" },
  ],
  rulesInstructionCapabilityGuards: #[
    #{ provider: "codex", tier: "wrapped", projectionSurface: "AGENTS.md/OpenBox skill governance instructions plus .codex/rules exact shell-prefix rules when behavior-rule renderer hints include codexCommandPrefix, commandPrefix, or exactShellPrefix", sourceOfTruth: "OpenBox Core/backend", allowedProjectionWork: "Render instruction summaries, skill references, source counts, and exact shell command-prefix execution policy only.", forbiddenLocalWork: "OPA/Rego evaluation, behavior-rule matching, or broad policy translation in SDK/runtime code", hostBoundary: "AGENTS.md and skills are advisory instruction surfaces; .codex/rules is limited to command-prefix execution policy and Core verdicts remain enforcement.", guardTest: "tests/unit/rules-projection-coverage.test.ts#renders instruction projections and exact Codex command rules without local policy evaluation" },
    #{ provider: "cursor", tier: "native", projectionSurface: "Cursor plugin rules/openbox.mdc, repo .cursor/rules/openbox-governance.mdc, and per-rule .cursor/rules/openbox-*.mdc projection", sourceOfTruth: "OpenBox Core/backend", allowedProjectionWork: "Render active guardrails, policies, and behavior rules into Cursor .mdc files with source/severity metadata and prune only OpenBox-managed files.", forbiddenLocalWork: "OPA/Rego evaluation, behavior-rule matching, or local verdict computation in SDK/runtime code", hostBoundary: "Cursor .mdc files provide native instruction context; hook decisions and final policy evaluation still come from Core.", guardTest: "tests/unit/cursor-rules-render.test.ts#writes one mdc per rule into .cursor/rules with our header marker" },
    #{ provider: "claude-code", tier: "wrapped", projectionSurface: "Claude Code plugin reviewer agent, slash command guidance, OpenBox skill, and instructions/CLAUDE.md rendered from the shared CLAUDE/AGENTS-style instruction projection", sourceOfTruth: "OpenBox Core/backend", allowedProjectionWork: "Ship reviewer, command, and instruction assets that ask MCP/Core for policies, guardrails, behavior rules, trust, and governance verdicts.", forbiddenLocalWork: "OPA/Rego evaluation, behavior-rule matching, invented endpoint shapes, or local policy decisions in plugin assets", hostBoundary: "Claude Code instruction assets are documentation and review aids; hooks/MCP/Core provide enforcement.", guardTest: "tests/unit/claude-code-plugin.test.ts#exports a complete marketplace-ready plugin folder" },
    #{ provider: "mcp", tier: "native", projectionSurface: "MCP prompts and resource templates for policy review, governance checks, guardrails, policies, behavior rules, approvals, agents, and skills", sourceOfTruth: "OpenBox Core/backend", allowedProjectionWork: "Expose read resources, prompts, and check_governance calls that route proposed actions to Core.", forbiddenLocalWork: "OPA/Rego evaluation, behavior-rule matching, or local guardrail duplication in MCP server code", hostBoundary: "MCP resources and prompts are inspection/check surfaces; clients must call check_governance so Core makes decisions.", guardTest: "tests/unit/mcp-server-coverage.test.ts#registers spec-driven MCP tool annotations, prompts, and resource templates" },
    #{ provider: "openai-agents-sdk", tier: "wrapped", projectionSurface: "OpenAI Agents SDK guardrail helpers and tracing observations that project Core verdicts into native callbacks", sourceOfTruth: "OpenBox Core/backend", allowedProjectionWork: "Wrap input/output/tool guardrails and run lifecycle to send payloads to Core and return native SDK outcomes.", forbiddenLocalWork: "OPA/Rego evaluation, behavior-rule matching, or local policy decisions inside SDK helpers", hostBoundary: "OpenAI Agents SDK helpers provide native callback shapes; Core remains the decision authority.", guardTest: "tests/unit/openai-agents-sdk.test.ts#maps OpenBox tool guardrail verdicts to fail-closed tool behavior" },
    #{ provider: "anthropic-agent-sdk", tier: "wrapped", projectionSurface: "Anthropic Agent SDK options, hooks, message observations, permission events, and workspace-change payloads", sourceOfTruth: "OpenBox Core/backend", allowedProjectionWork: "Build hook/message payloads, observe SDK events, and project returned Core verdicts into Anthropic hook decisions.", forbiddenLocalWork: "OPA/Rego evaluation, behavior-rule matching, or local policy decisions inside SDK helpers", hostBoundary: "Anthropic Agent SDK wrapping maps host events to Core checks; Core-owned verdicts drive continuation.", guardTest: "tests/unit/anthropic-agent-sdk.test.ts#maps approval-required PreToolUse verdicts to ask or defer" },
    #{ provider: "copilotkit", tier: "wrapped", projectionSurface: "CopilotKit prompt, tool, output, AG-UI, and approval helper result shapes", sourceOfTruth: "OpenBox Core/backend", allowedProjectionWork: "Project Core verdicts into CopilotKit runtime results, AG-UI events, interruptions, and approval routes.", forbiddenLocalWork: "OPA/Rego evaluation, behavior-rule matching, or local policy decisions inside CopilotKit adapters", hostBoundary: "CopilotKit surfaces adapt application UI/runtime behavior; Core remains canonical for rules and verdicts.", guardTest: "tests/unit/copilotkit-adapter.test.ts#emits workflow/tool lifecycle events around a governed tool" },
    #{ provider: "n8n", tier: "wrapped", projectionSurface: "n8n Governance, Guardrails, Approval/HITL, and governed AI Agent node/template descriptors", sourceOfTruth: "OpenBox Core/backend", allowedProjectionWork: "Project Core verdicts into n8n node helper outputs, workflow templates, and packaged node descriptors.", forbiddenLocalWork: "OPA/Rego evaluation, behavior-rule matching, or local policy decisions inside n8n helpers", hostBoundary: "n8n nodes/templates are workflow projection surfaces; Core remains canonical for policy, guardrails, and approvals.", guardTest: "tests/unit/runtime-adapters-coverage.test.ts#exports the spec-generated packaged n8n integration surface" },
  ],
  hookCapabilityGuards: #[
    #{ provider: "codex", tier: "native", hookSurface: "Codex hooks/hooks.json in plugin mode and project .codex/hooks.json invoke openbox codex hook.", eventCoverage: "PROVIDER_EVENT_CATALOG generatedAdapterEvents must match CODEX_HOOK_SPEC events for UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, and Stop.", enforcementBoundary: "Codex prompt/tool/output hooks send spans to Core and enforce returned verdicts fail-closed.", fallbackOrOutOfScope: "Project-local install only; no global Codex hook configuration is mutated.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins generated hook events to the event catalog" },
    #{ provider: "cursor", tier: "native", hookSurface: "Cursor plugin hooks/hooks.json and repo .cursor/hooks.json invoke openbox cursor hook.", eventCoverage: "PROVIDER_EVENT_CATALOG generatedAdapterEvents must match CURSOR_HOOK_SPEC events including prompt, file, shell, MCP, subagent, compaction, and stop surfaces.", enforcementBoundary: "Cursor pre-action hooks send spans to Core and enforce guardrail/policy verdicts fail-closed; post hooks observe outputs.", fallbackOrOutOfScope: "Project-local plugin or repo-mode install only; user-level Cursor hook configuration is not mutated.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins generated hook events to the event catalog" },
    #{ provider: "claude-code", tier: "native", hookSurface: "Claude Code plugin hooks/hooks.json invokes the project-local OpenBox CLI runner for default and opt-in hook events.", eventCoverage: "PROVIDER_EVENT_CATALOG generatedAdapterEvents must match CLAUDE_HOOK_SPEC and the official hook matrix, with WorktreeCreate and SessionEnd opt-in by default.", enforcementBoundary: "Claude Code prompt/tool/permission hooks send spans to Core and enforce returned verdicts fail-closed; opt-in worktree hooks are disabled by default.", fallbackOrOutOfScope: "Project-local plugin install only; monitors are opt-in and direct settings writes are avoided.", guardTest: "tests/unit/claude-code-governance-matrix.test.ts#keeps generated HOOK_SPEC aligned with the checked-in official hook matrix" },
    #{ provider: "mcp", tier: "out-of-scope", hookSurface: "No host hook surface exists for MCP itself; MCP is a server protocol.", eventCoverage: "MCP exposes tools, prompts, and resources rather than upstream hook events.", enforcementBoundary: "MCP check_governance sends spans to Core when called; there is no host hook lifecycle to pre-gate.", fallbackOrOutOfScope: "Out-of-scope for hooks because plugin adapters or clients own hook installation.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins hook support claims to explicit hook surface coverage" },
    #{ provider: "openai-agents-sdk", tier: "native", hookSurface: "createOpenBoxAgentHooks returns native OpenAI AgentHooks lifecycle handlers backed by OpenBox sessions.", eventCoverage: "AgentHooks lifecycle covers agent start/end/error, tool start/end/error, and model/output observation through tracing processor helpers.", enforcementBoundary: "Native hook callbacks open sessions and emit Core spans; tracing observes hosted/built-in/MCP tool use that cannot always be pre-gated.", fallbackOrOutOfScope: "No host hook files are installed; consumers import SDK helpers and wire them into OpenAI Agents SDK runs.", guardTest: "tests/unit/openai-agents-sdk.test.ts#creates native AgentHooks lifecycle handlers backed by OpenBox sessions" },
    #{ provider: "anthropic-agent-sdk", tier: "native", hookSurface: "createOpenBoxAnthropicAgentHooks and withOpenBoxAnthropicAgentOptions register Anthropic Agent SDK hook handlers.", eventCoverage: "PROVIDER_EVENT_CATALOG generatedAdapterEvents must match official HOOK_EVENTS, with WorktreeCreate opt-in by default.", enforcementBoundary: "Anthropic Agent SDK hooks send prompt/tool/permission/workspace spans to Core and enforce returned verdicts.", fallbackOrOutOfScope: "No host plugin files are installed; hook helpers are runtime SDK configuration.", guardTest: "tests/unit/anthropic-agent-sdk.test.ts#registers every official Agent SDK hook except WorktreeCreate by default" },
    #{ provider: "copilotkit", tier: "wrapped", hookSurface: "createOpenBoxCopilotKitAdapter wraps CopilotKit runtime, LangChain middleware, tool, prompt, output, and AG-UI surfaces.", eventCoverage: "Wrapped CopilotKit hooks map run lifecycle, messages, tool calls/results, shared state, errors, interrupts, and middleware callbacks to OpenBox activities.", enforcementBoundary: "Wrapped prompt/tool/output gates send spans to Core and project returned verdicts into CopilotKit continuation, interruption, or terminal results.", fallbackOrOutOfScope: "No host hook files are installed; application runtime wiring owns adapter registration.", guardTest: "tests/unit/copilotkit-adapter.test.ts#pauses on approval-required prompt verdict without calling the model" },
    #{ provider: "n8n", tier: "wrapped", hookSurface: "emitN8nUserPromptSignal, emitN8nNodePreExecute, emitN8nNodePostExecute, and emitN8nLlmCompletion provide hook-equivalent gates.", eventCoverage: "Wrapped n8n helpers map node pre/post execution and LLM completion to OpenBox lifecycle and activity spans.", enforcementBoundary: "n8n helper calls send spans to Core and project returned verdicts into node/template behavior.", fallbackOrOutOfScope: "No n8n instance mutation; operator-owned workflows consume packaged node/template descriptors.", guardTest: "tests/unit/govern-invariants.test.ts#n8n runtime helpers send node lifecycle events and hook completion spans" },
  ],
  subagentsAgentsCapabilityGuards: #[
    #{ provider: "codex", tier: "observe-only", agentSurface: "Codex Agent/Task-style tool calls are observed as tool or a2a metadata when surfaced by Codex spans.", lifecycleCoverage: "Codex hook events do not expose a dedicated subagent lifecycle; OpenBox records available agent/task spans where present.", ownershipBoundary: "Observe-only; Codex owns subagent orchestration and OpenBox does not package Codex subagent templates.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins subagents-agents support claims to explicit agent ownership coverage" },
    #{ provider: "cursor", tier: "native", agentSurface: "Cursor subagentStart/subagentStop hooks plus bundled agents/openbox-reviewer.md agent template.", lifecycleCoverage: "CURSOR_HOOK_SPEC and PROVIDER_EVENT_CATALOG include subagentStart and subagentStop, with subagentStart mapped to SubagentStart activity and a2a metadata.", ownershipBoundary: "Native host surface; Cursor owns model orchestration while OpenBox governs/observes subagent hook lifecycle through Core.", guardTest: "tests/unit/cursor-activity-type-drift.test.ts#subagentStart fires SubagentStart" },
    #{ provider: "claude-code", tier: "native", agentSurface: "Claude Code SubagentStart/SubagentStop/TaskCreated/TaskCompleted hooks plus bundled agents/openbox-reviewer.md agent template.", lifecycleCoverage: "CLAUDE_HOOK_SPEC and PROVIDER_EVENT_CATALOG include subagent and task lifecycle events; mapper tests pin AGENT_SPAWN activities and assistant-output spans.", ownershipBoundary: "Native host surface; Claude Code owns orchestration while OpenBox governs/observes subagent and task hook lifecycle through Core.", guardTest: "tests/unit/runtime-claude-code-mappers.test.ts#subagent-start + subagent-stop fire AGENT_SPAWN activities" },
    #{ provider: "mcp", tier: "observe-only", agentSurface: "MCP list_agents, get_agent, and openbox://agent/{agent_id} resources inspect OpenBox agents.", lifecycleCoverage: "MCP can inspect agents and approvals but does not spawn subagents or own multi-agent lifecycle events.", ownershipBoundary: "Observe-only; MCP exposes inspection/governance tools while host clients own agent orchestration.", guardTest: "tests/unit/mcp-server-coverage.test.ts#registers spec-driven MCP tool annotations, prompts, and resource templates" },
    #{ provider: "openai-agents-sdk", tier: "observe-only", agentSurface: "OpenAI Agents SDK handoffs and agents-as-tools are observed through AgentHooks and tracing processor spans.", lifecycleCoverage: "Tracing processor observes handoff spans, hosted tools, built-in tools, MCP tools, generations, and usage after the host SDK produces them.", ownershipBoundary: "Observe-only for multi-agent orchestration; OpenAI Agents SDK owns handoffs/agents-as-tools and OpenBox records spans where available.", guardTest: "tests/unit/openai-agents-sdk.test.ts#observes OpenAI trace spans for generations, handoffs, guardrails, and tools" },
    #{ provider: "anthropic-agent-sdk", tier: "observe-only", agentSurface: "Anthropic Agent SDK Task/Agent tool events and subagent metadata are observed through hook payloads.", lifecycleCoverage: "Official TaskCreated/TaskCompleted/SubagentStart/SubagentStop hooks and Agent/Task tool payloads are normalized with a2a metadata.", ownershipBoundary: "Observe-only for agent orchestration; Anthropic Agent SDK/Claude owns tasks and subagents while OpenBox records/governs exposed hooks.", guardTest: "tests/unit/anthropic-agent-sdk.test.ts#marks Agent/Task and subagent hooks as a2a activity metadata" },
    #{ provider: "copilotkit", tier: "observe-only", agentSurface: "CopilotKit agent runner lifecycle and a2a tool metadata are observed through runtime, middleware, and AG-UI adapters.", lifecycleCoverage: "CopilotKit AG-UI/run lifecycle and governed tool calls map subagent_type/tool metadata to OpenBox activities when surfaced.", ownershipBoundary: "Observe-only for orchestration; CopilotKit/application code owns agent runners while OpenBox observes/gates exposed prompt/tool/runtime events.", guardTest: "tests/unit/copilotkit-adapter.test.ts#emits workflow/tool lifecycle events around a governed tool" },
    #{ provider: "n8n", tier: "observe-only", agentSurface: "n8n governed AI Agent workflow template and node descriptors expose AI Agent workflow surfaces.", lifecycleCoverage: "OpenBox Governance, Guardrails, Approval/HITL, and governed AI Agent descriptors observe node/tool/LLM lifecycle around n8n AI Agent workflows.", ownershipBoundary: "Observe-only for orchestration; n8n owns AI Agent workflow execution while OpenBox nodes/helpers govern exposed workflow surfaces.", guardTest: "tests/unit/runtime-adapters-coverage.test.ts#exports the spec-generated packaged n8n integration surface" },
  ],
  pluginCapabilityGuards: #[
    #{ provider: "codex", tier: "native", packageSurface: "Codex plugin bundle with .codex-plugin/plugin.json plus repo-local .agents/plugins/marketplace.json metadata.", componentCoverage: "Codex plugin components include manifest, marketplace, hooks/hooks.json, plugin .mcp.json, skills/openbox/SKILL.md, AGENTS.md, and exact-prefix .codex/rules/openbox.rules.", installSurface: "exportCodexPlugin/installCodexPlugin and openbox install codex write project-local plugin and marketplace surfaces.", scopeBoundary: "Project-local only; OpenBox does not mutate global or user-level Codex plugin configuration.", guardTest: "tests/unit/codex-install-spec.test.ts#exports and installs Codex plugin, repo skill, and marketplace surfaces" },
    #{ provider: "cursor", tier: "native", packageSurface: "Cursor plugin bundle with .cursor-plugin/plugin.json, .cursor-plugin/marketplace.json, and workspaceOpen.json metadata.", componentCoverage: "Cursor plugin components include hooks, mcp.json, rules/openbox.mdc, commands, agents, skills/openbox/SKILL.md, and workspaceOpen discovery metadata.", installSurface: "exportCursorPlugin/installCursorPlugin install local plugin mode; installCursorRepoMode covers cloud-compatible repo mode separately.", scopeBoundary: "Project-local plugin or repo files only; OpenBox does not mutate user-level Cursor plugin configuration.", guardTest: "tests/unit/cursor-plugin.test.ts#exports a complete marketplace-ready plugin folder" },
    #{ provider: "claude-code", tier: "native", packageSurface: "Claude Code plugin bundle with .claude-plugin/plugin.json and .claude-plugin/marketplace.json metadata.", componentCoverage: "Claude Code plugin components include hooks, .mcp.json, commands, agents, skills/openbox/SKILL.md, diagnostics, bin runner, opt-in monitors metadata, and explicit LSP exclusion.", installSurface: "exportClaudeCodePlugin/installClaudeCodePlugin install the project-local plugin target without direct settings writes.", scopeBoundary: "Project-local plugin target and runtime config only; monitors are opt-in and LSP remains out of scope.", guardTest: "tests/unit/claude-code-plugin.test.ts#exports a complete marketplace-ready plugin folder" },
    #{ provider: "mcp", tier: "out-of-scope", packageSurface: "No MCP plugin package is emitted; MCP is the server protocol surface used by host plugins.", componentCoverage: "Plugin component catalogs are owned by Codex, Cursor, and Claude Code adapters, not the MCP server.", installSurface: "No plugin install surface; openbox mcp serve exposes protocol tools/resources/prompts only.", scopeBoundary: "Out-of-scope for plugins because host adapters own plugin packaging and installation.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins plugin support claims to explicit packaged component coverage" },
    #{ provider: "openai-agents-sdk", tier: "out-of-scope", packageSurface: "No OpenAI Agents SDK plugin package is emitted; consumers import public SDK helpers.", componentCoverage: "Public integration exports cover helper functions; host plugin components are intentionally out of scope.", installSurface: "No plugin install surface for OpenAI Agents SDK helpers.", scopeBoundary: "Out-of-scope for plugins because OpenAI Agents SDK does not consume host plugin bundles.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins plugin support claims to explicit packaged component coverage" },
    #{ provider: "anthropic-agent-sdk", tier: "out-of-scope", packageSurface: "No Anthropic Agent SDK plugin package is emitted; consumers import hook/options helpers.", componentCoverage: "Claude Code plugin packaging is covered under claude-code, not Anthropic Agent SDK.", installSurface: "No plugin install surface for Anthropic Agent SDK helpers.", scopeBoundary: "Out-of-scope for plugins because Anthropic Agent SDK usage is runtime-only.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins plugin support claims to explicit packaged component coverage" },
    #{ provider: "copilotkit", tier: "out-of-scope", packageSurface: "No CopilotKit plugin package is emitted; consumers wire runtime adapters and UI helpers.", componentCoverage: "Public integration exports cover CopilotKit adapters and approval helpers; host plugin components are intentionally out of scope.", installSurface: "No plugin install surface for CopilotKit helpers.", scopeBoundary: "Out-of-scope for plugins because CopilotKit does not consume host plugin bundles.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins plugin support claims to explicit packaged component coverage" },
    #{ provider: "n8n", tier: "wrapped", packageSurface: "Packaged n8n integration descriptor surface, not a Codex/Cursor/Claude host plugin folder.", componentCoverage: "N8N_INTEGRATION_SURFACE covers OpenBox credentials, Governance node, Guardrails node, Approval/HITL node, governed AI Agent template, and examples.", installSurface: "Operator-owned n8n package installation consumes generated descriptors/templates; OpenBox does not mutate n8n instances.", scopeBoundary: "Wrapped descriptor/template surface; n8n installation remains operator-owned and Core/backend remains authoritative for governance.", guardTest: "tests/unit/runtime-adapters-coverage.test.ts#exports the spec-generated packaged n8n integration surface" },
  ],
  skillCapabilityGuards: #[
    #{ provider: "codex", tier: "native", skillSurface: "Codex plugin skills/openbox/SKILL.md and repo .agents/skills/openbox/SKILL.md carry the OpenBox governance skill.", installSurface: "exportCodexPlugin/installCodexPlugin and openbox install codex install project-local skill assets without user-level writes.", discoverySurface: "Codex plugin manifest, repo marketplace metadata, and AGENTS.md instruction projection reference the OpenBox skill.", hostBoundary: "Skills are advisory host instructions; Core/backend remains authoritative for guardrails, OPA/Rego, approvals, and verdict enforcement.", guardTest: "tests/unit/codex-install-spec.test.ts#exports and installs Codex plugin, repo skill, and marketplace surfaces" },
    #{ provider: "cursor", tier: "native", skillSurface: "Cursor plugin skills/openbox/SKILL.md and cloud-compatible repo .agents/skills/openbox/SKILL.md carry the OpenBox governance skill.", installSurface: "installCursorPlugin and installCursorRepoMode write project-local plugin or repo skill assets and preserve unrelated workspace files.", discoverySurface: "Cursor plugin metadata, workspaceOpen metadata, and repo .agents/skills/openbox expose the OpenBox skill to local and cloud-compatible modes.", hostBoundary: "Skills provide native host context only; OpenBox Core/backend remains authoritative for guardrails, OPA/Rego, approvals, and verdicts.", guardTest: "tests/unit/cursor-plugin.test.ts#installs and uninstalls cloud-compatible repo mode files" },
    #{ provider: "claude-code", tier: "native", skillSurface: "Claude Code plugin skills/openbox/SKILL.md carries the OpenBox governance skill inside the project-local plugin bundle.", installSurface: "exportClaudeCodePlugin/installClaudeCodePlugin install the plugin under the project-local target without direct settings writes.", discoverySurface: "Claude Code plugin manifest, marketplace metadata, commands, agents, and diagnostics inventory reference the bundled OpenBox skill.", hostBoundary: "Plugin skills and commands are host instruction assets; Core/backend remains authoritative for guardrails, OPA/Rego, approvals, and verdicts.", guardTest: "tests/unit/claude-code-plugin.test.ts#exports a complete marketplace-ready plugin folder" },
    #{ provider: "mcp", tier: "native", skillSurface: "MCP exposes OpenBox skill reference markdown through the openbox://skill/{name} resource template.", installSurface: "openbox mcp serve registers the generated skill-reference resource template; host-specific skill file installs remain adapter-owned.", discoverySurface: "MCP_RESOURCE_TEMPLATE_SURFACES includes skill-reference so clients can discover skill documentation without language-specific SDK code.", hostBoundary: "MCP skill resources are read/inspection surfaces; Core/backend remains authoritative for guardrails, OPA/Rego, approvals, and verdicts.", guardTest: "tests/unit/mcp-server-coverage.test.ts#registers spec-driven MCP tool annotations, prompts, and resource templates" },
    #{ provider: "openai-agents-sdk", tier: "out-of-scope", skillSurface: "No OpenBox skill file surface is installed for OpenAI Agents SDK; consumers import SDK helpers instead.", installSurface: "No skill installation occurs for OpenAI Agents SDK helpers.", discoverySurface: "Public integration exports document helper support; Codex/host skill assets are intentionally out of scope.", hostBoundary: "Out-of-scope for skills because OpenAI Agents SDK does not consume Codex/Cursor/Claude Code skill assets.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins skill support claims to explicit skill surface coverage" },
    #{ provider: "anthropic-agent-sdk", tier: "out-of-scope", skillSurface: "No OpenBox skill file surface is installed for Anthropic Agent SDK; consumers import hook/options helpers instead.", installSurface: "No skill installation occurs for Anthropic Agent SDK helpers.", discoverySurface: "Public integration exports document helper support; host skill assets are intentionally out of scope.", hostBoundary: "Out-of-scope for skills because Anthropic Agent SDK usage is separate from host plugin skill assets.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins skill support claims to explicit skill surface coverage" },
    #{ provider: "copilotkit", tier: "out-of-scope", skillSurface: "No OpenBox skill file surface is installed for CopilotKit; consumers wire runtime adapters and approval UI helpers instead.", installSurface: "No skill installation occurs for CopilotKit runtime or React helpers.", discoverySurface: "Public integration exports document helper support; host skill assets are intentionally out of scope.", hostBoundary: "Out-of-scope for skills because CopilotKit does not consume Codex/Cursor/Claude Code skill assets.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins skill support claims to explicit skill surface coverage" },
    #{ provider: "n8n", tier: "out-of-scope", skillSurface: "No OpenBox skill file surface is installed for n8n; OpenBox ships node descriptors and workflow templates instead.", installSurface: "No skill installation occurs for the n8n integration descriptors.", discoverySurface: "N8N_INTEGRATION_SURFACE documents credentials, nodes, templates, and examples rather than host skill files.", hostBoundary: "Out-of-scope for skills because n8n consumes package descriptors/templates, not host plugin skill assets.", guardTest: "tests/unit/provider-capability-matrix.test.ts#pins skill support claims to explicit skill surface coverage" },
  ],
  mcpCapabilityGuards: #[
    #{ provider: "codex", tier: "native", serverSurface: "OpenBox MCP server launched by Codex through trusted project .codex/config.toml or plugin-bundled .mcp.json.", configSurface: ".codex/config.toml project entry plus Codex plugin .mcp.json; .codex/mcp.json is intentionally not used.", toolResourcePromptCoverage: "Shared MCP tools, prompts, resource templates, openbox_status, check_governance, and codex_doctor are available to Codex/MCP clients.", hostBoundary: "Project-local config only; OpenBox does not mutate global Codex config and Core evaluates governance decisions.", guardTest: "tests/unit/codex-install-spec.test.ts#writes Codex MCP config to trusted .codex/config.toml, not .codex/mcp.json" },
    #{ provider: "cursor", tier: "native", serverSurface: "OpenBox MCP server launched from Cursor plugin mcp.json or cloud-compatible repo .cursor/mcp.json.", configSurface: "Cursor plugin mcp.json and repo .cursor/mcp.json project entries; user-level Cursor MCP files are not written.", toolResourcePromptCoverage: "Shared MCP tools, prompts, resource templates, openbox_status, check_governance, and cursor_doctor back slash commands and diagnostics.", hostBoundary: "Project-local/plugin config only; OpenBox preserves other MCP servers and Core evaluates governance decisions.", guardTest: "tests/unit/cursor-mcp-install-coverage.test.ts#installs and uninstalls the project Cursor MCP entry without touching other servers" },
    #{ provider: "claude-code", tier: "native", serverSurface: "OpenBox MCP server launched from Claude Code plugin .mcp.json through the bundled project-local Node runner.", configSurface: "Claude Code plugin .mcp.json and project .mcp.json openbox command entries.", toolResourcePromptCoverage: "Shared MCP tools, prompts, resource templates, openbox_status, check_governance, and claude_code_doctor back slash commands and diagnostics.", hostBoundary: "Project-local plugin config only; OpenBox avoids direct settings writes and Core evaluates governance decisions.", guardTest: "tests/unit/claude-code-plugin.test.ts#exports a complete marketplace-ready plugin folder" },
    #{ provider: "mcp", tier: "native", serverSurface: "openbox mcp serve exposes the OpenBox MCP server over stdio or optional Streamable HTTP transport.", configSurface: "CLI transport options --transport stdio|http, --host, and --port; host config entries remain adapter-owned.", toolResourcePromptCoverage: "MCP_TOOL_SURFACES, MCP_PROMPT_SURFACES, and MCP_RESOURCE_TEMPLATE_SURFACES are generated from TypeSpec and registered by the server.", hostBoundary: "MCP server exposes tools/resources/prompts and sends check_governance to Core; it does not own host plugin installation.", guardTest: "tests/unit/mcp-server-coverage.test.ts#registers spec-driven MCP tool annotations, prompts, and resource templates" },
    #{ provider: "openai-agents-sdk", tier: "observe-only", serverSurface: "No OpenBox-owned MCP server install; OpenAI Agents SDK MCP tool usage is observed through tracing when the host app exposes spans.", configSurface: "Host application owns MCP server/client configuration; OpenBox SDK helpers do not install MCP config.", toolResourcePromptCoverage: "MCP tool calls are observed as tool spans and usage telemetry when tracing exposes mcp_data; no MCP prompts/resources are registered by the SDK.", hostBoundary: "Observe-only; hosted MCP tools may execute before observation, so Core receives spans where available instead of pre-gating host-owned MCP execution.", guardTest: "tests/unit/openai-agents-sdk.test.ts#observes OpenAI trace spans for generations, handoffs, guardrails, and tools" },
    #{ provider: "anthropic-agent-sdk", tier: "observe-only", serverSurface: "No OpenBox-owned MCP server install; Anthropic Agent SDK MCP elicitation/status events are observed when hooks expose them.", configSurface: "Host application owns MCP server/client configuration; OpenBox SDK helpers do not install MCP config.", toolResourcePromptCoverage: "MCP elicitation and permission events are mapped into OpenBox activities when surfaced by the SDK; no MCP prompts/resources are registered by the SDK.", hostBoundary: "Observe-only except governed hook payloads; Core receives elicitation/tool spans when the SDK exposes them.", guardTest: "tests/unit/anthropic-agent-sdk.test.ts#maps task, config, and elicitation verdicts to Agent SDK outputs" },
    #{ provider: "copilotkit", tier: "observe-only", serverSurface: "No OpenBox-owned MCP server install; CopilotKit observes MCP-like client/server tool events through AG-UI/runtime streams when surfaced.", configSurface: "Host application owns MCP server/client configuration; CopilotKit adapters do not install MCP config.", toolResourcePromptCoverage: "AG-UI lifecycle, tool, state, error, and interrupt events are mapped to OpenBox activities; MCP prompts/resources are not registered by CopilotKit.", hostBoundary: "Observe-only for host-owned MCP client/server usage; Core receives tool/runtime events when CopilotKit surfaces them.", guardTest: "tests/unit/copilotkit-adapter.test.ts#maps AG-UI run, tool, message, state, error, and interrupt events through OpenBox gates" },
    #{ provider: "n8n", tier: "native", serverSurface: "n8n packaged examples cover OpenBox-governed MCP Client Tool and MCP Server Trigger workflow entrypoints.", configSurface: "Operator-owned n8n MCP node configuration plus OpenBox credentials; OpenBox does not mutate n8n instances.", toolResourcePromptCoverage: "OpenBox Governance, Guardrails, Approval/HITL, and governed AI Agent descriptors include MCP Client Tool and MCP Server Trigger examples.", hostBoundary: "Operator-owned n8n installation; Core evaluates governance decisions for MCP workflow nodes through OpenBox helpers.", guardTest: "tests/unit/provider-capability-matrix.test.ts#declares the packaged n8n integration descriptor from the canonical spec" },
  ],
  installDoctorCapabilityGuards: #[
    #{ provider: "codex", tier: "native", installSurface: "openbox install codex, Codex plugin export/install, repo skill install, and trusted MCP config install", doctorSurface: "verifyCodexInstall, verifyCodexPlugin, and codex_doctor MCP tool", scopeBoundary: "project-local only; no global or user-level host config mutation", generatedOrPackagedSurface: ".codex-plugin/plugin.json, hooks/hooks.json, .mcp.json, AGENTS.md, .codex/config.toml, .agents/skills/openbox, and plugin skills/openbox", guardTest: "tests/unit/codex-install-spec.test.ts#exports and installs Codex plugin, repo skill, and marketplace surfaces" },
    #{ provider: "cursor", tier: "native", installSurface: "Cursor plugin mode plus cloud-compatible repo mode", doctorSurface: "verifyCursorPlugin, verifyCursorRepoMode, verifyCursorInstall, and cursor_doctor MCP tool", scopeBoundary: "project-local plugin or repo files only; no user-level Cursor writes", generatedOrPackagedSurface: ".cursor-plugin/plugin.json, workspaceOpen.json, hooks/hooks.json, mcp.json, .cursor/hooks.json, .cursor/mcp.json, .cursor/rules/openbox-governance.mdc, and .agents/skills/openbox", guardTest: "tests/unit/cursor-plugin.test.ts#installs and uninstalls cloud-compatible repo mode files" },
    #{ provider: "claude-code", tier: "native", installSurface: "Claude Code plugin export/install through project scope", doctorSurface: "verifyClaudeCodeInstall, verifyClaudeCodePlugin, openbox-plugin-doctor, and claude_code_doctor MCP tool", scopeBoundary: "project-local plugin target and runtime config only; monitors opt-in and LSP out-of-scope", generatedOrPackagedSurface: ".claude-plugin/plugin.json, hooks/hooks.json, .mcp.json, commands, agents, instructions/CLAUDE.md, skills/openbox, diagnostics, and bin/openbox-plugin-doctor", guardTest: "tests/hook-integration/claude-code-install.test.ts#claude-code plugin install --scope project writes a complete native plugin folder" },
    #{ provider: "mcp", tier: "native", installSurface: "openbox mcp serve over stdio or Streamable HTTP plus host MCP config entries", doctorSurface: "openbox_status, codex_doctor, cursor_doctor, and claude_code_doctor MCP tools", scopeBoundary: "project-local reads and backend readiness diagnostics; MCP tools do not mutate global host config", generatedOrPackagedSurface: "MCP tool annotations, prompts, resource templates, and doctor tool metadata from TypeSpec", guardTest: "tests/unit/mcp-server-coverage.test.ts#registers spec-driven MCP tool annotations, prompts, and resource templates" },
    #{ provider: "openai-agents-sdk", tier: "diagnose-only", installSurface: "No host install surface; consumers import SDK helpers", doctorSurface: "verifyOpenBoxAgentsSDKConfig runtime configuration diagnostics", scopeBoundary: "diagnose-only runtime library checks; no files installed", generatedOrPackagedSurface: "public integration support exports generated from the capability matrix", guardTest: "tests/unit/openai-agents-sdk.test.ts#diagnoses runtime-only OpenAI Agents SDK configuration without host file mutation" },
    #{ provider: "anthropic-agent-sdk", tier: "diagnose-only", installSurface: "No host install surface; consumers import SDK helpers", doctorSurface: "verifyOpenBoxAnthropicAgentSDKConfig runtime configuration diagnostics", scopeBoundary: "diagnose-only runtime library checks; no files installed", generatedOrPackagedSurface: "public integration support exports generated from the capability matrix", guardTest: "tests/unit/anthropic-agent-sdk.test.ts#diagnoses runtime-only Anthropic Agent SDK configuration without host file mutation" },
    #{ provider: "copilotkit", tier: "diagnose-only", installSurface: "No host install surface; consumers wire runtime adapters and approval routes", doctorSurface: "createOpenBoxReadinessCheck runtime readiness diagnostics", scopeBoundary: "diagnose-only application wiring checks; no host plugin files installed", generatedOrPackagedSurface: "public integration support exports generated from the capability matrix", guardTest: "tests/unit/copilotkit-adapter.test.ts#readiness treats backend inventory config as optional when Core runtime is configured" },
    #{ provider: "n8n", tier: "diagnose-only", installSurface: "Operator-owned n8n package installation; OpenBox ships descriptors and templates", doctorSurface: "verifyOpenBoxN8nIntegrationSurface descriptor/template diagnostics", scopeBoundary: "diagnose-only and operator-owned installation boundary; OpenBox does not mutate n8n instances", generatedOrPackagedSurface: "OpenBox credentials, Governance node, Guardrails node, Approval/HITL node, governed AI Agent template, and MCP examples", guardTest: "tests/unit/runtime-adapters-coverage.test.ts#exports the spec-generated packaged n8n integration surface" },
  ],
  localStackScenarioPaths: #[
    #{ id: "opa-allow", category: "opa", capability: "opa-rules", label: "OPA/Rego allows a governed event", axes: #["happy", "opa", "matrix"], requiredProofLevel: "behavioral", localStackRequired: true, operationIds: #["PolicyController_evaluate", "evaluateGovernance"], evidencePatterns: #["allow = true", "regoCase.expected"], operationEvidencePatterns: #[#{ operationId: "PolicyController_evaluate", evidencePatterns: #["allow = true", "regoCase.expected"] }, #{ operationId: "evaluateGovernance", evidencePatterns: #["ALLOW db query database_query path"] }], requiredBehavior: "The local stack must prove an OPA allow result through generated policy evaluation or Core governance evaluation." },
    #{ id: "opa-require-approval", category: "opa", capability: "opa-rules", label: "OPA/Rego requires approval", axes: #["happy", "opa", "matrix", "tool"], requiredProofLevel: "conformance", localStackRequired: true, operationIds: #["AgentController_createPolicy", "evaluateGovernance", "pollApproval"], evidencePatterns: #["REQUIRE_APPROVAL", "approval_expiration_time"], operationEvidencePatterns: #[#{ operationId: "AgentController_createPolicy", evidencePatterns: #["REQUIRE_APPROVAL", "approval_expiration_time"] }, #{ operationId: "evaluateGovernance", evidencePatterns: #["REQUIRE_APPROVAL", "approval_expiration_time"] }, #{ operationId: "pollApproval", evidencePatterns: #["REQUIRE_APPROVAL", "approval_expiration_time"] }], requiredBehavior: "A generated policy must return require_approval, create a pending approval, and expose the approval through Core polling." },
    #{ id: "opa-block", category: "opa", capability: "opa-rules", label: "OPA/Rego blocks a governed event", axes: #["failure", "opa", "matrix"], requiredProofLevel: "conformance", localStackRequired: true, operationIds: #["AgentController_createPolicy", "evaluateGovernance"], evidencePatterns: #["BLOCK file_write path", "matrixCase.expected.verdict"], operationEvidencePatterns: #[#{ operationId: "AgentController_createPolicy", evidencePatterns: #["BLOCK file_write path", "matrixCase.expected.verdict"] }, #{ operationId: "evaluateGovernance", evidencePatterns: #["BLOCK file_write path", "matrixCase.expected.verdict"] }], requiredBehavior: "A generated policy must return block and Core must expose the blocking verdict without allowing the action." },
    #{ id: "opa-halt", category: "opa", capability: "opa-rules", label: "OPA/Rego halts a governed event", axes: #["failure", "opa", "matrix"], requiredProofLevel: "conformance", localStackRequired: true, operationIds: #["AgentController_createPolicy", "evaluateGovernance"], evidencePatterns: #["HALT http POST http_post path", "matrixCase.expected.action"], operationEvidencePatterns: #[#{ operationId: "AgentController_createPolicy", evidencePatterns: #["HALT http POST http_post path", "matrixCase.expected.action"] }, #{ operationId: "evaluateGovernance", evidencePatterns: #["HALT http POST http_post path", "matrixCase.expected.action"] }], requiredBehavior: "A generated policy must return halt and Core must expose the halted verdict without allowing the action." },
    #{ id: "opa-decision-aliases", category: "opa", capability: "opa-rules", label: "OPA/Rego legacy decision aliases map to canonical verdicts", axes: #["happy", "failure", "opa", "matrix"], requiredProofLevel: "conformance", localStackRequired: true, operationIds: #["AgentController_createPolicy", "evaluateGovernance"], evidencePatterns: #["aliasCase.policyBody.rego_code", "matrixCase.expected.reason"], operationEvidencePatterns: #[#{ operationId: "AgentController_createPolicy", evidencePatterns: #["aliasCase.policyBody.rego_code", "matrixCase.expected.reason"] }, #{ operationId: "evaluateGovernance", evidencePatterns: #["aliasCase.policyBody.rego_code", "matrixCase.expected.reason"] }], requiredBehavior: "Legacy OPA decision aliases must map through Core/backend to canonical verdicts: continue to allow, stop to halt, and require-approval to require_approval." },
    #{ id: "opa-constrain", category: "opa", capability: "opa-rules", label: "OPA/Rego constrain contract boundary", axes: #["happy", "opa", "matrix", "dbquery"], requiredProofLevel: "conformance", localStackRequired: true, operationIds: #["AgentController_createPolicy", "evaluateGovernance"], evidencePatterns: #["CONSTRAIN", "constrainCase.expected.action"], operationEvidencePatterns: #[#{ operationId: "AgentController_createPolicy", evidencePatterns: #["CONSTRAIN", "constrainCase.expected.action"] }, #{ operationId: "evaluateGovernance", evidencePatterns: #["CONSTRAIN", "constrainCase.expected.action"] }], requiredBehavior: "A generated CONSTRAIN policy must prove the real backend/Core boundary: backend accepts the policy, Core falls through to allow, and SDK validation rejects CONSTRAIN as unsupported authoring input." },
    #{ id: "opa-unavailable-fail-closed", category: "opa", capability: "opa-rules", label: "OPA unavailable fails closed", axes: #["failure", "opa"], requiredProofLevel: "negative-path", localStackRequired: true, operationIds: #["evaluateGovernance"], evidencePatterns: #["unavailableVerdict", "unavailableReason"], operationEvidencePatterns: #[#{ operationId: "evaluateGovernance", evidencePatterns: #["unavailableReason", "unavailableVerdict"] }], requiredBehavior: "If OPA is unavailable, Core must fail closed with a halt/block class result rather than allow." },

    #{ id: "approval-pending", category: "approvals-hitl", capability: "approvals-hitl", label: "Approval pending state is materialized", axes: #["happy", "tool"], requiredProofLevel: "conformance", localStackRequired: true, operationIds: #["AgentController_getPendingApprovals", "OrganizationController_getApprovals", "pollApproval"], evidencePatterns: #["pendingApproval", "approval_status"], operationEvidencePatterns: #[#{ operationId: "AgentController_getPendingApprovals", evidencePatterns: #["approval_status", "pendingApproval"] }, #{ operationId: "OrganizationController_getApprovals", evidencePatterns: #["approval_status", "pendingApproval"] }, #{ operationId: "pollApproval", evidencePatterns: #["approval_status", "pendingApproval"] }], requiredBehavior: "A require_approval verdict must appear in agent, organization, and Core polling surfaces as pending." },
    #{ id: "approval-approved", category: "approvals-hitl", capability: "approvals-hitl", label: "Approval approve decision resolves pending row", axes: #["happy", "tool"], requiredProofLevel: "conformance", localStackRequired: true, operationIds: #["AgentController_decideApproval", "AgentController_getApprovalHistory"], evidencePatterns: #["decideBody.data.verdict", "historyApproval.approval_status", "historyApproval.verdict"], operationEvidencePatterns: #[#{ operationId: "AgentController_decideApproval", evidencePatterns: #["decideBody.data.decided_at", "decideBody.data.verdict"] }, #{ operationId: "AgentController_getApprovalHistory", evidencePatterns: #["historyApproval.approval_status", "historyApproval.verdict"] }], requiredBehavior: "An approve decision must mutate the pending approval into approved history and allow the stored verdict." },
    #{ id: "approval-rejected", category: "approvals-hitl", capability: "approvals-hitl", label: "Approval reject decision resolves pending row", axes: #["failure", "tool"], requiredProofLevel: "conformance", localStackRequired: true, operationIds: #["AgentController_decideApproval", "AgentController_getApprovalHistory"], evidencePatterns: #["rejectBody.data.id", "rejectedHistoryApproval.approval_status"], operationEvidencePatterns: #[#{ operationId: "AgentController_decideApproval", evidencePatterns: #["rejectBody.data.decided_at", "rejectBody.data.id"] }, #{ operationId: "AgentController_getApprovalHistory", evidencePatterns: #["rejectedHistoryApproval.approval_status"] }], requiredBehavior: "A reject decision must mutate the pending approval into rejected history and keep the action denied." },
    #{ id: "approval-expired-timeout", category: "approvals-hitl", capability: "approvals-hitl", label: "Approval timeout/expiration fails closed", axes: #["failure", "tool"], requiredProofLevel: "conformance", localStackRequired: true, operationIds: #["pollApproval", "AgentController_getPendingApprovals", "OrganizationController_getApprovals"], evidencePatterns: #["conformanceCase.scenarioId", "pollAfterExpiration.data.action", "expiredApprovalsBody.data.metrics.expired_count"], operationEvidencePatterns: #[#{ operationId: "pollApproval", evidencePatterns: #["conformanceCase.scenarioId", "expiredApprovalsBody.data.metrics.expired_count", "pollAfterExpiration.data.action"] }, #{ operationId: "AgentController_getPendingApprovals", evidencePatterns: #["conformanceCase.scenarioId", "expiredApprovalsBody.data.metrics.expired_count", "pollAfterExpiration.data.action"] }, #{ operationId: "OrganizationController_getApprovals", evidencePatterns: #["conformanceCase.scenarioId", "expiredApprovalsBody.data.metrics.expired_count", "pollAfterExpiration.data.action"] }], requiredBehavior: "Expired approvals must fail closed and must not be silently converted into allow." },
    #{ id: "approval-dashboard-metrics-history", category: "approvals-hitl", capability: "approvals-hitl", label: "Approval dashboard metrics, history, and SLA are shaped", axes: #["happy", "order", "matrix"], requiredProofLevel: "conformance", localStackRequired: true, operationIds: #["AgentController_getAgentApprovalsMetrics", "AgentController_getPendingApprovals", "AgentController_getApprovalHistory", "OrganizationController_getApprovals", "OrganizationController_getApprovalsMetrics", "OrganizationController_getSlaPerformance", "OrganizationController_getRecentDecisions"], evidencePatterns: #["approval-dashboard-pending", "approval-dashboard-approved"], operationEvidencePatterns: #[#{ operationId: "AgentController_getAgentApprovalsMetrics", evidencePatterns: #["body.data.pending"] }, #{ operationId: "AgentController_getPendingApprovals", evidencePatterns: #["approval-dashboard-pending"] }, #{ operationId: "AgentController_getApprovalHistory", evidencePatterns: #["approval-dashboard-approved"] }, #{ operationId: "OrganizationController_getApprovals", evidencePatterns: #["approval-dashboard-pending"] }, #{ operationId: "OrganizationController_getApprovalsMetrics", evidencePatterns: #["approved_today"] }, #{ operationId: "OrganizationController_getSlaPerformance", evidencePatterns: #["within_count"] }, #{ operationId: "OrganizationController_getRecentDecisions", evidencePatterns: #["approval-dashboard-approved"] }], requiredBehavior: "Approval dashboard metrics, history, and SLA endpoints must assert seeded pending and decided approval rows plus stable dashboard rollup shape." },

    #{ id: "guardrail-allow", category: "guardrails", capability: "guardrails", label: "Guardrail allows safe input/output", axes: #["happy", "guardrails"], requiredProofLevel: "behavioral", localStackRequired: true, operationIds: #["GuardrailController_runTest"], evidencePatterns: #["validation_passed", "allowed"], operationEvidencePatterns: #[#{ operationId: "GuardrailController_runTest", evidencePatterns: #["allowed", "validation_passed"] }], requiredBehavior: "The local stack must prove a safe guardrail evaluation returns allowed/passed." },
    #{ id: "guardrail-block", category: "guardrails", capability: "guardrails", label: "Guardrail blocks unsafe input/output", axes: #["failure", "guardrails"], requiredProofLevel: "behavioral", localStackRequired: true, operationIds: #["GuardrailController_runTest"], evidencePatterns: #["observedValidationResults", "observedStatuses", "toContain('blocked')"], operationEvidencePatterns: #[#{ operationId: "GuardrailController_runTest", evidencePatterns: #["observedStatuses", "observedValidationResults", "toContain('blocked')"] }], requiredBehavior: "The local stack must prove an unsafe guardrail evaluation returns blocked rather than pass-through." },
    #{ id: "guardrail-redact", category: "guardrails", capability: "guardrails", label: "Guardrail redacts or transforms sensitive fields", axes: #["happy", "guardrails"], requiredProofLevel: "behavioral", localStackRequired: true, operationIds: #["GuardrailController_runTest", "evaluateGovernance"], evidencePatterns: #["redacted_input", "toContain('redacted')", "toContain('transformed')"], operationEvidencePatterns: #[#{ operationId: "GuardrailController_runTest", evidencePatterns: #["redacted_input", "toContain('redacted')", "toContain('transformed')"] }, #{ operationId: "evaluateGovernance", evidencePatterns: #["[redacted-email]", "guardrails_result"] }], requiredBehavior: "Redaction/constrain output must be asserted as returned transformed payload, not only endpoint reachability." },
    #{ id: "guardrail-service-unavailable-fail-closed", category: "guardrails", capability: "guardrails", label: "Guardrail service unavailable fails closed", axes: #["failure", "guardrails"], requiredProofLevel: "negative-path", localStackRequired: true, operationIds: #["GuardrailController_runTest"], evidencePatterns: #["Guardrails test execution failed", "guardrail-service-unavailable-fail-closed"], operationEvidencePatterns: #[#{ operationId: "GuardrailController_runTest", evidencePatterns: #["Guardrails test execution failed", "guardrail-service-unavailable-fail-closed"] }], requiredBehavior: "Unavailable guardrail service paths must fail closed or be explicitly marked unavailable; they cannot count as behavioral proof." },

    #{ id: "behavior-order-goal-before-action", category: "behavioral", capability: "goal-signals", label: "Goal signal precedes first governed action", axes: #["order", "goal"], requiredProofLevel: "behavioral", localStackRequired: true, operationIds: #["evaluateGovernance"], evidencePatterns: #["goalSignalEvent.event_type", "toBeLessThan", "firstGovernedSurface"], operationEvidencePatterns: #[#{ operationId: "evaluateGovernance", evidencePatterns: #["firstGovernedSurface", "goalSignalEvent.event_type", "toBeLessThan"] }], requiredBehavior: "The suite must prove goal capture happens before the first governed prompt/tool/action." },
    #{ id: "behavior-db-query", category: "behavioral", capability: "tracing", label: "Database query span is governed", axes: #["dbquery", "matrix"], requiredProofLevel: "conformance", localStackRequired: true, operationIds: #["evaluateGovernance"], evidencePatterns: #["database_query", "ALLOW db query database_query path", "DatabaseQuery"], operationEvidencePatterns: #[#{ operationId: "evaluateGovernance", evidencePatterns: #["ALLOW db query database_query path", "DatabaseQuery", "database_query"] }], requiredBehavior: "A database query span must be classified and governed through the local stack." },
    #{ id: "behavior-tool-call", category: "behavioral", capability: "tracing", label: "Tool-call span is governed", axes: #["tool", "matrix"], requiredProofLevel: "conformance", localStackRequired: true, operationIds: #["evaluateGovernance"], evidencePatterns: #["tool_call", "llm_tool_call", "sdk-conformance-approval-tool"], operationEvidencePatterns: #[#{ operationId: "evaluateGovernance", evidencePatterns: #["llm_tool_call", "sdk-conformance-approval-tool", "tool_call"] }], requiredBehavior: "A tool-call span must be classified and governed through the local stack." },
    #{ id: "behavior-http", category: "behavioral", capability: "tracing", label: "HTTP span is governed", axes: #["tool", "matrix"], requiredProofLevel: "conformance", localStackRequired: true, operationIds: #["evaluateGovernance"], evidencePatterns: #["http_post", "HALT http POST http_post path", "HTTPRequest"], operationEvidencePatterns: #[#{ operationId: "evaluateGovernance", evidencePatterns: #["HALT http POST http_post path", "HTTPRequest", "http_post"] }], requiredBehavior: "An HTTP span must be classified and governed through the local stack." },
    #{ id: "behavior-file-read", category: "behavioral", capability: "tracing", label: "File-read span is governed", axes: #["tool", "matrix"], requiredProofLevel: "conformance", localStackRequired: true, operationIds: #["evaluateGovernance"], evidencePatterns: #["file_read", "REQUIRE_APPROVAL file_read path", "FileRead"], operationEvidencePatterns: #[#{ operationId: "evaluateGovernance", evidencePatterns: #["FileRead", "REQUIRE_APPROVAL file_read path", "file_read"] }], requiredBehavior: "A file-read span must be classified and governed through the local stack." },
    #{ id: "behavior-file-write", category: "behavioral", capability: "tracing", label: "File-write span is governed", axes: #["tool", "matrix"], requiredProofLevel: "conformance", localStackRequired: true, operationIds: #["evaluateGovernance"], evidencePatterns: #["file_write", "BLOCK file_write path", "FileEdit"], operationEvidencePatterns: #[#{ operationId: "evaluateGovernance", evidencePatterns: #["BLOCK file_write path", "FileEdit", "file_write"] }], requiredBehavior: "A file-write span must be classified and governed through the local stack." },
    #{ id: "behavior-shell", category: "behavioral", capability: "tracing", label: "Shell span is governed", axes: #["tool", "matrix"], requiredProofLevel: "conformance", localStackRequired: true, operationIds: #["evaluateGovernance"], evidencePatterns: #["shell", "BLOCK shell path", "ShellExecution"], operationEvidencePatterns: #[#{ operationId: "evaluateGovernance", evidencePatterns: #["BLOCK shell path", "ShellExecution", "shell"] }], requiredBehavior: "A shell/internal command span must be classified and governed through the local stack." },
    #{ id: "behavior-llm", category: "behavioral", capability: "tracing", label: "LLM span is governed", axes: #["tool", "matrix"], requiredProofLevel: "conformance", localStackRequired: true, operationIds: #["evaluateGovernance"], evidencePatterns: #["llm_gen_ai", "llm_completion", "e2e-approve-llm"], operationEvidencePatterns: #[#{ operationId: "evaluateGovernance", evidencePatterns: #["e2e-approve-llm", "llm_completion", "llm_gen_ai"] }], requiredBehavior: "An LLM generation/completion span must be classified and governed through the local stack." },
    #{ id: "behavior-mcp", category: "behavioral", capability: "mcp", label: "MCP tool span is governed", axes: #["tool", "matrix"], requiredProofLevel: "conformance", localStackRequired: true, operationIds: #["evaluateGovernance"], evidencePatterns: #["mcp_tool_call", "check_governance"], operationEvidencePatterns: #[#{ operationId: "evaluateGovernance", evidencePatterns: #["check_governance", "mcp_tool_call"] }], requiredBehavior: "An MCP tool span must be classified and governed through the local stack or declared observe-only for library providers." },
    #{ id: "behavior-rule-lifecycle-current", category: "behavioral", capability: "behavior-rules", label: "Behavior rule lifecycle persists current state", axes: #["happy", "order"], requiredProofLevel: "conformance", localStackRequired: true, operationIds: #["AgentController_createBehaviorRule", "AgentController_getBehaviorRule", "AgentController_updateBehaviorRule", "AgentController_changeBehaviorRuleStatus", "AgentController_getCurrentBehaviorRule", "AgentController_deleteBehaviorRule"], evidencePatterns: #["change_log", "is_active"], operationEvidencePatterns: #[#{ operationId: "AgentController_createBehaviorRule", evidencePatterns: #["body.data.rule_name"] }, #{ operationId: "AgentController_getBehaviorRule", evidencePatterns: #["body.data.rule_name"] }, #{ operationId: "AgentController_updateBehaviorRule", evidencePatterns: #["change_log"] }, #{ operationId: "AgentController_changeBehaviorRuleStatus", evidencePatterns: #["is_active"] }, #{ operationId: "AgentController_getCurrentBehaviorRule", evidencePatterns: #["is_active"] }, #{ operationId: "AgentController_deleteBehaviorRule", evidencePatterns: #["toBeUndefined"] }], requiredBehavior: "Behavior-rule create, update, current-version, status toggle, and delete paths must assert persisted state, not only HTTP 200. The current-rule surface returns the current version and carries its is_active state." },
    #{ id: "behavior-rule-metrics-violations", category: "behavioral", capability: "behavior-rules", label: "Behavior rule metrics and violations are shaped", axes: #["happy", "failure", "matrix"], requiredProofLevel: "behavioral", localStackRequired: true, operationIds: #["AgentController_getBehaviorMetrics", "AgentController_getBehaviorViolations"], evidencePatterns: #["behavior/violations", "violations_today", "compliance_rate", "behavior_violated: true"], operationEvidencePatterns: #[#{ operationId: "AgentController_getBehaviorMetrics", evidencePatterns: #["compliance_rate", "violations_today"] }, #{ operationId: "AgentController_getBehaviorViolations", evidencePatterns: #["behavior/violations", "behavior_violated: true"] }], requiredBehavior: "Behavior-rule metrics and violation list endpoints must assert dashboard shape and a seeded behavior_violated row so behavioral failure coverage does not count as smoke coverage." },
    #{ id: "behavior-rule-rollback-history", category: "behavioral", capability: "behavior-rules", label: "Behavior rule history and rollback are stateful", axes: #["happy", "order"], requiredProofLevel: "conformance", localStackRequired: true, operationIds: #["AgentController_updateBehaviorRule", "AgentController_getBehavioralRuleHistories", "AgentController_rollbackBehaviorRule", "AgentController_getCurrentBehaviorRule"], evidencePatterns: #["base_rule_id", "is_current_version"], operationEvidencePatterns: #[#{ operationId: "AgentController_updateBehaviorRule", evidencePatterns: #["base_rule_id", "is_current_version"] }, #{ operationId: "AgentController_getBehavioralRuleHistories", evidencePatterns: #["base_rule_id", "is_current_version"] }, #{ operationId: "AgentController_rollbackBehaviorRule", evidencePatterns: #["base_rule_id", "is_current_version"] }, #{ operationId: "AgentController_getCurrentBehaviorRule", evidencePatterns: #["found.is_active"] }], requiredBehavior: "Behavior-rule update must create a versioned history, and rollback must make the selected historical version current again." },
    #{ id: "policy-lifecycle-evaluations-metrics", category: "opa", capability: "opa-rules", label: "Policy lifecycle, evaluations, and metrics are stateful", axes: #["happy", "dbquery", "matrix"], requiredProofLevel: "conformance", localStackRequired: true, operationIds: #["AgentController_createPolicy", "AgentController_getPolicies", "AgentController_getCurrentPolicy", "AgentController_updatePolicy", "AgentController_getPolicesMetrics", "AgentController_getPolicyEvaluations"], evidencePatterns: #["body.data.rego_code", "is_active: false", "decision_distribution"], operationEvidencePatterns: #[#{ operationId: "AgentController_createPolicy", evidencePatterns: #["body.data.rego_code"] }, #{ operationId: "AgentController_getPolicies", evidencePatterns: #["found).toBeDefined"] }, #{ operationId: "AgentController_getCurrentPolicy", evidencePatterns: #["is_active: true"] }, #{ operationId: "AgentController_updatePolicy", evidencePatterns: #["is_active: false"] }, #{ operationId: "AgentController_getPolicesMetrics", evidencePatterns: #["decision_distribution"] }, #{ operationId: "AgentController_getPolicyEvaluations", evidencePatterns: #["decision_distribution"] }], requiredBehavior: "Policy current/update/metrics/evaluation endpoints must assert persisted policy state and DB-backed evaluation rows." },
    #{ id: "guardrail-lifecycle-order-metrics", category: "guardrails", capability: "guardrails", label: "Guardrail lifecycle, ordering, metrics, and logs are stateful", axes: #["happy", "order", "dbquery"], requiredProofLevel: "conformance", localStackRequired: true, operationIds: #["AgentController_createGuardrail", "AgentController_getGuardrails", "AgentController_getGuardrail", "AgentController_updateGuardrails", "AgentController_reorderGuardrail", "AgentController_getGuardrailMetrics", "AgentController_getGuardrailViolationLogs", "AgentController_deleteGuardrails"], evidencePatterns: #["body.data.name", "order: 0", "violations_trend"], operationEvidencePatterns: #[#{ operationId: "AgentController_createGuardrail", evidencePatterns: #["body.data.name"] }, #{ operationId: "AgentController_getGuardrails", evidencePatterns: #["found).toBeDefined"] }, #{ operationId: "AgentController_getGuardrail", evidencePatterns: #["body.data.name"] }, #{ operationId: "AgentController_updateGuardrails", evidencePatterns: #["is_active: false"] }, #{ operationId: "AgentController_reorderGuardrail", evidencePatterns: #["order: 0"] }, #{ operationId: "AgentController_getGuardrailMetrics", evidencePatterns: #["violations_trend"] }, #{ operationId: "AgentController_getGuardrailViolationLogs", evidencePatterns: #["guardrailEvaluationId"] }, #{ operationId: "AgentController_deleteGuardrails", evidencePatterns: #["toBeUndefined"] }], requiredBehavior: "Guardrail lifecycle, ordering, metrics, and violation-log endpoints must assert persisted state and DB-backed evaluation rows." },

    #{ id: "usage-core-wire-boundary", category: "usage-cost", capability: "usage-cost", label: "Core accepts usage/cost wire fields without fabricating dashboard metrics", axes: #["happy", "usage", "cost", "matrix"], requiredProofLevel: "conformance", localStackRequired: true, operationIds: #["evaluateGovernance"], evidencePatterns: #["not.toContain('cost_usd')", "not.toContain('input_tokens')", "Number(metrics.trim())).toBe(0)"], operationEvidencePatterns: #[#{ operationId: "evaluateGovernance", evidencePatterns: #["not.toContain('cost_usd')", "not.toContain('input_tokens')", "Number(metrics.trim())).toBe(0)"] }], requiredBehavior: "Core must accept top-level usage/cost fields and persist the governance event, while the local backend must not fabricate observability metric rows from provider-owned usage telemetry." },
    #{ id: "usage-token-counts", category: "usage-cost", capability: "usage-cost", label: "Token usage is normalized by provider adapters", axes: #["usage"], requiredProofLevel: "behavioral", localStackRequired: false, operationIds: #[], evidencePatterns: #["normalizeOpenBoxUsage", "inputTokens", "outputTokens", "totalTokens"], requiredBehavior: "Token aliases normalize through generated/provider SDK guards; /agent/metrics is a dashboard aggregate, not the local token ledger." },
    #{ id: "usage-cost-usd", category: "usage-cost", capability: "usage-cost", label: "Cost USD is normalized by provider adapters", axes: #["cost", "usage"], requiredProofLevel: "behavioral", localStackRequired: false, operationIds: #[], evidencePatterns: #["costUsd", "cost_usd", "total_cost_usd"], requiredBehavior: "Cost aliases normalize through generated/provider SDK guards and remain Core-owned for policy; local backend metrics do not expose spend rows." },
    #{ id: "usage-zero-values", category: "usage-cost", capability: "usage-cost", label: "Zero usage/cost values are preserved by provider adapters", axes: #["cost", "usage"], requiredProofLevel: "behavioral", localStackRequired: false, operationIds: #[], evidencePatterns: #["normalizeOpenBoxUsage", "cost_usd: 0"], requiredBehavior: "Explicit zero token and cost fields are preserved by SDK normalization tests; the local backend has no usage/cost write API to seed this path." },
    #{ id: "backend-dashboard-metrics", category: "usage-cost", capability: "usage-cost", label: "Backend dashboard metrics expose stable rollups", axes: #["happy", "usage", "matrix"], requiredProofLevel: "behavioral", localStackRequired: true, operationIds: #["AgentController_getAgentsMetrics"], evidencePatterns: #["total_agents", "violation_rate"], operationEvidencePatterns: #[#{ operationId: "AgentController_getAgentsMetrics", evidencePatterns: #["total_agents", "violation_rate"] }], requiredBehavior: "Backend agent metrics are dashboard rollups and must assert agent/guardrail/policy sections rather than only HTTP 200." },
    #{ id: "trust-aivss-ledger", category: "usage-cost", capability: "usage-cost", label: "AIVSS and trust ledger surfaces are stateful", axes: #["happy", "usage", "cost", "matrix", "dbquery"], requiredProofLevel: "conformance", localStackRequired: true, operationIds: #["AgentController_getAssessments", "AgentController_updateAivssConfig", "AgentController_recalculateTrustScore", "AgentController_getAgentTrustHistories", "AgentController_getAgentTrustScoreEvents", "AgentController_getAgentTrustRecoveryStatus", "AgentController_getTrustTierChanges", "OrganizationController_getTrustTierTrends"], evidencePatterns: #["score: expect.any(Number)", "has_penalty", "tier0"], operationEvidencePatterns: #[#{ operationId: "AgentController_getAssessments", evidencePatterns: #["trust_score"] }, #{ operationId: "AgentController_updateAivssConfig", evidencePatterns: #["body.data.id"] }, #{ operationId: "AgentController_recalculateTrustScore", evidencePatterns: #["body.data).toBe(agentId)"] }, #{ operationId: "AgentController_getAgentTrustHistories", evidencePatterns: #["score: expect.any(Number)"] }, #{ operationId: "AgentController_getAgentTrustScoreEvents", evidencePatterns: #["policy_violation"] }, #{ operationId: "AgentController_getAgentTrustRecoveryStatus", evidencePatterns: #["has_penalty"] }, #{ operationId: "AgentController_getTrustTierChanges", evidencePatterns: #["previous_tier: 1"] }, #{ operationId: "OrganizationController_getTrustTierTrends", evidencePatterns: #["tier0"] }], requiredBehavior: "AIVSS update/recalculate and trust dashboard endpoints must assert DB-backed trust history, event, recovery, and org trend state." },

    #{ id: "goal-alignment-checked", category: "goal-drift", capability: "goal-signals", label: "Goal alignment check result is surfaced", axes: #["happy", "goal"], requiredProofLevel: "behavioral", localStackRequired: true, operationIds: #["evaluateGovernance"], evidencePatterns: #["goal_alignment_checked", "actionResponse.data.age_result"], operationEvidencePatterns: #[#{ operationId: "evaluateGovernance", evidencePatterns: #["actionResponse.data.age_result", "goal_alignment_checked"] }], requiredBehavior: "Core governance results must surface whether goal alignment was checked." },
    #{ id: "goal-drift-detected", category: "goal-drift", capability: "goal-signals", label: "Goal drift detection is surfaced", axes: #["goal", "failure"], requiredProofLevel: "behavioral", localStackRequired: true, operationIds: #["AgentController_getRecentDriftEvents", "AgentController_getDriftEvents", "AgentController_getGoalAlignmentTrend", "AgentController_getSessionGoalAlignmentStats"], evidencePatterns: #["conformanceCase.expected.goalDrifted", "goal_drifted).toBe(true)", "drifted_count).toBeGreaterThan(0)"], operationEvidencePatterns: #[#{ operationId: "AgentController_getRecentDriftEvents", evidencePatterns: #["conformanceCase.expected.goalDrifted", "drifted_count).toBeGreaterThan(0)", "goal_drifted).toBe(true)"] }, #{ operationId: "AgentController_getDriftEvents", evidencePatterns: #["conformanceCase.expected.goalDrifted", "drifted_count).toBeGreaterThan(0)", "goal_drifted).toBe(true)"] }, #{ operationId: "AgentController_getGoalAlignmentTrend", evidencePatterns: #["conformanceCase.expected.goalDrifted", "drifted_count).toBeGreaterThan(0)", "goal_drifted).toBe(true)"] }, #{ operationId: "AgentController_getSessionGoalAlignmentStats", evidencePatterns: #["conformanceCase.expected.goalDrifted", "drifted_count).toBeGreaterThan(0)", "goal_drifted).toBe(true)"] }], requiredBehavior: "The suite must prove a drifted result through the goal-drift endpoints." },
    #{ id: "goal-drift-fallback", category: "goal-drift", capability: "goal-signals", label: "Goal drift fallback is surfaced", axes: #["goal", "failure"], requiredProofLevel: "behavioral", localStackRequired: true, operationIds: #["evaluateGovernance"], evidencePatterns: #["fallback_used", "conformanceCase.expected.fallbackUsed", "actionResponse.data.age_result"], operationEvidencePatterns: #[#{ operationId: "evaluateGovernance", evidencePatterns: #["actionResponse.data.age_result", "conformanceCase.expected.fallbackUsed", "fallback_used"] }], requiredBehavior: "If goal alignment falls back, the fallback flag must be visible and asserted." },

    #{ id: "trace-session", category: "tracing", capability: "tracing", label: "Session trace surfaces are readable", axes: #["happy"], requiredProofLevel: "behavioral", localStackRequired: true, operationIds: #["AgentController_getSessions", "AgentController_getSession"], evidencePatterns: #["completedSummary", "detail: 'seeded workflow session conformance'", "status: 'completed'"], operationEvidencePatterns: #[#{ operationId: "AgentController_getSessions", evidencePatterns: #["completedSummary", "status: 'completed'"] }, #{ operationId: "AgentController_getSession", evidencePatterns: #["detail: 'seeded workflow session conformance'", "status: 'completed'"] }], requiredBehavior: "Session list/detail endpoints must assert returned state, not only status." },
    #{ id: "trace-logs", category: "tracing", capability: "tracing", label: "Governance/log trace surfaces are readable", axes: #["happy"], requiredProofLevel: "behavioral", localStackRequired: true, operationIds: #["AgentController_getSessionLogs", "AgentController_getDriftEvents", "OrganizationController_getGovernanceFeed"], evidencePatterns: #["activity_id: 'workflow-session-log'", "driftLog).toBeDefined", "Array.isArray(body.data)"], operationEvidencePatterns: #[#{ operationId: "AgentController_getSessionLogs", evidencePatterns: #["activity_id: 'workflow-session-log'", "logEntry"] }, #{ operationId: "AgentController_getDriftEvents", evidencePatterns: #["driftLog).toBeDefined"] }, #{ operationId: "OrganizationController_getGovernanceFeed", evidencePatterns: #["Array.isArray(body.data)"] }], requiredBehavior: "Log and governance feed endpoints must assert returned trace/log content." },
    #{ id: "trace-reasoning", category: "tracing", capability: "tracing", label: "Reasoning trace surface is readable", axes: #["happy"], requiredProofLevel: "behavioral", localStackRequired: true, operationIds: #["AgentController_getSessionReasoningTrace"], evidencePatterns: #["goal_alignment_checked: true", "goal_drift: false"], operationEvidencePatterns: #[#{ operationId: "AgentController_getSessionReasoningTrace", evidencePatterns: #["reasoningEntry).toMatchObject"] }], requiredBehavior: "Reasoning trace endpoints must assert returned trace content." },
    #{ id: "trace-source-attribution", category: "tracing", capability: "tracing", label: "Provider/source attribution is retained", axes: #["happy", "tool"], requiredProofLevel: "behavioral", localStackRequired: true, operationIds: #["evaluateGovernance"], evidencePatterns: #["sourceAttribution", "_openbox_source", "source-attribution"], operationEvidencePatterns: #[#{ operationId: "evaluateGovernance", evidencePatterns: #["_openbox_source", "source-attribution", "sourceAttribution"] }], requiredBehavior: "Governed events must retain provider/source attribution through the persisted _openbox_source input fallback; provider span stamping is covered by adapter guard tests because the local Core path does not persist submitted openbox.source span attributes on governance_events." },
    #{ id: "observability-ledger-dashboard", category: "tracing", capability: "tracing", label: "Observability dashboard and logs read seeded ledger state", axes: #["happy", "dbquery", "matrix"], requiredProofLevel: "conformance", localStackRequired: true, operationIds: #["AgentController_getObservability", "AgentController_getIssues", "AgentController_getInsightMetrics", "AgentController_getAgentLogs"], evidencePatterns: #["observability ledger issue", "input_tokens"], operationEvidencePatterns: #[#{ operationId: "AgentController_getObservability", evidencePatterns: #["input_tokens"] }, #{ operationId: "AgentController_getIssues", evidencePatterns: #["observability ledger issue"] }, #{ operationId: "AgentController_getInsightMetrics", evidencePatterns: #["body.data.violation.total"] }, #{ operationId: "AgentController_getAgentLogs", evidencePatterns: #["observability-ledger"] }], requiredBehavior: "Observability, issues, insights, and agent logs must assert seeded local-stack telemetry rows and dashboard rollup shapes." },
    #{ id: "violation-false-positive", category: "tracing", capability: "tracing", label: "Violation ledgers support false-positive marking", axes: #["failure", "dbquery", "order"], requiredProofLevel: "conformance", localStackRequired: true, operationIds: #["AgentController_getViolations", "AgentController_getAgentEvaluations", "AgentController_markAsFalsePositive"], evidencePatterns: #["source_type: 'behavior'", "is_false_positive: true", "guardrail_violations"], operationEvidencePatterns: #[#{ operationId: "AgentController_getViolations", evidencePatterns: #["guardrail_violations"] }, #{ operationId: "AgentController_getAgentEvaluations", evidencePatterns: #["is_false_positive", "source_type: 'behavior'"] }, #{ operationId: "AgentController_markAsFalsePositive", evidencePatterns: #["is_false_positive: true"] }], requiredBehavior: "Violation list endpoints must expose seeded violation rows and false-positive marking must persist the is_false_positive state." },
    #{ id: "workflow-session-lifecycle", category: "workflow", capability: "tracing", label: "Workflow session lifecycle is readable", axes: #["happy", "order"], requiredProofLevel: "conformance", localStackRequired: true, operationIds: #["AgentController_getSessions", "AgentController_getActiveSessions", "AgentController_getSession", "AgentController_getSessionLogs", "AgentController_getSessionReasoningTrace", "AgentController_getSessionGoalAlignmentStats"], evidencePatterns: #["completedSummary", "goal_alignment_checked: true", "total_checked: 1"], operationEvidencePatterns: #[#{ operationId: "AgentController_getSessions", evidencePatterns: #["completedSummary", "status: 'completed'"] }, #{ operationId: "AgentController_getActiveSessions", evidencePatterns: #["activeSessionId", "toBeDefined"] }, #{ operationId: "AgentController_getSession", evidencePatterns: #["detail: 'seeded workflow session conformance'", "status: 'completed'"] }, #{ operationId: "AgentController_getSessionLogs", evidencePatterns: #["activity_id: 'workflow-session-log'", "logEntry"] }, #{ operationId: "AgentController_getSessionReasoningTrace", evidencePatterns: #["goal_alignment_checked: true", "goal_drift: false"] }, #{ operationId: "AgentController_getSessionGoalAlignmentStats", evidencePatterns: #["total_checked: 1", "total_drifted: 0"] }], requiredBehavior: "A seeded local-stack workflow session must be visible in list/detail/log/reasoning/stat surfaces with asserted state." },
    #{ id: "workflow-session-terminate", category: "workflow", capability: "tracing", label: "Workflow session termination changes active state", axes: #["failure", "order"], requiredProofLevel: "conformance", localStackRequired: true, operationIds: #["AgentController_getActiveSessions", "AgentController_terminateSession", "AgentController_getSession"], evidencePatterns: #["Session terminated by admin", "terminatedDetailBody.data.status", "toBeUndefined"], operationEvidencePatterns: #[#{ operationId: "AgentController_getActiveSessions", evidencePatterns: #["activeAfterTerminateBody.status", "toBeUndefined"] }, #{ operationId: "AgentController_terminateSession", evidencePatterns: #["Session terminated by admin", "status: 'halted'"] }, #{ operationId: "AgentController_getSession", evidencePatterns: #["terminatedDetailBody.data.status", "halted"] }], requiredBehavior: "Terminating an active workflow session must remove it from active sessions and persist halted detail state." },
  ],
  localStackScenarioMatrix: #{
    id: "backend-core-governance-full-matrix",
    description: "Backend/Core governance conformance matrix for OPA, approvals, guardrails, behavior rules, goal drift, tracing, usage/cost, workflow ordering, and DB-backed dashboard paths. Provider-owned usage/cost normalization is allowed only when declared outside local-stack runtime proof.",
    requiredCapabilities: #["approvals-hitl", "behavior-rules", "goal-signals", "guardrails", "mcp", "opa-rules", "tracing", "usage-cost"],
    requiredCategories: #["approvals-hitl", "behavioral", "goal-drift", "guardrails", "opa", "tracing", "usage-cost", "workflow"],
    requiredAxes: #["cost", "dbquery", "failure", "goal", "guardrails", "happy", "matrix", "opa", "order", "tool", "usage"],
    requiredLocalStackAxes: #["cost", "dbquery", "failure", "goal", "guardrails", "happy", "matrix", "opa", "order", "tool", "usage"],
    requiredCategoryAxes: #[
      #{ category: "approvals-hitl", axes: #["failure", "happy", "matrix", "order", "tool"] },
      #{ category: "behavioral", axes: #["dbquery", "failure", "goal", "happy", "matrix", "order", "tool"] },
      #{ category: "goal-drift", axes: #["failure", "goal", "happy"] },
      #{ category: "guardrails", axes: #["dbquery", "failure", "guardrails", "happy", "order"] },
      #{ category: "opa", axes: #["dbquery", "failure", "happy", "matrix", "opa", "tool"] },
      #{ category: "tracing", axes: #["dbquery", "failure", "happy", "matrix", "order", "tool"] },
      #{ category: "usage-cost", axes: #["cost", "dbquery", "happy", "matrix", "usage"] },
      #{ category: "workflow", axes: #["failure", "happy", "order"] },
    ],
    localStackScenarioIds: #[
      "opa-allow",
      "opa-require-approval",
      "opa-block",
      "opa-halt",
      "opa-decision-aliases",
      "opa-constrain",
      "opa-unavailable-fail-closed",
      "approval-pending",
      "approval-approved",
      "approval-rejected",
      "approval-expired-timeout",
      "approval-dashboard-metrics-history",
      "guardrail-allow",
      "guardrail-block",
      "guardrail-redact",
      "guardrail-service-unavailable-fail-closed",
      "behavior-order-goal-before-action",
      "behavior-db-query",
      "behavior-tool-call",
      "behavior-http",
      "behavior-file-read",
      "behavior-file-write",
      "behavior-shell",
      "behavior-llm",
      "behavior-mcp",
      "behavior-rule-lifecycle-current",
      "behavior-rule-metrics-violations",
      "behavior-rule-rollback-history",
      "policy-lifecycle-evaluations-metrics",
      "guardrail-lifecycle-order-metrics",
      "usage-core-wire-boundary",
      "backend-dashboard-metrics",
      "trust-aivss-ledger",
      "goal-alignment-checked",
      "goal-drift-detected",
      "goal-drift-fallback",
      "trace-session",
      "trace-logs",
      "trace-reasoning",
      "trace-source-attribution",
      "observability-ledger-dashboard",
      "violation-false-positive",
      "workflow-session-lifecycle",
      "workflow-session-terminate",
    ],
    providerOwnedScenarioIds: #[
      "usage-token-counts",
      "usage-cost-usd",
      "usage-zero-values",
    ],
    requiredOutcomeIds: #[
      "core-governance-verdicts",
      "core-approval-polling",
      "backend-policy-evaluation",
      "backend-guardrail-enforcement",
      "backend-approvals-hitl",
      "backend-organization-member-admin",
      "backend-tracing-observability",
      "backend-usage-cost-trust",
      "provider-adapter-guardrails",
      "provider-adapter-approvals-hitl",
      "provider-adapter-tracing",
      "provider-adapter-usage-cost",
      "provider-adapter-opa-rules",
    ],
    requiredOutcomeSpecs: #[
      #{ id: "core-governance-verdicts", label: "Core governance verdicts", source: "local-stack-e2e", minimumProofLevel: "behavioral", operationIds: #["validateApiKey", "evaluateGovernance"], providerGuardCapabilities: #[], exceptionCapabilities: #[] },
      #{ id: "core-approval-polling", label: "Core approval polling", source: "local-stack-e2e", minimumProofLevel: "behavioral", operationIds: #["pollApproval"], providerGuardCapabilities: #[], exceptionCapabilities: #[] },
      #{ id: "backend-policy-evaluation", label: "Backend policy and OPA evaluation", source: "local-stack-e2e", minimumProofLevel: "behavioral", operationIds: #["AgentController_createPolicy", "AgentController_getPolicies", "AgentController_getPolicy", "PolicyController_evaluate"], providerGuardCapabilities: #["opa-rules"], exceptionCapabilities: #[] },
      #{ id: "backend-guardrail-enforcement", label: "Backend guardrail enforcement", source: "local-stack-e2e", minimumProofLevel: "behavioral", operationIds: #["AgentController_createGuardrail", "AgentController_getGuardrails", "AgentController_getGuardrail", "GuardrailController_runTest"], providerGuardCapabilities: #["guardrails"], exceptionCapabilities: #[] },
      #{ id: "backend-approvals-hitl", label: "Backend approvals and HITL", source: "local-stack-e2e", minimumProofLevel: "behavioral", operationIds: #["AgentController_getPendingApprovals", "AgentController_getApprovalHistory", "AgentController_decideApproval", "OrganizationController_getApprovals"], providerGuardCapabilities: #["approvals-hitl"], exceptionCapabilities: #[] },
      #{ id: "backend-organization-member-admin", label: "Backend organization member administration", source: "local-stack-e2e", minimumProofLevel: "conformance", operationIds: #["OrganizationController_getMembers", "OrganizationController_removeMembers", "OrganizationController_createUser", "OrganizationController_sendWelcomeEmail", "OrganizationController_inviteUser", "OrganizationController_assignRoles", "OrganizationController_removeRoles", "OrganizationController_updateMember"], providerGuardCapabilities: #[], exceptionCapabilities: #[] },
      #{ id: "backend-tracing-observability", label: "Backend tracing and observability", source: "local-stack-e2e", minimumProofLevel: "behavioral", operationIds: #["AgentController_getAgentEvaluations", "AgentController_getSessions", "AgentController_getSession", "AgentController_getSessionLogs", "AgentController_getSessionReasoningTrace", "AgentController_getObservability", "OrganizationController_getGovernanceFeed"], providerGuardCapabilities: #["tracing"], exceptionCapabilities: #[] },
      #{ id: "backend-usage-cost-trust", label: "Backend usage, cost, and trust", source: "local-stack-e2e", minimumProofLevel: "behavioral", operationIds: #["AgentController_getAgentsMetrics", "AgentController_updateAivssConfig", "AgentController_recalculateTrustScore", "AgentController_getTrustTierChanges", "AgentController_getAgentTrustScoreEvents", "OrganizationController_getTrustTierTrends"], providerGuardCapabilities: #["usage-cost"], exceptionCapabilities: #[] },
      #{ id: "provider-adapter-guardrails", label: "Provider adapter guardrails", source: "provider-guard-fixture", minimumProofLevel: "none", operationIds: #[], providerGuardCapabilities: #["guardrails"], exceptionCapabilities: #["guardrails"] },
      #{ id: "provider-adapter-approvals-hitl", label: "Provider adapter approvals and HITL", source: "provider-guard-fixture", minimumProofLevel: "none", operationIds: #[], providerGuardCapabilities: #["approvals-hitl"], exceptionCapabilities: #["approvals-hitl"] },
      #{ id: "provider-adapter-tracing", label: "Provider adapter tracing", source: "provider-guard-fixture", minimumProofLevel: "none", operationIds: #[], providerGuardCapabilities: #["tracing"], exceptionCapabilities: #["tracing"] },
      #{ id: "provider-adapter-usage-cost", label: "Provider adapter usage and cost", source: "provider-guard-fixture", minimumProofLevel: "none", operationIds: #[], providerGuardCapabilities: #["usage-cost"], exceptionCapabilities: #["usage-cost"] },
      #{ id: "provider-adapter-opa-rules", label: "Provider adapter OPA/rules boundary", source: "provider-guard-fixture", minimumProofLevel: "none", operationIds: #[], providerGuardCapabilities: #["opa-rules"], exceptionCapabilities: #["rules-instructions"] },
    ],
    requiredSharedProviderGuardProofCapabilities: #["opa-rules"],
    requiredSdkSemanticGapClosureTargets: #["typescript", "python"],
    providerGuardSharedProofPolicy: "Shared provider guard proof is allowed only for explicitly generated backend-owned capabilities. OPA/Rego and behavior-rule evaluation are backend-owned, so every SDK/runtime provider must prove it delegates that capability rather than implementing policy evaluation locally.",
    localStackAxisPolicy: "Every required governance axis must be represented by at least one proven local-stack scenario; provider-owned fixture evidence cannot satisfy the local-stack governance axis requirement.",
    rawSemanticGapPolicy: "Raw backend/Core semantic gaps must remain explicit in the local-stack ledger and each gap must have generated TypeScript and Python request-preflight closure evidence until backend/Core rejects the invalid input itself.",
    backendCoreGapStatusPolicy: "The matrix status can be proven through SDK closures while raw backend/Core semantic gaps exist, but backendCoreGapStatus must remain known-gaps until the raw local stack rejects those inputs directly.",
    backendCoreGapRemediationPolicy: "Every raw backend/Core semantic gap must map to a generated request constraint remediation target with the affected operations, constraint keys, raw proof file, and required raw rejection behavior.",
  },
  eventCatalog: #[
    #{
      provider: "codex",
      upstreamKnownEvents: #["UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse", "Stop"],
      generatedAdapterEvents: #["UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse", "Stop"],
      intentionalExclusions: #[],
    },
    #{
      provider: "cursor",
      upstreamKnownEvents: #["beforeSubmitPrompt", "beforeReadFile", "beforeShellExecution", "beforeMCPExecution", "preToolUse", "afterAgentResponse", "afterAgentThought", "afterShellExecution", "afterFileEdit", "afterMCPExecution", "postToolUse", "postToolUseFailure", "sessionStart", "stop", "beforeTabFileRead", "afterTabFileEdit", "sessionEnd", "preCompact", "subagentStart", "subagentStop"],
      generatedAdapterEvents: #["beforeSubmitPrompt", "beforeReadFile", "beforeShellExecution", "beforeMCPExecution", "preToolUse", "afterAgentResponse", "afterAgentThought", "afterShellExecution", "afterFileEdit", "afterMCPExecution", "postToolUse", "postToolUseFailure", "sessionStart", "stop", "beforeTabFileRead", "afterTabFileEdit", "sessionEnd", "preCompact", "subagentStart", "subagentStop"],
      intentionalExclusions: #[],
    },
    #{
      provider: "claude-code",
      upstreamKnownEvents: #["Setup", "SessionStart", "InstructionsLoaded", "UserPromptSubmit", "UserPromptExpansion", "MessageDisplay", "PreToolUse", "PermissionRequest", "PermissionDenied", "PostToolUse", "PostToolUseFailure", "PostToolBatch", "SubagentStart", "SubagentStop", "TaskCreated", "TaskCompleted", "Stop", "StopFailure", "TeammateIdle", "Notification", "ConfigChange", "CwdChanged", "FileChanged", "WorktreeCreate", "WorktreeRemove", "PreCompact", "PostCompact", "SessionEnd", "Elicitation", "ElicitationResult"],
      generatedAdapterEvents: #["PreToolUse", "PostToolUse", "PostToolUseFailure", "PostToolBatch", "UserPromptSubmit", "UserPromptExpansion", "PermissionRequest", "PermissionDenied", "Setup", "InstructionsLoaded", "PreCompact", "PostCompact", "SessionStart", "SessionEnd", "SubagentStart", "SubagentStop", "TaskCreated", "TaskCompleted", "Stop", "StopFailure", "TeammateIdle", "Notification", "MessageDisplay", "ConfigChange", "CwdChanged", "FileChanged", "WorktreeCreate", "WorktreeRemove", "Elicitation", "ElicitationResult"],
      intentionalExclusions: #[],
    },
    #{
      provider: "anthropic-agent-sdk",
      upstreamKnownEvents: #["Setup", "SessionStart", "InstructionsLoaded", "UserPromptSubmit", "UserPromptExpansion", "MessageDisplay", "PreToolUse", "PermissionRequest", "PermissionDenied", "PostToolUse", "PostToolUseFailure", "PostToolBatch", "SubagentStart", "SubagentStop", "TaskCreated", "TaskCompleted", "Stop", "StopFailure", "TeammateIdle", "Notification", "ConfigChange", "CwdChanged", "FileChanged", "WorktreeCreate", "WorktreeRemove", "PreCompact", "PostCompact", "SessionEnd", "Elicitation", "ElicitationResult"],
      generatedAdapterEvents: #["Setup", "SessionStart", "InstructionsLoaded", "UserPromptSubmit", "UserPromptExpansion", "Notification", "PreToolUse", "PermissionRequest", "PermissionDenied", "PostToolUse", "PostToolUseFailure", "PostToolBatch", "Stop", "StopFailure", "SubagentStart", "SubagentStop", "TaskCreated", "TaskCompleted", "TeammateIdle", "ConfigChange", "CwdChanged", "FileChanged", "WorktreeRemove", "PreCompact", "PostCompact", "SessionEnd", "Elicitation", "ElicitationResult", "MessageDisplay", "WorktreeCreate"],
      intentionalExclusions: #[],
    },
  ],
  pluginComponents: #[
    #{ provider: "codex", components: #[#{ name: "manifest", tier: "native", path: ".codex-plugin/plugin.json", reason: "Required Codex plugin manifest." }, #{ name: "marketplace", tier: "native", path: ".agents/plugins/marketplace.json", reason: "Repo-local marketplace entry for local Codex discovery." }, #{ name: "skills", tier: "native", path: "skills/openbox/SKILL.md", reason: "Codex plugin skill bundle." }, #{ name: "repo-skill", tier: "native", path: ".agents/skills/openbox/SKILL.md", reason: "Project-local skill install for non-plugin discovery." }, #{ name: "hooks", tier: "native", path: "hooks/hooks.json", reason: "Plugin-bundled Codex hook config." }, #{ name: "mcp", tier: "native", path: ".mcp.json", reason: "Plugin-bundled MCP server config." }, #{ name: "agents-md", tier: "wrapped", path: "AGENTS.md", reason: "Codex instruction projection references OpenBox governance and skills." }, #{ name: "rules", tier: "wrapped", path: ".codex/rules/openbox.rules", reason: "Only command-prefix execution policy is projected to Codex rules." }, #{ name: "assets", tier: "diagnose-only", path: "assets/", reason: "Optional presentation assets are not required for governance." }] },
    #{ provider: "cursor", components: #[#{ name: "plugin-manifest", tier: "native", surface: "plugin", path: ".cursor-plugin/plugin.json", reason: "Cursor local plugin metadata." }, #{ name: "marketplace", tier: "native", surface: "plugin", path: ".cursor-plugin/marketplace.json", reason: "Cursor marketplace-style metadata." }, #{ name: "hooks", tier: "native", surface: "plugin", path: "hooks/hooks.json", reason: "Plugin hook config." }, #{ name: "mcp", tier: "native", surface: "plugin", path: "mcp.json", reason: "Plugin MCP config." }, #{ name: "rules", tier: "native", surface: "plugin", path: "rules/openbox.mdc", reason: "Cursor .mdc governance projection." }, #{ name: "commands", tier: "native", surface: "plugin", path: "commands/", reason: "Cursor slash command markdown files." }, #{ name: "agents", tier: "native", surface: "plugin", path: "agents/openbox-reviewer.md", reason: "Cursor agent template." }, #{ name: "skills", tier: "native", surface: "plugin", path: "skills/openbox/SKILL.md", reason: "Plugin skill bundle." }, #{ name: "workspaceOpen", tier: "wrapped", surface: "plugin", path: "workspaceOpen.json", reason: "Metadata hint for workspace plugin discovery/loading." }, #{ name: "repo-hooks", tier: "native", surface: "repo", path: ".cursor/hooks.json", reason: "Cloud-compatible repo hook config." }, #{ name: "repo-mcp", tier: "native", surface: "repo", path: ".cursor/mcp.json", reason: "Cloud-compatible repo MCP config." }, #{ name: "repo-rules", tier: "native", surface: "repo", path: ".cursor/rules/openbox-governance.mdc", reason: "Cloud-compatible repo .mdc governance projection." }, #{ name: "repo-skill", tier: "native", surface: "repo", path: ".agents/skills/openbox/SKILL.md", reason: "Project-local skill install for repo-mode discovery." }] },
    #{ provider: "claude-code", components: #[#{ name: "manifest", tier: "native", path: ".claude-plugin/plugin.json", reason: "Claude Code plugin manifest." }, #{ name: "marketplace", tier: "native", path: ".claude-plugin/marketplace.json", reason: "Claude Code marketplace metadata." }, #{ name: "skills", tier: "native", path: "skills/openbox/SKILL.md", reason: "Plugin skill bundle." }, #{ name: "commands", tier: "native", path: "commands/", reason: "Slash commands." }, #{ name: "agents", tier: "native", path: "agents/openbox-reviewer.md", reason: "Agent template." }, #{ name: "instructions", tier: "wrapped", path: "instructions/CLAUDE.md", reason: "CLAUDE/AGENTS-style instruction projection rendered from the shared OpenBox rules projection renderer." }, #{ name: "hooks", tier: "native", path: "hooks/hooks.json", reason: "Generated hook config." }, #{ name: "mcp", tier: "native", path: ".mcp.json", reason: "Plugin MCP config." }, #{ name: "diagnostics", tier: "native", path: "diagnostics/", reason: "Component inventory and governance audit." }, #{ name: "bin", tier: "native", path: "bin/", reason: "Project-local OpenBox CLI runner." }, #{ name: "monitors", tier: "diagnose-only", path: "diagnostics/monitors.opt-in.json", reason: "Monitor execution is unsandboxed and opt-in." }, #{ name: "lsp", tier: "out-of-scope", reason: "OpenBox does not ship a language server." }] },
  ],
  publicIntegrations: #[
    #{ integration: "openai-agents-sdk", tier: "native", packageSubpath: "./openai-agents-sdk", exports: #["createOpenBoxAgentHooks", "createOpenBoxTracingProcessor", "openBoxInputGuardrail", "openBoxOutputGuardrail", "openBoxToolInputGuardrail", "openBoxToolOutputGuardrail", "runWithOpenBox", "createOpenBoxAgentsTool", "verifyOpenBoxAgentsSDKConfig"], notes: "Native helpers plus compatibility wrappers for the OpenAI Agents SDK." },
    #{ integration: "anthropic-agent-sdk", tier: "native", packageSubpath: "./anthropic-agent-sdk", exports: #["createOpenBoxAnthropicAgentHooks", "withOpenBoxAnthropicAgentOptions", "createOpenBoxAnthropicAgentSDK", "verifyOpenBoxAnthropicAgentSDKConfig"], notes: "Native hook/options/query wrapper coverage; WorktreeCreate remains opt-in at host level." },
    #{ integration: "copilotkit", tier: "wrapped", packageSubpath: "./copilotkit", exports: #["createOpenBoxCopilotKitAdapter", "createOpenBoxAGUIAdapter", "createOpenBoxHeadlessApprovalClient", "createOpenBoxApprovalRoute", "createOpenBoxReadinessCheck"], notes: "CopilotKit runtime, AG-UI event stream, React renderers, and headless HITL helpers." },
    #{ integration: "n8n", tier: "wrapped", packageSubpath: "./runtime/n8n", exports: #["emitN8nUserPromptSignal", "emitN8nNodePreExecute", "emitN8nNodePostExecute", "emitN8nLlmCompletion", "OPENBOX_N8N_INTEGRATION", "listOpenBoxN8nCredentials", "listOpenBoxN8nNodes", "listOpenBoxN8nWorkflowTemplates", "listOpenBoxN8nExamples", "getOpenBoxN8nCredential", "getOpenBoxN8nNode", "getOpenBoxN8nWorkflowTemplate", "getOpenBoxN8nExample", "verifyOpenBoxN8nIntegrationSurface"], notes: "Low-level primitives plus packaged credentials, nodes, and workflow template descriptors." },
  ],
  mcpTools: #[
    #{ name: "get_profile", title: "Get Profile", risk: "low", approval: "never requires approval", sideEffects: "reads OpenBox backend profile only", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    #{ name: "cursor_status", title: "Cursor Status", risk: "low", approval: "never requires approval", sideEffects: "reads OpenBox backend health and local runtime readiness", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    #{ name: "openbox_status", title: "OpenBox Status", risk: "low", approval: "never requires approval", sideEffects: "reads OpenBox backend health and local runtime readiness", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    #{ name: "codex_doctor", title: "Codex Doctor", risk: "low", approval: "never requires approval", sideEffects: "reads project-local Codex/OpenBox hook files and optionally validates runtime connectivity", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    #{ name: "cursor_doctor", title: "Cursor Doctor", risk: "low", approval: "never requires approval", sideEffects: "reads project-local Cursor/OpenBox install files and optionally validates runtime connectivity", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    #{ name: "claude_code_doctor", title: "Claude Code Doctor", risk: "low", approval: "never requires approval", sideEffects: "reads project-local Claude Code/OpenBox plugin files and optionally validates runtime connectivity", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    #{ name: "list_agents", title: "List Agents", risk: "low", approval: "never requires approval", sideEffects: "reads OpenBox backend agents", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    #{ name: "get_agent", title: "Get Agent", risk: "low", approval: "never requires approval", sideEffects: "reads one OpenBox backend agent", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    #{ name: "list_pending_approvals", title: "List Pending Approvals", risk: "low", approval: "never requires approval", sideEffects: "reads OpenBox backend approval rows", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    #{ name: "decide_approval", title: "Decide Approval", risk: "high", approval: "does not require a separate approval, but mutates an existing OpenBox approval decision", sideEffects: "approves or rejects a pending OpenBox approval row", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    #{ name: "list_guardrails", title: "List Guardrails", risk: "low", approval: "never requires approval", sideEffects: "reads OpenBox backend guardrails", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    #{ name: "list_policies", title: "List Policies", risk: "low", approval: "never requires approval", sideEffects: "reads OpenBox backend policies", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    #{ name: "get_trust_score", title: "Get Trust Score", risk: "low", approval: "never requires approval", sideEffects: "reads one OpenBox backend agent trust snapshot", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    #{ name: "check_governance", title: "Check Governance", risk: "medium", approval: "may return require_approval and materialize a Core-owned approval row", sideEffects: "emits governance events and spans to OpenBox Core", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  ],
  mcpPrompts: #[
    #{ name: "openbox_status", title: "OpenBox Status", description: "Check OpenBox backend, MCP, and host readiness.", args: #[], instructions: "Call openbox_status and summarize connection health, fail-closed mode, approval mode, and host install readiness. Do not run shell commands." },
    #{ name: "pending_approvals", title: "Pending Approvals", description: "Review pending OpenBox approvals and request a human decision.", args: #[], instructions: "Call list_pending_approvals, group pending rows by agent/source, and ask the user before calling decide_approval. Keep source attribution visible." },
    #{ name: "policy_review", title: "Policy Review", description: "Inspect policies and behavior rules for an agent.", args: #[#{ name: "agent_id", description: "OpenBox agent ID to review", required: true }], instructions: "Call list_policies for the provided agent_id, then use policy/behavior-rule resources when specific records need detail. Explain that OPA/Rego and behavior-rule evaluation remain Core-owned." },
    #{ name: "governance_check", title: "Governance Check", description: "Evaluate a proposed action through OpenBox Core.", args: #[#{ name: "agent_id", description: "OpenBox agent ID used to resolve runtime API key when needed", required: false }, #{ name: "span_type", description: "Span type such as llm, shell, http, db, file_read, file_write, file_delete, or mcp", required: true }, #{ name: "activity_input", description: "JSON string containing the proposed action payload", required: true }], instructions: "Call check_governance with span_type and parsed activity_input before advising execution. If the verdict is require_approval, halt and route the user to approval resolution." },
    #{ name: "guardrail_review", title: "Guardrail Review", description: "Inspect guardrails for an agent.", args: #[#{ name: "agent_id", description: "OpenBox agent ID to review", required: true }], instructions: "Call list_guardrails for the provided agent_id and summarize stage coverage, redaction behavior, and any inactive or missing guardrails. Do not duplicate Core guardrail logic locally." },
  ],
  mcpResourceTemplates: #[
    #{ name: "agent", title: "OpenBox Agent", uriTemplate: "openbox://agent/{agent_id}", description: "OpenBox agent details, trust score, and tier.", mimeType: "application/json" },
    #{ name: "guardrail", title: "OpenBox Guardrail", uriTemplate: "openbox://agent/{agent_id}/guardrail/{guardrail_id}", description: "OpenBox guardrail record for an agent.", mimeType: "application/json" },
    #{ name: "policy", title: "OpenBox Policy", uriTemplate: "openbox://agent/{agent_id}/policy/{policy_id}", description: "OpenBox OPA/Rego policy record for an agent.", mimeType: "application/json" },
    #{ name: "behavior-rule", title: "OpenBox Behavior Rule", uriTemplate: "openbox://agent/{agent_id}/behavior-rule/{behavior_rule_id}", description: "OpenBox behavior-rule record for an agent.", mimeType: "application/json" },
    #{ name: "approval", title: "OpenBox Approval", uriTemplate: "openbox://agent/{agent_id}/approval/{approval_id}", description: "OpenBox pending or historical approval record.", mimeType: "application/json" },
    #{ name: "skill-reference", title: "OpenBox Skill Reference", uriTemplate: "openbox://skill/{name}", description: "OpenBox skill reference markdown installed by host plugins.", mimeType: "text/markdown" },
  ],
  mcpSkillReferences: #[
    #{ name: "governance-flow", path: "references/governance-flow.md", description: "Event protocol, wire format, verdicts, approval polling, spec-vs-implementation mismatches" },
    #{ name: "guardrails", path: "references/guardrails.md", description: "Guardrail configuration: numeric IDs, stage gating, legacy binding no-ops, per-field status, backend validation gaps" },
    #{ name: "behaviors", path: "references/behaviors.md", description: "Behavior rules: trigger/states enum, time_window, priority, active toggle, shell-as-internal" },
    #{ name: "backend-api", path: "references/backend-api.md", description: "Backend conventions: {status,data} envelope, X-Openbox-Client header, /auth/refresh caveats, OpenAPI availability" },
    #{ name: "rego-reference", path: "references/rego-reference.md", description: "Rego policy syntax, input fields, example policies, policy lifecycle gotchas" },
    #{ name: "span-reference", path: "references/span-reference.md", description: "Span types, gate attributes, semantic type detection" },
    #{ name: "commands", path: "references/commands.md", description: "Full CLI command reference" },
    #{ name: "claude-code-governance", path: "references/claude-code-governance.md", description: "Claude Code hook/plugin/MCP governance surface audit and coverage matrix" },
    #{ name: "existing-sdks", path: "references/existing-sdks.md", description: "Available SDKs and installation" },
  ],
  n8nIntegration: #{
    packageManifest: #{
      n8nNodesApiVersion: 1,
      credentials: #["dist/OpenBoxCredentials.credentials.js"],
      nodes: #["dist/OpenboxLlm.node.js", "dist/OpenBoxGovernance.node.js", "dist/OpenBoxGuardrails.node.js", "dist/OpenBoxApproval.node.js", "dist/OpenBoxGovernedAiAgent.node.js"],
      openboxSpecSource: "specs/typespec/govern/capabilities.tsp",
      openboxSpecNodeIds: #["openboxLlm", "openboxGovernance", "openboxGuardrails", "openboxApproval", "openboxGovernedAiAgent"],
    },
    credentials: #[
      #{ name: "OpenBox Credentials", id: "openboxCredentials", properties: #["coreUrl", "apiKey", "apiUrl", "backendApiKey", "agentId"], reason: "Core governance requires a runtime API key; backend approval decisions optionally use backend credentials." },
    ],
    nodes: #[
      #{ name: "OpenBox: LLM", id: "openboxLlm", tier: "wrapped", description: "Runs an OpenAI-compatible or Ollama LLM call and emits OpenBox pre/post governance spans." },
      #{ name: "OpenBox Governance", id: "openboxGovernance", tier: "wrapped", description: "Runs prompt or node pre-execution governance through OpenBox Core." },
      #{ name: "OpenBox Guardrails", id: "openboxGuardrails", tier: "native", description: "Wraps n8n guardrail checks and emits OpenBox guardrail spans." },
      #{ name: "OpenBox Approval/HITL", id: "openboxApproval", tier: "native", description: "Pauses/resumes workflow execution through OpenBox approval rows." },
      #{ name: "OpenBox Governed AI Agent", id: "openboxGovernedAiAgent", tier: "wrapped", description: "Template node composition for a governed n8n AI Agent workflow." },
    ],
    workflowTemplates: #[
      #{
        name: "OpenBox Governed AI Agent",
        id: "openbox-governed-ai-agent",
        nodes: #["openboxGovernance", "n8nAiAgent", "openboxGuardrails", "openboxApproval"],
        description: "Govern prompt, review tool calls, enforce guardrails, and resolve HITL approvals around an n8n AI Agent.",
        workflow: #{
          name: "OpenBox Governed AI Agent",
          nodes: #[
            #{ id: "openbox-governance", name: "openboxGovernance", type: "n8n-nodes-openbox-hook.openboxGovernance", typeVersion: 1, position: #[0, 0], parameters: #{ prompt: "={{ $json.chatInput || $json.prompt || $json.text || \"\" }}" } },
            #{ id: "n8n-ai-agent", name: "n8nAiAgent", type: "@n8n/n8n-nodes-langchain.agent", typeVersion: 2, position: #[300, 0], parameters: #{ agent: "toolsAgent" } },
            #{ id: "openbox-guardrails", name: "openboxGuardrails", type: "n8n-nodes-openbox-hook.openboxGuardrails", typeVersion: 1, position: #[600, 0], parameters: #{ text: "={{ $json.output || $json.text || \"\" }}" } },
            #{ id: "openbox-approval", name: "openboxApproval", type: "n8n-nodes-openbox-hook.openboxApproval", typeVersion: 1, position: #[900, 0], parameters: #{ approvalReason: "={{ $json.approvalReason || \"Review governed AI agent output.\" }}" } },
          ],
          connections: #{
            openboxGovernance: #{ main: #[#[#{ node: "n8nAiAgent", type: "main", index: 0 }]] },
            n8nAiAgent: #{ main: #[#[#{ node: "openboxGuardrails", type: "main", index: 0 }]] },
            openboxGuardrails: #{ main: #[#[#{ node: "openboxApproval", type: "main", index: 0 }]] },
          },
          settings: #{ executionOrder: "v1" },
        },
      },
    ],
    examples: #[
      #{
        name: "AI Agent Tool Review",
        id: "ai-agent-tool-review",
        description: "Pre/post tool review around an n8n AI Agent tool call.",
        workflow: #{
          name: "OpenBox AI Agent Tool Review",
          nodes: #[
            #{ id: "openbox-governance", name: "openboxGovernance", type: "n8n-nodes-openbox-hook.openboxGovernance", typeVersion: 1, position: #[0, 0], parameters: #{ prompt: "={{ $json.toolRequest || $json.chatInput || \"\" }}" } },
            #{ id: "n8n-ai-agent", name: "n8nAiAgent", type: "@n8n/n8n-nodes-langchain.agent", typeVersion: 2, position: #[300, 0], parameters: #{ agent: "toolsAgent" } },
            #{ id: "openbox-approval", name: "openboxApproval", type: "n8n-nodes-openbox-hook.openboxApproval", typeVersion: 1, position: #[600, 0], parameters: #{ approvalReason: "={{ $json.approvalReason || \"Review proposed AI Agent tool call.\" }}" } },
          ],
          connections: #{
            openboxGovernance: #{ main: #[#[#{ node: "n8nAiAgent", type: "main", index: 0 }]] },
            n8nAiAgent: #{ main: #[#[#{ node: "openboxApproval", type: "main", index: 0 }]] },
          },
          settings: #{ executionOrder: "v1" },
        },
      },
      #{
        name: "Guardrails Node Interop",
        id: "guardrails-node-interop",
        description: "OpenBox guardrail wrapper around the native n8n Guardrails node.",
        workflow: #{
          name: "OpenBox Guardrails Node Interop",
          nodes: #[
            #{ id: "openbox-governance", name: "openboxGovernance", type: "n8n-nodes-openbox-hook.openboxGovernance", typeVersion: 1, position: #[0, 0], parameters: #{ prompt: "={{ $json.prompt || $json.chatInput || \"\" }}" } },
            #{ id: "openbox-guardrails", name: "openboxGuardrails", type: "n8n-nodes-openbox-hook.openboxGuardrails", typeVersion: 1, position: #[300, 0], parameters: #{ text: "={{ $json.output || $json.text || \"\" }}" } },
          ],
          connections: #{
            openboxGovernance: #{ main: #[#[#{ node: "openboxGuardrails", type: "main", index: 0 }]] },
          },
          settings: #{ executionOrder: "v1" },
        },
      },
      #{
        name: "MCP Client Tool",
        id: "mcp-client-tool",
        description: "OpenBox-governed n8n MCP Client Tool invocation.",
        workflow: #{
          name: "OpenBox MCP Client Tool",
          nodes: #[
            #{ id: "openbox-governance", name: "openboxGovernance", type: "n8n-nodes-openbox-hook.openboxGovernance", typeVersion: 1, position: #[0, 0], parameters: #{ prompt: "={{ $json.mcpRequest || $json.chatInput || \"\" }}" } },
            #{ id: "mcp-client-tool", name: "mcpClientTool", type: "@n8n/n8n-nodes-langchain.toolmcp", typeVersion: 1, position: #[300, 180], parameters: #{ serverUrl: "={{ $env.OPENBOX_MCP_URL || \"http://localhost:3000/mcp\" }}" } },
            #{ id: "n8n-ai-agent", name: "n8nAiAgent", type: "@n8n/n8n-nodes-langchain.agent", typeVersion: 2, position: #[600, 0], parameters: #{ agent: "toolsAgent" } },
          ],
          connections: #{
            openboxGovernance: #{ main: #[#[#{ node: "n8nAiAgent", type: "main", index: 0 }]] },
            mcpClientTool: #{ ai_tool: #[#[#{ node: "n8nAiAgent", type: "ai_tool", index: 0 }]] },
          },
          settings: #{ executionOrder: "v1" },
        },
      },
      #{
        name: "MCP Server Trigger",
        id: "mcp-server-trigger",
        description: "OpenBox-governed n8n MCP Server Trigger workflow entrypoint.",
        workflow: #{
          name: "OpenBox MCP Server Trigger",
          nodes: #[
            #{ id: "mcp-server-trigger", name: "mcpServerTrigger", type: "@n8n/n8n-nodes-langchain.mcptrigger", typeVersion: 1, position: #[0, 0], parameters: #{ path: "openbox-governed" } },
            #{ id: "openbox-governance", name: "openboxGovernance", type: "n8n-nodes-openbox-hook.openboxGovernance", typeVersion: 1, position: #[300, 0], parameters: #{ prompt: "={{ $json.prompt || $json.input || \"\" }}" } },
          ],
          connections: #{
            mcpServerTrigger: #{ main: #[#[#{ node: "openboxGovernance", type: "main", index: 0 }]] },
          },
          settings: #{ executionOrder: "v1" },
        },
      },
    ],
    showcaseWorkflows: #[
      #{
        name: "OpenBox Governed Support Triage",
        id: "sdk-showcase",
        path: "example/n8n/workflows/sdk-showcase.json",
        description: "Local n8n demo workflow for governed support triage across chat, Slack, Postgres logging, optional HubSpot output, and Slack approval actions.",
        requiredOpenBoxNodeIds: #["openboxLlm"],
        requiredOpenBoxNodeTypes: #["n8n-nodes-openbox-hook.openboxLlm"],
        requiredTriggerTypes: #["@n8n/n8n-nodes-langchain.chatTrigger", "n8n-nodes-base.slackTrigger", "n8n-nodes-base.webhook"],
        requiredCheckpoints: #["OpenBox: Prompt Safety Wall", "OpenBox: Context Privacy Check", "OpenBox: Governed LLM Draft", "OpenBox: Channel Output Check"],
        requiredTerminalNodes: #["Package OpenBox Terminal Output", "Build Final Log", "Record Planned Path Log", "Return Chat Summary"],
        requiredEntryEdges: #[
          #{ from: "When Chat Message Received", to: "OpenBox: Prompt Safety Wall" },
          #{ from: "When Slack Agent Message Received", to: "Normalize Slack Agent Input" },
          #{ from: "Normalize Slack Agent Input", to: "OpenBox: Prompt Safety Wall" },
          #{ from: "When Slack Approval Action Received", to: "Parse Slack Approval Action" },
          #{ from: "Parse Slack Approval Action", to: "Record Slack Approval Decision" },
          #{ from: "Record Slack Approval Decision", to: "Acknowledge Slack Approval Decision" },
        ],
        checkpointGates: #[
          #{ checkpoint: "OpenBox: Prompt Safety Wall", gate: "Prompt Wall Passed?", pass: "Prepare Ticket Context", fail: "Package OpenBox Terminal Output" },
          #{ checkpoint: "OpenBox: Context Privacy Check", gate: "Context Check Passed?", pass: "Record Context Check", fail: "Package OpenBox Terminal Output" },
          #{ checkpoint: "OpenBox: Governed LLM Draft", gate: "Draft Governance Passed?", pass: "Record Draft Governance", fail: "Package OpenBox Terminal Output" },
          #{ checkpoint: "OpenBox: Channel Output Check", gate: "Channel Check Passed?", pass: "Record Channel Check", fail: "Package OpenBox Terminal Output" },
        ],
        requiredNodeIdentities: #[
          #{ name: "OpenBox: Prompt Safety Wall", id: "openbox-input-wall", type: "n8n-nodes-openbox-hook.openboxLlm" },
          #{ name: "OpenBox: Context Privacy Check", id: "openbox-context-privacy-check", type: "n8n-nodes-openbox-hook.openboxLlm" },
          #{ name: "OpenBox: Governed LLM Draft", id: "openbox-llm", type: "n8n-nodes-openbox-hook.openboxLlm" },
          #{ name: "OpenBox: Channel Output Check", id: "openbox-channel-output-check", type: "n8n-nodes-openbox-hook.openboxLlm" },
          #{ name: "When Slack Agent Message Received", id: "slack-agent-trigger", type: "n8n-nodes-base.slackTrigger" },
          #{ name: "Normalize Slack Agent Input", id: "normalize-slack-agent-input", type: "n8n-nodes-base.set" },
          #{ name: "HubSpot CRM Configured?", id: "hubspot-crm-configured", type: "n8n-nodes-base.if" },
          #{ name: "Upsert HubSpot Contact (Optional)", id: "upsert-hubspot-contact", type: "n8n-nodes-base.hubspot" },
          #{ name: "When Slack Approval Action Received", id: "slack-approval-action-webhook", type: "n8n-nodes-base.webhook" },
          #{ name: "Acknowledge Slack Approval Decision", id: "ack-slack-approval-decision", type: "n8n-nodes-base.httpRequest" },
        ],
        requiredNodeBooleanFlags: #[
          #{ node: "OpenBox: Prompt Safety Wall", flag: "continueOnFail", expected: true },
          #{ node: "OpenBox: Prompt Safety Wall", flag: "alwaysOutputData", expected: true },
          #{ node: "OpenBox: Context Privacy Check", flag: "continueOnFail", expected: true },
          #{ node: "OpenBox: Context Privacy Check", flag: "alwaysOutputData", expected: true },
          #{ node: "OpenBox: Governed LLM Draft", flag: "continueOnFail", expected: true },
          #{ node: "OpenBox: Governed LLM Draft", flag: "alwaysOutputData", expected: true },
          #{ node: "OpenBox: Channel Output Check", flag: "continueOnFail", expected: true },
          #{ node: "OpenBox: Channel Output Check", flag: "alwaysOutputData", expected: true },
          #{ node: "Post to Slack", flag: "continueOnFail", expected: true },
          #{ node: "Post to Slack", flag: "alwaysOutputData", expected: true },
          #{ node: "Upsert HubSpot Contact (Optional)", flag: "continueOnFail", expected: true },
          #{ node: "Upsert HubSpot Contact (Optional)", flag: "alwaysOutputData", expected: true },
        ],
        expressionSourceChecks: #[
          #{
            node: "When Slack Agent Message Received",
            requiredContains: #[
              "$env.SLACK_CHANNEL_ID",
            ],
            forbiddenContains: #[],
          },
          #{
            node: "Prompt Wall Passed?",
            requiredContains: #[
              "Boolean($json._openbox?.governed)",
              "!$json._openbox?.blocked",
              "!$json._openbox?.providerError",
              "!$json.error",
            ],
            forbiddenContains: #[],
          },
          #{
            node: "Context Check Passed?",
            requiredContains: #[
              "Boolean($json._openbox?.governed)",
              "!$json._openbox?.blocked",
              "!$json._openbox?.providerError",
              "!$json.error",
            ],
            forbiddenContains: #[],
          },
          #{
            node: "Draft Governance Passed?",
            requiredContains: #[
              "Boolean($json._openbox?.governed)",
              "!$json._openbox?.blocked",
              "!$json._openbox?.providerError",
              "!$json.error",
            ],
            forbiddenContains: #[],
          },
          #{
            node: "Channel Check Passed?",
            requiredContains: #[
              "Boolean($json._openbox?.governed)",
              "!$json._openbox?.blocked",
              "!$json._openbox?.providerError",
              "!$json.error",
            ],
            forbiddenContains: #[],
          },
          #{
            node: "Post to Slack",
            requiredContains: #[
              "$('Build Final Log').item.json.channelPayloads?.slack?.channelId",
              "$('Build Final Log').item.json.channelPayloads?.slack?.text",
              "$('Build Final Log').item.json.channelPayloads?.slack?.blocks",
            ],
            forbiddenContains: #[
              "$json.channelPayloads?.slack",
              "$json.channelPayloads.slack",
            ],
          },
          #{
            node: "Upsert HubSpot Contact (Optional)",
            requiredContains: #[
              "$('Build Final Log').item.json.channelPayloads.hubspot.email",
              "$('Build Final Log').item.json.channelPayloads.hubspot.firstName",
              "$('Build Final Log').item.json.channelPayloads.hubspot.lastName",
              "$('Build Final Log').item.json.channelPayloads.hubspot.companyName",
              "$('Build Final Log').item.json.channelPayloads.hubspot.websiteUrl",
              "$('Build Final Log').item.json.channelPayloads.hubspot.city",
              "$('Build Final Log').item.json.channelPayloads.hubspot.message",
              "$('Build Final Log').item.json.channelPayloads.hubspot.leadStatus",
              "$('Build Final Log').item.json.channelPayloads.hubspot.lifeCycleStage",
            ],
            forbiddenContains: #[
              "$json.channelPayloads.hubspot",
            ],
          },
        ],
        requiredOpenBoxNodeParameterChecks: #[
          #{
            nodeType: "n8n-nodes-openbox-hook.openboxLlm",
            parameter: "apiEndpoint",
            requiredContains: #[
              "OPENBOX_API_URL",
              "host.docker.internal:8086",
            ],
            forbiddenContains: #[],
            forbiddenValues: #[],
          },
          #{
            nodeType: "n8n-nodes-openbox-hook.openboxLlm",
            parameter: "apiKey",
            requiredContains: #[
              "OPENBOX_API_KEY",
            ],
            forbiddenContains: #[],
            forbiddenValues: #[],
          },
          #{
            nodeType: "n8n-nodes-openbox-hook.openboxLlm",
            parameter: "llmProvider",
            requiredContains: #[
              "LLM_PROVIDER_API_KEY",
              "LLM7_API_KEY",
              "OPENROUTER_API_KEY",
              "openrouter",
              "ollama",
            ],
            forbiddenContains: #[],
            forbiddenValues: #["openrouter", "ollama"],
          },
          #{
            nodeType: "n8n-nodes-openbox-hook.openboxLlm",
            parameter: "model",
            requiredContains: #[
              "LLM_PROVIDER_MODEL",
              "OPENROUTER_MODEL",
              "OLLAMA_MODEL",
            ],
            forbiddenContains: #["\"default\""],
            forbiddenValues: #["default"],
          },
          #{
            nodeType: "n8n-nodes-openbox-hook.openboxLlm",
            parameter: "openRouterBaseUrl",
            requiredContains: #[
              "LLM_PROVIDER_BASE_URL",
              "OPENROUTER_BASE_URL",
              "https://openrouter.ai/api/v1",
            ],
            forbiddenContains: #["api.llm7.io"],
            forbiddenValues: #[],
          },
        ],
        approvalStages: #["prompt-wall", "draft-governance", "channel-output"],
        requiredApprovalActionIds: #["openbox_prompt_false_positive", "openbox_prompt_keep_blocked", "openbox_draft_approve", "openbox_draft_reject", "openbox_send_approve", "openbox_send_reject", "openbox_send_rewrite"],
        requiredPathLogSteps: #["input", "slack-input", "prompt-wall", "customer-lookup", "context-check", "draft-governance", "channel-check", "review-package", "chat-output", "slack-output", "hubspot-output", "backend-final-log"],
        requiredTerminalEventTypes: #["planned-path", "chat-output", "slack-output", "hubspot-output", "approval-decision"],
        allowedCredentialPlaceholders: #["demo-postgres-placeholder", "demo-slack-api-placeholder", "demo-hubspot-app-token"],
        forbiddenWorkflowText: #["webhook-configured", "post-webhook", "jiraDescription", "webhook payload summary", "final webhook/chat response"],
        forbiddenWorkflowRegexes: #["\"value\":\"[CDG][A-Z0-9]{8,}\""],
        terminalLogTable: "demo.triage_events",
      },
    ],
  },
})
namespace OpenboxGovern {}
