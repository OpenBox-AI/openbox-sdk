// Public sub-path: `import { checkGovernance } from 'openbox-sdk/governance'`
//
// Thin wrapper around core's evaluate endpoint that handles agent
// runtime-key resolution + OPA verdict shaping. Used by the
// extension's PreWriteGate / TabObserver / PreFileOpGate; usable by
// any other in-process consumer that has an agent_id.

export {
  checkGovernance,
  type CheckGovernanceOptions,
  type SpanType,
} from './check.js';
