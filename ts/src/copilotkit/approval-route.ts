import { decideApproval } from '../approvals/index.js';
import { OpenBoxClient } from '../client/index.js';
import {
  getApprovalBackendApiKey,
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
      if (!request.governanceEventId) {
        throw new Error(
          'OpenBox approval decision requires governanceEventId.',
        );
      }
      return decideViaBackend(config, request);
    },
  };
}

async function decideViaBackend(
  config: OpenBoxCopilotKitConfig,
  request: OpenBoxApprovalDecisionRequest,
): Promise<OpenBoxApprovalDecisionResult> {
  const apiUrl = config.apiUrl ?? process.env.OPENBOX_API_URL;
  const apiKey = getApprovalBackendApiKey(config);
  const agentId = config.agentId ?? process.env.OPENBOX_AGENT_ID;
  if (!apiUrl) throw new Error('OpenBox API URL is not configured.');
  if (!apiKey) throw new Error('OpenBox backend API key is not configured.');
  if (!request.governanceEventId) {
    throw new Error(
      'OpenBox backend approval decision requires governanceEventId.',
    );
  }
  const client = new OpenBoxClient({
    apiUrl: apiUrl.replace(/\/+$/, ''),
    apiKey,
    clientName: config.clientName ?? 'openbox-copilotkit',
    timeoutMs: config.backendTimeoutMs,
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
}
