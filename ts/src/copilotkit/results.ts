import { randomUUID } from 'node:crypto';
import {
  applyInputRedaction,
  applyOutputRedaction,
  hasGuardrailRedaction,
  summarizeGuardrailRedaction,
} from '../core-client/redaction.js';
import type { AGEResult, WorkflowVerdict } from '../core-client/index.js';
import { OPENBOX_COPILOTKIT_RESULT_SCHEMA_VERSION } from './constants.js';
import { cloneValue, errorMessage } from './internal-utils.js';
import type {
  GovernedCopilotToolDefinition,
  OpenBoxCopilotActionInput,
  OpenBoxCopilotActionResult,
  OpenBoxCopilotSessionState,
  OpenBoxCopilotVerdictStatus,
  OpenBoxSafePayload,
} from './types.js';

type WorkflowVerdictWithAge = WorkflowVerdict & { ageResult?: AGEResult };

export function applyOpenBoxTransform<T>(
  original: T,
  verdict: WorkflowVerdict,
): T {
  if (!hasGuardrailRedaction(verdict.guardrailsResult)) return original;
  const inputType = verdict.guardrailsResult?.inputType;
  if (inputType === 'activity_output') {
    return applyOutputRedaction(cloneValue(original), verdict.guardrailsResult);
  }
  return applyInputRedaction(cloneValue(original), verdict.guardrailsResult);
}

export function safePayload<T>(
  safe: T,
  original: T,
  verdict: WorkflowVerdict,
  ids: { workflowId: string; runId: string; activityId: string },
  changed: boolean,
): OpenBoxSafePayload<T> {
  const redactionSummary = hasGuardrailRedaction(verdict.guardrailsResult)
    ? summarizeGuardrailRedaction(verdict.guardrailsResult)
    : undefined;
  // Allowed-with-transform is constrained by definition: the payload the
  // caller may use is not the original one.
  const status = isGovernanceAvailabilityFailure(verdict.reason)
    ? 'error'
    : verdict.arm === 'allow' && (redactionSummary || changed)
      ? 'constrained'
      : statusForVerdict(verdict);
  const haltedAt = new Date().toISOString();
  const session =
    status === 'halted'
      ? {
          status: 'halted' as const,
          reason: verdict.reason || 'OpenBox halted this CopilotKit session.',
          haltedAt,
          ...ids,
        }
      : { status: 'active' as const };
  return {
    safe,
    verdict,
    status,
    changed,
    rawBlocked: !isAllowed(verdict.arm),
    reason: verdict.reason || defaultReasonForVerdict(verdict.arm),
    message: verdict.reason || defaultReasonForVerdict(verdict.arm),
    redactionSummary,
    workflowId: ids.workflowId,
    runId: ids.runId,
    activityId: ids.activityId,
    session,
  };
}

export function safePayloadToCopilotResult<T>(
  verdict: WorkflowVerdict,
  safePayload: OpenBoxSafePayload<T>,
): OpenBoxCopilotActionResult<T> {
  return {
    schemaVersion: OPENBOX_COPILOTKIT_RESULT_SCHEMA_VERSION,
    status: safePayload.status,
    // Availability failures are not governance arms; never report them as
    // a policy block.
    verdict: safePayload.status === 'error' ? 'error' : verdict.arm,
    executed: false,
    action: 'copilotkit_runtime_gate',
    request: 'CopilotKit runtime governance gate',
    destination: null,
    amountUsd: null,
    fields: null,
    audience: null,
    sensitivity: null,
    reason: safePayload.reason,
    message: safePayload.message,
    artifact: safePayload.rawBlocked ? undefined : safePayload.safe,
    workflowId: safePayload.workflowId,
    runId: safePayload.runId,
    activityId: safePayload.activityId,
    session: safePayload.session,
    timings: safePayload.timings,
    ...verdictMetadata(verdict, safePayload.redactionSummary),
  };
}

