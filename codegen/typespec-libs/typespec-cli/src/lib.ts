import { createTypeSpecLibrary, paramMessage } from '@typespec/compiler';

export const $lib = createTypeSpecLibrary({
  name: 'typespec-cli',
  diagnostics: {
    'invalid-maturity': {
      severity: 'error',
      messages: {
        default: paramMessage`Invalid @cli_maturity '${'level'}'; must be one of stable, beta, experimental`,
      },
    },
    'invalid-feature-name': {
      severity: 'error',
      messages: {
        default: paramMessage`Invalid @feature_flag name '${'name'}'; must be dotted lowercase, such as 'agent.list.include-deleted'`,
      },
    },
    'invalid-output-kind': {
      severity: 'error',
      messages: {
        default: paramMessage`Invalid @cli_output_kind '${'kind'}'; must be one of table, list, json, kv, custom`,
      },
    },
  },
  state: {
    command: { description: 'CLI command binding attached to an interface' },
    flag: { description: 'CLI flag binding attached to a model property' },
    validator: { description: 'validator name attached to a model property' },
    maturity: { description: 'CLI maturity (stable/beta/experimental) attached to interface or operation' },
    featureFlag: { description: 'fine-grained feature flag attached to operation or model property' },
    callsBackend: { description: 'backend method + call shape attached to an operation' },
    outputKind: { description: 'output renderer kind attached to an operation' },
    pagination: { description: 'flag: operation accepts the canonical pagination flag set' },
    flagExtra: { description: 'flag-level extras (body-key, parse, choices, default) attached to a model property' },
    outputPluck: { description: 'dotted path to extract from a response before rendering' },
    outputPost: { description: 'name of a registered post-output callback (stderr banner, etc)' },
    jsonMerge: { description: 'op accepts --json escape hatch + per-flag override merge mode' },
    atLeastOne: { description: 'cross-field constraint: at least one of these flags must be set' },
    requiredTogether: { description: 'cross-field constraint: any of these → all of these required' },
    localOnly: { description: 'flag: op is local-only (no backend/core HTTP call)' },
    preflight: { description: 'name of a registered preflight callback (HTTP checks before main call)' },
    dtoDefaults: { description: 'declarative DTO defaults merged into the body for missing keys' },
    postValidate: { description: 'names of registered post-validate callbacks run before the call' },
    destructive: { description: 'flag: op is destructive (delete/revoke/etc); runtime requires --yes / non-interactive context' },
    recipe: { description: 'tier-2 composite: list of tier-1 backend calls + how to assemble their results' },
  },
});

export const { reportDiagnostic, createDiagnostic, stateKeys } = $lib;
