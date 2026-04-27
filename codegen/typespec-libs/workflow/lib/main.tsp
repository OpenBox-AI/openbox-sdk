// @openbox/typespec-workflow - decorators that describe the
// Temporal-style governance protocol. The wire format is just
// POST /api/v1/governance/evaluate, but every call must come in a
// specific order: WorkflowStarted -> paired ActivityStarted /
// ActivityCompleted per governed action -> WorkflowCompleted (or
// WorkflowFailed in finally). These decorators let .tsp authors
// declare the protocol and have the per-language emitters generate
// governance wrappers that fire the events in the right order with
// canonical activity_type strings.

import "../dist/index.js";

using TypeSpec.Reflection;

namespace OpenBox.Workflow;

/**
 * Marks an interface as a governance workflow. Emitters wrap calls
 * to its operations in a `WorkflowStarted` / `WorkflowCompleted`
 * envelope sharing one workflow_id + run_id. Each operation inside
 * must be decorated with `@activity` so the emitter knows the
 * canonical activity_type to put on the wire.
 *
 * @param domain Optional grouping for telemetry - defaults to the
 *   interface name in snake_case.
 */
extern dec workflow(target: Interface, domain?: valueof string);

/**
 * Marks an operation as a governed activity. The emitter wraps the
 * call in paired `ActivityStarted` + `ActivityCompleted` evaluations
 * sharing one activity_id, with `activity_type` set from
 * `canonicalType` (canonical names - `PromptSubmission`, `LLMCompleted`,
 * `ToolCompleted`, `FileRead`, `FileEdit`, `ShellExecution`,
 * `MCPToolCall`, etc. - see governance-flow.md for the full list).
 *
 * @param canonicalType One of the canonical activity_type strings.
 * @param stage Optional gate stage hint (`pre` runs guardrails on
 *   ActivityStarted only, `post` on ActivityCompleted only,
 *   `both` runs each gate at the matching stage). Default: `both`.
 */
extern dec activity(
  target: Operation,
  canonicalType: valueof string,
  stage?: valueof "pre" | "post" | "both",
);

/**
 * Marks a model as the verdict shape returned from a governance
 * evaluation. Emitters use this to generate the four-arm verdict
 * handler (allow / require_approval / block / halt). Only one model
 * per program may carry this decorator.
 */
extern dec verdict(target: Model);

/**
 * Marks an operation as an observer hook - fires informationally
 * before/after a governed activity but does NOT gate it. Emitters
 * skip verdict-handling for these and never wait for approval.
 *
 * @param when `before` fires before ActivityStarted, `after` fires
 *   after ActivityCompleted.
 */
extern dec observer_hook(target: Operation, when: valueof "before" | "after");