export function baseResult<TInput extends OpenBoxCopilotActionInput>(
  input: TInput,
  ids?: { workflowId: string; runId: string; activityId: string },
) {
  const passthrough = Object.fromEntries(
    Object.entries(input).filter(
      ([key]) =>
        !new Set([
          'action',
          'request',
          'destination',
          'amountUsd',
          'fields',
          'audience',
          'sensitivity',
          'workflowId',
          'runId',
          'activityId',
          'approvalId',
          'governanceEventId',
          'approved',
        ]).has(key),
    ),
  );
  return {
    ...passthrough,
    schemaVersion: OPENBOX_COPILOTKIT_RESULT_SCHEMA_VERSION,
    action: input.action,
    request: input.request,
    destination:
      typeof input.destination === 'string' ? input.destination : null,
    amountUsd: typeof input.amountUsd === 'number' ? input.amountUsd : null,
    fields: Array.isArray(input.fields) ? input.fields : null,
    audience: typeof input.audience === 'string' ? input.audience : null,
    sensitivity:
      typeof input.sensitivity === 'string' ? input.sensitivity : null,
    workflowId: ids?.workflowId,
    runId: ids?.runId,
    activityId: ids?.activityId,
  };
}

export function approvalRequiredResult<
  TInput extends OpenBoxCopilotActionInput,
>(
  input: TInput,
  ids: { workflowId: string; runId: string; activityId: string },
  verdict: WorkflowVerdict,
): OpenBoxCopilotActionResult {
  return {
    ...baseResult(input, ids),
    status: 'approval_required',
    verdict: 'require_approval',
    executed: false,
    approvalId: verdict.approvalId,
    governanceEventId: verdict.governanceEventId,
    expiresAt: verdict.approvalExpiresAt,
    reason: verdict.reason || 'OpenBox requires human approval.',
    message: 'OpenBox requires human approval before this action can continue.',
    ...verdictMetadata(verdict),
  };
}

export function stoppedResult<TInput extends OpenBoxCopilotActionInput>(
  input: TInput,
  ids: { workflowId: string; runId: string; activityId: string },
  verdict: WorkflowVerdict,
  executed = false,
): OpenBoxCopilotActionResult {
  if (isGovernanceAvailabilityFailure(verdict.reason)) {
    return {
      ...baseResult(input, ids),
      status: 'error',
      verdict: 'error',
      executed,
      reason: verdict.reason || 'OpenBox governance evaluation was unavailable.',
      message:
        'OpenBox could not evaluate this action, so it was not executed (failed closed). This is an availability failure, not a policy decision.',
      session: { status: 'active' },
      ...verdictMetadata(verdict),
    };
  }
  const status = verdict.arm === 'halt' ? 'halted' : 'blocked';
  const haltedAt = new Date().toISOString();
  return {
    ...baseResult(input, ids),
    status,
    verdict: verdict.arm,
    executed,
    reason: verdict.reason || 'OpenBox stopped this action.',
    message: verdict.reason || 'OpenBox stopped this action.',
    session:
      status === 'halted'
        ? {
            status: 'halted',
            reason: verdict.reason || 'OpenBox halted this conversation.',
            haltedAt,
            ...ids,
          }
        : { status: 'active' },
    ...verdictMetadata(verdict),
  };
}

export function rejectedResult<TInput extends OpenBoxCopilotActionInput>(
  input: TInput,
  ids: { workflowId: string; runId: string; activityId: string },
  verdict: WorkflowVerdict,
): OpenBoxCopilotActionResult {
  return {
    ...baseResult(input, ids),
    status: 'rejected',
    verdict: 'block',
    executed: false,
    reason: verdict.reason || 'OpenBox approval was rejected.',
    message: verdict.reason || 'OpenBox approval was rejected.',
    ...verdictMetadata(verdict),
  };
}

function isGovernanceAvailabilityFailure(reason: unknown): boolean {
  if (typeof reason !== 'string') return false;
  return /\b(?:opa|policy|guardrail|governance)\b[\s\S]*\bunavailable\b|\bunavailable\b[\s\S]*\b(?:opa|policy|guardrail|governance)\b/i.test(
    reason,
  );
}

export function executedResult<
  TInput extends OpenBoxCopilotActionInput,
  TArtifact,
