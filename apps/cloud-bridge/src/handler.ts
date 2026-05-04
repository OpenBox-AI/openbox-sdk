// Webhook handler: parse → verify → govern → respond.
//
// Provider-agnostic by design; the body shape is normalized into a
// `BridgePayload` before governance. New providers add a normalizer
// in `normalizers.ts` (TODO when we know the second provider's wire
// shape; currently only Cursor cloud-agent's completion event has a
// stable contract worth coding against).
import crypto from 'node:crypto';

export interface BridgePayload {
  /** Logical agent the run belongs to. Operator-provided via header
   *  or a query param; not derived from the provider payload. */
  agentId: string;
  /** Free-form action label (`cursor_cloud_agent_complete`, `bugbot_review`). */
  action: string;
  /** Diff / response / patch / whatever the upstream produced. */
  artifact: unknown;
  /** Stable identifier for idempotency / audit lookup. */
  sourceRunId: string;
}

export interface HandleInput {
  rawBody: string;
  headers: Record<string, string>;
}

export interface HandleResult {
  status: number;
  body: { ok: boolean; verdict?: string; reason?: string; error?: string };
}

/** Verify the request: HMAC if a signing secret is set, else bearer
 *  token. Skipped entirely when neither is configured (local dev).
 *  Env vars are read at call time so tests can flip them per case. */
function verify(input: HandleInput): { ok: true } | { ok: false; reason: string } {
  const signingSecret = process.env.OPENBOX_BRIDGE_SIGNING_SECRET;
  const sharedToken = process.env.OPENBOX_BRIDGE_TOKEN;
  if (signingSecret) {
    const sig = input.headers['x-openbox-signature'];
    if (!sig) return { ok: false, reason: 'missing X-OpenBox-Signature' };
    const expected = crypto.createHmac('sha256', signingSecret).update(input.rawBody).digest('hex');
    if (sig !== `sha256=${expected}`) return { ok: false, reason: 'signature mismatch' };
    return { ok: true };
  }
  if (sharedToken) {
    const auth = input.headers['authorization'] ?? '';
    if (auth !== `Bearer ${sharedToken}`) {
      return { ok: false, reason: 'invalid bearer token' };
    }
    return { ok: true };
  }
  // Neither configured; allow. The README warns about exposing the
  // bridge to the public internet without one of these set.
  return { ok: true };
}

function parsePayload(input: HandleInput): BridgePayload | null {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(input.rawBody) as Record<string, unknown>;
  } catch {
    return null;
  }
  // Allow header-driven `X-OpenBox-Agent` to override body for
  // providers that don't include the agent id in the payload.
  const agentId =
    input.headers['x-openbox-agent'] ?? (typeof body.agent_id === 'string' ? body.agent_id : null);
  if (!agentId) return null;
  return {
    agentId,
    action: typeof body.action === 'string' ? body.action : 'cloud_agent_complete',
    artifact: body.artifact ?? body.diff ?? body.result ?? body,
    sourceRunId: typeof body.source_run_id === 'string' ? body.source_run_id : crypto.randomUUID(),
  };
}

export async function handleWebhook(input: HandleInput): Promise<HandleResult> {
  const v = verify(input);
  if (!v.ok) return { status: 401, body: { ok: false, error: v.reason } };

  const payload = parsePayload(input);
  if (!payload) {
    return { status: 400, body: { ok: false, error: 'missing agent_id or invalid JSON' } };
  }

  // Governance call goes here. Stubbed until the SDK exposes a
  // standalone "govern this artifact" entrypoint; for the first
  // iteration we just echo the payload as `pass`. Wiring to
  // `check_governance` is straightforward but needs the agent-context
  // construction shared with the MCP server's `check_governance`
  // tool; pulling that into a shared `_shared/check.ts` is its own
  // refactor and lives in a follow-up.
  return {
    status: 200,
    body: {
      ok: true,
      verdict: 'pass',
      reason: `[stub] governed run ${payload.sourceRunId} for agent ${payload.agentId}`,
    },
  };
}
