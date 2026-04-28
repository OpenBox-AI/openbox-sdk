// Public surface of `openbox-sdk` - single import path for everything.
//
// Install: `npm install github:OpenBox-AI/openbox-sdk`  (npm clones, runs
// `prepare` to build the workspaces + bundle, drops dist/ into node_modules).
//
// Use:
//   import { OpenBoxClient, OpenBoxCoreClient, ENVIRONMENTS, parseTokenStore,
//            resolveClientName } from 'openbox-sdk';
//
// Internal package layout (`ts/{client,core-client,env,types}/`) stays
// for CLI development, but consumers never see it - they get one flat
// module.

export * from '@openbox/client';
export * from '@openbox/env';
export * from '@openbox/types';

// `@openbox/core-client` ships the wire types from
// specs/typespec/core/. Re-export the classes + CoreClient-specific
// types here. Wire-shape types like `GovernanceEventPayload` live on
// `@openbox/core-client` (single source of truth) and are consumed
// from there directly to avoid `export *` collisions with
// `@openbox/types` (which re-exposes the same shapes via the
// `Backend`/`Core` namespaces).
export {
  OpenBoxCoreClient,
  CoreApiError,
  type CoreClientConfig,
  type ApprovalStatusRequest,
  type ApprovalStatusResponse,

  // Spec-driven workflow runtime. `govern()` opens a workflow envelope,
  // exposes a typed session matching the chosen `preset`, and finalizes
  // (Workflow{Completed,Failed}) on return - even on throw / process
  // exit. Pick a preset (`presets.claudeCode`, `presets.langchain`,
  // `presets.default`, `presets.custom`, ...) - generated from
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
} from '@openbox/core-client';
