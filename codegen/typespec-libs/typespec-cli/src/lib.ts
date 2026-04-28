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
        default: paramMessage`Invalid @feature_flag name '${'name'}'; must be dotted lowercase (e.g. 'agent.list.include-deleted')`,
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
    output: { description: 'flag: model is the canonical output shape for a command' },
    maturity: { description: 'CLI maturity (stable/beta/experimental) attached to interface or operation' },
    featureFlag: { description: 'fine-grained feature flag attached to operation or model property' },
    callsBackend: { description: 'backend method + call shape attached to an operation' },
    outputKind: { description: 'output renderer kind attached to an operation' },
    pagination: { description: 'flag: operation accepts the canonical pagination flag set' },
    flagExtra: { description: 'flag-level extras (body-key, parse, choices, default) attached to a model property' },
    outputPluck: { description: 'dotted path to extract from a response before rendering' },
    outputPost: { description: 'name of a registered post-output callback (stderr banner, etc)' },
  },
});

export const { reportDiagnostic, createDiagnostic, stateKeys } = $lib;
