// Decorator implementations for typespec-workflow. See ../env/
// for the same split; getters here are for emitter consumption; the
// TypeSpec compiler sees decorators through src/index.ts ($decorators).

import type {
  DecoratorContext,
  Interface,
  Model,
  Namespace,
  Operation,
  Program,
} from '@typespec/compiler';
import { reportDiagnostic, stateKeys } from './lib.js';

/** Seven canonical event_type values the core service recognizes. */
export type CanonicalEventType =
  | 'WorkflowStarted'
  | 'WorkflowCompleted'
  | 'WorkflowFailed'
  | 'ActivityStarted'
  | 'ActivityCompleted'
  | 'SignalReceived'
  | 'Handoff';

const CANONICAL_EVENT_TYPES: ReadonlySet<CanonicalEventType> = new Set([
  'WorkflowStarted',
  'WorkflowCompleted',
  'WorkflowFailed',
  'ActivityStarted',
  'ActivityCompleted',
  'SignalReceived',
  'Handoff',
]);

export interface PresetBinding {
  readonly name: string;
}

export interface MapsToBinding {
  readonly eventType: CanonicalEventType;
  /** Free-form activity_type. Falls back to the operation name. */
  readonly activityType?: string;
}

export function $verdict(context: DecoratorContext, target: Model): void {
  const map = context.program.stateMap(stateKeys.verdict);
  if (map.size > 0) {
    reportDiagnostic(context.program, { code: 'duplicate-verdict', target });
    return;
  }
  map.set(target, true);
}

export function isVerdict(program: Program, target: Model): boolean {
  return program.stateMap(stateKeys.verdict).get(target) === true;
}

export function getVerdictModel(program: Program): Model | undefined {
  const map = program.stateMap(stateKeys.verdict);
  for (const [model] of map) {
    return model as Model;
  }
  return undefined;
}

const PRESET_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

export function $preset(
  context: DecoratorContext,
  target: Interface,
  name: string,
): void {
  if (!PRESET_NAME_PATTERN.test(name)) {
    reportDiagnostic(context.program, {
      code: 'invalid-preset-name',
      format: { name },
      target,
    });
    return;
  }
  const map = context.program.stateMap(stateKeys.preset);
  for (const [other, binding] of map) {
    if ((binding as PresetBinding).name === name && other !== target) {
      reportDiagnostic(context.program, {
        code: 'duplicate-preset-name',
        format: { name },
        target,
      });
      return;
    }
  }
  map.set(target, { name } satisfies PresetBinding);
}

export function getPreset(program: Program, target: Interface): PresetBinding | undefined {
  return program.stateMap(stateKeys.preset).get(target);
}

export function $maps_to(
  context: DecoratorContext,
  target: Operation,
  eventType: string,
  activityType?: string,
): void {
  if (!CANONICAL_EVENT_TYPES.has(eventType as CanonicalEventType)) {
    reportDiagnostic(context.program, {
      code: 'invalid-event-type',
      format: { eventType },
      target,
    });
    return;
  }
  context.program.stateMap(stateKeys.mapsTo).set(target, {
    eventType: eventType as CanonicalEventType,
    activityType,
  } satisfies MapsToBinding);
}

export function getMapsTo(program: Program, target: Operation): MapsToBinding | undefined {
  return program.stateMap(stateKeys.mapsTo).get(target);
}

// ─── Adapter decorators (Stage 1.3) ───────────────────────────────────────
// Adapters describe stdin/stdout JSON hook protocols (Claude Code hooks,
// Cursor hooks) that the emitter generates as `runtime/<name>` modules.
// An adapter binds to a @preset interface and routes incoming hook events
// (discriminated by a stdin field) to preset methods, then translates the
// verdict back to the platform-specific output shape.

export interface AdapterBinding {
  /** Emitted module suffix; `claude-code` -> `runtime/claude-code`. */
  readonly name: string;
  /** @preset name this adapter binds to, such as `claude-code` or `cursor`. */
  readonly preset: string;
  /** Stdin JSON discriminator field. */
  readonly discriminator: string;
}

const ADAPTER_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

export function $adapter(
  context: DecoratorContext,
  target: Interface,
  name: string,
  preset: string,
  discriminator: string,
): void {
  if (!ADAPTER_NAME_PATTERN.test(name)) {
    reportDiagnostic(context.program, {
      code: 'invalid-adapter-name',
      format: { name },
      target,
    });
    return;
  }
  if (!PRESET_NAME_PATTERN.test(preset)) {
    reportDiagnostic(context.program, {
      code: 'invalid-preset-name',
      format: { name: preset },
      target,
    });
    return;
  }
  const map = context.program.stateMap(stateKeys.adapter);
  for (const [other, binding] of map) {
    if ((binding as AdapterBinding).name === name && other !== target) {
      reportDiagnostic(context.program, {
        code: 'duplicate-adapter-name',
        format: { name },
        target,
      });
      return;
    }
  }
  map.set(target, { name, preset, discriminator } satisfies AdapterBinding);
}

export function getAdapter(program: Program, target: Interface): AdapterBinding | undefined {
  return program.stateMap(stateKeys.adapter).get(target);
}

export interface HookEventBinding {
  /** Value of the adapter's discriminator field that routes to this op. */
  readonly eventName: string;
}

export function $hookEvent(
  context: DecoratorContext,
  target: Operation,
  eventName: string,
): void {
  if (!eventName || typeof eventName !== 'string') {
    reportDiagnostic(context.program, {
      code: 'invalid-hook-event',
      format: { eventName: String(eventName) },
      target,
    });
    return;
  }
  context.program.stateMap(stateKeys.hookEvent).set(target, {
    eventName,
  } satisfies HookEventBinding);
}

export function getHookEvent(program: Program, target: Operation): HookEventBinding | undefined {
  return program.stateMap(stateKeys.hookEvent).get(target);
}

/**
 * Built-in verdict-arm-to-output translation families. The emitter has a
 * fixed registry of how each shape maps the four verdict arms to the
 * adapter's stdout JSON. Adding a new shape requires extending both the
 * decorator's union AND the emitter's registry.
 */
export type VerdictShape =
  | 'permission-decision' // PreToolUse: { hookSpecificOutput: { permissionDecision } }
  | 'decision-block' // PostToolUse / UserPromptSubmit: { decision?: 'block', reason? }
  | 'permission-request' // PermissionRequest: { hookSpecificOutput: { decision: { behavior } } }
  | 'permission-denied-retry' // PermissionDenied: { hookSpecificOutput: { retry } }
  | 'elicitation-response' // Elicitation/ElicitationResult: { hookSpecificOutput: { action, content? } }
  | 'continue-block' // Task/teammate lifecycle: { continue: false, stopReason? }
  | 'additional-context' // Failure/observe hooks that can feed context back
  | 'worktree-path' // WorktreeCreate: { hookSpecificOutput: { worktreePath } }
  | 'cursor-permission' // Cursor beforeXxx: { permission: 'allow'|'deny'|'ask', user_message? }
  | 'cursor-observe' // Cursor afterXxx: telemetry-only, no verdict gate
  | 'cursor-continue' // Cursor beforeSubmitPrompt: { continue: bool, user_message? }
  | 'none'; // adapter writes nothing (fire-and-forget signal)

const VERDICT_SHAPES: ReadonlySet<VerdictShape> = new Set([
  'permission-decision',
  'decision-block',
  'permission-request',
  'permission-denied-retry',
  'elicitation-response',
  'continue-block',
  'additional-context',
  'worktree-path',
  'cursor-permission',
  'cursor-observe',
  'cursor-continue',
  'none',
]);

export interface VerdictShapeBinding {
  readonly shape: VerdictShape;
}

export function $verdictShape(
  context: DecoratorContext,
  target: Operation,
  shape: string,
): void {
  if (!VERDICT_SHAPES.has(shape as VerdictShape)) {
    reportDiagnostic(context.program, {
      code: 'invalid-verdict-shape',
      format: { shape },
      target,
    });
    return;
  }
  context.program.stateMap(stateKeys.verdictShape).set(target, {
    shape: shape as VerdictShape,
  } satisfies VerdictShapeBinding);
}

export function getVerdictShape(
  program: Program,
  target: Operation,
): VerdictShapeBinding | undefined {
  return program.stateMap(stateKeys.verdictShape).get(target);
}

// ─── Activity routing ────────────────────────────────────────
// Per-event tool-name to activity_type table for adapter operations.
// Lives on @hookEvent operations whose handlers dispatch on a
// sub-discriminator inside the envelope. PreToolUse, for instance,
// routes by tool_name to FileRead, ShellExecution, HTTPRequest, etc.
//
// Spec'ing the table here means the per-platform runtime mappers
// consume a generated constant instead of hand-coding the same switch
// in two places. Drift between claude-code and cursor was a real
// concern.

export interface ActivityRoutingBinding {
  /** Map of inner-discriminator value → activity_type fired. */
  readonly table: Record<string, string>;
}

