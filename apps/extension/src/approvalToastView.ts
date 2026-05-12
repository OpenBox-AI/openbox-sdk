// Toast-rendering view. Subscribes to ApprovalStore and:
//   - shows ONE notification per pending entry (track by geid)
//   - dismisses any open toast for an entry whose status flips to
//     resolved/expired/dropped (via VS Code's notifications.clearAll
//     since the per-toast dismiss API doesn't exist)
//   - wires Approve/Deny buttons through resolveApproval()
//
// This is the only notification path for pending approvals. The
// ApprovalStore unifies socket-pushed (from hook subprocesses) and
// poll-discovered (out-of-band created via API / dashboard) entries,
// so one toast renders regardless of source.

import * as vscode from "vscode";
import type { OpenBoxClient } from "openbox-sdk/client";
import type { ApprovalStore } from "./approvalStore";
import { sanitizeReason, eventLabel } from "./format";
import { resolveApproval } from "./resolveApproval";

interface Deps {
  store: ApprovalStore;
  getClient: () => OpenBoxClient | undefined;
  /** Status bar to pulse while pending entries exist. */
  statusBar?: vscode.StatusBarItem;
}

const WARNING_BG = new vscode.ThemeColor("statusBarItem.warningBackground");

/** Already showing a toast for these geids; don't spawn duplicates. */
const shownFor = new Set<string>();

export function startApprovalToastView(deps: Deps): vscode.Disposable {
  const sub = deps.store.onChange(() => sync(deps));
  // Initial pass for any entries that landed before subscription.
  sync(deps);
  return { dispose: () => sub.dispose() };
}

function sync(deps: Deps): void {
  const pending = deps.store.pending();
  // Pulse the status bar while at least one approval is pending.
  if (deps.statusBar) {
    deps.statusBar.backgroundColor = pending.length > 0 ? WARNING_BG : undefined;
  }
  // Dismiss stale toasts: anything we showed a toast for that is no
  // longer pending. VS Code's notification API can't selectively
  // dismiss; clearAll is the only lever. Conservative: only nuke
  // when at least one tracked entry has resolved out-of-band.
  let dropped = false;
  for (const geid of [...shownFor]) {
    if (!pending.find((p) => p.governance_event_id === geid)) {
      shownFor.delete(geid);
      dropped = true;
    }
  }
  if (dropped) {
    void vscode.commands.executeCommand("notifications.clearAll");
  }
  for (const entry of pending) {
    if (shownFor.has(entry.governance_event_id)) continue;
    shownFor.add(entry.governance_event_id);
    void renderOneToast(entry, deps);
  }
}

async function renderOneToast(
  entry: ReturnType<ApprovalStore["pending"]>[number],
  deps: Deps,
): Promise<void> {
  const label = eventLabel(entry.hook_event_name);
  const cleanReason = sanitizeReason(entry.reason);
  const cleanSummary = sanitizeReason(entry.summary).slice(0, 120);
  const headline = `[OpenBox] approval needed: ${label}${cleanSummary ? `: ${cleanSummary}` : ""}`;
  const detail = cleanReason
    ? `${cleanReason}\n\n${label}${cleanSummary ? `: ${cleanSummary}` : ""}`
    : `${label}${cleanSummary ? `: ${cleanSummary}` : ""}`;

  const choice = await vscode.window.showWarningMessage(
    headline,
    { modal: false, detail },
    "Approve",
    "Deny",
    "View",
  );
  shownFor.delete(entry.governance_event_id);
  if (!choice) return;
  if (choice === "View") {
    // Open the detail panel for this approval. The command
    // resolves by governance event id when handed a plain string
    // (see the `openbox.openDetail` registration in
    // `extension.ts`).
    void vscode.commands.executeCommand(
      "openbox.openDetail",
      entry.governance_event_id,
    );
    return;
  }
  await resolveApproval(
    deps.store,
    deps.getClient(),
    entry.governance_event_id,
    entry.agent_id,
    choice === "Approve" ? "approve" : "reject",
  );
}