>(
  input: TInput,
  ids: { workflowId: string; runId: string; activityId: string },
  artifact: TArtifact,
  reason: string,
  verdict?: WorkflowVerdict,
  redactionSummary?: string,
): OpenBoxCopilotActionResult<TArtifact> {
  return {
    ...baseResult(input, ids),
    status: 'executed',
    verdict: 'allow',
    executed: true,
    reason,
    message: `Governed action '${input.action}' executed.`,
    artifact,
    session: { status: 'active' },
    ...verdictMetadata(verdict, redactionSummary),
  };
}

export function resultForAllowedVerdict<
  TInput extends OpenBoxCopilotActionInput,
  TArtifact,
>(
  input: TInput,
  ids: { workflowId: string; runId: string; activityId: string },
  verdict: WorkflowVerdict,
  artifact: TArtifact,
  reason: string,
  redactionSummary?: string,
): OpenBoxCopilotActionResult<TArtifact> {
  const result = executedResult(
    input,
    ids,
    artifact,
    reason,
    verdict,
    redactionSummary,
  );
  if (verdict.arm !== 'constrain') {
    // Input-stage transforms under an allow arm are still redaction; the
    // result must not present itself as a plain allow.
    if (redactionSummary) {
      return {
        ...result,
        status: 'constrained',
        verdict: 'constrain',
      };
    }
    return result;
  }
  return {
    ...result,
    status: 'constrained',
    verdict: 'constrain',
    reason: verdict.reason || 'OpenBox constrained this output.',
    message: 'OpenBox allowed the action with constrained output.',
  };
}

export function errorResult<TInput extends OpenBoxCopilotActionInput>(
  input: TInput,
  ids: { workflowId: string; runId: string; activityId: string },
  error: unknown,
): OpenBoxCopilotActionResult {
  const message = errorMessage(error);
  const governanceUnavailable =
    /request failed|fetch failed|timeout|econnreset|etimedout|und_err|operation was aborted/i.test(
      message,
    );
  return {
    ...baseResult(input, ids),
    status: 'error',
    verdict: 'error',
    executed: false,
    reason: message,
    message: governanceUnavailable
      ? 'OpenBox could not evaluate this action, so it was not executed (failed closed). This is an availability failure, not a policy decision.'
      : 'The governed action failed before a business result was produced. No business result was released.',
    session: { status: 'active' },
  };
}

export function applyStartedRedaction<
  TInput extends OpenBoxCopilotActionInput,
  TArtifact,
>(
  definition: GovernedCopilotToolDefinition<TInput, TArtifact>,
  input: TInput,
  verdict: WorkflowVerdict,
): { input: TInput; summary?: string } {
  if (!hasGuardrailRedaction(verdict.guardrailsResult)) return { input };
  const redactedTools = applyInputRedaction(
    cloneValue([toolInputForRedaction(definition, input)]),
    verdict.guardrailsResult,
  ) as Array<{ args?: Partial<TInput> }>;
  const redactedArgs = redactedTools?.[0]?.args;
  return {
    input:
      redactedArgs && typeof redactedArgs === 'object'
        ? ({ ...input, ...redactedArgs, action: input.action } as TInput)
        : input,
    summary: summarizeGuardrailRedaction(
      verdict.guardrailsResult,
      'Input redacted by OpenBox guardrails.',
    ),
  };
}

export function applyCompletedRedaction<
  TInput extends OpenBoxCopilotActionInput,
  TArtifact,
>(
  definition: GovernedCopilotToolDefinition<TInput, TArtifact>,
  result: OpenBoxCopilotActionResult<TArtifact>,
  verdict: WorkflowVerdict,
  existingSummary?: string,
): OpenBoxCopilotActionResult<TArtifact> {
  const coreRedacted = hasGuardrailRedaction(verdict.guardrailsResult);
  const redactedResult = coreRedacted
    ? (applyOutputRedaction(
        cloneValue(result),
        verdict.guardrailsResult,
      ) as OpenBoxCopilotActionResult<TArtifact>)
    : result;
  const visibleRedaction =
    definition.isArtifactRedacted?.(redactedResult.artifact) ?? false;
  const finalResult =
    coreRedacted &&
    redactedResult.artifact &&
    definition.markArtifactRedacted
      ? {
          ...redactedResult,
          artifact: definition.markArtifactRedacted(redactedResult.artifact),
        }
      : redactedResult;
  const summary = [
    existingSummary,
    coreRedacted
      ? summarizeGuardrailRedaction(
          verdict.guardrailsResult,
          'Output redacted by OpenBox guardrails.',
        )
      : undefined,
  ]
    .filter(Boolean)
    .join(' ');

  if (verdict.arm === 'constrain' || coreRedacted || visibleRedaction) {
    return {
      ...finalResult,
      status: 'constrained',
      verdict: 'constrain',
      reason:
        verdict.reason ||
        'OpenBox allowed the action with constrained output for sensitive fields.',
      message: 'OpenBox allowed the action with constrained output.',
      ...mergedVerdictMetadata(finalResult, verdict, summary || undefined),
    };
  }
  return {
    ...finalResult,
    ...mergedVerdictMetadata(finalResult, verdict, summary || undefined),
  };
}

