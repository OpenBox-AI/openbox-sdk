// Platform-agnostic poll loop for org approvals. Extracted from the
// extension's `PollingService`; mobile's React hook layer wraps the
// same primitive. EventEmitter so consumers can attach as many
// listeners as they like (status bar, tree view, notification spawner)
// without rewiring the loop.
//
// We deliberately don't read env or token state here. The OpenBox
// client passed in already knows its env and handles auth headers;
// rebuilding it on env change happens in the consumer's boot flow.
//
// Usage:
//
//   const poll = new ApprovalsPollingService(client, orgId);
//   poll.on('changed', (approvals) => render(approvals));
//   poll.on('newApprovals', (newOnes) => notify(newOnes));
//   poll.on('error', (err) => log(err));
//   poll.start();
//
// Pause via `stop()` and re-run via `start()` cleanly — `knownIds`
// state is preserved across restarts so the next "newApprovals" event
// fires only for IDs that landed during the pause + after.

import { EventEmitter } from 'events';
import type { OpenBoxClient } from '../client/index.js';
import type { Approval } from '../types/index.js';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface PollingOptions {
  /** Poll interval in milliseconds. Default 5000. */
  intervalMs?: number;
  /** Page size for the approvals list call. Default 50. */
  perPage?: number;
  /** Status filter. Default "pending". */
  status?: ApprovalStatus;
}

const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_PER_PAGE = 50;
const DEFAULT_STATUS: ApprovalStatus = 'pending';

export class ApprovalsPollingService extends EventEmitter {
  private client: OpenBoxClient;
  private orgId: string;
  private intervalMs: number;
  private perPage: number;
  private status: ApprovalStatus;
  private knownIds = new Set<string>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private _approvals: Approval[] = [];

  constructor(client: OpenBoxClient, orgId: string, options: PollingOptions = {}) {
    super();
    this.client = client;
    this.orgId = orgId;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.perPage = options.perPage ?? DEFAULT_PER_PAGE;
    this.status = options.status ?? DEFAULT_STATUS;
  }

  get approvals(): Approval[] {
    return this._approvals;
  }

  start(): void {
    // Emit an initial "changed" with the empty buffer so consumers can
    // paint a "loading…" → "0 pending" transition without waiting for
    // the first network round-trip.
    this.emit('changed', []);
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async refresh(): Promise<void> {
    await this.poll();
  }

  private async poll(): Promise<void> {
    try {
      const result = await this.client.getOrgApprovals(this.orgId, {
        status: this.status,
        page: 0,
        perPage: this.perPage,
      });
      const approvals = (result.approvals?.data ?? []) as Approval[];
      const newIds = new Set(approvals.map((a) => a.id));

      const brandNew = approvals.filter((a) => !this.knownIds.has(a.id));
      const changed =
        this.knownIds.size !== newIds.size ||
        [...newIds].some((id) => !this.knownIds.has(id));

      // First poll: knownIds is empty, so `brandNew.length === approvals.length`.
      // Don't fire newApprovals on cold start — consumers shouldn't get a
      // toast for every preexisting pending row. The `this.knownIds.size > 0`
      // gate (snapshot taken before the assignment below) is the cold-start
      // guard.
      const isColdStart = this.knownIds.size === 0;

      this.knownIds = newIds;
      this._approvals = approvals;

      if (!isColdStart && brandNew.length > 0) {
        this.emit('newApprovals', brandNew);
      }
      if (changed) {
        this.emit('changed', approvals);
      }
    } catch (err) {
      this.emit('error', err);
    }
  }
}
