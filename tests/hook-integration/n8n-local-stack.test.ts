import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { OpenBoxCoreClient } from '../../ts/src/core-client/core-client.js';
import { govern, presets } from '../../ts/src/core-client/generated/govern.js';
import {
  emitN8nGovernanceCheck,
  type N8nGovernanceCheckPayloadInput,
} from '../../ts/src/runtime/n8n/index.js';
import {
  LOCAL_GOVERNANCE_VERDICT_MATRIX,
  N8N_RUNTIME_VERDICT_MATRIX,
  requireProviderDriver,
  shouldSeedRule,
  type VerdictMatrixCase,
} from './fixtures/verdict-matrix.js';
import { ensureLocalGovernanceMatrix } from './helpers/local-governance-matrix.js';

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function activityInputFor(entry: VerdictMatrixCase): N8nGovernanceCheckPayloadInput['activityInput'] {
  return objectRecord(entry.activityInput);
}

describe('n8n local-stack governance', () => {
  it('drives generated runtime helper governance cases through local Core', async () => {
    const runtime = await ensureLocalGovernanceMatrix();
    expect(N8N_RUNTIME_VERDICT_MATRIX.map((entry) => entry.id)).toEqual(
      LOCAL_GOVERNANCE_VERDICT_MATRIX.map((entry) => entry.id),
    );

    for (const entry of N8N_RUNTIME_VERDICT_MATRIX) {
      const driver = requireProviderDriver(entry, 'n8n', 'runtime-helper');
      expect(driver).toMatchObject({
        event: 'governance-check',
        tool: 'emitN8nGovernanceCheck',
      });
      await govern(
        {
          preset: presets.n8n,
          core: new OpenBoxCoreClient({
            apiKey: runtime.runtimeKey,
            apiUrl: runtime.coreUrl,
            timeoutMs: 120_000,
          }),
          registerExitHandlers: false,
          workflowId: `n8n-${entry.id}-${randomUUID()}`,
          runId: randomUUID(),
          workflowType: 'n8n-local-stack-governance',
          taskQueue: 'n8n',
          inlineApproval: true,
        },
        async (session) => {
          const verdict = await emitN8nGovernanceCheck(session, {
            spanType: entry.spanType,
            activityInput: activityInputFor(entry),
            nodeName: 'OpenBox Governance',
            sessionId: `n8n-${entry.id}-${randomUUID()}`,
            prompt: entry.spanType === 'llm'
              ? String(objectRecord(entry.activityInput).prompt ?? entry.name)
              : undefined,
          });

          expect(verdict.arm, entry.id).toBe(entry.expectedVerdict);
          if (shouldSeedRule(entry)) {
            expect(verdict.reason, entry.id).toContain(entry.expectedRule);
          }
        },
      );
    }
  }, 300_000);
});
