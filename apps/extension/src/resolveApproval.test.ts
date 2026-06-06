import { describe, expect, test, vi } from "vitest";

vi.mock("vscode", () => ({
  window: {
    showInformationMessage: vi.fn(),
  },
  EventEmitter: class {
    private listeners: Array<() => void> = [];
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

vi.mock("./notifications", () => ({
  showAutoDismissError: vi.fn(),
}));

import { ApprovalStore, type ApprovalState } from "./approvalStore";
import { resolveApproval } from "./resolveApproval";

function state(overrides: Partial<ApprovalState> = {}): ApprovalState {
  return {
    governance_event_id: "geid-1",
    agent_id: "agent-1",
    hook_event_name: "preToolUse",
    source: "socket",
    summary: "Read({})",
    reason: "approval required",
    expires_at: new Date(Date.now() + 30_000).toISOString(),
    created_at: Date.now(),
    status: "pending",
    ...overrides,
  };
}

function client(overrides: Record<string, unknown> = {}) {
  return {
    decideApproval: vi.fn(async () => undefined),
    getProfile: vi.fn(async () => ({ orgId: "org-1" })),
    getOrgApprovals: vi.fn(async () => ({ data: { approvals: { data: [] } } })),
    ...overrides,
  } as any;
}

describe("resolveApproval", () => {
  test("decides backend before resolving the local hook socket", async () => {
    const store = new ApprovalStore();
    const resolver = vi.fn();
    const c = client();
    store.upsert(state({ resolver }));

    const ok = await resolveApproval(store, c, "geid-1", "agent-1", "reject");

    expect(ok).toBe(true);
    expect(c.decideApproval).toHaveBeenCalledWith("agent-1", "geid-1", {
      action: "reject",
    });
    expect(resolver).toHaveBeenCalledWith("reject");
  });

  test("pushes the socket decision before running UI refresh callbacks", async () => {
    const store = new ApprovalStore();
    const order: string[] = [];
    const resolver = vi.fn(() => order.push("socket"));
    const onResolved = vi.fn(() => order.push("ui"));
    const c = client();
    store.upsert(state({ resolver }));

    const ok = await resolveApproval(
      store,
      c,
      "geid-1",
      "agent-1",
      "approve",
      onResolved,
    );

    expect(ok).toBe(true);
    expect(order).toEqual(["socket", "ui"]);
    expect(onResolved).toHaveBeenCalledWith(expect.objectContaining({
      governanceEventId: "geid-1",
      agentId: "agent-1",
      eventId: "geid-1",
      status: "approved",
      entry: expect.objectContaining({
        governance_event_id: "geid-1",
        summary: "Read({})",
        status: "pending",
      }),
    }));
    expect(store.get("geid-1")?.status).toBe("approved");
  });

  test("resolves the live socket entry when the UI passes a backend row id", async () => {
    const store = new ApprovalStore();
    const resolver = vi.fn();
    const c = client({
      getOrgApprovals: vi.fn(async () => ({
        approvals: {
          data: [
            {
              id: "backend-row-id",
              event_id: "geid-1",
              agent_id: "agent-1",
            },
          ],
        },
      })),
    });
    store.upsert(state({ governance_event_id: "geid-1", resolver }));

    const ok = await resolveApproval(store, c, "backend-row-id", "agent-1", "approve");

    expect(ok).toBe(true);
    expect(c.decideApproval).toHaveBeenCalledWith("agent-1", "backend-row-id", {
      action: "approve",
    });
    expect(resolver).toHaveBeenCalledWith("approve");
    expect(store.get("geid-1")?.status).toBe("approved");
  });

  test("does not resolve the local row when backend decide fails", async () => {
    const store = new ApprovalStore();
    const resolver = vi.fn();
    const c = client({
      decideApproval: vi.fn(async () => {
        throw Object.assign(new Error("401"), { status: 401 });
      }),
    });
    store.upsert(state({ resolver }));

    const ok = await resolveApproval(store, c, "geid-1", "agent-1", "reject");

    expect(ok).toBe(false);
    expect(resolver).not.toHaveBeenCalled();
    expect(store.get("geid-1")?.status).toBe("pending");
  });
});
