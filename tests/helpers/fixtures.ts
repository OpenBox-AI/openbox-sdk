// Re-exports from the canonical SDK location. The factories live at
// ts/src/test-utils/fixtures.ts so downstream tooling can
// `import { makeCreateAgentDto, ... } from '@openbox-ai/openbox-sdk/test-utils'`
// against the same shapes the e2e suite uses.
export {
  makeCreateAgentDto,
  makeCreateGuardrailDto,
  makeCreatePolicyDto,
  makeApprovalExpirationConformanceCase,
  makeEvaluateRegoConformanceCase,
  makeGoalDriftDetectedConformanceCase,
  makeGoalSignalOrderConformanceCase,
  makeGuardrailRunTestConformanceCases,
  makeGuardrailServiceUnavailableConformanceCase,
  makeOpaAliasDecisionConformanceCase,
  makeOpaUnsupportedConstrainConformanceCase,
  makeOpaUnavailableFailClosedConformanceCase,
  makeOpaVerdictMatrixConformanceCase,
  makeRequireApprovalPolicyConformanceCase,
  makeCreateBehaviorRuleDto,
  makeUpdateAgentDto,
  makeGovernanceEvent,
  makeUpdateAivssConfigDto,
  makeGoalAlignmentConfigDto,
} from '../../ts/src/test-utils/fixtures.js';
