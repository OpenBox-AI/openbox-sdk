// One function for resolving an approval. Every UI button (toast,
// panel, status-bar action) calls this. Centralizing prevents the
// "three different decide call sites with three different IDs"
// problem from coming back.
//
// Flow:
//   1. Look up cached agent_id (toast + panel both have it).
//   2. POST decideApproval to the backend → 200 OK records the
//      decision.
//   3. Tell the store. Store fires resolver if any (sub-ms socket
//      push to the hook subprocess); store.onChange fires; views
//      re-render.

import * as vscode from "vscode";
import type { OpenBoxClient } from "openbox-sdk/client";
import type { ApprovalStore } from "./approvalStore";
import { showAutoDismissError } from "./notifications";

export async function resolveApproval(
  store: ApprovalStore,
  client: OpenBoxClient | undefined,
  geid: string,
  agentId: string | undefined,
  decision: "approve" | "reject",
): Promise<boolean> {
  if (!client) {
    void showAutoDismissError(
      "[OpenBox] cannot decide: extension not booted (no API key set?).",
    );
    return false;
  }
  const entry = store.get(geid);
  // Caller's hint takes precedence; fallback to store entry; LAST
  // resort: list pending and try to find the matching row. Empty-
  // string agent_id from a hook subprocess that couldn't validate
  // its API key is treated the same as missing.
  let aid: string | undefined =
    (agentId && agentId.length > 0 ? agentId : undefined) ??
    (entry?.agent_id && entry.agent_id.length > 0 ? entry.agent_id : undefined);

  // Same for governance_event_id: prefer caller geid, fall back to
  // anything the backend's polled row carries (id / event_id).
  let realGeid: string = geid;

  // If we don't have agent_id OR we want the most-authoritative geid,
  // ask the backend's pending list once. The dashboard poll path
  // should have it; if not, do an explicit fetch.
  if (!aid || !realGeid) {
    try {
      const profile = (await client.getProfile()) as { orgId?: string };
      const orgId = profile?.orgId;
      if (orgId) {
        const list = (await client.getOrgApprovals(orgId, {
          status: "pending",
          perPage: 50,
        })) as { data?: { approvals?: { data?: Array<{ id?: string; event_id?: string; agent_id?: string }> } } };
        const rows = list?.data?.approvals?.data ?? [];
        const match = rows.find(
          (r) =>
            (r.id && (r.id === geid || r.id === entry?.governance_event_id)) ||
            (r.event_id && (r.event_id === geid || r.event_id === entry?.governance_event_id)),
        );
        if (match) {
          aid ??= match.agent_id;
          // PUT /agent/{id}/approvals/{eventId}/decide takes the row's
          // `event_id` (== the SDK's `governance_event_id`), not the
          // row's internal primary key `id`. They're different UUIDs.
          // Fall back to `id` for older backends without `event_id`.
          realGeid = match.event_id ?? match.id ?? realGeid;
        }
      }
    } catch {
      /* fall through; the call below will fail with a real error */
    }
  }

  if (!aid) {
    void showAutoDismissError(
      "[OpenBox] cannot decide: this approval row is no longer in the pending list. It may have already been resolved.",
    );
    return false;
  }

  try {
    await client.decideApproval(aid, realGeid, {
      action: decision === "approve" ? "approve" : "reject",
    });
    store.resolve(geid, decision === "approve" ? "approved" : "rejected");
    void vscode.window.showInformationMessage(
      decision === "approve" ? "[OpenBox] approved." : "[OpenBox] rejected.",
    );
    return true;
  } catch (err: any) {
    // Surface enough diagnostics that the next 400 isn't a black box.
    // The toast message itself stays terse; the full request shape
    // and response body land in the OpenBox extension log so the
    // user can copy them when reporting a bug. Captured fields:
    // - aid: agent_id sent to the backend
    // - realGeid: the path parameter (approval row id from the
    //   getOrgApprovals lookup, or the original socket-supplied
    //   geid if the lookup didn't match)
    // - geid: the original socket-supplied governance_event_id
    // - status / response body from the failing PUT
    console.error(
      "[openbox.resolveApproval] decideApproval failed",
      JSON.stringify({
        action: decision,
        agent_id: aid,
        path_geid: realGeid,
        original_geid: geid,
        lookup_used_fresh_list: aid !== agentId || realGeid !== geid,
        err_status: err?.status,
        err_message: err?.message,
        err_body: err?.responseBody ?? err?.data ?? err?.response?.data,
      }),
    );
    void showAutoDismissError(
      `[OpenBox] ${decision} failed (${err?.status ?? "?"}): ${err?.message ?? err}.`,
    );
    return false;
  }
}
