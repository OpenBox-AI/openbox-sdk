// Hand-curated DTOs (friendly names, stable surface); the primary exports.
// `governance.ts` was deleted; the same types live in `@openbox-ai/openbox-sdk/core-client`
// (generated from specs/typespec/core/main.tsp).
export * from './requests.js';
export * from './responses.js';
export * from './auth.js';

// Auto-generated from the TypeSpec contract; imports `Backend` / `Core`
// namespaces so consumers can reach raw schema types without colliding with
// the curated names above. Regenerate via `npm run specs:compile`.
//
//   import type { Backend, Core } from '../types/index.js';
//   type CreateAgent = Backend.components['schemas']['CreateAgentDto'];
//   type EvaluateReq = Core.paths['/api/v1/governance/evaluate']['post']['requestBody'];
export * as Backend from './generated/backend.js';
export * as Core from './generated/core.js';
