// End-to-end: real unix socket round trip between the SDK client +
// SDK server and the extension's `ApprovalStore`-binding wrapper.
// Runs against a temp socket path so the dev's real ~/.openbox/run/
// is untouched.

import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { connectApprovalSocket } from "../../../ts/src/approvals/socket-client";
import {
  ApprovalSocketServer as SdkApprovalSocketServer,
  type ApprovalPendingMessage,
  type ApprovalServerConnection,
} from "../../../ts/src/approvals/socket-server";

vi.mock("vscode", () => ({
  EventEmitter: class {
    listeners: Array<() => void> = [];
    event = (l: () => void) => {
      this.listeners.push(l);
      return { dispose: () => undefined };
    };
    fire() {
      for (const l of this.listeners) l();
    }
    dispose() {
      this.listeners = [];
    }
  },
}));

import { ApprovalStore } from "./approvalStore";

const TMP_RUN = fs.mkdtempSync(path.join(os.tmpdir(), "openbox-test-"));
const SOCK = path.join(TMP_RUN, "openbox.sock");

// Wire SDK server → extension's ApprovalStore. Same shape as the
// production wrapper in approvalSocketServer.ts; just runs against
// a temp socket path.
function startServerOnStore(store: ApprovalStore): SdkApprovalSocketServer {
  const server = new SdkApprovalSocketServer(
    {
      onPending: (msg: ApprovalPendingMessage, conn: ApprovalServerConnection) => {
        store.upsert({
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
        });
      },
      onConnectionClosed: (conn) => {
        for (const geid of conn.geids) store.detachResolver(geid);
      },
    },
    { socketPath: SOCK },
  );
  server.start();
  return server;
}

describe("approval socket round trip", () => {
  let store: ApprovalStore;
  let server: SdkApprovalSocketServer;

  beforeEach(() => {
    store = new ApprovalStore();
    server = startServerOnStore(store);
  });

  afterEach(() => {
    server.stop();
  });

  test("hook → ext: pending message lands in store", async () => {
    const conn = await connectApprovalSocket(SOCK);
    expect(conn).not.toBeNull();
    conn!.notifyPending({
      governance_event_id: "geid-x",
      agent_id: "a",
      hook_event_name: "beforeReadFile",
      source: "cursor",
      summary: "/etc/passwd",
      reason: "rule",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    await new Promise((r) => setTimeout(r, 50));
    const entry = store.get("geid-x");
    expect(entry?.status).toBe("pending");
    expect(entry?.summary).toBe("/etc/passwd");
    expect(entry?.resolver).toBeTypeOf("function");
    conn!.close();
  });

  test("ext → hook: decision pushed when store.resolve fires", async () => {
    const conn = await connectApprovalSocket(SOCK);
    conn!.notifyPending({
      governance_event_id: "geid-y",
      agent_id: "a",
      hook_event_name: "beforeShellExecution",
      source: "cursor",
      summary: "rm -rf /tmp/x",
      reason: "shell rule",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    await new Promise((r) => setTimeout(r, 50));
    const decisionP = conn!.awaitDecision("geid-y", 2_000);
    store.resolve("geid-y", "approved");
    const r = await decisionP;
    expect(r).toEqual({ kind: "decision", decision: "approve" });
    conn!.close();
  });

  test("graceful: connect fails when no server", async () => {
    server.stop();
    const conn = await connectApprovalSocket(SOCK);
    expect(conn).toBeNull();
  });

  test("hook disconnect drops resolver from store", async () => {
    const conn = await connectApprovalSocket(SOCK);
    conn!.notifyPending({
      governance_event_id: "geid-z",
      agent_id: "a",
      hook_event_name: "beforeReadFile",
      source: "cursor",
      summary: "/x",
      reason: "r",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(store.get("geid-z")?.resolver).toBeTypeOf("function");
    conn!.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(store.get("geid-z")?.resolver).toBeUndefined();
  });
});
