import { describe, it, expect } from 'vitest';
import { getBackendClient, fullResponse } from '../helpers/api-client';
import { GOVERNANCE_SPEC_DOMAINS } from '../helpers/governance-spec-domains';

describe('Webhooks', () => {
  const client = getBackendClient();
  const webhookId = '00000000-0000-4000-8000-000000000000';

  it('NEGATIVE: webhook CRUD operations are feature-gated when webhooks are disabled', async () => {
    // CONTRACT_BOUNDARY_PROOF: local-stack webhook lifecycle operations all fail
    // closed behind the organization webhooks feature gate before any webhook
    // is listed, created, updated, tested, secret-rotated, or deleted.
    // EXHAUSTIVE_SPEC_PROOF: every finite WebhookEventType and webhook
    // channel member is sent through create and update boundaries before the
    // local-stack feature gate fails closed.
    const list = await client.get('/webhook?page=0&perPage=5');
    expect(list.data.status).toBe(403);
    expect(list.data.message).toContain('webhooks');
    expect(list.data.message).toContain('not enabled');

    for (const channel of GOVERNANCE_SPEC_DOMAINS.webhookChannels) {
      for (const eventType of GOVERNANCE_SPEC_DOMAINS.webhookEventTypes) {
        const created = await client.post('/webhook', {
          name: `e2e-webhook-boundary-${channel}-${eventType.replace(/[^a-z0-9]+/gi, '-')}`,
          channel,
          url: channel === 'slack'
            ? 'https://hooks.slack.com/services/T000/B000/XXXX'
            : 'https://example.invalid/openbox-webhook',
          event_types: [eventType],
          description: 'local-stack feature gate proof',
        });
        expect(created.data.status, `${channel}:${eventType}`).toBe(403);
        expect(created.data.message, `${channel}:${eventType}`).toContain('webhooks');
      }
    }

    const read = await client.get(`/webhook/${webhookId}`);
    expect(read.data.status).toBe(403);
    expect(read.data.message).toContain('not enabled');

    for (const channel of GOVERNANCE_SPEC_DOMAINS.webhookChannels) {
      for (const eventType of GOVERNANCE_SPEC_DOMAINS.webhookEventTypes) {
        const updated = await client.patch(`/webhook/${webhookId}`, {
          name: `e2e-webhook-boundary-renamed-${channel}-${eventType.replace(/[^a-z0-9]+/gi, '-')}`,
          channel,
          event_types: [eventType],
          is_active: false,
        });
        expect(updated.data.status, `${channel}:${eventType}`).toBe(403);
        expect(updated.data.message, `${channel}:${eventType}`).toContain('webhooks');
      }
    }

    const tested = await client.post(`/webhook/${webhookId}/test`);
    expect(tested.data.status).toBe(403);
    expect(tested.data.message).toContain('not enabled');

    const regenerated = await client.post(`/webhook/${webhookId}/regenerate-secret`);
    expect(regenerated.data.status).toBe(403);
    expect(regenerated.data.message).toContain('webhooks');

    const deleted = await client.delete(`/webhook/${webhookId}`);
    expect(deleted.data.status).toBe(403);
    expect(deleted.data.message).toContain('not enabled');
  });

  it('NEGATIVE: webhook delivery logs are feature-gated when webhooks are disabled', async () => {
    // CONTRACT_BOUNDARY_PROOF: local-stack webhook delivery logs are behind the
    // organization webhooks feature gate. This proves the public delivery-log
    // route fails closed with the explicit feature-disabled error instead of
    // exposing or fabricating delivery state.
    expect(GOVERNANCE_SPEC_DOMAINS.webhookEventTypes).toEqual([
      'governance.verdict.block',
      'governance.verdict.halt',
      'governance.verdict.require_approval',
      'governance.verdict.constrain',
      'approval.decided',
      'approval.expired',
      'trust_score.decreased',
      'compliance.export.ready',
      'compliance.attestation.expiring',
    ]);

    const response = await client.get(`/webhook/${webhookId}/deliveries?page=0&perPage=10`);
    const body = fullResponse(response);

    expect(body.status).toBe(403);
    expect(body.message).toContain('webhooks');
    expect(body.message).toContain('not enabled');
  });
});
