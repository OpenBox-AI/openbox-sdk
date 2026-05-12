// Protocol helpers for resolving an approval row identity. Every
// surface that decides an approval (toast, detail panel, status
// bar, mobile sheet, `openbox approval decide` CLI) needs the same
// pair of identifiers: the agent id and the approval row's event
// id. This module centralizes the resolution so all surfaces hit
// `PUT /agent/{id}/approvals/{eventId}/decide` with the correct
// values.
//
// Identifier note: the path parameter `{eventId}` is the row's
// `event_id` field, which equals the SDK's `governance_event_id`.
// It is distinct from the row's primary-key `id`. When `event_id`
// is absent (older backends) the code falls back to `id`.
//
// The module deliberately contains no UI: no toasts, no
// notifications, no console output. Each consumer adds its own
// user-facing layer on top.

import type { OpenBoxClient } from '../client/index.js';

export interface ApprovalIdentityHint {
  /** Governance event id from the socket message, hook envelope,
   *  or caller's pre-known value. Acts as both the lookup needle
   *  and the fallback path parameter when no fresher row is
   *  available. */
  governanceEventId: string;
  /** Optional caller-supplied agent id (often pre-cached in a
   *  toast or detail panel). Takes precedence over store and
   *  backend lookups. */
  agentId?: string;
  /** Optional consumer-side row that already carries an agent id
   *  or a backend-authoritative governance event id. */
  storeRow?: {
    agent_id?: string;
    governance_event_id?: string;
  };
}

export interface ResolvedApprovalIdentity {
  /** Agent id to use in the `/decide` path. */
  agentId: string;
  /** Event id to use in the `/decide` path. Differs from the input
   *  `governanceEventId` when the backend's row carries a distinct
   *  `event_id`. */
  eventId: string;
}

/**
 * Resolves an `{agentId, eventId}` pair from a partial hint by
 * consulting, in order: the caller's `agentId`, then the
 * `storeRow`, then the backend pending-approvals list. Throws
 * when no agent id can be determined.
 */
export async function resolveApprovalIdentity(
  client: OpenBoxClient,
  hint: ApprovalIdentityHint,
): Promise<ResolvedApprovalIdentity> {
  const callerAid =
    hint.agentId && hint.agentId.length > 0 ? hint.agentId : undefined;
  const storeAid =
    hint.storeRow?.agent_id && hint.storeRow.agent_id.length > 0
      ? hint.storeRow.agent_id
      : undefined;
  let aid: string | undefined = callerAid ?? storeAid;
  let realGeid: string = hint.governanceEventId;

  // When the agent id is missing or a more authoritative event id
  // might be available, consult the backend's pending list once.
  if (!aid || !realGeid) {
    try {
      const profile = (await client.getProfile()) as { orgId?: string };
      const orgId = profile?.orgId;
      if (orgId) {
        const list = (await client.getOrgApprovals(orgId, {
          status: 'pending',
          perPage: 50,
        })) as {
          data?: {
            approvals?: {
              data?: Array<{ id?: string; event_id?: string; agent_id?: string }>;
            };
          };
        };
        const rows = list?.data?.approvals?.data ?? [];
        const storeGeid = hint.storeRow?.governance_event_id;
        const match = rows.find(
          (r) =>
            (r.id && (r.id === hint.governanceEventId || r.id === storeGeid)) ||
            (r.event_id &&
              (r.event_id === hint.governanceEventId || r.event_id === storeGeid)),
        );
        if (match) {
          aid ??= match.agent_id;
          // The decide path takes the row's `event_id`, which
          // equals the SDK's `governance_event_id`, not the row's
          // primary-key `id` (the two are different UUIDs). Fall
          // back to `id` when the backend does not surface
          // `event_id`.
          realGeid = match.event_id ?? match.id ?? realGeid;
        }
      }
    } catch {
      /* surfaced as a missing-agent-id error below */
    }
  }

  if (!aid) {
    throw new ApprovalIdentityNotFoundError(
      'this approval row is no longer in the pending list; it may have already been resolved',
      hint,
    );
  }
  return { agentId: aid, eventId: realGeid };
}

/** Raised when no agent id can be resolved for a governance event id. */
export class ApprovalIdentityNotFoundError extends Error {
  constructor(message: string, readonly hint: ApprovalIdentityHint) {
    super(message);
    this.name = 'ApprovalIdentityNotFoundError';
  }
}

/**
 * Convenience helper that resolves the identity and posts the
 * decision in one call. Throws on either lookup or decide failure.
 * Returns the resolved identity so consumers can correlate logs
 * and store updates with the values actually sent on the wire.
 */
export async function decideApproval(
  client: OpenBoxClient,
  hint: ApprovalIdentityHint,
  decision: 'approve' | 'reject',
): Promise<ResolvedApprovalIdentity> {
  const identity = await resolveApprovalIdentity(client, hint);
  await client.decideApproval(identity.agentId, identity.eventId, {
    action: decision,
  });
  return identity;
}
