// Decorator implementations for typespec-workflow. See ../env/
// for the same split - getters here are for emitter consumption; the
// TypeSpec compiler sees decorators through src/index.ts ($decorators).

import type {
  DecoratorContext,
  Interface,
  Model,
  Operation,
  Program,
} from '@typespec/compiler';
import { reportDiagnostic, stateKeys } from './lib.js';

/** Six canonical event_type values openbox-core recognizes. */
export type CanonicalEventType =
  | 'WorkflowStarted'
  | 'WorkflowCompleted'
  | 'WorkflowFailed'
  | 'ActivityStarted'
  | 'ActivityCompleted'
  | 'SignalReceived';

const CANONICAL_EVENT_TYPES: ReadonlySet<CanonicalEventType> = new Set([
  'WorkflowStarted',
  'WorkflowCompleted',
  'WorkflowFailed',
  'ActivityStarted',
  'ActivityCompleted',
  'SignalReceived',
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
// Adapters describe stdin/stdout JSON hook protocols (claude-hooks,
// cursor-hooks) that the emitter generates as `runtime/<name>` modules.
// An adapter binds to a @preset interface and routes incoming hook events
// (discriminated by a stdin field) to preset methods, then translates the
// verdict back to the platform-specific output shape.

export interface AdapterBinding {
  /** Emitted module suffix - `claude-hooks` → `runtime/claude-hooks`. */
  readonly name: string;
  /** @preset name this adapter binds to (e.g. `claude-code`, `cursor`). */
  readonly preset: string;
  /** Stdin JSON field used to discriminate operations. */
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
  | 'cursor-permission' // cursor-hooks beforeXxx: { permission: 'allow'|'deny'|'ask', userMessage? }
  | 'cursor-observe' // cursor-hooks afterXxx: telemetry-only, no verdict gate
  | 'none'; // adapter writes nothing (fire-and-forget signal)

const VERDICT_SHAPES: ReadonlySet<VerdictShape> = new Set([
  'permission-decision',
  'decision-block',
  'permission-request',
  'cursor-permission',
  'cursor-observe',
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
// Per-event tool-name → activity_type table for adapter operations. Lives
// on @hookEvent operations whose handlers dispatch on a sub-discriminator
// inside the envelope (e.g. PreToolUse routes by tool_name to FileRead /
// ShellExecution / HTTPRequest / etc).
//
// Spec'ing the table here means the per-platform runtime mappers consume
// a generated constant instead of hand-coding the same switch in two
// places - drift between claude-code and cursor was a real concern.

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

// ─── Payload shape ────────────────────────────────────────────
// Declarative per-operation payload construction. The mappers used to
// hand-shape activity payloads with per-tool switch statements; this
// pushes the shaping into the spec so all language emitters get the
// same extraction logic for free.

/** A single output-field source. Discriminated by the keys present. */
export type FieldSource =
  | { kind: 'literal'; value: string }
  | { kind: 'from'; path: string; fallbacks: string[]; defaultLiteral?: string }
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
    const [path, ...fallbacks] = paths;
    if (typeof r.fallback === 'string') fallbacks.push(r.fallback);
    const defaultLiteral = typeof r.default === 'string' ? r.default : undefined;
    return { kind: 'from', path, fallbacks, defaultLiteral };
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

// ─── Install target ───────────────────────────────────────────
// Where the adapter writes its hook-event block on disk + how each
// event's JSON entry is shaped.

export type InstallStyle = 'claude-array' | 'cursor-keyed';

export interface InstallTargetBinding {
  readonly file: string;
  readonly key: string;
  readonly style: InstallStyle;
  readonly command: string;
  readonly configDir: string;
}

const INSTALL_STYLES: ReadonlySet<InstallStyle> = new Set(['claude-array', 'cursor-keyed']);

export function $installTarget(
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
      code: 'invalid-install-target',
      format: { reason: 'file, key, style, and command are all required' },
      target,
    });
    return;
  }
  if (!INSTALL_STYLES.has(style as InstallStyle)) {
    reportDiagnostic(context.program, {
      code: 'invalid-install-target',
      format: { reason: `style must be one of: ${[...INSTALL_STYLES].join(', ')}` },
      target,
    });
    return;
  }
  context.program.stateMap(stateKeys.installTarget).set(target, {
    file,
    key,
    style: style as InstallStyle,
    command,
    configDir,
  } satisfies InstallTargetBinding);
}

export function getInstallTarget(
  program: Program,
  target: Interface,
): InstallTargetBinding | undefined {
  return program.stateMap(stateKeys.installTarget).get(target);
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
