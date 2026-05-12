// Handler tests run with the env-driven verifier set in
// `beforeEach`. `vi.mock('node:crypto')` is unreliable, so the
// HMAC tests compute the expected signature inline.
//
// `openbox-sdk/governance` is mocked because the handler drives
// the SDK's in-process evaluator and the tests should not reach
// out for a runtime API key. The mock returns
// `{ verdict: 0, reason: <run-id + agent> }` so existing
// assertions on `body.reason` continue to hold.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';

vi.mock('openbox-sdk/governance', () => ({
  checkGovernance: vi.fn(async (opts: { agentId?: string; activityInput?: Record<string, unknown> }) => ({
    verdict: 0,
    reason: `governed run ${(opts.activityInput?.source_run_id as string) ?? 'unknown'} for agent ${opts.agentId ?? 'unknown'}`,
  })),
}));

const ORIG_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.OPENBOX_BRIDGE_SIGNING_SECRET;
  delete process.env.OPENBOX_BRIDGE_TOKEN;
});

afterEach(() => {
  process.env = { ...ORIG_ENV };
});

async function loadHandler() {
  // Env vars are read at call time inside `handler.ts`, so a single
  // import suffices; each test's beforeEach sets the env it needs.
  return await import('./handler');
}

describe('handleWebhook: verification', () => {
  it('with no secret + no token, accepts any request', async () => {
    const { handleWebhook } = await loadHandler();
    const result = await handleWebhook({
      rawBody: JSON.stringify({ agent_id: 'agt' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
  });

  it('with bearer token, rejects missing/wrong header', async () => {
    process.env.OPENBOX_BRIDGE_TOKEN = 'sekret';
    const { handleWebhook } = await loadHandler();
    const r1 = await handleWebhook({
      rawBody: JSON.stringify({ agent_id: 'agt' }),
      headers: {},
    });
    expect(r1.status).toBe(401);
    const r2 = await handleWebhook({
      rawBody: JSON.stringify({ agent_id: 'agt' }),
      headers: { authorization: 'Bearer wrong' },
    });
    expect(r2.status).toBe(401);
    const r3 = await handleWebhook({
      rawBody: JSON.stringify({ agent_id: 'agt' }),
      headers: { authorization: 'Bearer sekret' },
    });
    expect(r3.status).toBe(200);
  });

  it('with signing secret, validates HMAC and rejects mismatches', async () => {
    process.env.OPENBOX_BRIDGE_SIGNING_SECRET = 'secret-for-hmac';
    const { handleWebhook } = await loadHandler();
    const body = JSON.stringify({ agent_id: 'agt', action: 'review' });
    const sig = crypto.createHmac('sha256', 'secret-for-hmac').update(body).digest('hex');

    const ok = await handleWebhook({
      rawBody: body,
      headers: { 'x-openbox-signature': `sha256=${sig}` },
    });
    expect(ok.status).toBe(200);

    const bad = await handleWebhook({
      rawBody: body,
      headers: { 'x-openbox-signature': 'sha256=deadbeef' },
    });
    expect(bad.status).toBe(401);

    const missing = await handleWebhook({
      rawBody: body,
      headers: {},
    });
    expect(missing.status).toBe(401);
  });
});

describe('handleWebhook: payload parsing', () => {
  it('rejects invalid JSON', async () => {
    const { handleWebhook } = await loadHandler();
    const r = await handleWebhook({ rawBody: 'not json', headers: {} });
    expect(r.status).toBe(400);
  });

  it('rejects bodies missing agent_id', async () => {
    const { handleWebhook } = await loadHandler();
    const r = await handleWebhook({
      rawBody: JSON.stringify({ action: 'review' }),
      headers: {},
    });
    expect(r.status).toBe(400);
  });

  it('accepts agent id from X-OpenBox-Agent header', async () => {
    const { handleWebhook } = await loadHandler();
    const r = await handleWebhook({
      rawBody: JSON.stringify({ action: 'review', source_run_id: 'run-1' }),
      headers: { 'x-openbox-agent': 'agt_via_header' },
    });
    expect(r.status).toBe(200);
    expect(r.body.reason).toContain('agt_via_header');
    expect(r.body.reason).toContain('run-1');
  });
});
