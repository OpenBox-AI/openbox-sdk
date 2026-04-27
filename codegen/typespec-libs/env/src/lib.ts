import { createTypeSpecLibrary } from '@typespec/compiler';

export const $lib = createTypeSpecLibrary({
  name: '@openbox/typespec-env',
  diagnostics: {},
  state: {
    envVar: { description: 'env var binding for the property' },
    tokenFormat: { description: 'runtime regex constraint for the property' },
    osPath: { description: 'flag: resolve property under per-OS user data dir' },
  },
});

export const { reportDiagnostic, createDiagnostic, stateKeys } = $lib;
