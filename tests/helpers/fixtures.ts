// Re-exports from the canonical SDK location. The factories live at
// ts/src/test-utils/fixtures.ts so downstream tooling can
// `import { makeCreateAgentDto, ... } from 'openbox-sdk/test-utils'`
// against the same shapes the e2e suite uses.
export {
  makeCreateAgentDto,
  makeCreateGuardrailDto,
  makeCreatePolicyDto,
  makeCreateBehaviorRuleDto,
  makeUpdateAgentDto,
  makeGovernanceEvent,
  makeUpdateAivssConfigDto,
  makeGoalAlignmentConfigDto,
} from '../../ts/src/test-utils/fixtures.js';
