import { createOpenBoxApprovalRoute } from './approval-route.js';
import type {
  OpenBoxCopilotKitConfig,
  OpenBoxHeadlessApprovalClient,
  OpenBoxHeadlessApprovalRequest,
} from './types.js';

export function createOpenBoxHeadlessApprovalClient(
  config: OpenBoxCopilotKitConfig = {},
): OpenBoxHeadlessApprovalClient {
  const route = createOpenBoxApprovalRoute(config);
  return {
    decide(request) {
      const governanceEventId =
        request.governanceEventId ??
        stringValue(request.result?.governanceEventId);
      return route.decide({
        governanceEventId,
        workflowId: request.workflowId ?? stringValue(request.result?.workflowId),
        runId: request.runId ?? stringValue(request.result?.runId),
        activityId: request.activityId ?? stringValue(request.result?.activityId),
        decision: request.decision,
      });
    },
    approve(request) {
      return this.decide({ ...request, decision: 'approve' });
    },
    reject(request) {
      return this.decide({ ...request, decision: 'reject' });
    },
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}
