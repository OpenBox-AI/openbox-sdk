// ApprovalStore is the dedup point; verify the merge / resolve /
// reap contracts directly, since the whole "no duplicate toasts"
// guarantee rests on Map.set being the ONLY writer.

import { describe, expect, test, vi, beforeEach } from "vitest";

vi.mock("vscode", () => ({
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

import { ApprovalStore, type ApprovalState } from "./approvalStore";

function mkState(overrides: Partial<ApprovalState> = {}): ApprovalState {
  return {
    governance_event_id: "geid-1",
    agent_id: "a",
    hook_event_name: "beforeReadFile",
    source: "socket",
    summary: "/etc/passwd",
    reason: "rule fired",
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    created_at: Date.now(),
    status: "pending",
    ...overrides,
  };
}

describe("ApprovalStore", () => {
  let store: ApprovalStore;
  beforeEach(() => {
    store = new ApprovalStore();
  });

  test("upsert dedups by governance_event_id", () => {
    store.upsert(mkState());
    store.upsert(mkState({ summary: "newer summary" }));
    expect(store.pending()).toHaveLength(1);
    expect(store.pending()[0].summary).toBe("newer summary");
  });

  test("upsert preserves resolver if not overridden", () => {
    const r = vi.fn();
    store.upsert(mkState({ resolver: r }));
    store.upsert(mkState({ summary: "later" })); // no resolver field
    expect(store.pending()[0].resolver).toBe(r);
  });

  test("upsert preserves hydrated agent name if not overridden", () => {
    store.upsert(mkState({ agent_name: "Billing Assistant Preview" }));
    store.upsert(mkState({ summary: "later" }));
    expect(store.pending()[0].agent_name).toBe("Billing Assistant Preview");
  });

  test("get() and pending() return snapshots, not mutable store rows", () => {
    store.upsert(mkState());
    const viaGet = store.get("geid-1")!;
    const viaPending = store.pending()[0];

    viaGet.status = "approved";
    viaPending.summary = "mutated outside";

    expect(store.get("geid-1")?.status).toBe("pending");
    expect(store.pending()[0].summary).toBe("/etc/passwd");
  });

  test("resolve() fires resolver and emits change", () => {
    const r = vi.fn();
    const onChange = vi.fn();
    store.onChange(onChange);
    store.upsert(mkState({ resolver: r }));
    onChange.mockClear();
    store.resolve("geid-1", "approved");
    expect(r).toHaveBeenCalledWith("approve");
    expect(onChange).toHaveBeenCalled();
  });

  test("resolve() is no-op for already-resolved entries", () => {
    const r = vi.fn();
    store.upsert(mkState({ resolver: r }));
    store.resolve("geid-1", "approved");
    r.mockClear();
    store.resolve("geid-1", "rejected");
    expect(r).not.toHaveBeenCalled();
  });

  test("reapExpired resolves past-deadline entries to expired", () => {
    const r = vi.fn();
    store.upsert(
      mkState({
        expires_at: new Date(Date.now() - 1_000).toISOString(),
        resolver: r,
      }),
    );
    store.reapExpired();
    expect(r).toHaveBeenCalledWith("reject");
    expect(store.pending()).toHaveLength(0);
  });

  test("two sources merging into one entry", () => {
    const r = vi.fn();
    store.upsert(mkState({ source: "socket", resolver: r }));
    store.upsert(
      mkState({
        source: "poll",
        agent_id: "a-from-poll",
      }),
    );
    const final = store.pending()[0];
    expect(final.resolver).toBe(r); // socket-source resolver preserved
    expect(final.agent_id).toBe("a-from-poll"); // poll metadata wins
  });
});
