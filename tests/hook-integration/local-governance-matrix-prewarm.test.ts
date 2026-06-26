import { describe, expect, it } from 'vitest';
import {
  LOCAL_GOVERNANCE_MATRIX_SETUP_TIMEOUT_MS,
  ensureLocalGovernanceMatrix,
} from './helpers/local-governance-matrix.js';

const SHOULD_RUN = process.env.OPENBOX_LOCAL_STACK_PROOF_LANE === 'prewarm-local-governance-matrix';

describe.runIf(SHOULD_RUN)('local governance matrix prewarm', () => {
  it('prewarms the shared local-stack governance matrix cache', async () => {
    const runtime = await ensureLocalGovernanceMatrix();
    expect(runtime.agentId).toBeTruthy();
    expect(runtime.runtimeKey).toMatch(/^obx_(?:test|live)_/);
  }, LOCAL_GOVERNANCE_MATRIX_SETUP_TIMEOUT_MS + 300_000);
});
