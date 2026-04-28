import { createTypeSpecLibrary } from '@typespec/compiler';

export const $lib = createTypeSpecLibrary({
  name: 'typespec-cli',
  diagnostics: {},
  state: {
    command: { description: 'CLI command binding attached to an interface' },
    flag: { description: 'CLI flag binding attached to a model property' },
    validator: { description: 'validator name attached to a model property' },
    output: { description: 'flag: model is the canonical output shape for a command' },
  },
});

export const { reportDiagnostic, createDiagnostic, stateKeys } = $lib;