export function $activityRouting(
  context: DecoratorContext,
  target: Operation,
  raw: unknown,
): void {
  // TypeSpec passes record literals as a Map<string, string>. Normalize.
  const table: Record<string, string> = {};
  if (raw instanceof Map) {
    for (const [k, v] of raw.entries()) {
      if (typeof k === 'string' && typeof v === 'string') table[k] = v;
    }
  } else if (typeof raw === 'object' && raw !== null) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string') table[k] = v;
    }
  }
  if (Object.keys(table).length === 0) {
    reportDiagnostic(context.program, {
      code: 'invalid-activity-routing',
      format: { reason: 'table is empty or non-string-valued' },
      target,
    });
    return;
  }
  context.program.stateMap(stateKeys.activityRouting).set(target, {
    table,
  } satisfies ActivityRoutingBinding);
}

export function getActivityRouting(
  program: Program,
  target: Operation,
): ActivityRoutingBinding | undefined {
  return program.stateMap(stateKeys.activityRouting).get(target);
}

// ─── Activity type (single, fixed) ───────────────────────────
// For adapter ops whose hook events are action-specific (each Cursor
// hook = one action). Mutually exclusive with @activityRouting.

export function $activityType(
  context: DecoratorContext,
  target: Operation,
  name: string,
): void {
  if (typeof name !== 'string' || name.length === 0) {
    reportDiagnostic(context.program, {
      code: 'invalid-activity-routing',
      format: { reason: '@activityType requires a non-empty string' },
      target,
    });
    return;
  }
  context.program.stateMap(stateKeys.activityType).set(target, name);
}

export function getActivityType(
  program: Program,
  target: Operation,
): string | undefined {
  return program.stateMap(stateKeys.activityType).get(target);
}

// ─── Payload shape ────────────────────────────────────────────
// Declarative per-operation payload construction shared by all emitters.

/** A single output-field source. Discriminated by the keys present. */
export type FieldSource =
  | { kind: 'literal'; value: string }
  | { kind: 'from'; path: string; alternates: string[]; defaultLiteral?: string }
  | { kind: 'sideEffect'; effect: string; path: string };

export interface PayloadShapeBinding {
  /** Used when no tool name OR tool name not in `byTool`. */
  readonly defaultFields: Record<string, FieldSource>;
  /** Per-tool overrides. Keyed by inner-discriminator value. */
  readonly byTool: Record<string, Record<string, FieldSource>>;
  /** Set of side-effect kinds invoked anywhere in this op's payloads. */
  readonly sideEffectKinds: ReadonlySet<string>;
}

/** Walk a Map/object the TypeSpec compiler produced into a plain JS shape. */
function unwrapTspValue(v: unknown): unknown {
  if (v instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of v.entries()) {
      if (typeof k === 'string') out[k] = unwrapTspValue(val);
    }
    return out;
  }
  if (Array.isArray(v)) return v.map(unwrapTspValue);
  return v;
}

function parseFieldSource(raw: unknown): FieldSource | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.literal === 'string') {
    return { kind: 'literal', value: r.literal };
  }
  if (typeof r.sideEffect === 'string' && typeof r.from === 'string') {
    return { kind: 'sideEffect', effect: r.sideEffect, path: r.from };
  }
  if (typeof r.from === 'string' || Array.isArray(r.from)) {
    const paths = Array.isArray(r.from) ? r.from.filter((p): p is string => typeof p === 'string') : [r.from as string];
    if (paths.length === 0) return null;
    const [path, ...alternates] = paths;
    if (typeof r.alternate === 'string') alternates.push(r.alternate);
    const defaultLiteral = typeof r.default === 'string' ? r.default : undefined;
    return { kind: 'from', path, alternates, defaultLiteral };
  }
  return null;
}

function parseFieldMap(raw: unknown): Record<string, FieldSource> {
  if (typeof raw !== 'object' || raw === null) return {};
  const out: Record<string, FieldSource> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const src = parseFieldSource(v);
    if (src) out[k] = src;
  }
  return out;
}

export function $payloadShape(
  context: DecoratorContext,
  target: Operation,
  raw: unknown,
): void {
  const unwrapped = unwrapTspValue(raw) as Record<string, unknown>;
  const defaultFields = parseFieldMap(unwrapped.default);
  const byToolRaw = unwrapped.byTool;
  const byTool: Record<string, Record<string, FieldSource>> = {};
  if (byToolRaw && typeof byToolRaw === 'object') {
    for (const [tool, fields] of Object.entries(byToolRaw as Record<string, unknown>)) {
      byTool[tool] = parseFieldMap(fields);
    }
  }
  if (Object.keys(defaultFields).length === 0 && Object.keys(byTool).length === 0) {
    reportDiagnostic(context.program, {
      code: 'invalid-payload-shape',
      format: { reason: 'shape has no `default` and no `byTool` entries' },
      target,
    });
    return;
  }

  const sideEffectKinds = new Set<string>();
  const collect = (m: Record<string, FieldSource>) => {
    for (const src of Object.values(m)) {
      if (src.kind === 'sideEffect') sideEffectKinds.add(src.effect);
    }
  };
  collect(defaultFields);
  for (const m of Object.values(byTool)) collect(m);

  context.program.stateMap(stateKeys.payloadShape).set(target, {
    defaultFields,
    byTool,
    sideEffectKinds,
  } satisfies PayloadShapeBinding);
}

export function getPayloadShape(
  program: Program,
  target: Operation,
): PayloadShapeBinding | undefined {
  return program.stateMap(stateKeys.payloadShape).get(target);
}

export function $noPayload(context: DecoratorContext, target: Operation): void {
  context.program.stateMap(stateKeys.noPayload).set(target, true);
}

export function isNoPayload(program: Program, target: Operation): boolean {
  return program.stateMap(stateKeys.noPayload).get(target) === true;
}

// ─── Hook target ──────────────────────────────────────────────
// Host hook metadata: where the hook-event block lives for hosts that
// read config directly, plus how each event's JSON entry is shaped.

export type HookStyle = 'claude-array' | 'codex-array' | 'cursor-keyed';

export interface HookTargetBinding {
  readonly file: string;
  readonly key: string;
  readonly style: HookStyle;
  readonly command: string;
  readonly configDir: string;
}

const HOOK_STYLES: ReadonlySet<HookStyle> = new Set(['claude-array', 'codex-array', 'cursor-keyed']);

export function $hookTarget(
  context: DecoratorContext,
  target: Interface,
  raw: unknown,
): void {
  const obj = unwrapTspValue(raw) as Record<string, unknown>;
  const file = typeof obj.file === 'string' ? obj.file : '';
  const key = typeof obj.key === 'string' ? obj.key : '';
  const style = typeof obj.style === 'string' ? obj.style : '';
  const command = typeof obj.command === 'string' ? obj.command : '';
  const configDir = typeof obj.configDir === 'string' ? obj.configDir : '';
  if (!file || !key || !style || !command) {
    reportDiagnostic(context.program, {
      code: 'invalid-hook-target',
      format: { reason: 'file, key, style, and command are all required' },
      target,
    });
    return;
  }
  if (!HOOK_STYLES.has(style as HookStyle)) {
    reportDiagnostic(context.program, {
      code: 'invalid-hook-target',
      format: { reason: `style must be one of: ${[...HOOK_STYLES].join(', ')}` },
      target,
    });
    return;
  }
  context.program.stateMap(stateKeys.hookTarget).set(target, {
    file,
    key,
    style: style as HookStyle,
    command,
    configDir,
  } satisfies HookTargetBinding);
}

export function getHookTarget(
  program: Program,
  target: Interface,
): HookTargetBinding | undefined {
  return program.stateMap(stateKeys.hookTarget).get(target);
}

export function $installTimeout(
  context: DecoratorContext,
  target: Operation,
  seconds: number,
): void {
  context.program.stateMap(stateKeys.installTimeout).set(target, seconds);
}

export function getInstallTimeout(program: Program, target: Operation): number | undefined {
  return program.stateMap(stateKeys.installTimeout).get(target);
}

export function $installDefault(
  context: DecoratorContext,
  target: Operation,
  enabled: boolean,
): void {
  context.program.stateMap(stateKeys.installDefault).set(target, enabled);
}

export function getInstallDefault(program: Program, target: Operation): boolean | undefined {
  return program.stateMap(stateKeys.installDefault).get(target);
}

// ─── Activity variants ────────────────────────────────────────
// Predicate-based reroute for adapter ops where one tool's activity_type
// depends on a runtime field value.

export interface ActivityVariant {
  readonly tool: string;
  readonly field: string;
  readonly pattern: string;
  readonly activityType: string;
  readonly eventCategory?: string;
}

