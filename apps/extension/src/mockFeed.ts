// Mock approvals feed for openbox.mockAuth=true. Matches the subset
// of ApprovalsPollingService the extension consumes: emits 'changed'
// once on start, 'newApprovals' for the seed rows, and lets the
// caller approve/reject through `decideMockApproval`.
//
// Not an EventEmitter wrapper: just a tiny shape-compat interface so
// the consumer doesn't branch on mock vs real. The polling loop
// itself is unnecessary in mock mode (no network, fixtures don't
// drift).

import { EventEmitter } from 'events';
import type { Approval } from 'openbox-sdk/types';
import { getMockApprovals, decideMockApproval } from './__mocks__/fixtures';

export class MockApprovalsFeed extends EventEmitter {
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    const seed = getMockApprovals();
    // Mirror PollingService: 'changed' first with current state,
    // then 'newApprovals' once for the initial set so notification
    // handlers fire in mock mode too.
    setTimeout(() => {
      this.emit('changed', seed);
      this.emit('newApprovals', seed);
    }, 50);
  }

  stop(): void {
    this.started = false;
  }

  refresh(): void {
    this.emit('changed', getMockApprovals());
  }

  /** Mirror of OpenBoxClient.decideApproval for the consumer's
   *  decide-handlers. Returns a resolved promise so awaiters keep
   *  working. */
  decide(approvalId: string): Promise<void> {
    decideMockApproval(approvalId);
    this.emit('changed', getMockApprovals());
    return Promise.resolve();
  }

  get approvals(): Approval[] {
    return getMockApprovals();
  }
}
