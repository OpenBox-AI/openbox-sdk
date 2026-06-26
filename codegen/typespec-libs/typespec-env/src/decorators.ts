// Decorator implementations for typespec-env. These attach
// metadata to TypeSpec semantic-model nodes; per-target emitters at
// codegen/emitters/<lang>/ read the metadata to drive code generation.
//
// Importable directly by emitters via `typespec-env/decorators`
// for the getter helpers. The TypeSpec compiler itself only sees these
// through the `$decorators` export in tsp-index.ts.

import type { DecoratorContext, ModelProperty, Namespace, Program } from '@typespec/compiler';
import { reportDiagnostic, stateKeys } from './lib.js';

export interface EnvVarBinding {
  readonly name: string;
  readonly defaultValue: string | undefined;
}

export function $env_var(
  context: DecoratorContext,
  target: ModelProperty,
  name: string,
  defaultValue?: string,
): void {
  context.program.stateMap(stateKeys.envVar).set(target, {
    name,
    defaultValue,
  } satisfies EnvVarBinding);
}

export function getEnvVar(program: Program, target: ModelProperty): EnvVarBinding | undefined {
  return program.stateMap(stateKeys.envVar).get(target);
}

export function $token_format(
  context: DecoratorContext,
  target: ModelProperty,
  pattern: string,
): void {
  context.program.stateMap(stateKeys.tokenFormat).set(target, pattern);
}

export function getTokenFormat(program: Program, target: ModelProperty): string | undefined {
  return program.stateMap(stateKeys.tokenFormat).get(target);
}

export function $os_path(context: DecoratorContext, target: ModelProperty): void {
  context.program.stateMap(stateKeys.osPath).set(target, true);
}

export function isOsPath(program: Program, target: ModelProperty): boolean {
  return program.stateMap(stateKeys.osPath).get(target) === true;
}

// ─── Env conformance fixture ────────────────────────────────────────
// Runtime configuration resolution cases belong in TypeSpec so every
// SDK target validates the same env/token-store behavior.

export type EnvConformanceFixtureBinding = Record<string, unknown>;

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

export function $env_conformance(
  context: DecoratorContext,
  target: Namespace,
  raw: unknown,
): void {
  const value = unwrapTspValue(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    reportDiagnostic(context.program, {
      code: 'invalid-env-conformance',
      format: { reason: 'expected a record literal' },
      target,
    });
    return;
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.cases) || record.cases.length === 0) {
    reportDiagnostic(context.program, {
      code: 'invalid-env-conformance',
      format: { reason: 'cases must be a non-empty array' },
      target,
    });
    return;
  }
  context.program.stateMap(stateKeys.envConformance).set(target, record);
}

export function getEnvConformance(
  program: Program,
  target: Namespace,
): EnvConformanceFixtureBinding | undefined {
  return program.stateMap(stateKeys.envConformance).get(target);
}
