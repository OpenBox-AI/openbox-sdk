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

export type ActivityStage = 'pre' | 'post' | 'both';
export type ObserverWhen = 'before' | 'after';

export interface WorkflowBinding {
  readonly domain: string;
}

export interface ActivityBinding {
  readonly canonicalType: string;
  readonly stage: ActivityStage;
}

export interface ObserverBinding {
  readonly when: ObserverWhen;
}

function snakeCase(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}

export function $workflow(
  context: DecoratorContext,
  target: Interface,
  domain?: string,
): void {
  context.program.stateMap(stateKeys.workflow).set(target, {
    domain: domain ?? snakeCase(target.name),
  } satisfies WorkflowBinding);
}

export function getWorkflow(program: Program, target: Interface): WorkflowBinding | undefined {
  return program.stateMap(stateKeys.workflow).get(target);
}

export function $activity(
  context: DecoratorContext,
  target: Operation,
  canonicalType: string,
  stage: ActivityStage = 'both',
): void {
  if (stage !== 'pre' && stage !== 'post' && stage !== 'both') {
    reportDiagnostic(context.program, {
      code: 'invalid-activity-stage',
      format: { stage },
      target,
    });
    return;
  }
  context.program.stateMap(stateKeys.activity).set(target, {
    canonicalType,
    stage,
  } satisfies ActivityBinding);
}

export function getActivity(program: Program, target: Operation): ActivityBinding | undefined {
  return program.stateMap(stateKeys.activity).get(target);
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

export function $observer_hook(
  context: DecoratorContext,
  target: Operation,
  when: ObserverWhen,
): void {
  if (when !== 'before' && when !== 'after') {
    reportDiagnostic(context.program, {
      code: 'invalid-observer-when',
      format: { when },
      target,
    });
    return;
  }
  context.program.stateMap(stateKeys.observer).set(target, { when } satisfies ObserverBinding);
}

export function getObserverHook(
  program: Program,
  target: Operation,
): ObserverBinding | undefined {
  return program.stateMap(stateKeys.observer).get(target);
}