export function $activityVariant(
  context: DecoratorContext,
  target: Operation,
  toolName: string,
  rawVariant: unknown,
): void {
  const v = unwrapTspValue(rawVariant) as Record<string, unknown>;
  const field = typeof v.field === 'string' ? v.field : '';
  const pattern = typeof v.pattern === 'string' ? v.pattern : '';
  const activityType = typeof v.activityType === 'string' ? v.activityType : '';
  const eventCategory = typeof v.eventCategory === 'string' ? v.eventCategory : undefined;
  if (!field || !pattern || !activityType) {
    reportDiagnostic(context.program, {
      code: 'invalid-payload-shape',
      format: { reason: '@activityVariant requires { field, pattern, activityType }' },
      target,
    });
    return;
  }
  const list = (context.program.stateMap(stateKeys.activityVariants).get(target) ?? []) as ActivityVariant[];
  list.push({ tool: toolName, field, pattern, activityType, eventCategory });
  context.program.stateMap(stateKeys.activityVariants).set(target, list);
}

export function getActivityVariants(
  program: Program,
  target: Operation,
): ActivityVariant[] | undefined {
  return program.stateMap(stateKeys.activityVariants).get(target);
}

// ─── Activity labels (display strings) ────────────────────────────────────
// Single source of truth for activity_type → human-readable label. Replaces
// per-consumer Title-Case formatters that drift on acronyms (LLM/MCP/SDK/HTTP)
// and naming conventions (`on_llm_end`, `MCPToolCall`, `node-pre-execute`).
//
// Applied once on the OpenboxGovern namespace (record literal). Emitters
// emit a `CANONICAL_ACTIVITY_LABELS: Record<string, string>` constant; UIs
// look up the label and fall back to a Title-Case formatter for non-canonical
// activity_types (custom-preset domain agents always opt out of this table).

export interface ActivityLabelsBinding {
  /** Map of activity_type string → human-readable display label. */
  readonly table: Record<string, string>;
}

export function $activityLabels(
  context: DecoratorContext,
  target: Namespace,
  raw: unknown,
): void {
  const table: Record<string, string> = {};
  if (raw instanceof Map) {
    for (const [k, v] of raw.entries()) {
      if (typeof k === 'string' && typeof v === 'string') table[k] = v;
    }
  } else if (typeof raw === 'object' && raw !== null) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string') table[k] = v;
    }
  }
  if (Object.keys(table).length === 0) {
    reportDiagnostic(context.program, {
      code: 'invalid-activity-labels',
      format: { reason: 'table is empty or non-string-valued' },
      target,
    });
    return;
  }
  // Merge with any existing entries on the namespace; supports splitting
  // the table across multiple decorator calls if a future spec wants it.
  const existing = (context.program
    .stateMap(stateKeys.activityLabels)
    .get(target) ?? { table: {} }) as ActivityLabelsBinding;
  context.program.stateMap(stateKeys.activityLabels).set(target, {
    table: { ...existing.table, ...table },
  } satisfies ActivityLabelsBinding);
}

export function getActivityLabels(
  program: Program,
  target: Namespace,
): ActivityLabelsBinding | undefined {
  return program.stateMap(stateKeys.activityLabels).get(target);
}

// ─── Hook event labels (per-event display strings) ───────────────────
// Display label attached to an adapter `@hookEvent` operation. The
// emitter folds each adapter's collected labels into a generated
// `HOOK_EVENT_LABELS` constant so UIs render consistent names.

export function $hookEventLabel(
  context: DecoratorContext,
  target: Operation,
  label: string,
): void {
  if (typeof label !== 'string' || label.length === 0) {
    reportDiagnostic(context.program, {
      code: 'invalid-hook-event-label',
      format: { label: String(label) },
      target,
    });
    return;
  }
  context.program.stateMap(stateKeys.hookEventLabel).set(target, label);
}

export function getHookEventLabel(
  program: Program,
  target: Operation,
): string | undefined {
  return program.stateMap(stateKeys.hookEventLabel).get(target);
}

// ─── Provider capability matrix ──────────────────────────────────────
// Cross-host parity declarations live in TypeSpec so generated
// language SDKs consume the same support tiers, plugin components,
// event catalogs, and public integration exports.

export type ProviderCapabilitiesBinding = Record<string, unknown>;

export function $providerCapabilities(
  context: DecoratorContext,
  target: Namespace,
  raw: unknown,
): void {
  const value = unwrapTspValue(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    reportDiagnostic(context.program, {
      code: 'invalid-provider-capabilities',
      format: { reason: 'expected a record literal' },
      target,
    });
    return;
  }
  const record = value as Record<string, unknown>;
  for (const key of ['capabilityIds', 'providers', 'capabilities', 'governanceChecklistLimitations', 'governanceChecklistRows', 'governanceChecklistScore', 'referenceProviderParityClosures', 'referenceProviderRuntimeAudit', 'goalSignalGuards', 'usageCostCapabilityGuards', 'usageNormalization', 'tracingCapabilityGuards', 'hitlCapabilityGuards', 'guardrailCapabilityGuards', 'guardrailsHubRecordingSurface', 'policyEvaluationGuards', 'rulesInstructionCapabilityGuards', 'hookCapabilityGuards', 'subagentsAgentsCapabilityGuards', 'pluginCapabilityGuards', 'skillCapabilityGuards', 'mcpCapabilityGuards', 'installDoctorCapabilityGuards', 'localStackScenarioPaths', 'localStackScenarioMatrix', 'eventCatalog', 'pluginComponents', 'publicIntegrations', 'mcpTools', 'mcpPrompts', 'mcpResourceTemplates', 'mcpSkillReferences', 'n8nIntegration']) {
    if (!(key in record)) {
      reportDiagnostic(context.program, {
        code: 'invalid-provider-capabilities',
        format: { reason: `missing ${key}` },
        target,
      });
      return;
    }
  }
  context.program.stateMap(stateKeys.providerCapabilities).set(target, record);
}

export function getProviderCapabilities(
  program: Program,
  target: Namespace,
): ProviderCapabilitiesBinding | undefined {
  return program.stateMap(stateKeys.providerCapabilities).get(target);
}

// ─── Govern protocol conformance fixture ────────────────────────────
// Cross-language lifecycle scenarios belong in TypeSpec so every
// language runner consumes the same "bible" fixture.

export type GovernProtocolFixtureBinding = Record<string, unknown>;

export function $governProtocol(
  context: DecoratorContext,
  target: Namespace,
  raw: unknown,
): void {
  const value = unwrapTspValue(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    reportDiagnostic(context.program, {
      code: 'invalid-govern-protocol',
      format: { reason: 'expected a record literal' },
      target,
    });
    return;
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.cases) || record.cases.length === 0) {
    reportDiagnostic(context.program, {
      code: 'invalid-govern-protocol',
      format: { reason: 'cases must be a non-empty array' },
      target,
    });
    return;
  }
  context.program.stateMap(stateKeys.governProtocol).set(target, record);
}

export function getGovernProtocol(
  program: Program,
  target: Namespace,
): GovernProtocolFixtureBinding | undefined {
  return program.stateMap(stateKeys.governProtocol).get(target);
}

// ─── Backend permissions ─────────────────────────────────────────────
// Backend RBAC metadata belongs in the TypeSpec contract so generated
// SDKs share the same preflight rules across languages. The map is keyed
// by OpenAPI operationId and values are permission strings matching the
// backend Permission enum.

export type BackendPermissionsBinding = Record<string, string[]>;

export function $backendPermissions(
  context: DecoratorContext,
  target: Namespace,
  raw: unknown,
): void {
  const value = unwrapTspValue(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    reportDiagnostic(context.program, {
      code: 'invalid-backend-permissions',
      format: { reason: 'expected a record literal' },
      target,
    });
    return;
  }

  const permissions: BackendPermissionsBinding = {};
  for (const [operationId, rawPerms] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(rawPerms) || rawPerms.length === 0) {
      reportDiagnostic(context.program, {
        code: 'invalid-backend-permissions',
        format: { reason: `${operationId} must map to a non-empty string array` },
        target,
      });
      return;
    }
    const entries = rawPerms.filter(
      (entry): entry is string => typeof entry === 'string' && entry.length > 0,
    );
    if (entries.length !== rawPerms.length) {
      reportDiagnostic(context.program, {
        code: 'invalid-backend-permissions',
        format: { reason: `${operationId} contains a non-string permission` },
        target,
      });
      return;
    }
    permissions[operationId] = entries;
  }

  context.program.stateMap(stateKeys.backendPermissions).set(target, permissions);
}

export function getBackendPermissions(
  program: Program,
  target: Namespace,
): BackendPermissionsBinding | undefined {
  return program.stateMap(stateKeys.backendPermissions).get(target);
}

// ─── SDK method names ────────────────────────────────────────────────
// Public SDK method names are shared across language targets. The map is
// keyed by OpenAPI operationId and values are lower-camel method names;
// target emitters can project those to native casing when needed.

export type SdkMethodNamesBinding = Record<string, string>;

const SDK_METHOD_NAME_PATTERN = /^[a-z][A-Za-z0-9]*$/;

