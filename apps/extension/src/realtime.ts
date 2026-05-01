// Realtime approval feed via the backend's /ws Socket.IO namespace.
//
// Drop-in replacement for PollingService when the WS path is healthy:
// same EventEmitter contract (`changed` / `newApprovals` / `error`), so
// extension.ts wires consumers identically.
//
// Architecture:
//   - One Socket.IO connection to <apiBase>/ws with the user's access
//     token in handshake.auth.token (matches WsAuthService; Keycloak JWT
//     against the realm's JWKS).
//   - Backend auto-joins the socket to org:<orgId>; we don't subscribe
//     explicitly. Server emits approval.created / approval.decided /
//     approval.expired into that room.
//   - Each event triggers a refetch of the pending list via the existing
//     OpenBoxClient.getOrgApprovals so the tree stays an authoritative
//     snapshot; we don't try to mutate cached state from event payloads
//     (that path is far more bug-prone for very little wire savings).
//   - On connect failure / hard disconnect, emit "error" so extension.ts
//     can fall back to PollingService.

import { EventEmitter } from "events";
import { io, Socket } from "socket.io-client";
import type { OpenBoxClient } from "openbox-sdk/client";
import type { Approval } from "./types";

const CONNECT_TIMEOUT_MS = 5_000;
// Coalesce bursty event arrivals (decision + expired in close succession,
// or several creates fanning in) into one refetch. Keeps the tree from
// flickering through transient mid-batch states.
const REFETCH_DEBOUNCE_MS = 150;

export class RealtimeService extends EventEmitter {
  private client: OpenBoxClient;
  private orgId: string;
  private apiBase: string;
  private accessToken: string;
  private socket: Socket | undefined;
  private knownIds = new Set<string>();
  private _approvals: Approval[] = [];
  private refetchTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(opts: {
    client: OpenBoxClient;
    orgId: string;
    apiBase: string;
    accessToken: string;
  }) {
    super();
    this.client = opts.client;
    this.orgId = opts.orgId;
    this.apiBase = opts.apiBase.replace(/\/$/, "");
    this.accessToken = opts.accessToken;
  }

  get approvals(): Approval[] {
    return this._approvals;
  }

  /**
   * Returns a promise that resolves when the socket connects, or rejects
   * if it doesn't connect within CONNECT_TIMEOUT_MS. extension.ts uses
   * this to decide whether to keep WS or fall back to polling; the WS
   * path is only a win if it actually connects.
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = io(`${this.apiBase}/ws`, {
        transports: ["websocket"],
        auth: { token: this.accessToken },
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelayMax: 30_000,
        timeout: CONNECT_TIMEOUT_MS,
      });

      const onConnect = () => {
        this.socket?.off("connect_error", onConnectError);
        // Initial fetch so the tree has data immediately; events thereafter
        // drive incremental refetches.
        this.refetch();
        resolve();
      };
      const onConnectError = (err: Error) => {
        this.socket?.off("connect", onConnect);
        this.socket?.disconnect();
        this.socket = undefined;
        reject(err);
      };

      this.socket.once("connect", onConnect);
      this.socket.once("connect_error", onConnectError);

      // Server emits these into the org:<orgId> room the socket auto-joins
      // on auth. Names per ws-events.constants.ts.
      this.socket.on("approval.created", () => this.scheduleRefetch());
      this.socket.on("approval.decided", () => this.scheduleRefetch());
      this.socket.on("approval.expired", () => this.scheduleRefetch());

      // Token expiry on the server side; gateway disconnects with this
      // event. We surface as error so the consumer can rebuild with a
      // fresh token (same as polling 401 handling).
      this.socket.on("token:expired", () => {
        this.emit("error", new Error("WS token expired; reconnect required"));
      });
    });
  }

  stop() {
    if (this.refetchTimer) {
      clearTimeout(this.refetchTimer);
      this.refetchTimer = undefined;
    }
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = undefined;
  }

  /** Manual refetch; UI commands ("refresh" button) call through here. */
  async refresh() {
    await this.refetch();
  }

  private scheduleRefetch() {
    if (this.refetchTimer) return;
    this.refetchTimer = setTimeout(() => {
      this.refetchTimer = undefined;
      this.refetch().catch(() => {
        // Errors already surfaced via the "error" event channel inside refetch.
      });
    }, REFETCH_DEBOUNCE_MS);
  }

  private async refetch() {
    try {
      const result = await this.client.getOrgApprovals(this.orgId, {
        status: "pending",
        page: 0,
        perPage: 50,
      });
      const approvals = result.approvals?.data ?? [];
      const newIds = new Set(approvals.map((a) => a.id));

      const brandNew = approvals.filter((a) => !this.knownIds.has(a.id));
      const changed =
        this.knownIds.size !== newIds.size ||
        [...newIds].some((id) => !this.knownIds.has(id));

      this.knownIds = newIds;
      this._approvals = approvals;

      if (brandNew.length > 0 && this.knownIds.size > 0) {
        this.emit("newApprovals", brandNew);
      }
      if (changed) {
        this.emit("changed", approvals);
      }
    } catch (err: any) {
      this.emit("error", err);
    }
  }
}
