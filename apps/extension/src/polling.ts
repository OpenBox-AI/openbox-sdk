import { EventEmitter } from "events";
import type { OpenBoxClient } from "openbox-sdk/client";
import type { Approval } from "./types";

const POLL_INTERVAL = 5000;

// Driven by extension.ts. We don't read env or token state here - the
// OpenBoxClient passed in already knows its env and handles auth/headers.
export class PollingService extends EventEmitter {
  private client: OpenBoxClient;
  private orgId: string;
  private knownIds = new Set<string>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private _approvals: Approval[] = [];

  constructor(client: OpenBoxClient, orgId: string) {
    super();
    this.client = client;
    this.orgId = orgId;
  }

  get approvals(): Approval[] {
    return this._approvals;
  }

  start() {
    this.emit("changed", []);
    this.poll();
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async refresh() {
    await this.poll();
  }

  private async poll() {
    try {
      // SDK returns `{ approvals: PaginatedResponse<Approval>, metrics }`.
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
    } catch (err) {
      this.emit("error", err);
    }
  }
}
