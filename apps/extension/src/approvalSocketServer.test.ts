// End-to-end: real unix socket round trip between the SDK's client
// (runtime/_shared/approval-socket-client) and the extension's server.
// Runs against a temp socket path so the dev's real ~/.openbox/run/
// is untouched.

import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { connectApprovalSocket } from "../../../ts/src/runtime/_shared/approval-socket-client";

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
import { ApprovalSocketServer } from "./approvalSocketServer";

const TMP_RUN = fs.mkdtempSync(path.join(os.tmpdir(), "openbox-test-"));
const SOCK = path.join(TMP_RUN, "openbox.sock");

// Patch the client's default path by passing the override.

describe("approval socket round trip", () => {
  let store: ApprovalStore;
  let server: ApprovalSocketServer;

  beforeEach(() => {
    store = new ApprovalStore();
    server = new (class extends ApprovalSocketServer {
      // Override the constant path with our temp by re-implementing start().
      start(): void {
        const net = require("node:net");
        // @ts-expect-error: poke into private to wire to TMP_RUN
        this.server = net.createServer((s: import("net").Socket) =>
          // @ts-expect-error: private
          this.onConnection(s),
        );
        try {
          fs.unlinkSync(SOCK);
        } catch {
          /* ignore */
        }
        // @ts-expect-error: private
        this.server.listen(SOCK);
      }
      dispose(): void {
        // @ts-expect-error: private
        this.server?.close();
        try {
          fs.unlinkSync(SOCK);
        } catch {
          /* ignore */
        }
      }
    })(store);
    server.start();
  });

  afterEach(() => {
    server.dispose();
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
    // Allow the server's data handler to run.
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
    // Begin awaiting the decision (would race pollApproval in real life).
    const decisionP = conn!.awaitDecision("geid-y", 2_000);
    // Simulate the user clicking Approve in the toast.
    store.resolve("geid-y", "approved");
    const r = await decisionP;
    expect(r).toEqual({ kind: "decision", decision: "approve" });
    conn!.close();
  });

  test("graceful: connect fails when no server", async () => {
    server.dispose();
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