export function $sdkMethodNames(
  context: DecoratorContext,
  target: Namespace,
  raw: unknown,
): void {
  const value = unwrapTspValue(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    reportDiagnostic(context.program, {
      code: 'invalid-sdk-method-names',
      format: { reason: 'expected a record literal' },
      target,
    });
    return;
  }

  const methodNames: SdkMethodNamesBinding = {};
  for (const [operationId, methodName] of Object.entries(value as Record<string, unknown>)) {
    if (typeof methodName !== 'string' || !SDK_METHOD_NAME_PATTERN.test(methodName)) {
      reportDiagnostic(context.program, {
        code: 'invalid-sdk-method-names',
        format: { reason: `${operationId} must map to a lower-camel method name` },
        target,
      });
      return;
    }
    methodNames[operationId] = methodName;
  }

  context.program.stateMap(stateKeys.sdkMethodNames).set(target, methodNames);
}

export function getSdkMethodNames(
  program: Program,
  target: Namespace,
): SdkMethodNamesBinding | undefined {
  return program.stateMap(stateKeys.sdkMethodNames).get(target);
}

// ─── Target-native validation surfaces ──────────────────────────────
// The root check command is generic; language SDKs, spec-bound apps, and their
// native validation commands live in TypeSpec and are emitted as a fixture.

export type SdkTargetsBinding = Record<string, unknown>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function reportInvalidSdkTargets(
  context: DecoratorContext,
  target: Namespace,
  reason: string,
): void {
  reportDiagnostic(context.program, {
    code: 'invalid-sdk-targets',
    format: { reason },
    target,
  });
}

function validateCommandStepArray(
  context: DecoratorContext,
  target: Namespace,
  fieldPath: string,
  rawSteps: unknown,
): boolean {
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    reportInvalidSdkTargets(context, target, `${fieldPath} must be a non-empty array`);
    return false;
  }

  for (const [index, rawStep] of rawSteps.entries()) {
    if (!validateCommandStepRecord(context, target, `${fieldPath} ${index}`, rawStep)) return false;
  }

  return true;
}

function validateCommandStepRecord(
  context: DecoratorContext,
  target: Namespace,
  fieldPath: string,
  rawStep: unknown,
): boolean {
  if (!isRecord(rawStep)) {
    reportInvalidSdkTargets(context, target, `${fieldPath} must be a record`);
    return false;
  }
  const step = rawStep as Record<string, unknown>;
  for (const field of ['id', 'label', 'command', 'workingDirectory']) {
    if (!isNonEmptyString(step[field])) {
      reportInvalidSdkTargets(context, target, `${fieldPath}.${field} must be a non-empty string`);
      return false;
    }
  }
  if (step.args !== undefined && !isStringArray(step.args)) {
    reportInvalidSdkTargets(context, target, `${fieldPath}.args must be a string array`);
    return false;
  }
  if (step.env !== undefined) {
    if (!isRecord(step.env)) {
      reportInvalidSdkTargets(context, target, `${fieldPath}.env must be a record`);
      return false;
    }
    for (const [name, value] of Object.entries(step.env as Record<string, unknown>)) {
      if (!isNonEmptyString(name) || typeof value !== 'string') {
        reportInvalidSdkTargets(context, target, `${fieldPath}.env must map strings to strings`);
        return false;
      }
    }
  }

  return true;
}

function validatePipelineStepArray(
  context: DecoratorContext,
  target: Namespace,
  fieldPath: string,
  rawSteps: unknown,
): boolean {
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    reportInvalidSdkTargets(context, target, `${fieldPath} must be a non-empty array`);
    return false;
  }

  for (const [index, rawStep] of rawSteps.entries()) {
    if (!isRecord(rawStep)) {
      reportInvalidSdkTargets(context, target, `${fieldPath} ${index} must be a record`);
      return false;
    }
    const step = rawStep as Record<string, unknown>;
    if (step.steps === undefined) {
      if (!validateCommandStepRecord(context, target, `${fieldPath} ${index}`, step)) return false;
      continue;
    }
    for (const field of ['id', 'label']) {
      if (!isNonEmptyString(step[field])) {
        reportInvalidSdkTargets(context, target, `${fieldPath} ${index}.${field} must be a non-empty string`);
        return false;
      }
    }
    if (step.parallel !== true) {
      reportInvalidSdkTargets(context, target, `${fieldPath} ${index}.parallel must be true`);
      return false;
    }
    if (!validateCommandStepArray(context, target, `${fieldPath} ${index}.steps`, step.steps)) {
      return false;
    }
  }

  return true;
}

