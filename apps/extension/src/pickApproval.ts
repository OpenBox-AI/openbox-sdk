// Pure approval-row resolver shared by the openbox.openDetail /
// approve / reject command handlers. Each command receives a value
// from one of three places and has to normalize it to an Approval
// row before doing anything:
//
//   - Tree node: `{ approval: Approval, ... }` (sidebar context-menu)
//   - Plain Approval: `{ id, agent_id, ... }` (history-item action)
//   - Bare id string: `"apr_xxx"` (preWriteGate's "Open in OpenBox"
//     modal button passes only the approvalId; lookup falls back to
//     pending → history → undefined).

import type { Approval } from "./types";

export interface ApprovalLookup {
  pending: Approval[];
  history: Approval[];
}

export function pickApproval(node: unknown, lookup: ApprovalLookup): Approval | undefined {
  if (!node) return undefined;
  if (typeof node === "string") {
    return (
      lookup.pending.find((a) => a.id === node) ??
      lookup.history.find((a) => a.id === node)
    );
  }
  if (typeof node === "object" && node !== null) {
    const obj = node as { approval?: Approval; id?: string };
    if (obj.approval) return obj.approval;
    if (obj.id) return obj as Approval;
  }
  return undefined;
}
