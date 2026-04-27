// Decorator implementations for @openbox/typespec-env. These attach
// metadata to TypeSpec semantic-model nodes; per-language emitters at
// codegen/emitters/<lang>/ read the metadata to drive code generation.
//
// Importable directly by emitters via `@openbox/typespec-env/decorators`
// for the getter helpers. The TypeSpec compiler itself only sees these
// through the `$decorators` export in tsp-index.ts.

import type { DecoratorContext, ModelProperty, Program } from '@typespec/compiler';
import { stateKeys } from './lib.js';

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
