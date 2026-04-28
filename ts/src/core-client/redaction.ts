// Helpers for applying core's redacted payload over the original
// activity input/output. Use these when you want to forward a
// guardrail-redacted version of the payload downstream (e.g. write a
// redacted file, send a redacted prompt to an LLM).
//
// Ported from the legacy openbox-sdk. The shape of the input
// (`GuardrailsVerdict`) is the new spec-driven verdict envelope -
// `inputType` + `redactedInput` (camelCase) replace the old snake_case.
import type { WorkflowVerdict } from './generated/govern.js';

type GuardrailsVerdict = NonNullable<WorkflowVerdict['guardrailsResult']>;

/**
 * Recursively merge `source` fields into `target`. Plain objects are
 * deep-merged; arrays and primitives are replaced outright. Mutates
 * `target`.
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
      deepUpdateObject(originalData, redacted[0] as Record<string, unknown>);
      return originalData;
    }
    return redacted[0] as T;
  }

  const out = [...(originalData as unknown[])];
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
    deepUpdateObject(originalOutput, redacted as Record<string, unknown>);
    return originalOutput;
  }
  return redacted as T;
}
