import { createTypeSpecLibrary, paramMessage } from '@typespec/compiler';

export const $lib = createTypeSpecLibrary({
  name: 'typespec-workflow',
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
    'invalid-adapter-name': {
      severity: 'error',
      messages: {
        default: paramMessage`Invalid adapter name '${'name'}'; must match /^[a-z][a-z0-9-]*$/`,
      },
    },
    'duplicate-adapter-name': {
      severity: 'error',
      messages: {
        default: paramMessage`Duplicate @adapter name '${'name'}'; each adapter must have a unique identifier`,
      },
    },
    'invalid-hook-event': {
      severity: 'error',
      messages: {
        default: paramMessage`Invalid @hookEvent name '${'eventName'}'; must be a non-empty string`,
      },
    },
    'invalid-verdict-shape': {
      severity: 'error',
      messages: {
        default: paramMessage`Invalid @verdictShape '${'shape'}'; must be one of permission-decision, decision-block, permission-request, cursor-permission, cursor-observe, none`,
      },
    },
    'invalid-activity-routing': {
      severity: 'error',
      messages: {
        default: paramMessage`Invalid @activityRouting: ${'reason'}`,
      },
    },
    'invalid-payload-shape': {
      severity: 'error',
      messages: {
        default: paramMessage`Invalid @payloadShape: ${'reason'}`,
      },
    },
    'invalid-install-target': {
      severity: 'error',
      messages: {
        default: paramMessage`Invalid @installTarget: ${'reason'}`,
      },
    },
    'invalid-activity-labels': {
      severity: 'error',
      messages: {
        default: paramMessage`Invalid @activityLabels: ${'reason'}`,
      },
    },
  },
  state: {
    verdict: { description: 'flag: model is the canonical verdict shape' },
    preset: { description: 'preset binding attached to a framework-preset interface' },
    mapsTo: { description: 'envelope mapping attached to a preset operation' },
    adapter: { description: 'adapter binding attached to a hook-protocol interface' },
    hookEvent: { description: 'hook-event routing attached to an adapter operation' },
    verdictShape: { description: 'verdict-output translation family attached to an adapter operation' },
    activityRouting: { description: 'tool-name → activity_type table attached to an adapter operation' },
    payloadShape: { description: 'declarative activity payload shape attached to an adapter operation' },
    noPayload: { description: 'flag: adapter op has no scannable activity payload (lifecycle/observe-only)' },
    installTarget: { description: 'install file/key/style/command attached to an adapter interface' },
    installTimeout: { description: 'per-event install timeout (seconds) attached to an adapter operation' },
    activityVariants: { description: 'predicate-based activity-type reroute table attached to an adapter operation' },
    activityLabels: { description: 'activity_type → human-readable display label table attached to a namespace' },
  },
});

export const { reportDiagnostic, createDiagnostic, stateKeys } = $lib;
