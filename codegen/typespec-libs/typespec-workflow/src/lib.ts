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
        default: paramMessage`Invalid event_type '${'eventType'}' on @maps_to; must be one of WorkflowStarted, WorkflowCompleted, WorkflowFailed, ActivityStarted, ActivityCompleted, SignalReceived, Handoff`,
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
        default: paramMessage`Invalid @verdictShape '${'shape'}'; must be one of permission-decision, decision-block, permission-request, permission-denied-retry, elicitation-response, continue-block, additional-context, cursor-permission, cursor-observe, cursor-continue, none`,
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
    'invalid-hook-target': {
      severity: 'error',
      messages: {
        default: paramMessage`Invalid @hookTarget: ${'reason'}`,
      },
    },
    'invalid-activity-labels': {
      severity: 'error',
      messages: {
        default: paramMessage`Invalid @activityLabels: ${'reason'}`,
      },
    },
    'invalid-hook-event-label': {
      severity: 'error',
      messages: {
        default: paramMessage`Invalid @hookEventLabel '${'label'}'; must be a non-empty string`,
      },
    },
    'invalid-provider-capabilities': {
      severity: 'error',
      messages: {
        default: paramMessage`Invalid @providerCapabilities: ${'reason'}`,
      },
    },
    'invalid-govern-protocol': {
      severity: 'error',
      messages: {
        default: paramMessage`Invalid @governProtocol: ${'reason'}`,
      },
    },
    'invalid-backend-permissions': {
      severity: 'error',
      messages: {
        default: paramMessage`Invalid @backendPermissions: ${'reason'}`,
      },
    },
    'invalid-sdk-method-names': {
      severity: 'error',
      messages: {
        default: paramMessage`Invalid @sdkMethodNames: ${'reason'}`,
      },
    },
    'invalid-sdk-targets': {
      severity: 'error',
      messages: {
        default: paramMessage`Invalid @sdkTargets: ${'reason'}`,
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
    hookTarget: { description: 'hook file/key/style/command attached to an adapter interface' },
    installTimeout: { description: 'per-event install timeout (seconds) attached to an adapter operation' },
    installDefault: { description: 'whether a hook event is installed by default' },
    activityVariants: { description: 'predicate-based activity-type reroute table attached to an adapter operation' },
    activityType: { description: 'fixed activity_type binding attached to an adapter operation (single value, mutually exclusive with activityRouting)' },
    activityLabels: { description: 'activity_type → human-readable display label table attached to a namespace' },
    hookEventLabel: { description: 'human-readable label attached to an adapter @hookEvent operation' },
    providerCapabilities: { description: 'provider capability/support-tier matrix attached to a namespace' },
    governProtocol: { description: 'cross-language governance protocol conformance fixture attached to a namespace' },
    backendPermissions: {
      description: 'backend operationId → required RBAC permissions table attached to a namespace',
    },
    sdkMethodNames: {
      description: 'backend operationId → public SDK method name table attached to a namespace',
    },
    sdkTargets: {
      description: 'SDK validation target manifest attached to a namespace',
    },
  },
});

export const { reportDiagnostic, createDiagnostic, stateKeys } = $lib;
