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
    'invalid-preset-name': {
      severity: 'error',
      messages: {
        default: paramMessage`Invalid preset name '${'name'}'; must match /^[a-z][a-z0-9-]*$/`,
      },
    },
    'duplicate-preset-name': {
      severity: 'error',
      messages: {
        default: paramMessage`Duplicate @preset name '${'name'}'; each preset must have a unique identifier`,
      },
    },
    'invalid-event-type': {
      severity: 'error',
      messages: {
        default: paramMessage`Invalid event_type '${'eventType'}' on @maps_to; must be one of WorkflowStarted, WorkflowCompleted, WorkflowFailed, ActivityStarted, ActivityCompleted, SignalReceived`,
      },
    },
  },
  state: {
    verdict: { description: 'flag: model is the canonical verdict shape' },
    preset: { description: 'preset binding attached to a framework-preset interface' },
    mapsTo: { description: 'envelope mapping attached to a preset operation' },
  },
});

export const { reportDiagnostic, createDiagnostic, stateKeys } = $lib;
