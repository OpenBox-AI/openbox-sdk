// VS Code wrapper for resolving an approval. All protocol logic
// (agent and event id lookup, the decide call, and the
// `event_id`-versus-`id` fallback) lives in
// `openbox-sdk/approvals`. This file is the UI layer: error and
// success toasts plus the store sync.
//
// Every UI button (toast, detail panel, status-bar action) routes
// through here so the decision path stays consistent.

import * as vscode from "vscode";
import type { OpenBoxClient } from "openbox-sdk/client";
import {
  decideApproval as sdkDecideApproval,
  ApprovalIdentityNotFoundError,
} from "openbox-sdk/approvals";
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
  try {
    const identity = await sdkDecideApproval(
      client,
      {
        governanceEventId: geid,
        agentId,
        storeRow: entry
          ? {
              agent_id: entry.agent_id,
              governance_event_id: entry.governance_event_id,
            }
          : undefined,
      },
      decision,
    );
    store.resolve(geid, decision === "approve" ? "approved" : "rejected");
    void vscode.window.showInformationMessage(
      decision === "approve" ? "[OpenBox] approved." : "[OpenBox] rejected.",
    );
    void identity; // returned for diagnostics; unused here
    return true;
  } catch (err: any) {
    if (err instanceof ApprovalIdentityNotFoundError) {
      void showAutoDismissError(`[OpenBox] cannot decide: ${err.message}.`);
      return false;
    }
    // Capture enough context that a 400 from the decide endpoint
    // is not a black box.
    console.error(
      "[openbox.resolveApproval] decideApproval failed",
      JSON.stringify({
        action: decision,
        agent_id_hint: agentId,
        path_geid_hint: geid,
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
