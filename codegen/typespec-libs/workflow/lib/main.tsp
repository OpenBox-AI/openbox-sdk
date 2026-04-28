// @openbox/typespec-workflow - decorators describing the Temporal-style
// governance protocol. The wire format is POST /api/v1/governance/evaluate;
// every call rides one of six canonical event_types (verified against
// openbox-core internal/services/governance_workflow.go) which the runtime
// recognizes for guardrail eligibility, attestation extraction, and metric
// routing.
//
// One decorator surface - the framework-preset shape:
//   @preset(name)     - marks an interface as a framework preset
//   @maps_to(...)     - per-method canonical envelope mapping
//   @verdict          - marks the public verdict model
//
// Each @preset interface generates one Session class whose methods map
// to the canonical envelope via @maps_to. Lifecycle (Workflow{Started,
// Completed,Failed}) is owned by the SDK runtime, never user code.

import "../dist/index.js";

using TypeSpec.Reflection;

namespace OpenBox.Workflow;

/**
 * Marks a model as the verdict shape returned from a governance
 * evaluation. Emitters use this to generate the four-arm verdict
 * handler (allow / require_approval / block / halt). Only one model
 * per program may carry this decorator.
 */
extern dec verdict(target: Model);

/**
 * Marks an interface as a framework preset. Emitters generate one
 * `<PascalName>Session` runtime class per preset, plus a registry entry
 * keyed by `name` (so callers do `presets.claudeCode`, `presets.langchain`,
 * etc.). Every operation must carry @maps_to.
 *
 * @param name Lowercase-hyphen identifier (`claude-code`, `langchain`,
 *   `vercel-ai`, `temporal`, `airflow`, `default`, `custom`, ...).
 */
extern dec preset(target: Interface, name: valueof string);

/**
 * Per-operation envelope mapping inside a @preset interface. Tells the
 * emitter "when the user calls this method, fire this canonical
 * event_type with this activity_type string."
 *
 * Only six event_types are valid - these are the ones openbox-core
 * recognizes for guardrail eligibility checks (verified against
 * internal/services/governance_workflow.go:350+ and attestation_workflow.go).
 * Custom strings would be stored but skip event-type-specific logic.
 *
 * @param eventType One of the six canonical event_types.
 * @param activityType The free-form activity_type string for the wire.
 *   Optional - defaults to the operation name verbatim if omitted, so
 *   `onToolStart` becomes activity_type="onToolStart".
 */
extern dec maps_to(
  target: Operation,
  eventType: valueof
    | "WorkflowStarted"
    | "WorkflowCompleted"
    | "WorkflowFailed"
    | "ActivityStarted"
    | "ActivityCompleted"
    | "SignalReceived",
  activityType?: valueof string,
);
