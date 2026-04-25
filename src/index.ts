// Public surface of `openbox-sdk` - single import path for everything.
//
// Install: `npm install github:OpenBox-AI/openbox-sdk`  (npm clones, runs
// `prepare` to build the workspaces + bundle, drops dist/ into node_modules).
//
// Use:
//   import { OpenBoxClient, OpenBoxCoreClient, ENVIRONMENTS, parseTokenStore,
//            resolveClientName } from 'openbox-sdk';
//
// Internal package layout (`packages/{client,core-client,env,types}/`) stays
// for CLI development, but consumers never see it - they get one flat
// module.

export * from '@openbox/client';
export * from '@openbox/env';
export * from '@openbox/types';

// `@openbox/core-client` re-defines a handful of governance types that also
// live in `@openbox/types`. Re-export the runtime classes + the CoreClient-
// specific types only, to avoid `export *` collisions.
export {
  OpenBoxCoreClient,
  CoreApiError,
  type CoreClientConfig,
  type ApprovalPollRequest,
  type ApprovalPollResponse,
} from '@openbox/core-client';
