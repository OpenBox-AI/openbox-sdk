import { createTypeSpecLibrary, paramMessage } from '@typespec/compiler';

export const $lib = createTypeSpecLibrary({
  name: '@openbox/typespec-workflow',
  diagnostics: {
    'duplicate-verdict': {
      severity: 'error',
      messages: {
        default: 'Only one model in a program may be marked @verdict',
      },
    },
    'invalid-activity-stage': {
      severity: 'error',
      messages: {
        default: paramMessage`Invalid stage '${'stage'}' on @activity; must be 'pre', 'post', or 'both'`,
      },
    },
    'invalid-observer-when': {
      severity: 'error',
      messages: {
        default: paramMessage`Invalid when '${'when'}' on @observer_hook; must be 'before' or 'after'`,
      },
    },
  },
  state: {
    workflow: { description: 'workflow domain attached to an interface' },
    activity: { description: 'activity binding attached to an operation' },
    verdict: { description: 'flag: model is the canonical verdict shape' },
    observer: { description: 'observer-hook binding attached to an operation' },
  },
});

export const { reportDiagnostic, createDiagnostic, stateKeys } = $lib;
