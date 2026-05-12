// Single source of truth for pending / resolved approvals in the
// extension. Two ingest sources (socket from hooks, polling from
// dashboard) both upsert into one Map keyed by governance_event_id.
// Three view sinks (toast, panel, status bar) subscribe via the
// onChange event and re-render off the current snapshot.
//
// Race conditions are impossible by construction: there's one writer
// per governance_event_id at the data-structure level (Map.set),
// regardless of which source observed it first or how many times.

import * as vscode from "vscode";

export interface ApprovalState {
  governance_event_id: string;
  agent_id: string;
  hook_event_name: string;
  /** "socket" if a hook subprocess pushed via IPC; "poll" if the
   *  dashboard polling loop saw it first (e.g. created via API). */
  source: "socket" | "poll";
  /** One-line description for the toast: command, file path, etc. */
  summary: string;
  /** Backend reject_message verbatim. View layer sanitizes via format.ts. */
  reason: string;
  expires_at: string;
  created_at: number;
  status: "pending" | "approved" | "rejected" | "expired";
  /** When the source is a live hook subprocess connection, this
   *  closure pushes the user's decision back over the socket so the
   *  hook's pollApproval race can resolve immediately. Poll-source
   *  entries don't have one; the hook will pick up the decision via
   *  its own pollApproval cycle (~500ms slower). */
  resolver?: (decision: "approve" | "reject") => void;
}

export class ApprovalStore implements vscode.Disposable {
  private readonly map = new Map<string, ApprovalState>();
  private readonly _onChange = new vscode.EventEmitter<void>();
  readonly onChange = this._onChange.event;

  get(geid: string): ApprovalState | undefined {
    return this.map.get(geid);
  }

  /** Snapshot of pending entries; views render off this. */
  pending(): ApprovalState[] {
    return Array.from(this.map.values()).filter((s) => s.status === "pending");
  }

  /** Total count for status-bar pip. */
  pendingCount(): number {
    return this.pending().length;
  }

  /**
   * Insert or merge state. Sources call this; multiple sources merging
   * into one entry is fine; later upserts override earlier fields,
   * with the resolver preserved if the upsert doesn't carry one.
   */
  upsert(state: ApprovalState): void {
    const existing = this.map.get(state.governance_event_id);
    if (existing) {
      this.map.set(state.governance_event_id, {
        ...existing,
        ...state,
        resolver: state.resolver ?? existing.resolver,
      });
    } else {
      this.map.set(state.governance_event_id, state);
    }
    this._onChange.fire();
  }

  /**
   * Mark resolved. If a resolver is attached (live hook subprocess
   * waiting on the socket), push the decision back. The entry stays
   * in the map briefly so the UI can render the resolved state, then
   * the cleanup timer drops it.
   */
  resolve(
    geid: string,
    status: "approved" | "rejected" | "expired",
  ): void {
    const entry = this.map.get(geid);
    if (!entry || entry.status !== "pending") return;
    entry.status = status;
    if (entry.resolver && (status === "approved" || status === "rejected")) {
      try {
        entry.resolver(status === "approved" ? "approve" : "reject");
      } catch {
        /* hook may have disconnected; ignore */
      }
    }
    this._onChange.fire();
    setTimeout(() => {
      const cur = this.map.get(geid);
      if (cur && cur.status !== "pending") {
        this.map.delete(geid);
        this._onChange.fire();
      }
    }, 5_000);
  }

  /**
   * Drop an entry without resolving it (e.g. socket disconnected
   * mid-flight; hook subprocess died). The dashboard panel may still
   * show it via the polling source until that path catches up.
   */
  drop(geid: string): void {
    if (this.map.delete(geid)) this._onChange.fire();
  }

  /**
   * Detach the live resolver from an entry (the hook subprocess that
   * was waiting on the socket disconnected). The entry stays pending
   *; pollApproval will eventually resolve it via the dashboard path
   *; but we no longer have a live socket to push the decision over.
   */
  detachResolver(geid: string): void {
    const entry = this.map.get(geid);
    if (!entry || !entry.resolver) return;
    entry.resolver = undefined;
    this._onChange.fire();
  }

  /** Sweep entries past expires_at. Called periodically by the
   *  extension's tick. */
  reapExpired(): void {
    const now = Date.now();
    let changed = false;
    for (const [geid, s] of this.map) {
      if (s.status === "pending" && Date.parse(s.expires_at) < now) {
        s.status = "expired";
        if (s.resolver) {
          try {
            s.resolver("reject");
          } catch {
            /* ignore */
          }
        }
        changed = true;
      }
    }
    if (changed) this._onChange.fire();
  }

  dispose(): void {
    this._onChange.dispose();
    this.map.clear();
  }
}
