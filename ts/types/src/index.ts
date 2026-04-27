// Hand-curated DTOs (friendly names, stable surface) - the primary exports.
export * from './requests.js';
export * from './responses.js';
export * from './governance.js';
export * from './auth.js';

// Auto-generated from OpenAPI specs - imports `Backend` / `Core` namespaces
// so consumers can reach raw schema types without colliding with the
// curated names above. Regenerate via `npm run generate:types`.
//
//   import type { Backend, Core } from 'openbox-sdk/types';
//   type CreateAgent = Backend.components['schemas']['CreateAgentDto'];
//   type EvaluateReq = Core.paths['/api/v1/governance/evaluate']['post']['requestBody'];
export * as Backend from './generated/backend.js';
export * as Core from './generated/core.js';