export function verdictMetadata(
  verdict?: WorkflowVerdict,
  redactionSummary?: string,
) {
  return {
    riskScore: verdict?.riskScore,
    trustTier: verdict?.trustTier,
    alignmentScore: verdict?.alignmentScore,
    policyId: verdict?.policyId,
    behavioralViolations: verdict?.behavioralViolations,
    constraints: verdict?.constraints,
    metadata: verdict?.metadata,
    fallbackUsed: verdict?.fallbackUsed,
    guardrailsResult: verdict?.guardrailsResult,
    ageResult: ageResultFromVerdict(verdict),
    redactionSummary,
  };
}

export function mergedVerdictMetadata(
  result: OpenBoxCopilotActionResult,
  verdict: WorkflowVerdict,
  redactionSummary?: string,
) {
  return {
    riskScore: verdict.riskScore ?? result.riskScore,
    trustTier: verdict.trustTier ?? result.trustTier,
    alignmentScore: verdict.alignmentScore ?? result.alignmentScore,
    policyId: verdict.policyId ?? result.policyId,
    behavioralViolations: verdict.behavioralViolations ?? result.behavioralViolations,
    constraints: verdict.constraints ?? result.constraints,
    metadata: verdict.metadata ?? result.metadata,
    fallbackUsed: verdict.fallbackUsed ?? result.fallbackUsed,
    guardrailsResult: verdict.guardrailsResult ?? result.guardrailsResult,
    ageResult: ageResultFromVerdict(verdict) ?? result.ageResult,
    redactionSummary: redactionSummary || result.redactionSummary,
  };
}

function ageResultFromVerdict(
  verdict?: WorkflowVerdict,
): AGEResult | undefined {
  return (verdict as WorkflowVerdictWithAge | undefined)?.ageResult;
}

export function mapGuardrailsResult(
  value: unknown,
): WorkflowVerdict['guardrailsResult'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as {
    inputType?: string;
    input_type?: string;
    redactedInput?: unknown;
    redacted_input?: unknown;
    validationPassed?: boolean;
    validation_passed?: boolean;
    rawLogs?: Record<string, unknown>;
    raw_logs?: Record<string, unknown>;
    reasons?: Array<{ type?: unknown; field?: unknown; reason?: unknown }>;
    fieldResults?: Array<{
      field?: unknown;
      status?: unknown;
      reason?: unknown;
    }>;
    results?: Array<{
      results?: Array<{ field?: unknown; status?: unknown; reason?: unknown }>;
    }>;
  };
  const inputType = raw.inputType ?? raw.input_type;
  return {
    inputType: normalizeGuardrailsInputType(inputType),
    redactedInput: raw.redactedInput ?? raw.redacted_input,
    validationPassed: raw.validationPassed ?? raw.validation_passed ?? true,
    rawLogs: raw.rawLogs ?? raw.raw_logs,
    reasons: (raw.reasons ?? []).map((reason) => ({
      type: String(reason.type ?? ''),
      field: typeof reason.field === 'string' ? reason.field : undefined,
      reason: String(reason.reason ?? ''),
    })),
    fieldResults: [
      ...(raw.fieldResults ?? []),
      ...(raw.results ?? []).flatMap((group) => group.results ?? []),
    ].map((field) => ({
      field: String(field.field ?? ''),
      status: normalizeGuardrailStatus(field.status),
      reason: typeof field.reason === 'string' ? field.reason : undefined,
    })),
  };
}

