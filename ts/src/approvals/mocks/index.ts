// Re-exports for the dev-only fixtures sub-path.
//
//   import { mockProfile, getMockApprovals } from 'openbox-sdk/approvals/mocks';
//
// Kept on a separate sub-path so consumers can include or exclude the
// fixture payload at the bundler level (e.g. tree-shake out of prod web
// builds, ship in dev/mock-auth builds).

export {
  type ApprovalListStatus,
  mockProfile,
  mockMembers,
  mockAgents,
  canMockReadAgent,
  fromNow,
  agoMin,
  randInt,
  getMockApprovals,
  decideMockApproval,
  getMockOrgApprovals,
  getMockAgents,
  getMockAgentById,
  getMockMembers,
  resetMockData,
} from './fixtures.js';
