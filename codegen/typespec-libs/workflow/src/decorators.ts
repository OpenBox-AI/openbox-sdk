// Decorator implementations for openbox-sdk/typespec-workflow. See ../env/
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

/** Six canonical event_type values the-core-service recognizes. */
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