function validateExtensionManifestRecord(
  context: DecoratorContext,
  target: Namespace,
  targetId: string,
  rawManifest: unknown,
): boolean {
  if (!isRecord(rawManifest)) {
    reportInvalidSdkTargets(context, target, `${targetId} extensionManifest must be a record`);
    return false;
  }

  const manifest = rawManifest;
  for (const field of ['packageName', 'publisher', 'displayName', 'main']) {
    if (!isNonEmptyString(manifest[field])) {
      reportInvalidSdkTargets(
        context,
        target,
        `${targetId} extensionManifest.${field} must be a non-empty string`,
      );
      return false;
    }
  }
  if (!isRecord(manifest.metadata)) {
    reportInvalidSdkTargets(
      context,
      target,
      `${targetId} extensionManifest.metadata must be a record`,
    );
    return false;
  }
  const metadata = manifest.metadata as Record<string, unknown>;
  for (const field of ['description', 'icon', 'license', 'homepage']) {
    if (!isNonEmptyString(metadata[field])) {
      reportInvalidSdkTargets(
        context,
        target,
        `${targetId} extensionManifest.metadata.${field} must be a non-empty string`,
      );
      return false;
    }
  }
  if (!isRecord(metadata.repository)) {
    reportInvalidSdkTargets(
      context,
      target,
      `${targetId} extensionManifest.metadata.repository must be a record`,
    );
    return false;
  }
  for (const field of ['type', 'url']) {
    if (!isNonEmptyString((metadata.repository as Record<string, unknown>)[field])) {
      reportInvalidSdkTargets(
        context,
        target,
        `${targetId} extensionManifest.metadata.repository.${field} must be a non-empty string`,
      );
      return false;
    }
  }
  if (!isRecord(metadata.bugs) || !isNonEmptyString((metadata.bugs as Record<string, unknown>).url)) {
    reportInvalidSdkTargets(
      context,
      target,
      `${targetId} extensionManifest.metadata.bugs.url must be a non-empty string`,
    );
    return false;
  }
  if (!isRecord(metadata.engines) || !isNonEmptyString((metadata.engines as Record<string, unknown>).vscode)) {
    reportInvalidSdkTargets(
      context,
      target,
      `${targetId} extensionManifest.metadata.engines.vscode must be a non-empty string`,
    );
    return false;
  }
  for (const field of ['keywords', 'categories']) {
    if (!isStringArray(metadata[field])) {
      reportInvalidSdkTargets(
        context,
        target,
        `${targetId} extensionManifest.metadata.${field} must be a string array`,
      );
      return false;
    }
  }

  for (const field of ['activationEvents', 'views', 'commands', 'configurationKeys']) {
    if (!isStringArray(manifest[field])) {
      reportInvalidSdkTargets(
        context,
        target,
        `${targetId} extensionManifest.${field} must be a string array`,
      );
      return false;
    }
  }

  const views = manifest.views as string[];
  const commands = manifest.commands as string[];
  const configurationKeys = manifest.configurationKeys as string[];
  const viewSet = new Set(views);
  const commandSet = new Set(commands);
  if (viewSet.size !== views.length || commandSet.size !== commands.length) {
    reportInvalidSdkTargets(context, target, `${targetId} extensionManifest has duplicate views or commands`);
    return false;
  }
  if (new Set(configurationKeys).size !== configurationKeys.length) {
    reportInvalidSdkTargets(context, target, `${targetId} extensionManifest has duplicate configuration keys`);
    return false;
  }

  const recordArrays = [
    'viewContainers',
    'viewDefinitions',
    'commandDefinitions',
    'configurationProperties',
    'viewsWelcome',
    'menus',
  ];
  for (const field of recordArrays) {
    const value = manifest[field];
    if (!Array.isArray(value) || value.some((entry) => !isRecord(entry))) {
      reportInvalidSdkTargets(
        context,
        target,
        `${targetId} extensionManifest.${field} must be a record array`,
      );
      return false;
    }
  }

  const viewContainers = manifest.viewContainers as Array<Record<string, unknown>>;
  const viewDefinitions = manifest.viewDefinitions as Array<Record<string, unknown>>;
  const commandDefinitions = manifest.commandDefinitions as Array<Record<string, unknown>>;
  const configurationProperties = manifest.configurationProperties as Array<Record<string, unknown>>;
  const viewsWelcome = manifest.viewsWelcome as Array<Record<string, unknown>>;
  const menus = manifest.menus as Array<Record<string, unknown>>;

  const containerIds = new Set<string>();
  for (const [index, container] of viewContainers.entries()) {
    for (const field of ['location', 'id', 'title']) {
      if (!isNonEmptyString(container[field])) {
        reportInvalidSdkTargets(
          context,
          target,
          `${targetId} extensionManifest.viewContainers ${index}.${field} must be a non-empty string`,
        );
        return false;
      }
    }
    if (container.icon !== undefined && !isNonEmptyString(container.icon)) {
      reportInvalidSdkTargets(
        context,
        target,
        `${targetId} extensionManifest.viewContainers ${index}.icon must be a non-empty string`,
      );
      return false;
    }
    containerIds.add(container.id as string);
  }

  const definedViews: string[] = [];
  for (const [index, view] of viewDefinitions.entries()) {
    for (const field of ['container', 'id', 'name']) {
      if (!isNonEmptyString(view[field])) {
        reportInvalidSdkTargets(
          context,
          target,
          `${targetId} extensionManifest.viewDefinitions ${index}.${field} must be a non-empty string`,
        );
        return false;
      }
    }
    if (!containerIds.has(view.container as string)) {
      reportInvalidSdkTargets(
        context,
        target,
        `${targetId} extensionManifest.viewDefinitions ${index}.container references unknown view container`,
      );
      return false;
    }
    for (const field of ['icon', 'when']) {
      if (view[field] !== undefined && !isNonEmptyString(view[field])) {
        reportInvalidSdkTargets(
          context,
          target,
          `${targetId} extensionManifest.viewDefinitions ${index}.${field} must be a non-empty string`,
        );
        return false;
      }
    }
    definedViews.push(view.id as string);
  }
  if (definedViews.join('\n') !== views.join('\n')) {
    reportInvalidSdkTargets(context, target, `${targetId} extensionManifest.viewDefinitions must match views`);
    return false;
  }

  const definedCommands: string[] = [];
  for (const [index, command] of commandDefinitions.entries()) {
    for (const field of ['command', 'title']) {
      if (!isNonEmptyString(command[field])) {
        reportInvalidSdkTargets(
          context,
          target,
          `${targetId} extensionManifest.commandDefinitions ${index}.${field} must be a non-empty string`,
        );
        return false;
      }
    }
    for (const field of ['category', 'icon', 'enablement']) {
      if (command[field] !== undefined && !isNonEmptyString(command[field])) {
        reportInvalidSdkTargets(
          context,
          target,
          `${targetId} extensionManifest.commandDefinitions ${index}.${field} must be a non-empty string`,
        );
        return false;
      }
    }
    definedCommands.push(command.command as string);
  }
  if (definedCommands.join('\n') !== commands.join('\n')) {
    reportInvalidSdkTargets(
      context,
      target,
      `${targetId} extensionManifest.commandDefinitions must match commands`,
    );
    return false;
  }

  const definedConfigurationKeys: string[] = [];
  for (const [index, property] of configurationProperties.entries()) {
    for (const field of ['key', 'type', 'description']) {
      if (!isNonEmptyString(property[field])) {
        reportInvalidSdkTargets(
          context,
          target,
          `${targetId} extensionManifest.configurationProperties ${index}.${field} must be a non-empty string`,
        );
        return false;
      }
    }
    if (
      property.defaultValue !== undefined &&
      !['boolean', 'number', 'string'].includes(typeof property.defaultValue)
    ) {
      reportInvalidSdkTargets(
        context,
        target,
        `${targetId} extensionManifest.configurationProperties ${index}.defaultValue must be scalar`,
      );
      return false;
    }
    definedConfigurationKeys.push(property.key as string);
  }
  if (definedConfigurationKeys.join('\n') !== configurationKeys.join('\n')) {
    reportInvalidSdkTargets(
      context,
      target,
      `${targetId} extensionManifest.configurationProperties must match configurationKeys`,
    );
    return false;
  }

  for (const [index, entry] of viewsWelcome.entries()) {
    for (const field of ['view', 'contents']) {
      if (!isNonEmptyString(entry[field])) {
        reportInvalidSdkTargets(
          context,
          target,
          `${targetId} extensionManifest.viewsWelcome ${index}.${field} must be a non-empty string`,
        );
        return false;
      }
    }
    if (!viewSet.has(entry.view as string)) {
      reportInvalidSdkTargets(
        context,
        target,
        `${targetId} extensionManifest.viewsWelcome ${index}.view references unknown view`,
      );
      return false;
    }
    if (entry.when !== undefined && !isNonEmptyString(entry.when)) {
      reportInvalidSdkTargets(
        context,
        target,
        `${targetId} extensionManifest.viewsWelcome ${index}.when must be a non-empty string`,
      );
      return false;
    }
  }

  for (const [index, entry] of menus.entries()) {
    for (const field of ['location', 'command']) {
      if (!isNonEmptyString(entry[field])) {
        reportInvalidSdkTargets(
          context,
          target,
          `${targetId} extensionManifest.menus ${index}.${field} must be a non-empty string`,
        );
        return false;
      }
    }
    if (!commandSet.has(entry.command as string)) {
      reportInvalidSdkTargets(
        context,
        target,
        `${targetId} extensionManifest.menus ${index}.command references unknown command`,
      );
      return false;
    }
    for (const field of ['when', 'group']) {
      if (entry[field] !== undefined && !isNonEmptyString(entry[field])) {
        reportInvalidSdkTargets(
          context,
          target,
          `${targetId} extensionManifest.menus ${index}.${field} must be a non-empty string`,
        );
        return false;
      }
    }
  }

  for (const activationEvent of manifest.activationEvents as string[]) {
    if (activationEvent.startsWith('onView:') && !viewSet.has(activationEvent.slice('onView:'.length))) {
      reportInvalidSdkTargets(context, target, `${targetId} extensionManifest.activationEvents references unknown view`);
      return false;
    }
    if (
      activationEvent.startsWith('onCommand:') &&
      !commandSet.has(activationEvent.slice('onCommand:'.length))
    ) {
      reportInvalidSdkTargets(
        context,
        target,
        `${targetId} extensionManifest.activationEvents references unknown command`,
      );
      return false;
    }
  }

  return true;
}

function validateSecurityAuditRecord(
  context: DecoratorContext,
  target: Namespace,
  rawSecurityAudit: unknown,
): boolean {
  if (!rawSecurityAudit || typeof rawSecurityAudit !== 'object' || Array.isArray(rawSecurityAudit)) {
    reportInvalidSdkTargets(context, target, 'securityAudit must be a record');
    return false;
  }

  const securityAudit = rawSecurityAudit as Record<string, unknown>;
  if (!validateCommandStepArray(context, target, 'securityAudit.commands', securityAudit.commands)) {
    return false;
  }

  if (!Array.isArray(securityAudit.secretScanExcludes)) {
    reportInvalidSdkTargets(context, target, 'securityAudit.secretScanExcludes must be an array');
    return false;
  }
  for (const [index, rawExclude] of securityAudit.secretScanExcludes.entries()) {
    if (!rawExclude || typeof rawExclude !== 'object' || Array.isArray(rawExclude)) {
      reportInvalidSdkTargets(context, target, `securityAudit.secretScanExcludes ${index} must be a record`);
      return false;
    }
    const exclude = rawExclude as Record<string, unknown>;
    if (!isNonEmptyString(exclude.path) || !isNonEmptyString(exclude.reason)) {
      reportInvalidSdkTargets(
        context,
        target,
        `securityAudit.secretScanExcludes ${index} requires path and reason`,
      );
      return false;
    }
  }

  return true;
}

function validateLocalCiRecord(
  context: DecoratorContext,
  target: Namespace,
  rawLocalCi: unknown,
): boolean {
  if (!rawLocalCi || typeof rawLocalCi !== 'object' || Array.isArray(rawLocalCi)) {
    reportInvalidSdkTargets(context, target, 'localCi must be a record');
    return false;
  }

  const localCi = rawLocalCi as Record<string, unknown>;
  return validatePipelineStepArray(context, target, 'localCi.steps', localCi.steps);
}

function validateTestSuitesRecord(
  context: DecoratorContext,
  target: Namespace,
  rawTestSuites: unknown,
): boolean {
  if (!rawTestSuites || typeof rawTestSuites !== 'object' || Array.isArray(rawTestSuites)) {
    reportInvalidSdkTargets(context, target, 'testSuites must be a record');
    return false;
  }

  const testSuites = rawTestSuites as Record<string, unknown>;
  const defaultSuites = testSuites.defaultSuites;
  if (!isStringArray(defaultSuites) || defaultSuites.length === 0) {
    reportInvalidSdkTargets(context, target, 'testSuites.defaultSuites must be a non-empty string array');
    return false;
  }
  if (!validatePipelineStepArray(context, target, 'testSuites.suites', testSuites.suites)) {
    return false;
  }

  const suiteIds = new Set((testSuites.suites as Array<Record<string, unknown>>).map((suite) => suite.id as string));
  for (const suiteId of defaultSuites) {
    if (!suiteIds.has(suiteId)) {
      reportInvalidSdkTargets(context, target, `testSuites.defaultSuites references unknown suite ${suiteId}`);
      return false;
    }
  }

  return true;
}

