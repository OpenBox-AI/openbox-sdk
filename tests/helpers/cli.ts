import { vi } from 'vitest';
import { Command } from 'commander';

/**
 * Creates a mock OpenBoxClient with vi.fn() stubs for all public methods.
 */
export function createMockClient() {
  return {
    // Auth
    getProfile: vi.fn().mockResolvedValue({}),
    refreshTokens: vi.fn().mockResolvedValue({}),
    changePassword: vi.fn().mockResolvedValue({}),
    getUserRoles: vi.fn().mockResolvedValue([]),
    logout: vi.fn().mockResolvedValue(undefined),
    // Agent
    listAgents: vi.fn().mockResolvedValue({ data: [] }),
    createAgent: vi.fn().mockResolvedValue({ agent: { id: 'a1' }, token: 'tok' }),
    getAgent: vi.fn().mockResolvedValue({ id: 'a1' }),
    updateAgent: vi.fn().mockResolvedValue({ id: 'a1' }),
    deleteAgent: vi.fn().mockResolvedValue({ message: 'ok' }),
    // API Keys
    rotateApiKey: vi.fn().mockResolvedValue({ token: 'new-key' }),
    revokeApiKey: vi.fn().mockResolvedValue({ message: 'ok' }),
    // Guardrails
    listGuardrails: vi.fn().mockResolvedValue({ data: [] }),
    createGuardrail: vi.fn().mockResolvedValue({ id: 'g1' }),
    getGuardrail: vi.fn().mockResolvedValue({ id: 'g1' }),
    updateGuardrail: vi.fn().mockResolvedValue({ id: 'g1' }),
    deleteGuardrail: vi.fn().mockResolvedValue({ message: 'ok' }),
    reorderGuardrail: vi.fn().mockResolvedValue({ id: 'g1' }),
    getGuardrailMetrics: vi.fn().mockResolvedValue({}),
    getGuardrailViolationLogs: vi.fn().mockResolvedValue({ data: [] }),
    runGuardrailTest: vi.fn().mockResolvedValue({}),
    // Policies
    listPolicies: vi.fn().mockResolvedValue({ data: [] }),
    createPolicy: vi.fn().mockResolvedValue({ id: 'p1' }),
    getCurrentPolicies: vi.fn().mockResolvedValue([]),
    getPolicy: vi.fn().mockResolvedValue({ id: 'p1' }),
    updatePolicy: vi.fn().mockResolvedValue({ id: 'p1' }),
    getPolicyEvaluations: vi.fn().mockResolvedValue({ data: [] }),
    getPolicyMetrics: vi.fn().mockResolvedValue({}),
    evaluateRego: vi.fn().mockResolvedValue({}),
    // Behavior Rules
    getSemanticTypes: vi.fn().mockResolvedValue([]),
    listBehaviorRules: vi.fn().mockResolvedValue({ data: [] }),
    getCurrentBehaviorRules: vi.fn().mockResolvedValue([]),
    createBehaviorRule: vi.fn().mockResolvedValue({ id: 'b1' }),
    getBehaviorRule: vi.fn().mockResolvedValue({ id: 'b1' }),
    updateBehaviorRule: vi.fn().mockResolvedValue({ id: 'b1' }),
    deleteBehaviorRule: vi.fn().mockResolvedValue({ message: 'ok' }),
    restoreBehaviorRule: vi.fn().mockResolvedValue({ id: 'b1' }),
    toggleBehaviorRuleStatus: vi.fn().mockResolvedValue({ id: 'b1' }),
    getBehaviorRuleVersions: vi.fn().mockResolvedValue({ data: [] }),
    getBehaviorMetrics: vi.fn().mockResolvedValue({}),
    getBehaviorViolations: vi.fn().mockResolvedValue({ data: [] }),
    // Sessions
    listSessions: vi.fn().mockResolvedValue({ data: [] }),
    getActiveSessions: vi.fn().mockResolvedValue([]),
    getSession: vi.fn().mockResolvedValue({ id: 's1' }),
    getSessionLogs: vi.fn().mockResolvedValue({ data: [] }),
    getSessionGoalAlignmentStats: vi.fn().mockResolvedValue({}),
    getSessionReasoningTrace: vi.fn().mockResolvedValue({}),
    terminateSession: vi.fn().mockResolvedValue({ message: 'ok' }),
    // Trust
    getTrustHistories: vi.fn().mockResolvedValue([]),
    getTrustEvents: vi.fn().mockResolvedValue({ data: [] }),
    getTrustTierChanges: vi.fn().mockResolvedValue({ data: [] }),
    getTrustRecoveryStatus: vi.fn().mockResolvedValue({}),
    // AIVSS
    getAssessments: vi.fn().mockResolvedValue({ data: [] }),
    updateAivssConfig: vi.fn().mockResolvedValue({}),
    recalculateAivss: vi.fn().mockResolvedValue({}),
    calculateAivss: vi.fn().mockResolvedValue({}),
    // Goal Alignment
    updateGoalAlignment: vi.fn().mockResolvedValue({}),
    getGoalAlignmentTrend: vi.fn().mockResolvedValue({}),
    getGoalAlignmentRecentDrifts: vi.fn().mockResolvedValue([]),
    // Approvals
    getApprovalMetrics: vi.fn().mockResolvedValue({}),
    getPendingApprovals: vi.fn().mockResolvedValue({ data: [] }),
    getApprovalHistory: vi.fn().mockResolvedValue({ data: [] }),
    decideApproval: vi.fn().mockResolvedValue({}),
    // Observability
    getObservability: vi.fn().mockResolvedValue({}),
    getIssues: vi.fn().mockResolvedValue({ data: [] }),
    getInsightsMetrics: vi.fn().mockResolvedValue({}),
    getAgentLogs: vi.fn().mockResolvedValue({ data: [] }),
    getDriftLogs: vi.fn().mockResolvedValue({ data: [] }),
    getAgentMetrics: vi.fn().mockResolvedValue({}),
    // Violations
    getAllViolations: vi.fn().mockResolvedValue([]),
    getAgentViolations: vi.fn().mockResolvedValue({ data: [] }),
    markFalsePositive: vi.fn().mockResolvedValue({}),
    // Organization
    getOrganization: vi.fn().mockResolvedValue({ id: 'org1' }),
    getOrgSettings: vi.fn().mockResolvedValue({}),
    updateOrgSettings: vi.fn().mockResolvedValue({}),
    getDashboard: vi.fn().mockResolvedValue({}),
    getDashboardTierTrends: vi.fn().mockResolvedValue({}),
    getOrgSessions: vi.fn().mockResolvedValue({ data: [] }),
    getOrgApprovals: vi.fn().mockResolvedValue({ approvals: { data: [] }, metrics: { pending_count: 0 } }),
    getOrgApprovalMetrics: vi.fn().mockResolvedValue({}),
    getOrgApprovalSla: vi.fn().mockResolvedValue({}),
    getOrgApprovalHistory: vi.fn().mockResolvedValue({ data: [] }),
    // Teams
    listTeams: vi.fn().mockResolvedValue({ data: [] }),
    getTeamStats: vi.fn().mockResolvedValue({}),
    getTeam: vi.fn().mockResolvedValue({ id: 't1' }),
    createTeam: vi.fn().mockResolvedValue({ id: 't-new' }),
    updateTeam: vi.fn().mockResolvedValue({ id: 't1' }),
    deleteTeams: vi.fn().mockResolvedValue({ status: 200 }),
    getTeamMembers: vi.fn().mockResolvedValue({ data: [] }),
    addTeamMembers: vi.fn().mockResolvedValue({ status: 200 }),
    removeTeamMembers: vi.fn().mockResolvedValue({ status: 200 }),
    // Members
    listMembers: vi.fn().mockResolvedValue({ data: [] }),
    createUser: vi.fn().mockResolvedValue({ id: 'u1' }),
    updateMember: vi.fn().mockResolvedValue({ id: 'u1' }),
    assignRoles: vi.fn().mockResolvedValue({ message: 'ok' }),
    removeRoles: vi.fn().mockResolvedValue({ message: 'ok' }),
    removeMembers: vi.fn().mockResolvedValue({ message: 'ok' }),
    inviteUser: vi.fn().mockResolvedValue({ message: 'ok' }),
    // Audit
    getAuditLogs: vi.fn().mockResolvedValue({ data: [] }),
    getAuditLog: vi.fn().mockResolvedValue({ id: 'al1' }),
    exportAuditLogs: vi.fn().mockResolvedValue({ id: 'exp1' }),
    previewAuditExport: vi.fn().mockResolvedValue({}),
    getExportHistory: vi.fn().mockResolvedValue({ data: [] }),
    getExport: vi.fn().mockResolvedValue({ id: 'exp1' }),
    downloadExport: vi.fn().mockResolvedValue('binary-data'),
    deleteExport: vi.fn().mockResolvedValue({ message: 'ok' }),
    // Health
    health: vi.fn().mockResolvedValue({ status: 'ok' }),
  };
}

/**
 * Creates a mock OpenBoxCoreClient with vi.fn() stubs.
 */
export function createMockCoreClient() {
  return {
    health: vi.fn().mockResolvedValue('hello world'),
    validateApiKey: vi.fn().mockResolvedValue({ valid: true }),
    evaluate: vi.fn().mockResolvedValue({ verdict: 'ALLOW', action: 'allow' }),
    pollApproval: vi.fn().mockResolvedValue({ verdict: 'ALLOW', expired: false }),
  };
}

/**
 * Creates a Commander program with exitOverride to prevent process.exit in tests.
 */
export function createTestProgram(): Command {
  const program = new Command();
  program.exitOverride();
  return program;
}
