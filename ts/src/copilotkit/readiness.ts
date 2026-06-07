import { OpenBoxClient } from '../client/index.js';
import {
  createCoreClientResolver,
  getApprovalBackendApiKey,
} from './config-utils.js';
import { errorMessage } from './internal-utils.js';
import type { OpenBoxCopilotKitConfig } from './types.js';

export function createOpenBoxReadinessCheck(
  config: OpenBoxCopilotKitConfig = {},
) {
  return {
    async check(): Promise<{
      ok: boolean;
      mode: {
        enabled: boolean;
        strict: boolean;
        governanceMode: 'observe' | 'enforce';
        failClosed: boolean;
      };
      core: boolean;
      guardrails: boolean;
      policies: boolean;
      behaviorRules: boolean;
      approvals: boolean;
      capabilities: {
        promptGovernance: boolean;
        toolInputGovernance: boolean;
        toolOutputGovernance: boolean;
        finalOutputGovernance: boolean;
        approvals: boolean;
        guardrails: boolean;
        policies: boolean;
        behaviorRules: boolean;
      };
      errors: string[];
      warnings: string[];
    }> {
      const errors: string[] = [];
      const warnings: string[] = [];
      const mode = {
        enabled: config.enabled ?? process.env.OPENBOX_ENABLED !== 'false',
        strict: config.strict ?? true,
        governanceMode: config.governanceMode ?? ('enforce' as const),
        failClosed: config.failClosed ?? true,
      };
      const apiUrl = config.apiUrl ?? process.env.OPENBOX_API_URL;
      const apiKey = getApprovalBackendApiKey(config);
      const agentId = config.agentId ?? process.env.OPENBOX_AGENT_ID;
      const core = await readinessStep(errors, 'core', async () => {
        createCoreClientResolver(config)();
      });
      if (!apiUrl || !apiKey || !agentId) {
        const missing = [
          !apiUrl ? 'OPENBOX_API_URL' : undefined,
          !apiKey ? 'OPENBOX_BACKEND_API_KEY' : undefined,
          !agentId ? 'OPENBOX_AGENT_ID' : undefined,
        ]
          .filter(Boolean)
          .join(', ');
        warnings.push(`backend inventory not checked: missing ${missing}`);
        return {
          ok: core,
          mode,
          core,
          guardrails: false,
          policies: false,
          behaviorRules: false,
          approvals: false,
          capabilities: {
            promptGovernance: core,
            toolInputGovernance: core,
            toolOutputGovernance: core,
            finalOutputGovernance: core,
            approvals: false,
            guardrails: core,
            policies: core,
            behaviorRules: core,
          },
          errors,
          warnings,
        };
      }
      const client = new OpenBoxClient({
        apiUrl: apiUrl.replace(/\/+$/, ''),
        apiKey,
        clientName: config.clientName ?? 'openbox-copilotkit',
      });
      const guardrails = await readinessStep(errors, 'guardrails', () =>
        client.listGuardrails(agentId),
      );
      const policies = await readinessStep(errors, 'policies', () =>
        client.getCurrentPolicies(agentId),
      );
      const behaviorRules = await readinessStep(errors, 'behavior rules', () =>
        client.getCurrentBehaviorRules(agentId),
      );
      const approvals = await readinessStep(errors, 'approvals', () =>
        client.getPendingApprovals(agentId),
      );
      return {
        ok: core && guardrails && policies && behaviorRules && approvals,
        mode,
        core,
        guardrails,
        policies,
        behaviorRules,
        approvals,
        capabilities: {
          promptGovernance: core,
          toolInputGovernance: core,
          toolOutputGovernance: core,
          finalOutputGovernance: core,
          approvals,
          guardrails,
          policies,
          behaviorRules,
        },
        errors,
        warnings,
      };
    },
  };
}

async function readinessStep(
  errors: string[],
  name: string,
  fn: () => Promise<unknown> | unknown,
): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (error) {
    errors.push(`${name}: ${errorMessage(error)}`);
    return false;
  }
}
