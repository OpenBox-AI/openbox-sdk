import {
  LOCAL_GOVERNANCE_HOST_PORTABLE_VERDICT_MATRIX,
  LOCAL_GOVERNANCE_LOCAL_ONLY_VERDICT_MATRIX,
  LOCAL_GOVERNANCE_UNDRIVABLE_TRIGGERS as GENERATED_LOCAL_GOVERNANCE_UNDRIVABLE_TRIGGERS,
  LOCAL_GOVERNANCE_VERDICT_MATRIX_CASES,
  type LocalGovernanceOutcome,
  type LocalGovernanceProviderDriver,
  type LocalGovernanceSpanType,
  type LocalGovernanceVerdict,
  type LocalGovernanceVerdictMatrixCase,
} from '../../../ts/src/governance/capability-matrix.js';

export type SpanType = LocalGovernanceSpanType;
export type Verdict = LocalGovernanceVerdict;
export type Outcome = LocalGovernanceOutcome;
export type BehaviorRuleTrigger = LocalGovernanceVerdictMatrixCase['expectedTrigger'];
export type VerdictMatrixCase = LocalGovernanceVerdictMatrixCase;
export type ProviderDriver = LocalGovernanceProviderDriver;

export const VERDICT_MATRIX = LOCAL_GOVERNANCE_HOST_PORTABLE_VERDICT_MATRIX;
export const LOCAL_ONLY_VERDICT_MATRIX = LOCAL_GOVERNANCE_LOCAL_ONLY_VERDICT_MATRIX;
export const LOCAL_GOVERNANCE_VERDICT_MATRIX = LOCAL_GOVERNANCE_VERDICT_MATRIX_CASES;
export const LOCAL_GOVERNANCE_UNDRIVABLE_TRIGGERS =
  GENERATED_LOCAL_GOVERNANCE_UNDRIVABLE_TRIGGERS;
export const CLAUDE_CODE_HOOK_VERDICT_MATRIX = LOCAL_GOVERNANCE_VERDICT_MATRIX_CASES.filter(
  (entry) => providerDriver(entry, 'claude-code', 'hook') !== undefined,
);
export const CLAUDE_CODE_HOOK_STDIN_VERDICT_MATRIX = LOCAL_GOVERNANCE_VERDICT_MATRIX_CASES.filter(
  (entry) => providerDriver(entry, 'claude-code', 'hook-stdin') !== undefined,
);
export const CLAUDE_CODE_MCP_VERDICT_MATRIX = LOCAL_GOVERNANCE_VERDICT_MATRIX_CASES.filter(
  (entry) => providerDriver(entry, 'claude-code', 'mcp') !== undefined,
);
export const CODEX_HOOK_STDIN_VERDICT_MATRIX = LOCAL_GOVERNANCE_VERDICT_MATRIX_CASES.filter(
  (entry) => providerDriver(entry, 'codex', 'hook-stdin') !== undefined,
);
export const CURSOR_HOOK_STDIN_VERDICT_MATRIX = LOCAL_GOVERNANCE_VERDICT_MATRIX_CASES.filter(
  (entry) => providerDriver(entry, 'cursor', 'hook-stdin') !== undefined,
);
export const OPENAI_AGENTS_SDK_VERDICT_MATRIX = LOCAL_GOVERNANCE_VERDICT_MATRIX_CASES.filter(
  (entry) => providerDriver(entry, 'openai-agents-sdk', 'sdk-wrapper') !== undefined,
);
export const OPENAI_AGENTS_SDK_MCP_REQUIRED_VERDICT_MATRIX = LOCAL_GOVERNANCE_VERDICT_MATRIX_CASES.filter(
  (entry) => providerDriver(entry, 'openai-agents-sdk', 'mcp-required') !== undefined,
);
export const ANTHROPIC_AGENT_SDK_VERDICT_MATRIX = LOCAL_GOVERNANCE_VERDICT_MATRIX_CASES.filter(
  (entry) => providerDriver(entry, 'anthropic-agent-sdk', 'sdk-wrapper') !== undefined,
);
export const ANTHROPIC_AGENT_SDK_MCP_REQUIRED_VERDICT_MATRIX = LOCAL_GOVERNANCE_VERDICT_MATRIX_CASES.filter(
  (entry) => providerDriver(entry, 'anthropic-agent-sdk', 'mcp-required') !== undefined,
);
export const COPILOTKIT_RUNTIME_VERDICT_MATRIX = LOCAL_GOVERNANCE_VERDICT_MATRIX_CASES.filter(
  (entry) => providerDriver(entry, 'copilotkit', 'runtime-adapter') !== undefined,
);
export const COPILOTKIT_MCP_REQUIRED_VERDICT_MATRIX = LOCAL_GOVERNANCE_VERDICT_MATRIX_CASES.filter(
  (entry) => providerDriver(entry, 'copilotkit', 'mcp-required') !== undefined,
);
export const N8N_RUNTIME_VERDICT_MATRIX = LOCAL_GOVERNANCE_VERDICT_MATRIX_CASES.filter(
  (entry) => providerDriver(entry, 'n8n', 'runtime-helper') !== undefined,
);
export const MCP_VERDICT_MATRIX = LOCAL_GOVERNANCE_VERDICT_MATRIX_CASES.filter(
  (entry) => providerDriver(entry, 'mcp', 'mcp') !== undefined,
);

export function providerDriver(
  c: VerdictMatrixCase,
  provider: string,
  surface: string,
): ProviderDriver | undefined {
  return c.providerDrivers?.find(
    (entry) => entry.provider === provider && entry.surface === surface,
  );
}

export function requireProviderDriver(
  c: VerdictMatrixCase,
  provider: string,
  surface: string,
): ProviderDriver {
  const driver = providerDriver(c, provider, surface);
  if (!driver) {
    throw new Error(`Missing ${provider}/${surface} driver for ${c.id}`);
  }
  return driver;
}

export function shouldSeedRule(c: VerdictMatrixCase): boolean {
  return (c as { seedRule?: boolean }).seedRule !== false;
}
