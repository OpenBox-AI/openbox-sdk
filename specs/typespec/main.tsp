// Root TypeSpec entry. Delegates the API surface area to per-domain
// modules so the OpenAPI emitter can produce one document per service
// (OpenboxBackend.json + OpenboxCore.json under specs/generated/).
//
// Build: `npx tsp compile specs/typespec` from the repo root. Output
// lands under specs/generated/ (see tspconfig.yaml). TypeSpec is the
// source of truth; drift vs upstream backend/core is detected by
// .github/workflows/spec-drift.yml.

import "./backend/main.tsp";
import "./core/main.tsp";
import "./env/main.tsp";
import "./cli/main.tsp";
import "./govern/main.tsp";
import "./govern/adapters.tsp";
