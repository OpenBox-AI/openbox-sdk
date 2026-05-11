// Unix-domain-socket server for the extension. Hook subprocesses
// connect, push a "pending" message, and (optionally) wait for a
// "decision" message back. Each connection corresponds to one
// outstanding hook subprocess.
//
// On the wire:
//   hook → ext  {"type":"pending","governance_event_id":...,"agent_id":...,
//                "hook_event_name":...,"summary":...,"reason":...,
//                "expires_at":...}
//   ext  → hook {"type":"decision","governance_event_id":...,"decision":"approve"|"reject"}

import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as vscode from "vscode";
import type { ApprovalStore, ApprovalState } from "./approvalStore";

const RUN_DIR = path.join(os.homedir(), ".openbox", "run");
const SOCKET_PATH = path.join(RUN_DIR, "openbox.sock");

interface PendingMsg {
  type: "pending";
  governance_event_id: string;
  agent_id: string;
  hook_event_name: string;
  source: "cursor" | "claude-code";
  summary: string;
  reason: string;
  expires_at: string;
}

interface ConnState {
  socket: net.Socket;
  /** geids whose pending state lives on this connection. When the
   *  connection closes, drop their resolvers (hook subprocess died). */
  geids: Set<string>;
}

export class ApprovalSocketServer implements vscode.Disposable {
  private server: net.Server | undefined;
  private readonly conns = new Set<ConnState>();

  constructor(
    private readonly store: ApprovalStore,
    private readonly log?: vscode.OutputChannel,
  ) {}

  start(): void {
    try {
      fs.mkdirSync(RUN_DIR, { recursive: true, mode: 0o700 });
    } catch (err) {
      this.log?.appendLine(`[socket] mkdir failed: ${err}`);
    }
    // Stale socket from a previous extension crash blocks listen().
    // Unlink first; ignore ENOENT.
    try {
      fs.unlinkSync(SOCKET_PATH);
    } catch {
      /* ENOENT is fine */
    }

    this.server = net.createServer((socket) => this.onConnection(socket));
    this.server.on("error", (err) => {
      this.log?.appendLine(`[socket] server error: ${err}`);
    });
    this.server.listen(SOCKET_PATH, () => {
      try {
        fs.chmodSync(SOCKET_PATH, 0o600);
      } catch {
        /* ignore */
      }
      this.log?.appendLine(`[socket] listening at ${SOCKET_PATH}`);
    });
  }

  private onConnection(socket: net.Socket): void {
    const conn: ConnState = { socket, geids: new Set() };
    this.conns.add(conn);

    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        try {
          this.handleMessage(JSON.parse(line) as PendingMsg, conn);
        } catch (err) {
          this.log?.appendLine(`[socket] bad line: ${err}`);
        }
      }
    });

    socket.on("error", () => undefined);
    socket.on("close", () => {
      this.conns.delete(conn);
      // Drop resolvers for entries this connection was holding —
      // the hook subprocess is gone; pollApproval (or expiry) takes
      // over for resolution.
      for (const geid of conn.geids) this.store.detachResolver(geid);
    });
  }

  private handleMessage(msg: PendingMsg, conn: ConnState): void {
    if (msg.type !== "pending") return;
    if (!msg.governance_event_id) return;

    conn.geids.add(msg.governance_event_id);

    const state: ApprovalState = {
      governance_event_id: msg.governance_event_id,
      agent_id: msg.agent_id,
      hook_event_name: msg.hook_event_name,
      source: "socket",
      summary: msg.summary ?? "",
      reason: msg.reason ?? "",
      expires_at:
        msg.expires_at ??
        new Date(Date.now() + 30 * 60_000).toISOString(),
      created_at: Date.now(),
      status: "pending",
      resolver: (decision) => {
        try {
          conn.socket.write(
            JSON.stringify({
              type: "decision",
              governance_event_id: msg.governance_event_id,
              decision,
            }) + "\n",
          );
        } catch {
          /* socket may be mid-close; cleanup happens on 'close' */
        }
      },
    };
    this.store.upsert(state);
  }

  dispose(): void {
    for (const conn of this.conns) {
      try {
        conn.socket.destroy();
      } catch {
        /* ignore */
      }
    }
    this.conns.clear();
    this.server?.close();
    try {
      fs.unlinkSync(SOCKET_PATH);
    } catch {
      /* ignore */
    }
  }
}
