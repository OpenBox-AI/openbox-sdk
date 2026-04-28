// typespec-workflow - decorators describing the Temporal-style
// governance protocol. The wire format is POST /api/v1/governance/evaluate;
// every call rides one of six canonical event_types (verified against
// the-core-service internal/services/governance_workflow.go) which the runtime
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
 * Only six event_types are valid - these are the ones the-core-service
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

/**
 * Marks an interface as a hook-protocol adapter. Emitters generate one
 * `runtime/<name>` module that reads stdin JSON, dispatches by the
 * `discriminator` field to the matching @hookEvent operation, runs the
 * bound preset method, and translates the verdict into the operation's
 * @verdictShape output.
 *
 * @param name Lowercase-hyphen identifier - `claude-hooks`, `cursor-hooks`.
 *   Becomes the runtime module suffix.
 * @param preset @preset name this adapter binds to (`claude-code`, `cursor`).
 * @param discriminator Stdin JSON field used to route. Almost always
 *   `hook_event_name`.
 */
extern dec adapter(
  target: Interface,
  name: valueof string,
  preset: valueof string,
  discriminator: valueof string,
);

/**
 * Per-operation routing inside an @adapter. When the parsed stdin's
 * discriminator value equals `eventName`, the operation is dispatched.
 *
 * @param eventName The string the adapter's discriminator field must
 *   equal for this operation to handle it.
 */
extern dec hookEvent(target: Operation, eventName: valueof string);

/**
 * Per-operation verdict-arm-to-output translation family. Picks one of
 * the emitter's built-in shapes; the emitter has a fixed registry of how
 * each shape converts the four verdict arms into the adapter's stdout
 * JSON.
 *
 * @param shape One of `permission-decision`, `decision-block`,
 *   `permission-request`, `cursor-permission`, `cursor-observe`, `none`.
 */
extern dec verdictShape(
  target: Operation,
  shape: valueof
    | "permission-decision"
    | "decision-block"
    | "permission-request"
    | "cursor-permission"
    | "cursor-observe"
    | "none",
);

/**
 * Per-event tool-name → activity_type table. For adapter operations
 * whose handlers route to multiple activity_types based on a
 * sub-discriminator inside the envelope (e.g. `tool_name` on
 * Claude Code's PreToolUse, or Cursor's preToolUse).
 *
 * The emitter materializes the table as a constant per operation in
 * the generated runtime adapter; per-platform mappers consume the
 * constant instead of hand-coding the same switch in two places.
 *
 * @param table Map of inner-discriminator string → activity_type
 *   string. e.g. `#{ Read: "FileRead", Bash: "ShellExecution" }`.
 */
extern dec activityRouting(target: Operation, table: valueof Record<string>);

/**
 * Declarative payload shape for an adapter operation. Replaces the
 * per-tool switch statement that used to live in every mapper.
 *
 * The emitter generates a `build<Op>Payload(env, toolName?, sideEffects?)`
 * function alongside the routing constants. Mappers call it instead of
 * hand-shaping the activity payload - guaranteeing the same field
 * extraction logic across adapters and across languages.
 *
 * Shape of `shape`:
 *   #{
 *     default: #{ <field>: <fieldSource>, ... },   // when no tool match
 *     byTool:  #{ <toolName>: #{ <field>: <fieldSource> }, ... },
 *   }
 *
 * Field sources (the value attached to each output field):
 *   #{ from: "envelope.path" }                   - pull at the path
 *   #{ from: "envelope.path", fallback: "alt" }  - alt is another path
 *   #{ from: "path", default: "literal" }        - path or literal default
 *   #{ literal: "value" }                        - fixed literal string
 *   #{ sideEffect: "readFile", from: "path" }    - invoke a sideEffect
 *                                                  callback the runtime
 *                                                  supplies; arg = path
 *
 * Path syntax: dotted access into the envelope, e.g. `prompt`,
 * `tool_input.command`, `tool_input.file_path`. The emitter wires
 * `tool_input.X` to read `env.tool_input?.X` safely.
 *
 * @param shape Two-tier record (default + optional byTool).
 */
extern dec payloadShape(target: Operation, shape: valueof Record<unknown>);

/**
 * Marks an adapter op as not needing payload generation (sessions /
 * lifecycle ops with no scannable input). Drift guard counterpart to
 * `@payloadShape` - every @hookEvent must have one or the other so
 * adding a new event doesn't silently regress to hand-coding.
 */
extern dec noPayload(target: Operation);

/**
 * Where the adapter's install command writes its hook-event block.
 * The emitter materializes an `INSTALL_SPEC` constant per adapter
 * carrying these fields; the hand-coded install.ts reads it and
 * delegates to the shared JSON-merge primitive in
 * runtime/_shared/install.ts.
 *
 * Shape:
 *   #{
 *     file: "~/.claude/settings.json",     // tilde-expanded at runtime
 *     key: "hooks",                         // top-level key under settings
 *     style: "claude-array" | "cursor-keyed",
 *     command: "openbox claude-code hook",  // bin command for each event
 *     configDir: "~/.claude-hooks",         // example config drop dir
 *   }
 *
 * `style` controls the per-event JSON shape:
 *   claude-array: events[evt] = [{ matcher?, hooks: [{ type, command, timeout? }] }]
 *   cursor-keyed: events[evt] = { command }
 */
extern dec installTarget(target: Interface, target_: valueof Record<unknown>);

/**
 * Per-event timeout (seconds) for the `claude-array` install style.
 * Long-running hooks (PreToolUse, UserPromptSubmit, PermissionRequest)
 * need this so Claude Code doesn't kill the OpenBox call on a slow
 * backend. Ignored by other styles.
 */
extern dec installTimeout(target: Operation, seconds: valueof int32);
