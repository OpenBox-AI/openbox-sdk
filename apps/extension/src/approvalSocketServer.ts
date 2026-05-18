// VS Code lifecycle wrapper for the OpenBox approval socket
// server. All wire-format and IPC logic lives in
// `openbox-sdk/approvals` so any host integration can use the
// same protocol. This file contains only the `vscode.Disposable`
// shim and the store-integration callback that turns incoming
// `pending` messages into `ApprovalStore` rows.

import * as vscode from "vscode";
import {
  ApprovalSocketServer as SdkApprovalSocketServer,
  type ApprovalPendingMessage,
  type ApprovalServerConnection,
} from "openbox-sdk/approvals";
import type { ApprovalStore, ApprovalState } from "./approvalStore";

export class ApprovalSocketServer implements vscode.Disposable {
  private readonly server: SdkApprovalSocketServer;

  constructor(
    private readonly store: ApprovalStore,
    private readonly log?: vscode.OutputChannel,
    socketPath?: string,
  ) {
    this.server = new SdkApprovalSocketServer(
      {
        onPending: (msg, conn) => this.handlePending(msg, conn),
        onConnectionClosed: (conn) => {
          for (const geid of conn.geids) this.store.detachResolver(geid);
        },
      },
      { socketPath, log: (line) => this.log?.appendLine(line) },
    );
  }

  start(): void {
    this.server.start();
  }

  private handlePending(
    msg: ApprovalPendingMessage,
    conn: ApprovalServerConnection,
  ): void {
    // Host scope: this is the Cursor extension, so reject pending
    // pushes from any non-cursor host. The socket at
    // `~/.openbox/run/openbox.sock` is shared, so a claude-code
    // hook subprocess can connect here; drop those rows before
    // they reach the store. Other hosts surface their approvals
    // through the source-neutral desktop approver and mobile app,
    // and through their own host-specific IDE extensions. A
    // missing or empty `source` is treated as cursor for
    // compatibility with adapters that do not stamp the field.
    if (msg.source && msg.source !== "cursor") {
      this.log?.appendLine(
        `[socket] dropped non-cursor pending (source=${msg.source}, geid=${msg.governance_event_id})`,
      );
      return;
    }
    const state: ApprovalState = {
      governance_event_id: msg.governance_event_id,
      agent_id: msg.agent_id,
      hook_event_name: msg.hook_event_name,
      source: "socket",
      summary: msg.summary ?? "",
      reason: msg.reason ?? "",
      expires_at:
        msg.expires_at ?? new Date(Date.now() + 30 * 60_000).toISOString(),
      created_at: Date.now(),
      status: "pending",
      resolver: (decision) =>
        conn.writeDecision(msg.governance_event_id, decision),
    };
    this.store.upsert(state);
  }

  dispose(): void {
    this.server.stop();
  }
}
