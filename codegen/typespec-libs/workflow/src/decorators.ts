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
