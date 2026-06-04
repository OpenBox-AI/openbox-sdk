// Helpers for applying core's redacted payload over the original
// activity input or output. Use these when forwarding a
// guardrail-redacted version of the payload downstream, such as
// writing a redacted file or sending a redacted prompt to an LLM.
//
// The input shape `GuardrailsVerdict` is the spec-driven verdict
// envelope. The camelCase `inputType` and `redactedInput` are the
// canonical field names.
import type { WorkflowVerdict } from './generated/govern.js';

type GuardrailsVerdict = NonNullable<WorkflowVerdict['guardrailsResult']>;

/**
 * Recursively merge `source` fields into `target`. Plain objects are
 * deep-merged; arrays of objects are merged by index so partial
 * guardrail transforms do not drop sibling fields. Mutates `target`.
 */
export function deepUpdateObject(target: unknown, source: Record<string, unknown>): void {
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    throw new Error('deepUpdateObject: target must be a plain object');
  }
  const t = target as Record<string, unknown>;
  for (const [key, value] of Object.entries(source)) {
    if (value === null || value === undefined) {
      t[key] = value;
      continue;
    }
    const existing = t[key];
    const bothArrays = Array.isArray(value) && Array.isArray(existing);
    if (bothArrays) {
      mergeArray(existing, value);
      continue;
    }
    const bothObjects =
      typeof value === 'object' && !Array.isArray(value) &&
      typeof existing === 'object' && !Array.isArray(existing) && existing !== null;
    if (bothObjects) {
      deepUpdateObject(existing, value as Record<string, unknown>);
    } else {
      t[key] = value;
    }
  }
}

function mergeArray(target: unknown[], source: unknown[]): void {
  for (let i = 0; i < source.length; i++) {
    const value = source[i];
    const existing = target[i];
    if (
      typeof value === 'object' && !Array.isArray(value) && value !== null &&
      typeof existing === 'object' && !Array.isArray(existing) && existing !== null
    ) {
      deepUpdateObject(existing, value as Record<string, unknown>);
    } else {
      target[i] = value;
    }
  }
}

/**
 * Apply core's `redactedInput` over the ORIGINAL activity input. Returns
 * a redacted copy you can forward downstream. No-op when the verdict
 * isn't an activity-input redaction (input_type !== "activity_input")
 * or when there's no redaction to apply.
 */
export function applyInputRedaction<T = unknown>(
  originalData: T,
  guardrails: GuardrailsVerdict | undefined,
): T {
  if (!guardrails || guardrails.inputType !== 'activity_input') return originalData;

  let redacted = guardrails.redactedInput as unknown;
  if (redacted && typeof redacted === 'object' && !Array.isArray(redacted)) {
    redacted = [redacted];
  }
  if (!Array.isArray(redacted)) return originalData;
  if (typeof originalData !== 'object' || originalData === null) {
    return (redacted.length > 0 ? redacted[0] : redacted) as T;
  }

  if (!Array.isArray(originalData)) {
    if (redacted[0] && typeof redacted[0] === 'object' && !Array.isArray(redacted[0])) {
      const out = cloneValue(originalData);
      deepUpdateObject(out, redacted[0] as Record<string, unknown>);
      return out;
    }
    return redacted[0] as T;
  }

  const out = cloneValue(originalData as unknown[]) as unknown[];
  for (let i = 0; i < redacted.length && i < out.length; i++) {
    const r = redacted[i];
    const o = out[i];
    if (
      typeof o === 'object' && !Array.isArray(o) && o !== null &&
      typeof r === 'object' && !Array.isArray(r) && r !== null
    ) {
      deepUpdateObject(o, r as Record<string, unknown>);
    } else {
      out[i] = r;
    }
  }
  return out as T;
}

/**
 * Apply core's `redactedInput` over the ORIGINAL activity output. Same
 * deep-merge logic but keyed on `inputType === "activity_output"` (the
 * verdict shape doesn't rename "input"-side state for output redactions).
 */
export function applyOutputRedaction<T = unknown>(
  originalOutput: T,
  guardrails: GuardrailsVerdict | undefined,
): T {
  if (!guardrails || guardrails.inputType !== 'activity_output') return originalOutput;
  const redacted = guardrails.redactedInput;
  if (redacted === null || redacted === undefined) return originalOutput;
  if (
    typeof originalOutput === 'object' && !Array.isArray(originalOutput) && originalOutput !== null &&
    typeof redacted === 'object' && !Array.isArray(redacted)
  ) {
    const out = cloneValue(originalOutput);
    deepUpdateObject(out, redacted as Record<string, unknown>);
    return out;
  }
  return redacted as T;
}

export function hasGuardrailRedaction(guardrails: GuardrailsVerdict | undefined): boolean {
  return Boolean(
    guardrails?.redactedInput !== null &&
      guardrails?.redactedInput !== undefined &&
      guardrails.fieldResults?.some((field) => isRedactedStatus(field.status)),
  );
}

export function summarizeGuardrailRedaction(
  guardrails: GuardrailsVerdict | undefined,
  fallback = 'OpenBox redacted sensitive fields.',
): string {
  const fields = guardrails?.fieldResults
    ?.filter((field) => isRedactedStatus(field.status))
    .map((field) => field.field)
    .filter(Boolean);
  if (!fields?.length) return fallback;

  return `OpenBox redacted ${fields.slice(0, 4).join(', ')}${
    fields.length > 4 ? ` and ${fields.length - 4} more ${fields.length - 4 === 1 ? 'field' : 'fields'}` : ''
  }.`;
}

function isRedactedStatus(status: unknown): boolean {
  return status === 'redacted' || status === 'transformed';
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}
