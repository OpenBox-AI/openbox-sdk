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

export * from 'openbox-sdk/client';
export * from 'openbox-sdk/env';
export * from 'openbox-sdk/types';

// `openbox-sdk/core-client` ships the wire types from
// specs/typespec/core/. Re-export the classes + CoreClient-specific
// types here. Wire-shape types like `GovernanceEventPayload` live on
// `openbox-sdk/core-client` (single source of truth) and are consumed
// from there directly to avoid `export *` collisions with
// `openbox-sdk/types` (which re-exposes the same shapes via the
// `Backend`/`Core` namespaces).
export {
  OpenBoxCoreClient,
  CoreApiError,
  type CoreClientConfig,
  type ApprovalStatusRequest,
  type ApprovalStatusResponse,
} from 'openbox-sdk/core-client';