function validateCodegenBuildRecord(
  context: DecoratorContext,
  target: Namespace,
  rawCodegenBuild: unknown,
): boolean {
  if (!rawCodegenBuild || typeof rawCodegenBuild !== 'object' || Array.isArray(rawCodegenBuild)) {
    reportInvalidSdkTargets(context, target, 'codegenBuild must be a record');
    return false;
  }

  const codegenBuild = rawCodegenBuild as Record<string, unknown>;
  return validateCommandStepArray(context, target, 'codegenBuild.steps', codegenBuild.steps);
}

function validateSdkGenerationRecord(
  context: DecoratorContext,
  target: Namespace,
  rawSdkGeneration: unknown,
): boolean {
  if (!rawSdkGeneration || typeof rawSdkGeneration !== 'object' || Array.isArray(rawSdkGeneration)) {
    reportInvalidSdkTargets(context, target, 'sdkGeneration must be a record');
    return false;
  }

  const sdkGeneration = rawSdkGeneration as Record<string, unknown>;
  return validateCommandStepArray(context, target, 'sdkGeneration.steps', sdkGeneration.steps);
}

function validateSpecCommandsRecord(
  context: DecoratorContext,
  target: Namespace,
  rawSpecCommands: unknown,
): boolean {
  if (!rawSpecCommands || typeof rawSpecCommands !== 'object' || Array.isArray(rawSpecCommands)) {
    reportInvalidSdkTargets(context, target, 'specCommands must be a record');
    return false;
  }

  const specCommands = rawSpecCommands as Record<string, unknown>;
  return validateCommandStepArray(context, target, 'specCommands.commands', specCommands.commands);
}

function validateServiceDriftRecord(
  context: DecoratorContext,
  target: Namespace,
  rawServiceDrift: unknown,
): boolean {
  if (!rawServiceDrift || typeof rawServiceDrift !== 'object' || Array.isArray(rawServiceDrift)) {
    reportInvalidSdkTargets(context, target, 'serviceDrift must be a record');
    return false;
  }

  const serviceDrift = rawServiceDrift as Record<string, unknown>;
  if (
    !isNonEmptyString(serviceDrift.script) ||
    !isStringArray(serviceDrift.services) ||
    serviceDrift.services.length === 0 ||
    !isStringArray(serviceDrift.tiers) ||
    serviceDrift.tiers.length === 0 ||
    !isNonEmptyString(serviceDrift.policy)
  ) {
    reportInvalidSdkTargets(
      context,
      target,
      'serviceDrift requires script, non-empty services/tiers, and policy',
    );
    return false;
  }

  if (!Array.isArray(serviceDrift.commands) || serviceDrift.commands.length === 0) {
    reportInvalidSdkTargets(context, target, 'serviceDrift.commands must be a non-empty array');
    return false;
  }

  const commandIds = new Set<string>();
  for (const [index, rawCommand] of serviceDrift.commands.entries()) {
    if (!rawCommand || typeof rawCommand !== 'object' || Array.isArray(rawCommand)) {
      reportInvalidSdkTargets(context, target, `serviceDrift.commands ${index} must be a record`);
      return false;
    }
    const command = rawCommand as Record<string, unknown>;
    for (const field of ['id', 'label', 'command', 'workingDirectory', 'outputPathTemplate', 'behavior']) {
      if (!isNonEmptyString(command[field])) {
        reportInvalidSdkTargets(
          context,
          target,
          `serviceDrift.commands ${index}.${field} must be a non-empty string`,
        );
        return false;
      }
    }
    if (commandIds.has(command.id as string)) {
      reportInvalidSdkTargets(context, target, `serviceDrift.commands duplicate id ${command.id}`);
      return false;
    }
    commandIds.add(command.id as string);
    if (command.args !== undefined && !isStringArray(command.args)) {
      reportInvalidSdkTargets(context, target, `serviceDrift.commands ${index}.args must be a string array`);
      return false;
    }
  }

  if (!Array.isArray(serviceDrift.upstreamSources) || serviceDrift.upstreamSources.length === 0) {
    reportInvalidSdkTargets(context, target, 'serviceDrift.upstreamSources must be a non-empty array');
    return false;
  }

  const sourcePairs = new Set<string>();
  for (const [index, rawSource] of serviceDrift.upstreamSources.entries()) {
    if (!rawSource || typeof rawSource !== 'object' || Array.isArray(rawSource)) {
      reportInvalidSdkTargets(context, target, `serviceDrift.upstreamSources ${index} must be a record`);
      return false;
    }
    const source = rawSource as Record<string, unknown>;
    for (const field of ['service', 'tier', 'source']) {
      if (!isNonEmptyString(source[field])) {
        reportInvalidSdkTargets(
          context,
          target,
          `serviceDrift.upstreamSources ${index}.${field} must be a non-empty string`,
        );
        return false;
      }
    }
    sourcePairs.add(`${source.service}:${source.tier}`);
  }

  for (const service of serviceDrift.services) {
    for (const tier of serviceDrift.tiers) {
      const pair = `${service}:${tier}`;
      if (!sourcePairs.has(pair)) {
        reportInvalidSdkTargets(
          context,
          target,
          `serviceDrift.upstreamSources is missing ${pair}`,
        );
        return false;
      }
    }
  }

  return true;
}

function validateRootPipelinesRecord(
  context: DecoratorContext,
  target: Namespace,
  rawRootPipelines: unknown,
): boolean {
  if (!rawRootPipelines || typeof rawRootPipelines !== 'object' || Array.isArray(rawRootPipelines)) {
    reportInvalidSdkTargets(context, target, 'rootPipelines must be a record');
    return false;
  }

  const rootPipelines = rawRootPipelines as Record<string, unknown>;
  if (!Array.isArray(rootPipelines.pipelines) || rootPipelines.pipelines.length === 0) {
    reportInvalidSdkTargets(context, target, 'rootPipelines.pipelines must be a non-empty array');
    return false;
  }

  const ids = new Set<string>();
  for (const [index, rawPipeline] of rootPipelines.pipelines.entries()) {
    if (!rawPipeline || typeof rawPipeline !== 'object' || Array.isArray(rawPipeline)) {
      reportInvalidSdkTargets(context, target, `rootPipelines.pipelines ${index} must be a record`);
      return false;
    }
    const pipeline = rawPipeline as Record<string, unknown>;
    for (const field of ['id', 'label']) {
      if (!isNonEmptyString(pipeline[field])) {
        reportInvalidSdkTargets(context, target, `rootPipelines.pipelines ${index}.${field} must be a non-empty string`);
        return false;
      }
    }
    if (ids.has(pipeline.id as string)) {
      reportInvalidSdkTargets(context, target, `rootPipelines.pipelines duplicate id ${pipeline.id}`);
      return false;
    }
    ids.add(pipeline.id as string);
    if (!validatePipelineStepArray(context, target, `rootPipelines.pipelines ${index}.steps`, pipeline.steps)) {
      return false;
    }
  }

  return true;
}

function validateBundleBuildRecord(
  context: DecoratorContext,
  target: Namespace,
  rawBundleBuild: unknown,
): boolean {
  if (!rawBundleBuild || typeof rawBundleBuild !== 'object' || Array.isArray(rawBundleBuild)) {
    reportInvalidSdkTargets(context, target, 'bundleBuild must be a record');
    return false;
  }

  const bundleBuild = rawBundleBuild as Record<string, unknown>;
  return validateCommandStepArray(context, target, 'bundleBuild.steps', bundleBuild.steps);
}

function validateQualityCommandsRecord(
  context: DecoratorContext,
  target: Namespace,
  rawQualityCommands: unknown,
): boolean {
  if (!rawQualityCommands || typeof rawQualityCommands !== 'object' || Array.isArray(rawQualityCommands)) {
    reportInvalidSdkTargets(context, target, 'qualityCommands must be a record');
    return false;
  }

  const qualityCommands = rawQualityCommands as Record<string, unknown>;
  return validateCommandStepArray(context, target, 'qualityCommands.commands', qualityCommands.commands);
}

function validateGeneratedChecksRecord(
  context: DecoratorContext,
  target: Namespace,
  rawGeneratedChecks: unknown,
): boolean {
  if (!rawGeneratedChecks || typeof rawGeneratedChecks !== 'object' || Array.isArray(rawGeneratedChecks)) {
    reportInvalidSdkTargets(context, target, 'generatedChecks must be a record');
    return false;
  }

  const generatedChecks = rawGeneratedChecks as Record<string, unknown>;
  return validateCommandStepArray(context, target, 'generatedChecks.commands', generatedChecks.commands);
}

