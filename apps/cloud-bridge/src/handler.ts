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

const RUNTIME_KEY_PATTERN = /^obx_(?:live|test)_[0-9a-f]{48}$/;

function isUnsafeLocalDevEnabled(): boolean {
  return process.env.OPENBOX_BRIDGE_UNSAFE_LOCAL_DEV === '1';
}

/** Verify the request: HMAC if a signing secret is set, else bearer
 *  token. Unauthenticated mode is intentionally opt-in because this
 *  process gates cloud-side agent output and may be bound publicly. */
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
  if (isUnsafeLocalDevEnabled()) return { ok: true };
  return {
    ok: false,
    reason:
      'missing bridge authentication; set OPENBOX_BRIDGE_SIGNING_SECRET or OPENBOX_BRIDGE_TOKEN',
  };
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

  const hasRuntimeKey =
    typeof process.env.OPENBOX_API_KEY === 'string' &&
    RUNTIME_KEY_PATTERN.test(process.env.OPENBOX_API_KEY);
  if (!hasRuntimeKey) {
    if (!isUnsafeLocalDevEnabled()) {
      return {
        status: 503,
        body: {
          ok: false,
          error:
            'missing agent runtime key; set OPENBOX_API_KEY to obx_live_*/obx_test_*',
        },
      };
    }
    return {
      status: 200,
      body: {
        ok: true,
        verdict: 'pass',
        reason: `governed run ${payload.sourceRunId} for agent ${payload.agentId}`,
      },
    };
  }

  try {
    // Drive the SDK's in-process evaluator. The span type is
    // `http` because the upstream produced an artifact via an
    // external call (webhook delivery body). The artifact is the
    // input the classifier sees; policies inspect it like any
    // other governed action.
    const { checkGovernance } = await import('openbox-sdk/governance');
    const verdict = await checkGovernance({
      agentId: payload.agentId,
      spanType: 'http',
      activityInput: {
        action: payload.action,
        source_run_id: payload.sourceRunId,
        artifact: payload.artifact,
        url: process.env.OPENBOX_BRIDGE_INBOUND_URL ?? 'cloud-bridge://webhook',
        method: 'POST',
      },
    });
    // Backend verdict envelope: `0` is allow, non-zero is gated.
    // The wire representation may be a numeric enum (current) or a
    // string label (older). Normalize to the string surfaced as
    // `verdict` in the response body either way.
    const v = (verdict as unknown as { verdict?: number | string; reason?: string }) ?? {};
    const numeric =
      typeof v.verdict === 'number'
        ? v.verdict
        : typeof v.verdict === 'string'
          ? ({ allow: 0, constrain: 1, require_approval: 2, block: 3, halt: 4 } as Record<string, number>)[v.verdict] ?? 0
          : 0;
    const label =
      numeric === 0
        ? 'pass'
        : numeric === 1
          ? 'constrain'
          : numeric === 2
            ? 'require_approval'
            : numeric === 3
              ? 'block'
              : 'halt';
    return {
      status: 200,
      body: {
        ok: numeric === 0,
        verdict: label,
        reason:
          v.reason ?? `governed run ${payload.sourceRunId} for agent ${payload.agentId}`,
      },
    };
  } catch (err: unknown) {
    const message =
      err && typeof err === 'object' && 'message' in err
        ? String((err as { message: unknown }).message)
        : String(err);
    return {
      status: 500,
      body: { ok: false, error: `governance evaluation failed: ${message}` },
    };
  }
}
