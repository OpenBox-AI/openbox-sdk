// Root TypeSpec entry. Delegates the API surface area to per-domain
// modules so the OpenAPI emitter can produce one document per service
// (backend.json + core.yaml today; agent/cli/env protocols arrive in
// later phases).
//
// Build: `npx tsp compile specs/typespec` from the repo root. Output
// lands under specs/generated/ (see tspconfig.yaml). The hand-written
// specs/backend.json and specs/core.yaml stay authoritative until the
// emitted versions are byte-equivalent.

import "./backend/main.tsp";
import "./core/main.tsp";
import "./env/main.tsp";
import "./cli/main.tsp";
import "./govern/main.tsp";
