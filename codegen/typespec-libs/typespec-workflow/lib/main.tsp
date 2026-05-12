// typespec-workflow: decorators describing the Temporal-style
// governance protocol. The wire format is
// `POST /api/v1/governance/evaluate`. Every call rides one of six
// canonical event_types that the core service recognizes for guardrail
// eligibility, attestation extraction, and metric routing.
//
// Decorator surface for the framework-preset shape:
//   @preset(name)   marks an interface as a framework preset
//   @maps_to(...)   per-method canonical envelope mapping
//   @verdict        marks the public verdict model
//
// Each @preset interface generates one Session class whose methods
// map to the canonical envelope via @maps_to. Lifecycle events
// (Workflow{Started,Completed,Failed}) are owned by the SDK runtime,
// never user code.

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
 * Only six event_types are valid. These are the ones the core service
 * recognizes for guardrail eligibility checks. Custom strings would be
 * stored but skip event-type-specific logic.
 *
 * @param eventType One of the six canonical event_types.
 * @param activityType The free-form activity_type string for the wire.
 *   Optional; defaults to the operation name verbatim if omitted, so
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
 * @param name Lowercase-hyphen identifier; `claude-hooks`, `cursor-hooks`.
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
    | "cursor-continue"
    | "none",
);

/**
 * Per-event activity_type binding for adapters whose hook events are
 * already action-specific (each Cursor hook is one action; Claude Code's
 * `PreToolUse` is multi-tool and uses `@activityRouting` instead).
 *
 * Specifies the canonical activity_type the runtime mapper should emit
 * when this hook fires. The emitter materializes a per-event constant
 * in the generated adapter module so mappers never hand-code the value.
 *
 * Mutually exclusive with `@activityRouting` on the same op: an op
 * either routes by sub-discriminator or has one fixed activity_type.
 *
 * @param name Canonical activity_type from CANONICAL_ACTIVITY_TYPES
 *   in the spec (e.g., `ShellExecution`, `FileRead`, `MCPToolCall`,
 *   `PromptSubmission`).
 */
extern dec activityType(target: Operation, name: valueof string);

/**
 * Per-event tool-name to activity_type table. For adapter operations
 * whose handlers route to multiple activity_types based on a
 * sub-discriminator inside the envelope, such as `tool_name` on
 * Claude Code's PreToolUse or Cursor's preToolUse.
 *
 * The emitter materializes the table as a constant per operation in
 * the generated runtime adapter. Per-platform mappers consume the
 * constant instead of hand-coding the same switch in two places.
 *
 * @param table Map of inner-discriminator string to activity_type
 *   string, such as `#{ Read: "FileRead", Bash: "ShellExecution" }`.
 */
extern dec activityRouting(target: Operation, table: valueof Record<string>);

/**
 * Declarative payload shape for an adapter operation. Replaces the
 * per-tool switch statement that used to live in every mapper.
 *
 * The emitter generates a `build<Op>Payload(env, toolName?, sideEffects?)`
 * function alongside the routing constants. Mappers call it instead of
 * hand-shaping the activity payload; guaranteeing the same field
 * extraction logic across adapters and across languages.
 *
 * Shape of `shape`:
 *   #{
 *     default: #{ <field>: <fieldSource>, ... },   // when no tool match
 *     byTool:  #{ <toolName>: #{ <field>: <fieldSource> }, ... },
 *   }
 *
 * Field sources (the value attached to each output field):
 *   #{ from: "envelope.path" }                  ; pull at the path
 *   #{ from: "envelope.path", fallback: "alt" } ; alt is another path
 *   #{ from: "path", default: "literal" }       ; path or literal default
 *   #{ literal: "value" }                       ; fixed literal string
 *   #{ sideEffect: "readFile", from: "path" }   ; invoke a sideEffect
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
 * `@payloadShape`; every @hookEvent must have one or the other so
 * adding a new event doesn't silently regress to hand-coding.
 */
extern dec noPayload(target: Operation);

/**
 * Where the adapter's install command writes its hook-event block.
 * The emitter materializes an `INSTALL_SPEC` constant per adapter
 * carrying these fields; the hand-coded install.ts reads it and
 * delegates to the shared JSON-merge primitive in
 * `ts/src/install/from-spec.ts` (exposed under
 * `openbox-sdk/install`).
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

/**
 * Predicate-based activity-type reroute. Sits alongside @activityRouting
 * for adapter ops where one tool's activity_type depends on a runtime
 * field value, such as Cursor's Shell tool rerouting to `file_write`
 * when the command matches a delete pattern.
 *
 * Multiple variants per op are allowed; first match wins. Each variant
 * record carries: field (dotted envelope path), pattern (regex source),
 * activityType (override target), eventCategory (optional payload
 * override).
 *
 * @param toolName Inner-discriminator value to match.
 * @param variant Field/pattern/activityType/eventCategory record.
 */
extern dec activityVariant(
  target: Operation,
  toolName: valueof string,
  variant: valueof Record<unknown>,
);

/**
 * Spec-driven display labels for canonical activity_type strings.
 *
 * The emitter materializes the table as a `CANONICAL_ACTIVITY_LABELS`
 * constant of type Record<string,string>, so every consumer (UIs, CLI
 * list views, report generators) reads from a single source of truth.
 *
 * Apply once at the namespace that owns the canonical activity_type
 * vocabulary (typically `OpenboxGovern`). Multiple calls merge; later
 * entries win on conflict, so a downstream profile can override a single
 * label without redeclaring the whole table.
 *
 * Custom-preset domain agents (FinOps, IAM, RPA, ...) emit free-form
 * activity_types that aren't in this table; consumers fall back to a
 * Title-Case formatter for unknown strings.
 *
 * @param table Map of activity_type string → display label.
 *   e.g. `#{ LLMCompleted: "LLM Completed", MCPToolCall: "MCP Tool Call" }`.
 */
extern dec activityLabels(target: Namespace, table: valueof Record<string>);

/**
 * Human-readable label for a single adapter hook event.
 *
 * Applied alongside `@hookEvent` on an adapter operation. The
 * emitter collects every `(hookEventName, label)` pair into the
 * adapter's generated `HOOK_EVENT_LABELS` constant. UI surfaces
 * (toast titles, detail-panel headers, mobile sheet labels) read
 * the constant so labels stay consistent across consumers.
 *
 * @param label Display label such as `"Shell command"` or
 *              `"File read"`.
 */
extern dec hookEventLabel(target: Operation, label: valueof string);
