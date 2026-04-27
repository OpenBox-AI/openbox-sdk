// specs/typespec/govern/main.tsp - language-agnostic shape of the
// governance protocol that wraps every governed agent action. The
// wire surface is just POST /api/v1/governance/evaluate (in
// specs/typespec/core/), but the WAY the SDK uses it is structured:
//
//   WorkflowStarted
//     -> ActivityStarted (per governed action)
//     -> ActivityCompleted
//   WorkflowCompleted   (or WorkflowFailed in finally)
//
// This file declares that protocol. Per-language emitters take it
// and produce a typed `govern()` wrapper that does the right thing.
// The TS implementation today lives in openbox-typescript-sdk /
// `ts/client/src/govern/`; codegen will regenerate it from here.
//
// Canonical activity_type strings come from governance-flow.md in
// the openbox skill. Add new ones here as the protocol grows.

// Note: this is a programming-model spec, not an HTTP API. We
// deliberately do NOT mark it `@service` - the HTTP emitter would
// turn every operation into an unrouted POST and fail to compile.
// The openapi3 emitter quietly skips non-service namespaces, which
// is what we want; emitters at codegen/emitters/<lang>/ pick this
// up via the @workflow / @activity / @verdict / @observer_hook
// state attached by the decorator library.

import "@openbox/typespec-workflow";

using OpenBox.Workflow;

namespace OpenboxGovern;

// ---------------------------------------------------------------------------
// Verdict - four arms emitted by the live server. `constrain` is in
// the spec for forward compatibility but never appears on the wire
// today.
// ---------------------------------------------------------------------------

enum VerdictArm {
  allow: "allow",
  constrain: "constrain",
  require_approval: "require_approval",
  block: "block",
  halt: "halt",
}

@verdict
model Verdict {
  arm: VerdictArm;

  /** Set on `require_approval`; opaque ID for the polling endpoint. */
  approvalId?: string;

  /** Wall-clock cutoff for `require_approval`; SDK stops polling after this. */
  approvalExpiresAt?: utcDateTime;

  /** Human-readable explanation when the arm isn't `allow`. */
  reason?: string;

  /** Aggregate risk score in [0, 1]. */
  riskScore: float64;

  /** Agent trust tier (1-4) at the moment of evaluation. */
  trustTier?: int32;
}

// ---------------------------------------------------------------------------
// Activities - one operation per canonical activity_type. Each is
// decorated with @activity so emitters know the canonical name to
// stamp on the wire and which gate stage to fire on.
// ---------------------------------------------------------------------------

/** Free-form input/output payload. Server stringifies; SDKs pass through. */
model GovernedPayload {
  /** Activity input (request side). Wrap singletons as a one-element array. */
  input?: unknown[];

  /** Activity output (response side); only set on completion events. */
  output?: unknown;
}

@workflow("governed_agent")
interface GovernedAgent {
  /** User prompt entering the agent. Pre-stage: PII / safety guardrails. */
  @activity("PromptSubmission", "pre")
  promptSubmission(payload: GovernedPayload): Verdict;

  /** LLM completion returned to the agent. Post-stage: output guardrails. */
  @activity("LLMCompleted", "post")
  llmCompleted(payload: GovernedPayload): Verdict;

  /** Tool call about to be invoked. Pre-stage: policy / approval gate. */
  @activity("ToolCompleted", "both")
  toolCompleted(payload: GovernedPayload): Verdict;

  /** File read by the agent. Pre-stage: redaction / DLP. */
  @activity("FileRead", "pre")
  fileRead(payload: GovernedPayload): Verdict;

  /** File write/edit. Pre-stage: write-access policy. */
  @activity("FileEdit", "pre")
  fileEdit(payload: GovernedPayload): Verdict;

  /** Shell command. Pre-stage: command allowlist / approval. */
  @activity("ShellExecution", "pre")
  shellExecution(payload: GovernedPayload): Verdict;

  /** MCP tool call. Pre-stage: per-tool policy. */
  @activity("MCPToolCall", "both")
  mcpToolCall(payload: GovernedPayload): Verdict;
}

// ---------------------------------------------------------------------------
// Observer hooks - fire-and-forget telemetry. Emitters skip verdict
// handling and never block on these.
// ---------------------------------------------------------------------------

interface Observers {
  @observer_hook("before")
  workflowStarting(payload: GovernedPayload): void;

  @observer_hook("after")
  workflowCompleted(payload: GovernedPayload): void;
}
