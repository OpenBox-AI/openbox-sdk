// Source attribution for an approval row. The backend's `Approval`
// model has no first-class `source` column; the originating host
// (such as `cursor` or `claude-code`) is recoverable through two
// read paths the SDK guarantees:
//
//   1. `metadata.source`. Preferred. `ApprovalMetadata` is
//      open-keyed, so a future backend step can populate this from
//      the span data below without breaking the spec. Reading this
//      first means consumers automatically pick up the new field
//      once it lands.
//
//   2. `spans[0].module` or
//      `spans[0].attributes['gen_ai.system']`. Fallback that works
//      today. Every adapter calls `buildSpan(host, ...)` from
//      `governance/spans.ts`, which stamps `module: <host>` on
//      each span. The approval row carries the activity's spans
//      verbatim, so the first span's `module` identifies the
//      originating host.
//
// Approvals of unknown origin return `undefined` rather than a
// guess. Consumers (extension filter, approver badge, mobile chip)
// should treat `undefined` permissively, displaying the row rather
// than hiding it.

import type { Approval } from '../types/index.js';

/** Canonical host names. Free-form so a third-party host
 *  integration can use its own slug without an SDK change. */
export type ApprovalSource = string;

function readMetadataSource(a: Approval): string | undefined {
  const meta = (a as { metadata?: unknown }).metadata;
  if (!meta || typeof meta !== 'object') return undefined;
  const src = (meta as Record<string, unknown>).source;
  return typeof src === 'string' && src.length > 0 ? src : undefined;
}

function readSpanModule(a: Approval): string | undefined {
  const spans = (a as { spans?: unknown }).spans;
  if (!Array.isArray(spans) || spans.length === 0) return undefined;
  const span = spans[0];
  if (!span || typeof span !== 'object') return undefined;
  const s = span as Record<string, unknown>;
  // `module` is the canonical write site in `governance/spans.ts`.
  if (typeof s.module === 'string' && s.module.length > 0) return s.module;
  // `gen_ai.system` is the classifier-derived fallback for adapters
  // that did not set `module`.
  const attrs = s.attributes;
  if (attrs && typeof attrs === 'object') {
    const sys = (attrs as Record<string, unknown>)['gen_ai.system'];
    if (typeof sys === 'string' && sys.length > 0) return sys;
  }
  return undefined;
}

/**
 * Infers the originating host for an approval. The file header
 * describes the two read paths. Returns `undefined` when neither
 * source carries a value; callers should treat that as "unknown,
 * do not filter out".
 */
export function approvalSource(a: Approval): ApprovalSource | undefined {
  return readMetadataSource(a) ?? readSpanModule(a);
}
