import { decideApproval } from '../approvals/index.js';
import { OpenBoxClient } from '../client/index.js';
import { CoreApiError } from '../core-client/core-client.js';
import {
  createCoreClientResolver,
  getApprovalBackendApiKey,
  hasApprovalBackendConfig,
  hasCoreRuntimeConfig,
} from './config-utils.js';
import type {
  OpenBoxApprovalDecisionRequest,
  OpenBoxApprovalDecisionResult,
  OpenBoxCopilotKitConfig,
} from './types.js';

export function createOpenBoxApprovalRoute(
  config: OpenBoxCopilotKitConfig = {},
) {
  return {
    async decide(
      request: OpenBoxApprovalDecisionRequest,
    ): Promise<OpenBoxApprovalDecisionResult> {
      if (
        !request.governanceEventId &&
        (!request.workflowId || !request.runId || !request.activityId)
      ) {
        throw new Error(
          'OpenBox approval decision requires governanceEventId or workflowId, runId, and activityId.',
        );
      }
      let coreUnavailableError: unknown;
      try {
        const resolved = await createCoreClientResolver(
          config,
        )().decideApproval({
          governance_event_id: request.governanceEventId,
          workflow_id: request.workflowId,
          run_id: request.runId,
          activity_id: request.activityId,
          decision: request.decision,
        });
        return { ok: true, decision: request.decision, eventId: resolved.id };
      } catch (error) {
        if (!shouldFallbackToBackendApproval(config, error)) {
          throw error;
        }
        coreUnavailableError = error;
      }

      const apiUrl = config.apiUrl ?? process.env.OPENBOX_API_URL;
      const apiKey = getApprovalBackendApiKey(config);
      const agentId = config.agentId ?? process.env.OPENBOX_AGENT_ID;
      if (!apiUrl || !apiKey) {
        if (coreUnavailableError instanceof Error) throw coreUnavailableError;
        if (!apiUrl) throw new Error('OpenBox API URL is not configured.');
        throw new Error('OpenBox backend API key is not configured.');
      }
      if (!request.governanceEventId) {
        throw new Error(
          'Legacy OpenBox backend approval bridge requires governanceEventId.',
        );
      }
      const client = new OpenBoxClient({
        apiUrl: apiUrl.replace(/\/+$/, ''),
        apiKey,
        clientName: config.clientName ?? 'openbox-copilotkit',
      });
      const resolved = await decideApproval(
        client,
        { governanceEventId: request.governanceEventId, agentId },
        request.decision,
      );
      return {
        ok: true,
        decision: request.decision,
        eventId: resolved.eventId,
      };
    },
  };
}

function shouldFallbackToBackendApproval(
  config: OpenBoxCopilotKitConfig,
  error: unknown,
): boolean {
  if (!hasApprovalBackendConfig(config)) return false;
  if (!hasCoreRuntimeConfig(config)) return true;
  return (
    error instanceof CoreApiError &&
    (error.status === 404 || error.status === 405)
  );
}
