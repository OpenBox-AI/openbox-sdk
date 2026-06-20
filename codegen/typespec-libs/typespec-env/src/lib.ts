import { createTypeSpecLibrary, paramMessage } from '@typespec/compiler';

export const $lib = createTypeSpecLibrary({
  name: 'typespec-env',
  diagnostics: {
    'invalid-env-conformance': {
      severity: 'error',
      messages: {
        default: paramMessage`Invalid @env_conformance: ${'reason'}`,
      },
    },
  },
  state: {
    envVar: { description: 'env var binding for the property' },
    tokenFormat: { description: 'runtime regex constraint for the property' },
    osPath: { description: 'flag: resolve property under per-OS user data dir' },
    envConformance: { description: 'environment conformance fixture attached to a namespace' },
  },
});

export const { reportDiagnostic, createDiagnostic, stateKeys } = $lib;
