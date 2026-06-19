// Public surface of `@openbox-ai/openbox-sdk`; single import path for everything.
//
//   import { OpenBoxClient, OpenBoxCoreClient, resolveConnection,
//            parseTokenStore, resolveClientName } from '@openbox-ai/openbox-sdk';
//
// Sub-paths exist for tree-shaking / RN bundlers; see package.json
// `exports` map. (`@openbox-ai/openbox-sdk/client`, `@openbox-ai/openbox-sdk/core-client`, etc.)

export * from './client/index.js';
export * from './env/index.js';
export * from './types/index.js';

// core-client carries the wire types from specs/typespec/core/. Re-export
// the classes + CoreClient-specific types here. Wire-shape types like
// `GovernanceEventPayload` live on core-client (single source of truth)
// and are consumed from there directly; `export *` would collide with
// `types/`, which re-exposes the same shapes via the `Backend`/`Core`
// namespaces.
export {
  OpenBoxCoreClient,
  CoreApiError,
  type CoreClientConfig,
  type ApprovalStatusRequest,
  type ApprovalStatusResponse,
  type ApprovalStatusResponseWithClientExpiry,

  // Spec-driven workflow runtime. `govern()` opens a workflow envelope,
  // exposes a typed session matching the chosen `preset`, and finalizes
  // (Workflow{Completed,Failed}) on return; even on throw / process
  // exit. Pick a preset (`presets.claudeCode`, `presets.langchain`,
  // `presets.default`, `presets.custom`, ...); generated from
  // specs/typespec/govern/main.tsp, manifest in PRESET_MANIFEST.
  govern,
  presets,
  PRESET_MANIFEST,
  BaseGovernedSession,
  SessionAlreadyTerminatedError,
  type Presets,
  type PresetCtor,
  type PresetName,
  type GovernedSessionConfig,
  type WorkflowVerdict,
  type VerdictArm,
  type GovernedPayload,
  type ActivityStage,
  type CanonicalEventType,
  type CanonicalVerdict,
} from './core-client/index.js';