function validatePackageSurfaceRecord(
  context: DecoratorContext,
  target: Namespace,
  rawPackageSurface: unknown,
): boolean {
  if (!rawPackageSurface || typeof rawPackageSurface !== 'object' || Array.isArray(rawPackageSurface)) {
    reportInvalidSdkTargets(context, target, 'packageSurface must be a record');
    return false;
  }

  const packageSurface = rawPackageSurface as Record<string, unknown>;
  if (!isNonEmptyString(packageSurface.packageName)) {
    reportInvalidSdkTargets(context, target, 'packageSurface.packageName must be a non-empty string');
    return false;
  }
  if (!isStringArray(packageSurface.files)) {
    reportInvalidSdkTargets(context, target, 'packageSurface.files must be a string array');
    return false;
  }

  if (!Array.isArray(packageSurface.bin)) {
    reportInvalidSdkTargets(context, target, 'packageSurface.bin must be an array');
    return false;
  }
  const binNames = new Set<string>();
  for (const [index, rawBin] of packageSurface.bin.entries()) {
    if (!rawBin || typeof rawBin !== 'object' || Array.isArray(rawBin)) {
      reportInvalidSdkTargets(context, target, `packageSurface.bin ${index} must be a record`);
      return false;
    }
    const bin = rawBin as Record<string, unknown>;
    if (!isNonEmptyString(bin.name) || !isNonEmptyString(bin.path)) {
      reportInvalidSdkTargets(context, target, `packageSurface.bin ${index} requires name and path`);
      return false;
    }
    if (binNames.has(bin.name)) {
      reportInvalidSdkTargets(context, target, `packageSurface.bin duplicate name ${bin.name}`);
      return false;
    }
    binNames.add(bin.name);
  }

  if (!Array.isArray(packageSurface.exports) || packageSurface.exports.length === 0) {
    reportInvalidSdkTargets(context, target, 'packageSurface.exports must be a non-empty array');
    return false;
  }
  const exportSubpaths = new Set<string>();
  for (const [index, rawExport] of packageSurface.exports.entries()) {
    if (!rawExport || typeof rawExport !== 'object' || Array.isArray(rawExport)) {
      reportInvalidSdkTargets(context, target, `packageSurface.exports ${index} must be a record`);
      return false;
    }
    const exportEntry = rawExport as Record<string, unknown>;
    for (const field of ['subpath', 'types', 'importPath']) {
      if (!isNonEmptyString(exportEntry[field])) {
        reportInvalidSdkTargets(context, target, `packageSurface.exports ${index}.${field} must be a non-empty string`);
        return false;
      }
    }
    if (exportSubpaths.has(exportEntry.subpath as string)) {
      reportInvalidSdkTargets(context, target, `packageSurface.exports duplicate subpath ${exportEntry.subpath}`);
      return false;
    }
    exportSubpaths.add(exportEntry.subpath as string);
  }

  return true;
}

const PACKAGE_SCRIPT_KINDS = new Set(['spec-runner', 'lifecycle-alias', 'compatibility-alias']);

function validatePackageScriptsRecord(
  context: DecoratorContext,
  target: Namespace,
  rawPackageScripts: unknown,
): boolean {
  if (!rawPackageScripts || typeof rawPackageScripts !== 'object' || Array.isArray(rawPackageScripts)) {
    reportInvalidSdkTargets(context, target, 'packageScripts must be a record');
    return false;
  }

  const packageScripts = rawPackageScripts as Record<string, unknown>;
  if (!Array.isArray(packageScripts.scripts) || packageScripts.scripts.length === 0) {
    reportInvalidSdkTargets(context, target, 'packageScripts.scripts must be a non-empty array');
    return false;
  }

  const scriptNames = new Set<string>();
  for (const [index, rawScript] of packageScripts.scripts.entries()) {
    if (!rawScript || typeof rawScript !== 'object' || Array.isArray(rawScript)) {
      reportInvalidSdkTargets(context, target, `packageScripts.scripts ${index} must be a record`);
      return false;
    }

    const script = rawScript as Record<string, unknown>;
    for (const field of ['name', 'command', 'kind']) {
      if (!isNonEmptyString(script[field])) {
        reportInvalidSdkTargets(
          context,
          target,
          `packageScripts.scripts ${index}.${field} must be a non-empty string`,
        );
        return false;
      }
    }
    if (scriptNames.has(script.name as string)) {
      reportInvalidSdkTargets(context, target, `packageScripts.scripts duplicate name ${script.name}`);
      return false;
    }
    scriptNames.add(script.name as string);
    if (!PACKAGE_SCRIPT_KINDS.has(script.kind as string)) {
      reportInvalidSdkTargets(
        context,
        target,
        `packageScripts.scripts ${index}.kind must be spec-runner, lifecycle-alias, or compatibility-alias`,
      );
      return false;
    }
  }

  return true;
}

function validateScriptInventoryRecord(
  context: DecoratorContext,
  target: Namespace,
  rawScriptInventory: unknown,
): boolean {
  if (!rawScriptInventory || typeof rawScriptInventory !== 'object' || Array.isArray(rawScriptInventory)) {
    reportInvalidSdkTargets(context, target, 'scriptInventory must be a record');
    return false;
  }

  const scriptInventory = rawScriptInventory as Record<string, unknown>;
  if (!Array.isArray(scriptInventory.entries) || scriptInventory.entries.length === 0) {
    reportInvalidSdkTargets(context, target, 'scriptInventory.entries must be a non-empty array');
    return false;
  }

  const paths = new Set<string>();
  for (const [index, rawEntry] of scriptInventory.entries.entries()) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
      reportInvalidSdkTargets(context, target, `scriptInventory.entries ${index} must be a record`);
      return false;
    }
    const entry = rawEntry as Record<string, unknown>;
    for (const field of ['path', 'category', 'canonicalSurface', 'role']) {
      if (!isNonEmptyString(entry[field])) {
        reportInvalidSdkTargets(
          context,
          target,
          `scriptInventory.entries ${index}.${field} must be a non-empty string`,
        );
        return false;
      }
    }
    if (paths.has(entry.path as string)) {
      reportInvalidSdkTargets(context, target, `scriptInventory.entries duplicate path ${entry.path}`);
      return false;
    }
    paths.add(entry.path as string);
  }

  return true;
}

function validateLocalStackProofLanesRecord(
  context: DecoratorContext,
  target: Namespace,
  rawLocalStackProofLanes: unknown,
): boolean {
  if (!isRecord(rawLocalStackProofLanes)) {
    reportInvalidSdkTargets(context, target, 'localStackProofLanes must be a record');
    return false;
  }

  const localStackProofLanes = rawLocalStackProofLanes;
  if (!isNonEmptyString(localStackProofLanes.policy)) {
    reportInvalidSdkTargets(context, target, 'localStackProofLanes.policy must be a non-empty string');
    return false;
  }
  if (!Array.isArray(localStackProofLanes.lanes) || localStackProofLanes.lanes.length === 0) {
    reportInvalidSdkTargets(context, target, 'localStackProofLanes.lanes must be a non-empty array');
    return false;
  }

  const laneIds = new Set<string>();
  for (const [index, rawLane] of localStackProofLanes.lanes.entries()) {
    if (!isRecord(rawLane)) {
      reportInvalidSdkTargets(context, target, `localStackProofLanes.lanes ${index} must be a record`);
      return false;
    }
    const lane = rawLane;
    for (const field of ['id', 'label', 'kind', 'suiteId', 'command', 'isolation']) {
      if (!isNonEmptyString(lane[field])) {
        reportInvalidSdkTargets(
          context,
          target,
          `localStackProofLanes.lanes ${index}.${field} must be a non-empty string`,
        );
        return false;
      }
    }
    const laneId = lane.id as string;
    if (laneIds.has(laneId)) {
      reportInvalidSdkTargets(context, target, `localStackProofLanes.lanes duplicate id ${laneId}`);
      return false;
    }
    laneIds.add(laneId);
    for (const field of ['parallelSafe', 'localStackRequired']) {
      if (typeof lane[field] !== 'boolean') {
        reportInvalidSdkTargets(
          context,
          target,
          `localStackProofLanes.lanes ${index}.${field} must be a boolean`,
        );
        return false;
      }
    }
    for (const field of ['requiredEnv', 'proofFiles']) {
      if (!isStringArray(lane[field])) {
        reportInvalidSdkTargets(
          context,
          target,
          `localStackProofLanes.lanes ${index}.${field} must be a string array`,
        );
        return false;
      }
    }
    const coverage = lane.coverage;
    if (!isRecord(coverage)) {
      reportInvalidSdkTargets(
        context,
        target,
        `localStackProofLanes.lanes ${index}.coverage must be a record`,
      );
      return false;
    }
    for (const field of ['checklistAreas', 'providers', 'domains', 'subsystems']) {
      if (!isStringArray(coverage[field])) {
        reportInvalidSdkTargets(
          context,
          target,
          `localStackProofLanes.lanes ${index}.coverage.${field} must be a string array`,
        );
        return false;
      }
    }
  }

  return true;
}