export function normalizeArm(value: unknown): WorkflowVerdict['arm'] {
  if (typeof value === 'number') {
    switch (value) {
      case 1:
        return 'constrain';
      case 2:
        return 'require_approval';
      case 3:
        return 'block';
      case 4:
        return 'halt';
      case 0:
      default:
        return 'allow';
    }
  }
  if (
    value === 'allow' ||
    value === 'constrain' ||
    value === 'require_approval' ||
    value === 'block' ||
    value === 'halt'
  ) {
    return value;
  }
  if (value === 'continue') return 'allow';
  if (value === 'stop') return 'halt';
  if (value === 'require-approval' || value === 'request_approval')
    return 'require_approval';
  return 'block';
}

export function effectiveArmForGuardrails(
  arm: WorkflowVerdict['arm'],
  guardrailsResult: WorkflowVerdict['guardrailsResult'] | undefined,
): WorkflowVerdict['arm'] {
  if (
    guardrailsResult?.validationPassed === false &&
    arm !== 'halt' &&
    arm !== 'block'
  ) {
    return 'block';
  }
  return arm;
}

export function guardrailFailureReason(
  result: WorkflowVerdict['guardrailsResult'] | undefined,
): string {
  if (!result) return 'Guardrails validation failed';
  const reasons = (result.reasons ?? [])
    .map((reason) => cleanGuardrailReason(reason.reason))
    .filter((reason) => reason.length > 0);
  if (reasons.length > 0) {
    return result.inputType === 'activity_output'
      ? reasons.join('; ')
      : reasons[0];
  }
  return result.inputType === 'activity_output'
    ? 'Guardrails output validation failed'
    : 'Guardrails validation failed';
}

function cleanGuardrailReason(reason: string): string {
  const withoutQuestion = reason.replace(
    /\n?-\s*Question:\s*\[Session context\][^\n]*\n?/g,
    '',
  );
  for (const marker of ['\n\nThought:', '\n\nThought', '\nThought:', '\nThought']) {
    const index = withoutQuestion.indexOf(marker);
    if (index >= 0) return withoutQuestion.slice(0, index).trimEnd();
  }
  return withoutQuestion.trimEnd();
}

export function isAllowed(arm: WorkflowVerdict['arm']): boolean {
  return arm === 'allow' || arm === 'constrain';
}

function toolInputForRedaction<
  TInput extends OpenBoxCopilotActionInput,
  TArtifact,
>(definition: GovernedCopilotToolDefinition<TInput, TArtifact>, input: TInput) {
  return {
    id: undefined,
    name: definition.toolName,
    args: input,
    description: definition.description,
  };
}

function normalizeGuardrailsInputType(
  value: unknown,
): NonNullable<WorkflowVerdict['guardrailsResult']>['inputType'] {
  if (value === 'activity_output') return 'activity_output';
  if (value === 'signal_args') return 'signal_args';
  return 'activity_input';
}

function normalizeGuardrailStatus(
  value: unknown,
): 'allowed' | 'blocked' | 'redacted' | 'transformed' | 'skipped' {
  if (value === 'blocked' || value === 'block') return 'blocked';
  if (value === 'redacted') return 'redacted';
  if (value === 'transformed') return 'transformed';
  if (value === 'allowed' || value === 'allow') return 'allowed';
  return 'skipped';
}

function statusForVerdict(
  verdict: WorkflowVerdict,
): OpenBoxCopilotVerdictStatus {
  if (verdict.arm === 'allow') return 'executed';
  if (verdict.arm === 'constrain') return 'constrained';
  if (verdict.arm === 'require_approval') return 'approval_required';
  if (verdict.arm === 'halt') return 'halted';
  return 'blocked';
}

function defaultReasonForVerdict(arm: WorkflowVerdict['arm']): string {
  if (arm === 'allow') return 'OpenBox allowed this CopilotKit runtime event.';
  if (arm === 'constrain')
    return 'OpenBox constrained this CopilotKit runtime event.';
  if (arm === 'require_approval') return 'OpenBox requires human approval.';
  if (arm === 'halt') return 'OpenBox halted this CopilotKit session.';
  return 'OpenBox blocked this CopilotKit runtime event.';
}
