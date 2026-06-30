/**
 * Shared runtime verdict helpers.
 *
 * These were previously copy-pasted byte-for-byte across the host hook
 * handlers (claude-code, cursor, codex). They now live here as the single
 * canonical implementation — edit here, never fork. No drift.
 */
import type { WorkflowVerdict } from '../../core-client/index.js';

/** Canonical fail-closed verdict: block the action with maximum risk. */
export function failClosedVerdict(reason: string): WorkflowVerdict {
  return {
    arm: 'block',
    reason,
    riskScore: 1,
  };
}

/** Extract a decision label from a verdict-shaped value, or undefined. */
export function verdictDecision(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const decision = record.arm ?? record.verdict ?? record.action ?? record.decision;
  return typeof decision === 'string' && decision.trim() ? decision.trim() : undefined;
}

/** Extract a trimmed reason string from a verdict-shaped value, or undefined. */
export function verdictReason(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const reason = (value as Record<string, unknown>).reason;
  return typeof reason === 'string' && reason.trim() ? reason.trim() : undefined;
}
