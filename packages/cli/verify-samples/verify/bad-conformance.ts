// Regression fixture - triggers the 6 protocol-conformance rules added in Phase Q.
// Tracks: non-canonical-event-type, span-missing-gate-attribute,
// id-generated-per-event-not-reused, approval-poll-unbounded,
// require-approval-no-hitl-enabled.
// Plus raw-approval-response-verdict (reusing from primary set since it
// naturally fires when the SDK is used but polled with .verdict).

async function fire() {
  await fetch('/evaluate', {
    method: 'POST',
    headers: { 'X-Openbox-Client': 'test' },
    body: JSON.stringify({
      event_type: 'LLMStarted',
      workflow_id: crypto.randomUUID(),
      run_id: crypto.randomUUID(),
      spans: [{ hook_type: 'http_request', name: 'GET /api' }],
      activity_input: [{ prompt: 'x' }],
    }),
  });
}

async function pollForever(workflowId: string, runId: string, activityId: string) {
  while (true) {
    const r = await fetch('https://api.openbox.ai/api/v1/governance/approval', {
      method: 'POST',
      headers: { 'X-Openbox-Client': 'test' },
      body: JSON.stringify({ workflow_id: workflowId, run_id: runId, activity_id: activityId }),
    });
    const data = await r.json() as any;
    if (data.action === 'allow') return true;
    if (data.action === 'block' || data.action === 'halt') return false;
    await new Promise((r) => setTimeout(r, 5000));
  }
}

import { govern } from 'openbox-typescript-sdk';
async function useSdk() {
  const res = await govern(
    async (opts) => ({}),
    { apiKey: 'obx_live_...' },
    'wf', { x: 1 }, async (g) => ({}),
  );
  const v = (res as any).meta.verdict;
  if (v === 'require_approval') {
    // handle approval
  }
}
