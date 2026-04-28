// Decorator implementations for typespec-cli. See ../env/src/
// decorators.ts for the same shape - getter helpers are exported here
// for emitter consumption; the TypeSpec compiler sees the decorators
// through src/index.ts ($decorators export) only.

import type {
  DecoratorContext,
  Interface,
  Model,
  ModelProperty,
  Program,
} from '@typespec/compiler';
import { stateKeys } from './lib.js';

export interface CommandBinding {
  readonly name: string;
  readonly description: string | undefined;
}

export interface FlagBinding {
  readonly description: string;
  readonly short: string | undefined;
  readonly env: string | undefined;
}

function kebabCase(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

export function $cli_command(
  context: DecoratorContext,
  target: Interface,
  commandName?: string,
  description?: string,
): void {
  context.program.stateMap(stateKeys.command).set(target, {
    name: commandName ?? kebabCase(target.name),
    description,
  } satisfies CommandBinding);
}

export function getCommand(program: Program, target: Interface): CommandBinding | undefined {
  return program.stateMap(stateKeys.command).get(target);
}

export function $cli_flag(
  context: DecoratorContext,
  target: ModelProperty,
  description: string,
  short?: string,
  env?: string,
): void {
  context.program.stateMap(stateKeys.flag).set(target, {
    description,
    short,
    env,
  } satisfies FlagBinding);
}

export function getFlag(program: Program, target: ModelProperty): FlagBinding | undefined {
  return program.stateMap(stateKeys.flag).get(target);
}

export function $cli_validator(
  context: DecoratorContext,
  target: ModelProperty,
  name: string,
): void {
  context.program.stateMap(stateKeys.validator).set(target, name);
}

export function getValidator(program: Program, target: ModelProperty): string | undefined {
  return program.stateMap(stateKeys.validator).get(target);
}

export function $cli_output(context: DecoratorContext, target: Model): void {
  context.program.stateMap(stateKeys.output).set(target, true);
}

export function isOutput(program: Program, target: Model): boolean {
  return program.stateMap(stateKeys.output).get(target) === true;
}
