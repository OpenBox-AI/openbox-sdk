// Protocol helpers for resolving an approval row identity. Every
// surface that decides an approval (toast, detail panel, status
// bar, mobile sheet, backend approval decision route) needs the same
// pair of identifiers: the agent id and the approval row id. This
// module centralizes the resolution so all surfaces hit
// `PUT /agent/{id}/approvals/{eventId}/decide` with the correct
// values.
//
// Identifier note: the backend path parameter is named `{eventId}`,
// but the current Backend service resolves it against the approval
// row's primary-key `id`. `event_id` remains useful as a lookup key
// when callers only have the Core governance event id.
//
// The module deliberately contains no UI: no toasts, no
// notifications, no console output. Each consumer adds its own
// user-facing layer on top.

import type { OpenBoxClient } from '../client/index.js';

export interface ApprovalIdentityHint {
  /** Governance event id from the socket message, hook envelope,
   *  or caller's pre-known value. Acts as both the lookup needle
   *  and the path parameter when no fresher row is
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
  /** Approval row id to use in the `/decide` path. */
  eventId: string;
  /** Core governance event id, when the backend approval row exposes it. */
  governanceEventId?: string;
}

type ApprovalLookupRow = {
  id?: string;
  event_id?: string;
  agent_id?: string;
};

const APPROVAL_LOOKUP_PAGE_SIZE = 100;
const APPROVAL_LOOKUP_MAX_PAGES = 10;

function extractApprovalRows(payload: unknown): ApprovalLookupRow[] {
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as {
    approvals?: { data?: ApprovalLookupRow[] };
    data?: { approvals?: { data?: ApprovalLookupRow[] } };
  };
  return root.approvals?.data ?? root.data?.approvals?.data ?? [];
}

function findApprovalRow(
  rows: ApprovalLookupRow[],
  governanceEventId: string,
  storeGeid: string | undefined,
): ApprovalLookupRow | undefined {
  return rows.find(
    (r) =>
      (r.id && (r.id === governanceEventId || r.id === storeGeid)) ||
      (r.event_id && (r.event_id === governanceEventId || r.event_id === storeGeid)),
  );
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
  let governanceEventId: string | undefined = hint.storeRow?.governance_event_id;

  // Always consult the backend's pending list when we have a lookup
  // key. UI/socket surfaces can carry either the approval row's
  // primary `id` or the Core governance `event_id`, while the Backend
  // decide endpoint currently expects the row `id`.
  if (realGeid) {
    try {
      const profile = (await client.getProfile()) as { orgId?: string };
      const orgId = profile?.orgId;
      if (orgId) {
        const storeGeid = hint.storeRow?.governance_event_id;
        let match: ApprovalLookupRow | undefined;
        for (let page = 0; page < APPROVAL_LOOKUP_MAX_PAGES && !match; page += 1) {
          const list = await client.getOrgApprovals(orgId, {
            status: 'pending',
            page,
            perPage: APPROVAL_LOOKUP_PAGE_SIZE,
          });
          const rows = extractApprovalRows(list);
          match = findApprovalRow(rows, hint.governanceEventId, storeGeid);
          if (rows.length < APPROVAL_LOOKUP_PAGE_SIZE) break;
        }
        if (match) {
          aid ??= match.agent_id;
          governanceEventId = match.event_id ?? governanceEventId;
          realGeid = match.id ?? match.event_id ?? realGeid;
        }
      }
    } catch {
      /* keep the caller/store identity; missing agent id is surfaced below */
    }
  }

  if (!aid) {
    throw new ApprovalIdentityNotFoundError(
      'this approval row is no longer in the pending list; it may have already been resolved',
      hint,
    );
  }
  return { agentId: aid, eventId: realGeid, governanceEventId };
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
