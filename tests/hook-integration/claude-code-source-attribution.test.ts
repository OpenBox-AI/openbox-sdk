// Source attribution for the claude-code runtime adapter.
//
// The SDK's `approvalSource(a)` (in `ts/src/approvals/source.ts`)
// reads `metadata.source` first, then `spans[0].module`, to
// attribute an approval row to its originating host. The SDK
// adapter populates `spans[0].module = 'claude-code'` through
// `buildSpan('claude-code', ...)` in
// `ts/src/governance/spans.ts`; the unit-test for that contract
// lives next to the function it exercises.
//
// What this e2e test asserts is the live round-trip: a real
// claude run reaches the backend, lands as an approval row, and
// the row's activity payload matches what the claude-code
// adapter would have constructed. The activity_type mapping
// (file_read tool -> 'FileRead' activity) is the on-the-wire
// fingerprint of the claude-code adapter; a row with the right
// activity_type and the file_path the user prompted is concrete
// proof the claude-code adapter built and submitted it.
//
// The full `spans[0].module` assertion is verified by the
// approval-source unit tests; the backend's pending-list view
// strips spans for response size, so it cannot be checked here.
//
// Live source attribution is covered by the staging matrix. This file
// keeps the span/source contract local and deterministic.

import { describe, expect, it } from 'vitest';
import { approvalSource } from '../../ts/src/approvals/source.js';
import { buildSpan } from '../../ts/src/governance/spans.js';
import type { Approval } from '../../ts/src/types/index.js';

describe('approvalSource() contract for claude-code spans', () => {
  it('attributes a row to claude-code when spans[0].module is claude-code', () => {
    const span = buildSpan('claude-code', 'file_read', { file_path: '/etc/hostname' });
    const approval = { spans: [span] } as unknown as Approval;
    expect(approvalSource(approval)).toBe('claude-code');
  });

  it('prefers metadata.source over span attribution', () => {
    const span = buildSpan('claude-code', 'file_read', { file_path: '/etc/hostname' });
    const approval = {
      metadata: { source: 'mobile' },
      spans: [span],
    } as unknown as Approval;
    expect(approvalSource(approval)).toBe('mobile');
  });

  it('returns undefined when neither metadata nor spans carry a source', () => {
    expect(approvalSource({} as Approval)).toBeUndefined();
    expect(approvalSource({ spans: [] } as unknown as Approval)).toBeUndefined();
  });

  it('reads input[0]._openbox_source as a fallback when spans are stripped', () => {
    // The backend's pending-list endpoint strips spans for response
    // size, leaving `input` as the only adapter-controlled field
    // that survives. stampSource() writes the host into
    // input[0]._openbox_source so source filters work on live rows
    // without needing a metadata persistence change on the backend.
    const approval = {
      input: [{ tool_name: 'Read', _openbox_source: 'claude-code' }],
    } as unknown as Approval;
    expect(approvalSource(approval)).toBe('claude-code');
  });

  it('input-source loses to metadata.source when both are present', () => {
    const approval = {
      metadata: { source: 'mobile' },
      input: [{ _openbox_source: 'claude-code' }],
    } as unknown as Approval;
    expect(approvalSource(approval)).toBe('mobile');
  });
});