function validateCleanArtifactsRecord(
  context: DecoratorContext,
  target: Namespace,
  rawCleanArtifacts: unknown,
): boolean {
  if (!rawCleanArtifacts || typeof rawCleanArtifacts !== 'object' || Array.isArray(rawCleanArtifacts)) {
    reportInvalidSdkTargets(context, target, 'cleanArtifacts must be a record');
    return false;
  }

  const cleanArtifacts = rawCleanArtifacts as Record<string, unknown>;
  if (!isStringArray(cleanArtifacts.paths)) {
    reportInvalidSdkTargets(context, target, 'cleanArtifacts.paths must be a string array');
    return false;
  }

  if (!Array.isArray(cleanArtifacts.nestedNames)) {
    reportInvalidSdkTargets(context, target, 'cleanArtifacts.nestedNames must be an array');
    return false;
  }
  for (const [index, rawNested] of cleanArtifacts.nestedNames.entries()) {
    if (!rawNested || typeof rawNested !== 'object' || Array.isArray(rawNested)) {
      reportInvalidSdkTargets(context, target, `cleanArtifacts.nestedNames ${index} must be a record`);
      return false;
    }
    const nested = rawNested as Record<string, unknown>;
    if (!isNonEmptyString(nested.root) || !isStringArray(nested.names)) {
      reportInvalidSdkTargets(context, target, `cleanArtifacts.nestedNames ${index} requires root and names`);
      return false;
    }
  }

  if (!Array.isArray(cleanArtifacts.filePatterns)) {
    reportInvalidSdkTargets(context, target, 'cleanArtifacts.filePatterns must be an array');
    return false;
  }
  for (const [index, rawPattern] of cleanArtifacts.filePatterns.entries()) {
    if (!rawPattern || typeof rawPattern !== 'object' || Array.isArray(rawPattern)) {
      reportInvalidSdkTargets(context, target, `cleanArtifacts.filePatterns ${index} must be a record`);
      return false;
    }
    const pattern = rawPattern as Record<string, unknown>;
    for (const field of ['root', 'prefix', 'suffix']) {
      if (!isNonEmptyString(pattern[field])) {
        reportInvalidSdkTargets(context, target, `cleanArtifacts.filePatterns ${index}.${field} must be a non-empty string`);
        return false;
      }
    }
  }

  return true;
}

export function $sdkTargets(
  context: DecoratorContext,
  target: Namespace,
  raw: unknown,
): void {
  const value = unwrapTspValue(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    reportInvalidSdkTargets(context, target, 'expected a record literal');
    return;
  }

  const record = value as Record<string, unknown>;
  if (record.generatedArtifacts !== undefined) {
    if (!record.generatedArtifacts || typeof record.generatedArtifacts !== 'object' || Array.isArray(record.generatedArtifacts)) {
      reportInvalidSdkTargets(context, target, 'generatedArtifacts must be a record');
      return;
    }

    const artifacts = record.generatedArtifacts as Record<string, unknown>;
    for (const field of ['generatedRoots', 'generatedFiles']) {
      if (!isStringArray(artifacts[field])) {
        reportInvalidSdkTargets(context, target, `generatedArtifacts.${field} must be a string array`);
        return;
      }
    }
    if (artifacts.driftCheckFiles !== undefined && !isStringArray(artifacts.driftCheckFiles)) {
      reportInvalidSdkTargets(context, target, 'generatedArtifacts.driftCheckFiles must be a string array');
      return;
    }

    const nested = artifacts.nestedGeneratedFiles;
    if (nested !== undefined) {
      if (!Array.isArray(nested)) {
        reportInvalidSdkTargets(context, target, 'generatedArtifacts.nestedGeneratedFiles must be an array');
        return;
      }
      for (const [index, rawNested] of nested.entries()) {
        if (!rawNested || typeof rawNested !== 'object' || Array.isArray(rawNested)) {
          reportInvalidSdkTargets(
            context,
            target,
            `generatedArtifacts.nestedGeneratedFiles ${index} must be a record`,
          );
          return;
        }
        const nestedEntry = rawNested as Record<string, unknown>;
        if (!isNonEmptyString(nestedEntry.root) || !isStringArray(nestedEntry.suffixes)) {
          reportInvalidSdkTargets(
            context,
            target,
            `generatedArtifacts.nestedGeneratedFiles ${index} requires root and suffixes`,
          );
          return;
        }
      }
    }
  }

  if (record.packageSurface !== undefined) {
    if (!validatePackageSurfaceRecord(context, target, record.packageSurface)) {
      return;
    }
  }

  if (record.packageScripts !== undefined) {
    if (!validatePackageScriptsRecord(context, target, record.packageScripts)) {
      return;
    }
  }

  if (record.scriptInventory !== undefined) {
    if (!validateScriptInventoryRecord(context, target, record.scriptInventory)) {
      return;
    }
  }

  if (record.localStackProofLanes !== undefined) {
    if (!validateLocalStackProofLanesRecord(context, target, record.localStackProofLanes)) {
      return;
    }
  }

  if (record.codegenBuild !== undefined) {
    if (!validateCodegenBuildRecord(context, target, record.codegenBuild)) {
      return;
    }
  }

  if (record.sdkGeneration !== undefined) {
    if (!validateSdkGenerationRecord(context, target, record.sdkGeneration)) {
      return;
    }
  }

  if (record.specCommands !== undefined) {
    if (!validateSpecCommandsRecord(context, target, record.specCommands)) {
      return;
    }
  }

  if (record.serviceDrift !== undefined) {
    if (!validateServiceDriftRecord(context, target, record.serviceDrift)) {
      return;
    }
  }

  if (record.rootPipelines !== undefined) {
    if (!validateRootPipelinesRecord(context, target, record.rootPipelines)) {
      return;
    }
  }

  if (record.bundleBuild !== undefined) {
    if (!validateBundleBuildRecord(context, target, record.bundleBuild)) {
      return;
    }
  }

  if (record.qualityCommands !== undefined) {
    if (!validateQualityCommandsRecord(context, target, record.qualityCommands)) {
      return;
    }
  }

  if (record.generatedChecks !== undefined) {
    if (!validateGeneratedChecksRecord(context, target, record.generatedChecks)) {
      return;
    }
  }

  if (record.testSuites !== undefined) {
    if (!validateTestSuitesRecord(context, target, record.testSuites)) {
      return;
    }
  }

  if (record.cleanArtifacts !== undefined) {
    if (!validateCleanArtifactsRecord(context, target, record.cleanArtifacts)) {
      return;
    }
  }

  if (record.securityAudit !== undefined) {
    if (!validateSecurityAuditRecord(context, target, record.securityAudit)) {
      return;
    }
  }

  if (record.localCi !== undefined) {
    if (!validateLocalCiRecord(context, target, record.localCi)) {
      return;
    }
  }

  const targets = record.targets;
  if (!Array.isArray(targets) || targets.length === 0) {
    reportInvalidSdkTargets(context, target, 'targets must be a non-empty array');
    return;
  }

  for (const [index, rawTarget] of targets.entries()) {
    if (!rawTarget || typeof rawTarget !== 'object' || Array.isArray(rawTarget)) {
      reportInvalidSdkTargets(context, target, `target ${index} must be a record`);
      return;
    }
    const sdkTarget = rawTarget as Record<string, unknown>;
    if (!isNonEmptyString(sdkTarget.id)) {
      reportInvalidSdkTargets(context, target, `target ${index} is missing id`);
      return;
    }
    if (!Array.isArray(sdkTarget.commands) || sdkTarget.commands.length === 0) {
      reportInvalidSdkTargets(context, target, `${sdkTarget.id} commands must be a non-empty array`);
      return;
    }

    for (const [commandIndex, rawCommand] of sdkTarget.commands.entries()) {
      if (!rawCommand || typeof rawCommand !== 'object' || Array.isArray(rawCommand)) {
        reportInvalidSdkTargets(context, target, `${sdkTarget.id} command ${commandIndex} must be a record`);
        return;
      }
      const command = rawCommand as Record<string, unknown>;
      if (!isNonEmptyString(command.command)) {
        reportInvalidSdkTargets(context, target, `${sdkTarget.id} command ${commandIndex} is missing command`);
        return;
      }
      if (command.args !== undefined) {
        if (!Array.isArray(command.args) || !command.args.every((arg) => typeof arg === 'string')) {
          reportInvalidSdkTargets(context, target, `${sdkTarget.id} ${command.command} args must be a string array`);
          return;
        }
      }
      if (command.env !== undefined) {
        if (!command.env || typeof command.env !== 'object' || Array.isArray(command.env)) {
          reportInvalidSdkTargets(context, target, `${sdkTarget.id} ${command.command} env must be a record`);
          return;
        }
        for (const [name, value] of Object.entries(command.env as Record<string, unknown>)) {
          if (!isNonEmptyString(name) || typeof value !== 'string') {
            reportInvalidSdkTargets(
              context,
              target,
              `${sdkTarget.id} ${command.command} env must map strings to strings`,
            );
            return;
          }
        }
      }
    }

    if (sdkTarget.extensionManifest !== undefined) {
      if (sdkTarget.kind !== 'app') {
        reportInvalidSdkTargets(context, target, `${sdkTarget.id} extensionManifest is only valid for app targets`);
        return;
      }
      if (!validateExtensionManifestRecord(context, target, sdkTarget.id, sdkTarget.extensionManifest)) {
        return;
      }
    }
  }

  context.program.stateMap(stateKeys.sdkTargets).set(target, record);
}

export function getSdkTargets(
  program: Program,
  target: Namespace,
): SdkTargetsBinding | undefined {
  return program.stateMap(stateKeys.sdkTargets).get(target);
}
